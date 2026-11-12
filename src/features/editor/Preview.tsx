import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  LayoutGrid,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";
import { assetForClip, useEditor } from "../../stores/editor";
import { mediaUrl } from "../../lib/media";
import { formatClock, projectDuration } from "../../lib/time";
import { clipValue } from "../../lib/animation";
import { renderTransition } from "../../lib/transitionPreview";
import {
  clipTransitionPlan,
  transitionAlpha,
  transitionProgress,
  type ClipTransitionPlan,
} from "../../lib/transitions";
import { sourceOffsetAt, speedAt } from "../../lib/speed";
import { duckGainAt, midFilterQ, projectDuckingSegments } from "../../lib/audio";
import { recordMetric } from "../../lib/metrics";
import { useT } from "../../lib/i18n";
import { activeClips, buildTimelineIndex, type TimelineIndex } from "../../lib/timelineIndex";
import type { ChromaKeyOptions, Clip, DuckSegment, LutSettings, MaskPoint, Project } from "../../lib/types";

type PoolEntry = {
  kind: "video" | "audio" | "image";
  el: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  mediaId: string;
  source?: MediaElementAudioSourceNode;
  bass?: BiquadFilterNode;
  mid?: BiquadFilterNode;
  treble?: BiquadFilterNode;
  panner?: StereoPannerNode;
  compressor?: DynamicsCompressorNode;
  gain?: GainNode;
};

/**
 * How far ahead of the playhead a clip is prepared for decoding.
 *
 * A long timeline holds thousands of clips, and giving every one of them a
 * media element would multiply decoders and memory for material that is not
 * on screen. Only clips near the playhead are pooled.
 */
const POOL_LOOKAHEAD_SECONDS = 30;

/** How long a pooled element is kept after it leaves the window. */
const POOL_RETENTION_SECONDS = 10;

type Clock = { last: number; lastUi: number };
type MotionHistory = { frames: HTMLCanvasElement[]; lastTime: number };
let lutPreviewCanvas: HTMLCanvasElement | undefined;

function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function applyLutToCanvas(canvas: HTMLCanvasElement, lut: LutSettings) {
  const context = canvas.getContext("2d");
  if (!context || lut.data.length !== lut.size ** 3 * 3) return;
  const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
  if (scale < 1) {
    lutPreviewCanvas ??= document.createElement("canvas");
    const preview = lutPreviewCanvas;
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    if (preview.width !== width || preview.height !== height) { preview.width = width; preview.height = height; }
    const previewContext = preview.getContext("2d");
    if (!previewContext) return;
    previewContext.drawImage(canvas, 0, 0, width, height);
    applyLutToCanvas(preview, lut);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    return;
  }
  let image: ImageData;
  try { image = context.getImageData(0, 0, canvas.width, canvas.height); } catch { return; }
  const { data } = image;
  const size = lut.size;
  const domainMin = lut.domainMin ?? [0, 0, 0];
  const domainMax = lut.domainMax ?? [1, 1, 1];
  const sample = (r: number, g: number, b: number, channel: number) => lut.data[((r * size + g) * size + b) * 3 + channel];
  const blend = Math.max(0, Math.min(1, lut.strength));
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    const coords = [0, 1, 2].map((channel) => {
      const value = data[pixel + channel] / 255;
      return Math.max(0, Math.min(size - 1, ((value - domainMin[channel]) / (domainMax[channel] - domainMin[channel])) * (size - 1)));
    });
    const lo = coords.map(Math.floor);
    const hi = coords.map((_, channel) => Math.min(size - 1, lo[channel] + 1));
    const f = coords.map((value, channel) => value - lo[channel]);
    for (let channel = 0; channel < 3; channel++) {
      let transformed = 0;
      for (let ri = 0; ri < 2; ri++) for (let gi = 0; gi < 2; gi++) for (let bi = 0; bi < 2; bi++) {
        const weight = (ri ? f[0] : 1 - f[0]) * (gi ? f[1] : 1 - f[1]) * (bi ? f[2] : 1 - f[2]);
        transformed += sample(ri ? hi[0] : lo[0], gi ? hi[1] : lo[1], bi ? hi[2] : lo[2], channel) * weight;
      }
      data[pixel + channel] = Math.round(data[pixel + channel] * (1 - blend) + Math.max(0, Math.min(1, transformed)) * 255 * blend);
    }
  }
  context.putImageData(image, 0, 0);
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: "contain" | "cover",
) {
  if (!sourceWidth || !sourceHeight) return;
  const scale =
    fit === "cover"
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  try {
    ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } catch {
    // A frame that is not decodable yet (or a CORS failure) should not break
    // the compositor loop; the next frame will retry.
  }
}

function keyedFrame(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, options: ChromaKeyOptions, canvas: HTMLCanvasElement) {
  const width = Math.max(1, Math.min(1600, sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight * width / sourceWidth));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  ctx.clearRect(0, 0, width, height);
  try {
    ctx.drawImage(source, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const data = pixels.data;
    const hex = options.color.replace("#", "");
    const kr = Number.parseInt(hex.slice(0, 2), 16) || 0;
    const kg = Number.parseInt(hex.slice(2, 4), 16) || 0;
    const kb = Number.parseInt(hex.slice(4, 6), 16) || 0;
    const threshold = Math.max(0, Math.min(1, options.similarity)) * 441.67;
    const edge = Math.max(0.001, options.softness) * 441.67;
    for (let i = 0; i < data.length; i += 4) {
      const distance = Math.hypot(data[i] - kr, data[i + 1] - kg, data[i + 2] - kb);
      const t = Math.max(0, Math.min(1, (distance - threshold) / edge));
      data[i + 3] = Math.round(data[i + 3] * t * t * (3 - 2 * t));
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    return source;
  }
}

/**
 * Applies a clip mask in the clip's local frame.
 *
 * The mask travels with the clip: the caller applies the clip transform first,
 * so position and size are measured against the clip frame. The exporter uses
 * the same frame ordering.
 */
function applyClipMask(
  target: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
) {
  const mask = clip.mask;
  if (!mask || mask === "none") return;
  const minSide = Math.min(width, height);

  if (mask === "custom") {
    const points = clip.maskPoints ?? [];
    if (points.length < 3) return;
    target.beginPath();
    points.forEach((point, index) => {
      const x = (point.x - 0.5) * width;
      const y = (point.y - 0.5) * height;
      if (index === 0) target.moveTo(x, y);
      else target.lineTo(x, y);
    });
    target.closePath();
    target.clip();
    return;
  }

  const maskWidth = Math.max(1, (clip.maskWidth ?? 0.6) * minSide);
  const maskHeight = mask === "rectangle"
    ? Math.max(1, (clip.maskHeight ?? 0.6) * minSide)
    : maskWidth;
  const centerX = ((clip.maskX ?? 0.5) - 0.5) * width;
  const centerY = ((clip.maskY ?? 0.5) - 0.5) * height;

  const matrix = target.getTransform();
  target.translate(centerX, centerY);
  const rotation = ((clip.maskRotation ?? 0) * Math.PI) / 180;
  if (rotation) target.rotate(rotation);
  target.beginPath();
  if (mask === "circle") {
    target.arc(0, 0, maskWidth / 2, 0, Math.PI * 2);
  } else {
    target.rect(-maskWidth / 2, -maskHeight / 2, maskWidth, maskHeight);
  }
  target.clip();
  target.setTransform(matrix);
}

/**
 * Keeps a freehand mask to a workable vertex count.
 *
 * Affine points are sampled evenly, which is enough for a clip mask and keeps
 * the export expression short.
 */
function simplifyMaskPoints(points: MaskPoint[], max = 32): MaskPoint[] {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, index) =>
    points[Math.round((index * (points.length - 1)) / (max - 1))],
  );
}

/**
 * The transition plan of a clip: which transition plays into it, which plays
 * out of it, and whether its own edges fade it in or out.
 */
function transitionPlanOf(index: TimelineIndex | null, clip: Clip): ClipTransitionPlan {
  if (!index) return clipTransitionPlan(clip, null, null);
  const location = index.clipLocations.get(clip.id);
  if (!location) return clipTransitionPlan(clip, null, null);
  const { track, index: position } = location;
  return clipTransitionPlan(
    clip,
    track.transitions[position] ?? null,
    track.transitions[position + 1] ?? null,
  );
}

export function Preview() {
  const t = useT();
  const project = useEditor((state) => state.project);
  const currentTime = useEditor((state) => state.currentTime);
  const playing = useEditor((state) => state.playing);
  const setPlaying = useEditor((state) => state.setPlaying);
  const setCurrentTime = useEditor((state) => state.setCurrentTime);
  const selectedClipId = useEditor((state) => state.selectedClipId);
  const updateClip = useEditor((state) => state.updateClip);

  const [showGuides, setShowGuides] = useState(false);
  const [draftMaskPoints, setDraftMaskPoints] = useState<MaskPoint[]>([]);
  const [canvasBox, setCanvasBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const drawingMaskRef = useRef(false);
  const maskPointsRef = useRef<MaskPoint[]>([]);
  const guidesRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionHistoryRef = useRef<Map<string, MotionHistory>>(new Map());
  const chromaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<Map<string, PoolEntry>>(new Map());
  const poolWindowRef = useRef({ start: 0, end: 0 });
  const timelineIndexRef = useRef<TimelineIndex | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const duckRef = useRef<{ project: Project | null; segments: Map<string, DuckSegment[]> }>({ project: null, segments: new Map() });
  const rafRef = useRef(0);
  const drawRafRef = useRef(0);
  const retryDrawRef = useRef<number | null>(null);
  const clockRef = useRef<Clock>({ last: 0, lastUi: 0 });
  const projectRef = useRef(project);
  const playingRef = useRef(playing);
  const timeRef = useRef(currentTime);
  const lastSlowSeekWarningRef = useRef(0);

  const duration = project ? projectDuration(project.tracks, 0) : 0;
  const fps = project?.fps ?? 30;
  const selectedClip = project && selectedClipId
    ? project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId)
    : undefined;
  const drawingCustomMask = Boolean(
    selectedClip && selectedClip.kind === "video" && selectedClip.mask === "custom",
  );

  useEffect(() => {
    if (!drawingCustomMask) return;
    const updateBox = () => {
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (!canvas || !stage) return;
      const canvasRect = canvas.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const next = {
        left: canvasRect.left - stageRect.left,
        top: canvasRect.top - stageRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      };
      setCanvasBox((previous) =>
        previous.left === next.left && previous.top === next.top
          && previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    updateBox();
    const observer = new ResizeObserver(updateBox);
    if (stageRef.current) observer.observe(stageRef.current);
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener("resize", updateBox);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBox);
    };
  }, [drawingCustomMask, project?.width, project?.height]);

  const maskFrame = () => {
    if (!selectedClip || !project) return null;
    const localTime = Math.max(0, Math.min(selectedClip.duration, currentTime - selectedClip.start));
    const rotation = (clipValue(selectedClip, "rotation", localTime) * Math.PI) / 180;
    return {
      x: clipValue(selectedClip, "x", localTime),
      y: clipValue(selectedClip, "y", localTime),
      scale: Math.max(0.001, clipValue(selectedClip, "scale", localTime)),
      cos: Math.cos(rotation),
      sin: Math.sin(rotation),
    };
  };

  const maskPointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): MaskPoint | null => {
    const canvas = canvasRef.current;
    const activeProject = projectRef.current;
    const frame = maskFrame();
    if (!canvas || !activeProject || !frame) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // Undo the clip transform to store the point in the clip-local frame.
    const offsetX = event.clientX - rect.left - rect.width * (0.5 + frame.x);
    const offsetY = event.clientY - rect.top - rect.height * (0.5 + frame.y);
    const projectX = offsetX * (activeProject.width / rect.width);
    const projectY = offsetY * (activeProject.height / rect.height);
    const localX = (projectX * frame.cos + projectY * frame.sin) / frame.scale;
    const localY = (-projectX * frame.sin + projectY * frame.cos) / frame.scale;
    return {
      x: Math.max(0, Math.min(1, localX / activeProject.width + 0.5)),
      y: Math.max(0, Math.min(1, localY / activeProject.height + 0.5)),
    };
  };

  /** Maps clip-local mask points to pixels on the displayed canvas. */
  const maskOverlayPoints = (points: MaskPoint[]): string => {
    const activeProject = projectRef.current;
    const frame = maskFrame();
    if (!activeProject || !frame || !canvasBox.width || !canvasBox.height) return "";
    const centerX = canvasBox.width * (0.5 + frame.x);
    const centerY = canvasBox.height * (0.5 + frame.y);
    return points.map((point) => {
      const localX = (point.x - 0.5) * activeProject.width * frame.scale;
      const localY = (point.y - 0.5) * activeProject.height * frame.scale;
      const rotatedX = localX * frame.cos - localY * frame.sin;
      const rotatedY = localX * frame.sin + localY * frame.cos;
      const x = centerX + rotatedX * (canvasBox.width / activeProject.width);
      const y = centerY + rotatedY * (canvasBox.height / activeProject.height);
      return `${x},${y}`;
    }).join(" ");
  };

  const startMaskDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawingCustomMask || !selectedClip) return;
    const point = maskPointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    drawingMaskRef.current = true;
    maskPointsRef.current = [point];
    setDraftMaskPoints([point]);
    setPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const extendMaskDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawingMaskRef.current) return;
    const point = maskPointFromEvent(event);
    if (!point) return;
    const points = maskPointsRef.current;
    const last = points[points.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.004) {
      points.push(point);
      setDraftMaskPoints(points.slice());
    }
  };

  const finishMaskDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawingMaskRef.current) return;
    drawingMaskRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const points = simplifyMaskPoints(maskPointsRef.current);
    maskPointsRef.current = [];
    setDraftMaskPoints([]);
    if (selectedClip && points.length >= 3) {
      updateClip(selectedClip.id, { maskPoints: points });
    }
  };

  const syncPool = (time: number) => {
    const activeProject = projectRef.current;
    const container = hiddenRef.current;
    if (!activeProject || !container) return;

    // Only clips near the playhead get a media element. A long timeline holds
    // thousands of clips, and decoding all of them at once would dominate
    // memory and would keep every decoder busy.
    const windowStart = time - POOL_RETENTION_SECONDS;
    const windowEnd = time + POOL_LOOKAHEAD_SECONDS;
    const wanted = new Map<string, { mediaId: string; kind: "video" | "audio" | "image" }>();
    for (const track of activeProject.tracks) {
      if (track.kind === "text") continue;
      for (const clip of track.clips) {
        const clipEnd = clip.start + clip.duration;
        if (clip.start > windowEnd || clipEnd < windowStart) continue;
        const asset = assetForClip(activeProject, clip);
        if (!asset) continue;
        const kind = asset.info.isImage ? "image" : asset.info.hasVideo ? "video" : "audio";
        wanted.set(clip.id, {
          mediaId: asset.previewMediaId || asset.mediaId,
          kind,
        });
      }
    }
    poolWindowRef.current = { start: windowStart, end: windowEnd };

    for (const [clipId, entry] of poolRef.current) {
      const next = wanted.get(clipId);
      if (!next || next.mediaId !== entry.mediaId || next.kind !== entry.kind) {
        if (entry.kind !== "image") (entry.el as HTMLMediaElement).pause();
        try {
          entry.source?.disconnect();
          entry.gain?.disconnect();
        } catch {
          // Audio nodes may already be disconnected.
        }
        if (entry.el.parentElement === container) container.removeChild(entry.el);
        poolRef.current.delete(clipId);
      }
    }

    for (const [clipId, { mediaId, kind }] of wanted) {
      if (poolRef.current.has(clipId)) continue;
      if (kind === "image") {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = mediaUrl(mediaId);
        const entry: PoolEntry = { kind, el: image, mediaId };
        image.addEventListener("load", () => scheduleDraw());
        poolRef.current.set(clipId, entry);
      } else {
        const media = document.createElement(kind === "video" ? "video" : "audio") as
          | HTMLVideoElement
          | HTMLAudioElement;
        media.crossOrigin = "anonymous";
        media.preload = "auto";
        media.src = mediaUrl(mediaId);
        if (media instanceof HTMLVideoElement) {
          media.playsInline = true;
        }
        const refreshFrame = () => {
          syncElements(timeRef.current, playingRef.current);
          applyGains(timeRef.current);
          scheduleDraw();
        };
        media.addEventListener("loadedmetadata", refreshFrame);
        media.addEventListener("loadeddata", refreshFrame);
        media.addEventListener("seeked", () => {
          refreshFrame();
        });
        media.addEventListener("timeupdate", () => {
          if (!playingRef.current) scheduleDraw();
        });
        container.appendChild(media);
        const entry: PoolEntry = { kind, el: media, mediaId };
        poolRef.current.set(clipId, entry);
        // An element that joins the pool during playback needs the audio
        // graph as well, or it would be heard at full volume with no filters.
        connectAudio(entry);
      }
    }
  };

  /**
   * Refreshes the media pool when the playhead leaves the pooled window.
   * During playback this runs once per window rather than per frame.
   */
  const ensurePool = (time: number) => {
    const window = poolWindowRef.current;
    if (time >= window.start && time <= window.end) return;
    syncPool(time);
  };

  /**
   * Routes a pooled element through the Web Audio graph.
   *
   * Elements enter and leave the pool while playback runs, so every new
   * element has to be wired up as it is created. Otherwise a clip that starts
   * later in the timeline would play without its volume and filters.
   */
  const connectAudio = (entry: PoolEntry) => {
    const ctx = audioCtxRef.current;
    if (!ctx || entry.kind === "image" || entry.source) return;
    try {
      const source = ctx.createMediaElementSource(entry.el as HTMLMediaElement);
      const bass = ctx.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 180;
      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 3;
      const treble = ctx.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 4000;
      const panner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : undefined;
      const compressor = ctx.createDynamicsCompressor();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(bass);
      bass.connect(mid);
      mid.connect(treble);
      treble.connect(panner ?? compressor);
      if (panner) panner.connect(compressor);
      compressor.connect(gain);
      gain.connect(ctx.destination);
      entry.source = source;
      entry.bass = bass;
      entry.mid = mid;
      entry.treble = treble;
      entry.panner = panner;
      entry.compressor = compressor;
      entry.gain = gain;
    } catch {
      // Some media elements cannot be routed through Web Audio.
    }
  };

  const ensureAudio = async () => {
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtxRef.current = new Ctor();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();
    for (const entry of poolRef.current.values()) {
      connectAudio(entry);
    }
  };

  const syncElements = (time: number, isPlaying: boolean) => {
    const activeProject = projectRef.current;
    if (!activeProject) return;
    const active = new Set<string>();
    const index = timelineIndexRef.current;
    if (!index) return;

    for (const { track, clip } of activeClips(index, time)) {
      if (track.hidden || track.kind === "text") continue;
      active.add(clip.id);
      const entry = poolRef.current.get(clip.id);
      if (!entry || entry.kind === "image") continue;
      const media = entry.el as HTMLMediaElement;
      const localTime = time - clip.start;
      const rampSpeed = clip.speedRamp?.length ? speedAt(clip.speedRamp, clip.duration, localTime) : clip.speed;
      const audioRate = Math.min(8, Math.max(0.0625, rampSpeed * Math.pow(2, clip.pitch / 12)));
      media.preservesPitch = clip.pitch === 0;
      const target = Math.max(0, clip.trimIn + (clip.speedRamp?.length ? sourceOffsetAt(clip.speedRamp, clip.duration, localTime) : localTime * audioRate));
      const tolerance = isPlaying ? 0.22 : 0.015;
      if (Math.abs(media.currentTime - target) > tolerance) {
        try {
          media.currentTime = target;
        } catch {
          // Seeking can fail while metadata is still loading.
        }
      }
      media.playbackRate = audioRate;
      if (isPlaying) {
        if (media.paused) void media.play().catch(() => undefined);
      } else if (!media.paused) {
        media.pause();
      }
    }

    for (const [clipId, entry] of poolRef.current) {
      if (active.has(clipId) || entry.kind === "image") continue;
      const media = entry.el as HTMLMediaElement;
      if (!media.paused) media.pause();
    }

    // A clip that hands over to a clip with a transition is held on its last
    // frame while the transition runs, so the cut can blend the two clips.
    for (const { clip } of activeClips(index, time)) {
      const location = index.clipLocations.get(clip.id);
      if (!location) continue;
      const transition = location.track.transitions[location.index];
      if (!transition) continue;
      const previous = location.track.previous[location.index];
      if (!previous) continue;
      const previousEntry = poolRef.current.get(previous.id);
      if (!previousEntry || previousEntry.kind === "image") continue;
      const media = previousEntry.el as HTMLMediaElement;
      const rampSpeed = previous.speedRamp?.length
        ? speedAt(previous.speedRamp, previous.duration, previous.duration)
        : previous.speed;
      const target = Math.max(
        0,
        previous.trimIn +
          (previous.speedRamp?.length
            ? sourceOffsetAt(previous.speedRamp, previous.duration, previous.duration)
            : previous.duration * rampSpeed),
      );
      if (Math.abs(media.currentTime - target) > 0.04) {
        try {
          media.currentTime = target;
        } catch {
          // Seeking can fail while metadata is still loading.
        }
      }
      if (!media.paused) media.pause();
    }
  };

  const applyGains = (time: number) => {
    const activeProject = projectRef.current;
    if (!activeProject) return;
    if (duckRef.current.project !== activeProject) {
      duckRef.current = { project: activeProject, segments: projectDuckingSegments(activeProject) };
    }
    const duckSegments = duckRef.current.segments;
    const index = timelineIndexRef.current;
    if (!index) return;
    // The pool is bounded by the playhead window, so iterating it keeps this
    // cheap while still silencing clips that just left the playhead.
    for (const [clipId, entry] of poolRef.current) {
      if (!entry.gain) continue;
      const location = index.clipLocations.get(clipId);
      if (!location) {
        entry.gain.gain.value = 0;
        continue;
      }
      const clip = location.track.clips[location.index];
      const track = location.track.track;
      const trackVolume = track.volume ?? 1;
      const ducking = duckSegments.get(track.id);
      const isActive = !track.hidden && time >= clip.start && time < clip.start + clip.duration;
      const local = time - clip.start;
      const fadeIn = clip.fadeIn > 0 ? Math.min(1, local / clip.fadeIn) : 1;
      const fadeOut = clip.fadeOut > 0 ? Math.min(1, (clip.duration - local) / clip.fadeOut) : 1;
      const plan = transitionPlanOf(index, clip);
      // A clip that takes over fades its audio in while the transition runs.
      const transitions = plan.incoming && time < clip.start + plan.incoming.duration
        ? transitionProgress(plan.incoming, time)
        : transitionAlpha(clip, time, plan);
      const volume = clipValue(clip, "volume", local);
      const duck = ducking ? duckGainAt(ducking, time) : 1;
      const target = isActive
        ? Math.min(4, Math.max(0, volume)) * Math.min(fadeIn, fadeOut) * transitions * trackVolume * duck * (track.muted ? 0 : 1)
        : 0;
      if (entry.bass) {
        entry.bass.gain.value = clip.bass;
        entry.bass.frequency.value = clip.bassFrequency ?? 180;
      }
      if (entry.mid) {
        entry.mid.gain.value = clip.mid ?? 0;
        entry.mid.frequency.value = clip.midFrequency ?? 1000;
        entry.mid.Q.value = midFilterQ(clip.midWidth ?? 1);
      }
      if (entry.treble) {
        entry.treble.gain.value = clip.treble;
        entry.treble.frequency.value = clip.trebleFrequency ?? 4000;
      }
      if (entry.panner) {
        entry.panner.pan.value = Math.max(-1, Math.min(1, clip.pan));
      }
      if (entry.compressor) {
        const compressor = clip.compressor;
        entry.compressor.threshold.value = compressor?.enabled ? compressor.threshold : 0;
        entry.compressor.ratio.value = compressor?.enabled ? Math.max(1, compressor.ratio) : 1;
        entry.compressor.attack.value = Math.max(0, (compressor?.attack ?? 20) / 1000);
        entry.compressor.release.value = Math.max(0, (compressor?.release ?? 250) / 1000);
      }
      entry.gain.gain.value = target;
    }
  };

  /**
   * Draws one clip onto a context.
   *
   * The same helper paints the clip that is going away and the clip that
   * comes in, which is what a transition blends.
   */
  const drawClipLayer = (
    target: CanvasRenderingContext2D,
    targetClip: Clip,
    targetEntry: PoolEntry,
    localTime: number,
    alpha: number,
  ) => {
    const activeProject = projectRef.current;
    if (!activeProject) return;
    const source = targetEntry.el;
    const isImage = targetEntry.kind === "image";
    if (isImage) {
      const image = source as HTMLImageElement;
      if (!image.complete) return;
    } else {
      const video = source as HTMLVideoElement;
      if (video.seeking || video.readyState < 2) return;
    }
    target.save();
    target.translate(
      activeProject.width * (0.5 + clipValue(targetClip, "x", localTime)),
      activeProject.height * (0.5 + clipValue(targetClip, "y", localTime)),
    );
    target.rotate((clipValue(targetClip, "rotation", localTime) * Math.PI) / 180);
    const clipScale = clipValue(targetClip, "scale", localTime);
    target.scale(clipScale, clipScale);
    applyClipMask(target, targetClip, activeProject.width, activeProject.height);
    target.globalAlpha = clipValue(targetClip, "opacity", localTime) * alpha;
    const chroma = targetClip.chromaKey;
    if (isImage) {
      const image = source as HTMLImageElement;
      const keyed = chroma?.enabled
        ? keyedFrame(image, image.naturalWidth, image.naturalHeight, chroma, chromaCanvasRef.current ?? (chromaCanvasRef.current = document.createElement("canvas")))
        : image;
      drawFitted(target, keyed, image.naturalWidth, image.naturalHeight, activeProject.width, activeProject.height, targetClip.fit);
    } else {
      const video = source as HTMLVideoElement;
      const keyed = chroma?.enabled
        ? keyedFrame(video, video.videoWidth, video.videoHeight, chroma, chromaCanvasRef.current ?? (chromaCanvasRef.current = document.createElement("canvas")))
        : video;
      drawFitted(target, keyed, video.videoWidth, video.videoHeight, activeProject.width, activeProject.height, targetClip.fit);
    }
    target.restore();
  };

  const drawFrame = (time: number) => {
    const activeProject = projectRef.current;
    const canvas = canvasRef.current;
    if (!activeProject) return;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const maxDimension = 1920;
    const scale = Math.min(1, maxDimension / Math.max(activeProject.width, activeProject.height));
    const width = Math.max(2, Math.round(activeProject.width * scale));
    const height = Math.max(2, Math.round(activeProject.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);

    const index = timelineIndexRef.current;
    for (const { track, clip } of index ? activeClips(index, time) : []) {
      if (track.hidden || track.kind === "text" || track.kind === "audio") continue;
      {
        const entry = poolRef.current.get(clip.id);
        if (!entry) continue;
        const plan = transitionPlanOf(index, clip);
        const transition = plan.incoming;
        if (transition && time < clip.start + transition.duration) {
          // The cut is running: the clip in front is held on its last frame
          // while this one moves in.
          const location = index?.clipLocations.get(clip.id);
          const previous = location?.track.previous[location.index] ?? null;
          const previousEntry = previous ? poolRef.current.get(previous.id) : undefined;
          if (previous && previousEntry) {
            renderTransition(ctx, transition.type, transitionProgress(transition, time), {
              width,
              height,
              scale,
              outgoing: (target) => drawClipLayer(target, previous, previousEntry, previous.duration, 1),
              incoming: (target) => drawClipLayer(target, clip, entry, time - clip.start, 1),
            });
            continue;
          }
        }
        if (entry.kind === "image") {
          const image = entry.el as HTMLImageElement;
          if (!image.complete) continue;
          drawClipLayer(ctx, clip, entry, time - clip.start, transitionAlpha(clip, time, plan));
        } else {
          const video = entry.el as HTMLVideoElement;
          if (video.seeking || video.readyState < 2) {
            if (!playingRef.current && retryDrawRef.current === null) {
              retryDrawRef.current = window.setTimeout(() => {
                retryDrawRef.current = null;
                scheduleDraw();
              }, 40);
            }
            continue;
          }
          drawClipLayer(ctx, clip, entry, time - clip.start, transitionAlpha(clip, time, plan));
        }
      }
    }
    ctx.globalAlpha = 1;

    const effects = index
      ? activeClips(index, time)
        .filter(({ track, clip }) => track.kind === "misc" && !track.hidden && clip.effect)
        .map(({ clip }) => clip)
      : [];
    if (!playingRef.current) motionHistoryRef.current.clear();
    if (effects.length) {
      const effectCanvas = effectCanvasRef.current ?? document.createElement("canvas");
      effectCanvasRef.current = effectCanvas;
      if (effectCanvas.width !== canvas.width || effectCanvas.height !== canvas.height) {
        effectCanvas.width = canvas.width;
        effectCanvas.height = canvas.height;
      }
      const effectCtx = effectCanvas.getContext("2d");
      if (effectCtx) for (const clip of effects) {
        const effect = clip.effect!;
        effectCtx.setTransform(1, 0, 0, 1, 0, 0);
        effectCtx.clearRect(0, 0, canvas.width, canvas.height);
        effectCtx.drawImage(canvas, 0, 0);
        if (clip.lut) applyLutToCanvas(effectCanvas, clip.lut);
        const localTime = time - clip.start;
        const fadeIn = effect.fadeIn > 0 ? Math.min(1, localTime / effect.fadeIn) : 1;
        const fadeOut = effect.fadeOut > 0 ? Math.min(1, (clip.duration - localTime) / effect.fadeOut) : 1;
        const effectAlpha = clip.opacity * fadeIn * fadeOut;
        let motionHistory: MotionHistory | undefined;
        if (effect.motionBlur > 0 && playingRef.current) {
          motionHistory = motionHistoryRef.current.get(clip.id);
          if (!motionHistory) {
            motionHistory = { frames: [], lastTime: time };
            motionHistoryRef.current.set(clip.id, motionHistory);
          } else if (time <= motionHistory.lastTime || time - motionHistory.lastTime > 2 / Math.max(1, fps)) {
            motionHistory.frames = [];
          }
          motionHistory.lastTime = time;
        } else {
          motionHistoryRef.current.delete(clip.id);
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = effectAlpha;
        ctx.filter = `brightness(${(1 + effect.brightness) * 100}%) contrast(${effect.contrast * 100}%) saturate(${effect.saturation * 100}%) hue-rotate(${effect.hue}deg) sepia(${effect.sepia * 100}%) blur(${effect.blur * scale}px)`;
        if (effect.mask === "circle") {
          ctx.beginPath();
          ctx.arc(effect.maskX * canvas.width, effect.maskY * canvas.height,
            Math.min(canvas.width, canvas.height) * effect.maskSize / 2, 0, Math.PI * 2);
          ctx.clip();
        }
        if (motionHistory?.frames.length) {
          const smear = effect.motionBlur * 0.2 / motionHistory.frames.length;
          motionHistory.frames.forEach((frame, index) => {
            ctx.globalAlpha = effectAlpha * smear * (motionHistory!.frames.length - index);
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          });
          ctx.globalAlpha = effectAlpha;
        }
        ctx.drawImage(effectCanvas, 0, 0);
        if (effect.vignette > 0) {
          ctx.filter = "none";
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = effectAlpha * effect.vignette;
          const radius = Math.hypot(canvas.width, canvas.height) * 0.68;
          const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, radius * 0.24, canvas.width / 2, canvas.height / 2, radius);
          vignette.addColorStop(0, "rgba(0,0,0,0)");
          vignette.addColorStop(1, "rgba(0,0,0,1)");
          ctx.fillStyle = vignette;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = "source-over";
        }
        if (motionHistory) {
          const historyCanvas = document.createElement("canvas");
          const historyScale = Math.min(1, 960 / Math.max(canvas.width, canvas.height));
          historyCanvas.width = Math.max(1, Math.round(canvas.width * historyScale));
          historyCanvas.height = Math.max(1, Math.round(canvas.height * historyScale));
          historyCanvas.getContext("2d")?.drawImage(effectCanvas, 0, 0, historyCanvas.width, historyCanvas.height);
          motionHistory.frames.unshift(historyCanvas);
          motionHistory.frames = motionHistory.frames.slice(0, 2);
        }
        ctx.restore();
      }
      ctx.filter = "none";
      ctx.globalAlpha = 1;
    }

    for (const { track, clip } of index ? activeClips(index, time) : []) {
      if (track.hidden || track.kind !== "text" || !clip.text) continue;
      {
        const text = clip.text;
        const plan = clipTransitionPlan(clip, null, null);
        const transition = transitionAlpha(clip, time, plan);
        const x = clipValue(clip, "x", time - clip.start, text.x) * activeProject.width;
        const y = clipValue(clip, "y", time - clip.start, text.y) * activeProject.height;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((clipValue(clip, "rotation", time - clip.start, text.rotation) * Math.PI) / 180);
        ctx.globalAlpha = clipValue(clip, "opacity", time - clip.start) * transition;
        const brightness = Math.max(0, Math.min(2, text.brightness));
        const brightColor = /^#[0-9a-f]{6}$/i.test(text.color)
          ? `#${[1, 3, 5].map((at) => Math.min(255, Math.round(parseInt(text.color.slice(at, at + 2), 16) * brightness)).toString(16).padStart(2, "0")).join("")}`
          : text.color;
        const lines = text.text.split("\n");
        const lineHeight = text.size * Math.max(0.8, text.lineHeight);
        ctx.fillStyle = brightColor;
        ctx.strokeStyle = text.outlineColor;
        ctx.lineWidth = text.outlineWidth * 2;
        ctx.lineJoin = "round";
        ctx.font = `${text.italic ? "italic " : ""}${text.fontWeight} ${text.size}px "${text.fontFamily}", "Segoe UI", sans-serif`;
        ctx.textAlign = text.align;
        ctx.textBaseline = "middle";
        ctx.letterSpacing = `${text.characterSpacing}px`;
        ctx.shadowColor = colorWithAlpha(text.shadowColor, Math.max(0, Math.min(1, text.shadow)));
        ctx.shadowBlur = Math.max(0, text.size * 0.14 * text.shadow);
        ctx.shadowOffsetY = Math.max(0, text.size * 0.05 * text.shadow);
        if (text.backgroundOpacity > 0) {
          const maxWidth = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
          const padding = text.size * 0.2;
          const left = text.align === "left" ? -padding : text.align === "right" ? -maxWidth - padding : -maxWidth / 2 - padding;
          ctx.save();
          ctx.shadowColor = "transparent";
          ctx.globalAlpha *= Math.max(0, Math.min(1, text.backgroundOpacity));
          ctx.fillStyle = text.backgroundColor;
          ctx.fillRect(left, -(lines.length * lineHeight) / 2 - padding, maxWidth + padding * 2, lines.length * lineHeight + padding * 2);
          ctx.restore();
        }
        if (lines.length === 1 && Math.abs(text.curve) >= 1) {
          const chars = Array.from(text.text);
          const widths = chars.map((char) => ctx.measureText(char).width + text.characterSpacing);
          const glyphWidth = widths.reduce((sum, width) => sum + width, 0);
          const arc = Math.abs(text.curve) * Math.PI / 180;
          const totalWidth = Math.max(glyphWidth, arc * text.size * 1.15);
          const extraGap = chars.length > 1 ? (totalWidth - glyphWidth) / (chars.length - 1) : 0;
          const left = text.align === "left" ? 0 : text.align === "right" ? -totalWidth : -totalWidth / 2;
          let cursor = left;
          const radius = totalWidth / Math.max(0.01, arc);
          chars.forEach((char, index) => {
            const advance = widths[index] + (index < chars.length - 1 ? extraGap : 0);
            const angle = ((cursor + advance / 2 - (left + totalWidth / 2)) / totalWidth) * arc;
            const curveX = Math.sign(text.curve) * radius * Math.sin(angle);
            const curveY = Math.sign(text.curve) * radius * (1 - Math.cos(angle));
            ctx.save();
            ctx.translate(left + totalWidth / 2 + curveX, curveY);
            ctx.rotate(Math.sign(text.curve) * angle);
            if (text.outlineWidth > 0) ctx.strokeText(char, 0, 0);
            ctx.fillText(char, 0, 0);
            if (text.underline) ctx.fillRect(-widths[index] / 2, text.size * 0.55, widths[index], Math.max(1, text.size * 0.045));
            ctx.restore();
            cursor += advance;
          });
        } else {
          lines.forEach((line, index) => {
            const lineY = (index - (lines.length - 1) / 2) * lineHeight;
            if (text.outlineWidth > 0) ctx.strokeText(line, 0, lineY);
            ctx.fillText(line, 0, lineY);
            if (text.underline) {
              const width = ctx.measureText(line).width;
              const left = text.align === "left" ? 0 : text.align === "right" ? -width : -width / 2;
              ctx.fillRect(left, lineY + text.size * 0.55, width, Math.max(1, text.size * 0.045));
            }
          });
        }
        ctx.restore();
      }
    }

    if (guidesRef.current) {
      const projectWidth = activeProject.width;
      const projectHeight = activeProject.height;
      const line = Math.max(1, 1.5 / Math.max(0.0001, scale));
      ctx.save();
      ctx.lineWidth = line;
      ctx.setLineDash([line * 5, line * 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.strokeRect(projectWidth * 0.05, projectHeight * 0.05, projectWidth * 0.9, projectHeight * 0.9);
      ctx.strokeStyle = "rgba(84,214,222,0.55)";
      ctx.strokeRect(projectWidth * 0.1, projectHeight * 0.1, projectWidth * 0.8, projectHeight * 0.8);
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = line;
      for (const fraction of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(projectWidth * fraction, 0);
        ctx.lineTo(projectWidth * fraction, projectHeight);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, projectHeight * fraction);
        ctx.lineTo(projectWidth, projectHeight * fraction);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(projectWidth / 2 - projectWidth * 0.025, projectHeight / 2);
      ctx.lineTo(projectWidth / 2 + projectWidth * 0.025, projectHeight / 2);
      ctx.moveTo(projectWidth / 2, projectHeight / 2 - projectHeight * 0.025);
      ctx.lineTo(projectWidth / 2, projectHeight / 2 + projectHeight * 0.025);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.stroke();
      ctx.font = `${Math.max(10, Math.round(projectWidth * 0.011))}px "Segoe UI", sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(t("ACTION SAFE"), projectWidth * 0.05 + line * 6, projectHeight * 0.05 + line * 5);
      ctx.fillStyle = "rgba(84,214,222,0.75)";
      ctx.fillText(t("TITLE SAFE"), projectWidth * 0.1 + line * 6, projectHeight * 0.1 + line * 5);
      ctx.restore();
    }
  };

  const scheduleDraw = () => {
    if (drawRafRef.current) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      drawFrame(timeRef.current);
    });
  };

  useEffect(() => {
    guidesRef.current = showGuides;
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGuides]);

  const startLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    clockRef.current.last = performance.now();
    clockRef.current.lastUi = 0;

    const tick = (now: number) => {
      if (!playingRef.current) return;
      const delta = Math.min(0.25, (now - clockRef.current.last) / 1000);
      clockRef.current.last = now;
      const total = timelineIndexRef.current?.duration ?? 0;
      let next = timeRef.current + delta;
      if (next >= total) {
        next = total;
        timeRef.current = next;
        useEditor.getState().setCurrentTime(next);
        useEditor.getState().setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (now - clockRef.current.lastUi > 32) {
        clockRef.current.lastUi = now;
        useEditor.getState().setCurrentTime(next);
      }
      ensurePool(next);
      syncElements(next, true);
      applyGains(next);
      drawFrame(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    projectRef.current = project;
    // The index turns the per-frame clip lookups into a binary search.
    timelineIndexRef.current = project ? buildTimelineIndex(project) : null;
    syncPool(timeRef.current);
    syncElements(timeRef.current, playingRef.current);
    applyGains(timeRef.current);
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useEffect(() => {
    return useEditor.subscribe((state, previous) => {
      if (state.project !== previous.project) {
        projectRef.current = state.project;
        timelineIndexRef.current = state.project ? buildTimelineIndex(state.project) : null;
        syncPool(timeRef.current);
      }
      if (state.currentTime !== previous.currentTime) timeRef.current = state.currentTime;
      if (state.playing !== previous.playing) playingRef.current = state.playing;

      if (!state.playing && state.project) {
        syncElements(state.currentTime, false);
        applyGains(state.currentTime);
        scheduleDraw();
      }
    });
    // These functions read from refs, so the subscription stays current without
    // waiting for React to commit a render during timeline scrubbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      void ensureAudio().then(() => {
        if (!playingRef.current) return;
        clockRef.current.last = performance.now();
        syncElements(timeRef.current, true);
        startLoop();
      });
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      syncElements(timeRef.current, false);
      applyGains(timeRef.current);
      scheduleDraw();
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    if (playing) return;
    let timer = 0;
    let cancelled = false;
    const renderPausedFrame = () => {
      if (cancelled || playingRef.current) return;
      const time = timeRef.current;
      syncElements(time, false);
      applyGains(time);
      drawFrame(time);
      timer = window.setTimeout(renderPausedFrame, 40);
    };
    renderPausedFrame();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Keep the compositor alive while paused so decoded seeks and edits are
    // reflected even when the browser does not emit another media event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    timeRef.current = currentTime;
    if (!playingRef.current) {
      const seekStarted = performance.now();
      // A scrub can land far from the pooled window, so the pool follows the
      // playhead before the elements are positioned.
      ensurePool(currentTime);
      syncElements(currentTime, false);
      applyGains(currentTime);
      scheduleDraw();
      const elapsedMs = performance.now() - seekStarted;
      recordMetric("preview seek", elapsedMs, "ms", {
        clips: projectRef.current?.tracks.reduce((count, track) => count + track.clips.length, 0) ?? 0,
      });
      if (elapsedMs > 24 && performance.now() - lastSlowSeekWarningRef.current > 5000 && import.meta.env.DEV) {
        lastSlowSeekWarningRef.current = performance.now();
        console.warn("LibreCut slow preview seek", {
          elapsedMs: Math.round(elapsedMs),
          clips: projectRef.current?.tracks.reduce((count, track) => count + track.clips.length, 0) ?? 0,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
      if (retryDrawRef.current !== null) window.clearTimeout(retryDrawRef.current);
      for (const entry of poolRef.current.values()) {
        if (entry.kind !== "image") (entry.el as HTMLMediaElement).pause();
        try {
          entry.source?.disconnect();
          entry.gain?.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      poolRef.current.clear();
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  const togglePlay = () => setPlaying(!playing);
  const step = (direction: number) => {
    setPlaying(false);
    setCurrentTime(currentTime + direction / fps);
  };

  const fullscreen = () => {
    const element = stageRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen();
  };

  return (
    <section aria-label={t("Preview")} className="flex min-w-0 flex-1 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line-soft px-4">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="font-medium text-ink">{t("Preview")}</span>
          <span>{project ? `${project.width}×${project.height}` : "—"}</span>
          <span className="text-dim" aria-hidden="true">·</span>
          <span>{project?.fps ?? 30} fps</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={`btn btn-ghost btn-icon btn-sm ${showGuides ? "text-accent" : ""}`}
            onClick={() => setShowGuides((value) => !value)}
            title={t("Toggle title and action safe-area guides")}
            aria-label={t("Toggle title and action safe-area guides")}
            aria-pressed={showGuides}
          >
            <LayoutGrid size={13} aria-hidden="true" />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={fullscreen} title={t("Fullscreen preview")} aria-label={t("Fullscreen preview")}>
            <Maximize2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#09090b] p-5">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t("Preview of {name} at {time}", { name: project?.name ?? t("the project"), time: formatClock(currentTime, fps) })}
          className="relative max-h-full max-w-full rounded-[2px] bg-black ring-1 ring-white/15"
          style={{
            aspectRatio: project ? `${project.width} / ${project.height}` : "16 / 9",
            width: "100%",
            objectFit: "contain",
          }}
          onClick={() => {
            if (!drawingCustomMask) togglePlay();
          }}
        />
        {drawingCustomMask && canvasBox.width > 0 ? (
          <svg
            className="absolute z-10 touch-none select-none"
            style={{
              left: canvasBox.left,
              top: canvasBox.top,
              width: canvasBox.width,
              height: canvasBox.height,
              cursor: "crosshair",
            }}
            viewBox={`0 0 ${canvasBox.width} ${canvasBox.height}`}
            preserveAspectRatio="none"
            role="application"
            aria-label={t("Draw the custom mask on the preview")}
            onPointerDown={startMaskDrawing}
            onPointerMove={extendMaskDrawing}
            onPointerUp={finishMaskDrawing}
            onPointerCancel={finishMaskDrawing}
          >
            <rect width={canvasBox.width} height={canvasBox.height} fill="transparent" />
            {selectedClip?.maskPoints && selectedClip.maskPoints.length >= 3 ? (
              <polygon
                points={maskOverlayPoints(selectedClip.maskPoints)}
                fill="rgba(167, 139, 250, 0.14)"
                stroke="#a78bfa"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {draftMaskPoints.length >= 2 ? (
              <polygon
                points={maskOverlayPoints(draftMaskPoints)}
                fill="rgba(167, 139, 250, 0.18)"
                stroke="#c4b5fd"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
        ) : null}
        {drawingCustomMask ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[10.5px] text-white/80 ring-1 ring-white/10">
            {t("Drag on the preview to draw the mask")}
          </div>
        ) : null}
        {project && project.tracks.every((track) => track.clips.length === 0) ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <Play size={18} className="text-white/60" />
            </div>
            <p className="text-[12px] font-medium text-white/80">{t("Your preview is empty")}</p>
            <p className="max-w-[250px] text-[11px] leading-relaxed text-white/60">
              {t("Import media, then add a clip to the timeline to see it here.")}
            </p>
          </div>
        ) : null}
        <div ref={hiddenRef} className="pointer-events-none absolute left-[-99999px] top-0 h-px w-px overflow-hidden opacity-0" />
      </div>

      <div className="relative flex h-[52px] shrink-0 items-center justify-between gap-3 border-t border-line-soft bg-panel px-4">
        <div className="flex w-[180px] items-center gap-1">
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => step(-1)} title={t("Previous frame")} aria-label={t("Previous frame")}>
            <SkipBack size={14} aria-hidden="true" />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-surface transition hover:bg-white"
            onClick={togglePlay}
            title={playing ? t("Pause (Space)") : t("Play (Space)")}
            aria-label={playing ? t("Pause") : t("Play")}
            aria-pressed={playing}
          >
            {playing ? <Pause size={14} fill="currentColor" aria-hidden="true" /> : <Play size={14} fill="currentColor" className="ml-0.5" aria-hidden="true" />}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => step(1)} title={t("Next frame")} aria-label={t("Next frame")}>
            <SkipForward size={14} aria-hidden="true" />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => {
              setPlaying(false);
              setCurrentTime(0);
            }}
            title={t("Go to start")}
            aria-label={t("Go to the start of the timeline")}
          >
            <Square size={12} aria-hidden="true" />
          </button>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 font-mono text-[11.5px] tracking-tight">
          <span className="text-ink">{formatClock(currentTime, fps)}</span>
          <span className="text-dim/70" aria-hidden="true">/</span>
          <span className="text-dim">{formatClock(duration, fps)}</span>
        </div>

      </div>
    </section>
  );
}
