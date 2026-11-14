import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { assetForClip, useEditor } from "../../stores/editor";
import { cancelPreviewRender, isTauri, mediaUrl, renderPreviewFrame, renderPreviewPlayback } from "../../lib/media";
import { projectDuration } from "../../lib/time";
import { clipValue } from "../../lib/animation";
import { renderTransition } from "../../lib/transitionPreview";
import { transitionAlpha, transitionProgress } from "../../lib/transitions";
import { sourceOffsetAt, speedAt } from "../../lib/speed";
import { duckGainAt, midFilterQ, projectDuckingSegments } from "../../lib/audio";
import { recordMetric } from "../../lib/metrics";
import { useT } from "../../lib/i18n";
import { activeClips, buildTimelineIndex, type TimelineIndex } from "../../lib/timelineIndex";
import {
  applyClipMask,
  applyLutToCanvas,
  drawFitted,
  drawTextClip,
  keyedFrame,
  maskFrameOf,
  maskOverlayPoints as maskOverlayPointsFor,
  maskPointAt,
  simplifyMaskPoints,
  transitionPlanOf,
} from "../../lib/previewCanvas";
import type { Clip, DuckSegment, MaskPoint, Project } from "../../lib/types";
import { buildExportRequest, previewRenderKey } from "../../lib/exportRequest";
import type { PreviewRenderProgress } from "../../lib/types";
import { PreviewHeader, PreviewTransport } from "./preview/PreviewControls";
import { PreviewStage } from "./preview/PreviewStage";

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
  const [matchExport, setMatchExport] = useState(false);
  const [exactFrame, setExactFrame] = useState<{ mediaId: string; width: number; height: number } | null>(null);
  const [exactFrameBusy, setExactFrameBusy] = useState(false);
  const [exactFrameError, setExactFrameError] = useState<string | null>(null);
  // "Export-accurate" playback: the edit is rendered with the export graph and
  // played back from the rendered file. The fast canvas path stays the default.
  const [previewQuality, setPreviewQuality] = useState<"fast" | "exact">(() => {
    if (isTauri) {
      try {
        return localStorage.getItem("librecut.preview.quality") === "exact" ? "exact" : "fast";
      } catch {
        return "fast";
      }
    }
    return "fast";
  });
  const [renderProgress, setRenderProgress] = useState<PreviewRenderProgress | null>(null);
  const [renderRetry, setRenderRetry] = useState(0);
  const [exactRenderError, setExactRenderError] = useState<string | null>(null);
  const [exactRenderedHash, setExactRenderedHash] = useState<string | null>(null);
  const [exactMediaId, setExactMediaId] = useState<string | null>(null);
  const drawingMaskRef = useRef(false);
  const maskPointsRef = useRef<MaskPoint[]>([]);
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
  const exactFrameRequestRef = useRef(0);
  const renderKeyRef = useRef<string | null>(null);
  const renderFailedKeyRef = useRef<string | null>(null);
  const renderCancelledKeyRef = useRef<string | null>(null);
  const exactReadyRef = useRef(false);
  const exactVideoRef = useRef<HTMLVideoElement | null>(null);
  const exactRafRef = useRef(0);
  // True once a full frame has been painted. Until then the canvas may show
  // empty background on the first scrubbed frame; afterwards the last
  // composite is kept until every on-screen clip is ready again.
  const hasDrawnFrameRef = useRef(false);

  const duration = project ? projectDuration(project.tracks, 0) : 0;
  const fps = project?.fps ?? 30;
  const hasClips = project?.tracks.some((track) => track.clips.length > 0) ?? false;
  const canShowExportFrame = matchExport && isTauri && hasClips;
  // The content key of everything that can change a pixel of the accurate
  // preview. This is what tells us the rendered file matches the project.
  const contentKey = useMemo(
    () => (project && hasClips ? previewRenderKey(buildExportRequest(project, "", project.width, project.height)) : null),
    [project, hasClips],
  );
  const exactReady = previewQuality === "exact" && isTauri && hasClips && contentKey !== null && exactRenderedHash === contentKey;
  const exactVideoUrl = exactReady && exactMediaId && isTauri ? mediaUrl(exactMediaId) : null;
  exactReadyRef.current = exactReady;
  const selectedClip = project && selectedClipId
    ? project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId)
    : undefined;
  const drawingCustomMask = Boolean(
    selectedClip && selectedClip.kind === "video" && selectedClip.mask === "custom",
  );

  useEffect(() => {
    // The box is measured even when no mask is drawn: the export frame is
    // painted on top of the canvas at exactly the same place.
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

  const maskFrame = () =>
    selectedClip && project ? maskFrameOf(selectedClip, currentTime) : null;

  const maskPointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): MaskPoint | null => {
    const canvas = canvasRef.current;
    const activeProject = projectRef.current;
    const frame = maskFrame();
    if (!canvas || !activeProject || !frame) return null;
    return maskPointAt(activeProject, frame, canvas.getBoundingClientRect(), event.clientX, event.clientY);
  };

  /** Maps clip-local mask points to pixels on the displayed canvas. */
  const maskOverlayPoints = (points: MaskPoint[]): string => {
    const activeProject = projectRef.current;
    const frame = maskFrame();
    if (!activeProject || !frame) return "";
    return maskOverlayPointsFor(points, activeProject, frame, canvasBox);
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
    if (exactReadyRef.current) return;
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

    const index = timelineIndexRef.current;
    // While the browser reseeks the clips as the playhead moves, at least one
    // of them is usually between frames. Painting then would show the empty
    // background for a frame or two at a time — a black blink. Keep the last
    // composite until every clip on screen is ready to draw.
    const visibleMedia = index
      ? activeClips(index, time).filter(({ track }) => !track.hidden && track.kind !== "text" && track.kind !== "audio")
      : [];
    // Clips that are going away are painted too while their transition runs,
    // so they matter as well.
    const transitionOutgoing = index
      ? visibleMedia.flatMap(({ clip }) => {
          const plan = transitionPlanOf(index, clip);
          if (!plan.incoming || time >= clip.start + plan.incoming.duration) return [];
          const location = index.clipLocations.get(clip.id);
          const previous = location?.track.previous[location.index];
          return previous ? [previous] : [];
        })
      : [];
    const waitingOnMedia = [...visibleMedia.map(({ clip }) => clip), ...transitionOutgoing].some((clip) => {
      const entry = poolRef.current.get(clip.id);
      if (!entry) return true;
      if (entry.kind === "image") return !(entry.el as HTMLImageElement).complete;
      const video = entry.el as HTMLVideoElement;
      return video.seeking || video.readyState < 2;
    });
    if (waitingOnMedia && hasDrawnFrameRef.current) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);

    for (const { clip } of visibleMedia) {
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
      drawTextClip(ctx, clip, activeProject, time);
    }
    hasDrawnFrameRef.current = true;
  };

  const scheduleDraw = () => {
    if (drawRafRef.current) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      drawFrame(timeRef.current);
    });
  };

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
    if (!exactReadyRef.current) {
      syncElements(timeRef.current, playingRef.current);
      applyGains(timeRef.current);
      scheduleDraw();
    }
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

      if (!state.playing && state.project && !exactReadyRef.current) {
        syncElements(state.currentTime, false);
        applyGains(state.currentTime);
        scheduleDraw();
      }
    });
    // These functions read from refs, so the subscription stays current without
    // waiting for React to commit a render during timeline scrubbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startExactLoop = () => {
    if (exactRafRef.current) cancelAnimationFrame(exactRafRef.current);
    // The element may not be mounted on the same commit; try again next tick.
    const play = () => {
      const video = exactVideoRef.current;
      if (!video) {
        exactRafRef.current = requestAnimationFrame(play);
        return;
      }
      // The element is a fresh mount; start it at the playhead.
      try {
        video.currentTime = Math.max(0, timeRef.current);
      } catch {
        // The seek is applied once the metadata arrives.
      }
      void video.play().catch((error: unknown) => {
        setExactRenderError(
          error instanceof Error && error.message.includes("interaction")
            ? t("The accurate preview is ready — press Space to play it")
            : error instanceof Error
              ? error.message
              : String(error),
        );
      });
    };
    const tick = () => {
      exactRafRef.current = requestAnimationFrame(tick);
      const video = exactVideoRef.current;
      if (!video || !playingRef.current) return;
      const time = video.currentTime;
      if (Number.isFinite(time) && Math.abs(time - timeRef.current) > 0.0005) {
        useEditor.getState().setCurrentTime(time);
      }
    };
    play();
    exactRafRef.current = requestAnimationFrame(tick);
  };

  const cancelExactLoop = () => {
    if (exactRafRef.current) {
      cancelAnimationFrame(exactRafRef.current);
      exactRafRef.current = 0;
    }
    exactVideoRef.current?.pause();
  };

  const exactRendering = renderProgress !== null;
  const retryAccurateRender = () => {
    renderFailedKeyRef.current = null;
    renderCancelledKeyRef.current = null;
    setExactRenderError(null);
    setRenderRetry((value) => value + 1);
  };
  const cancelAccurateRender = () => {
    renderCancelledKeyRef.current = renderKeyRef.current;
    renderKeyRef.current = null;
    void cancelPreviewRender();
    setRenderProgress(null);
    setExactRenderError(null);
  };

  // Subscribe to the render progress of the accurate preview.
  useEffect(() => {
    if (!isTauri) return undefined;
    let unsubscribe: (() => void) | undefined;
    listen<PreviewRenderProgress>("preview-render-progress", (event) => {
      const percent = Number(event.payload?.percent);
      const time = Number(event.payload?.time);
      if (Number.isFinite(percent)) {
        setRenderProgress({ percent, time: Number.isFinite(time) ? time : 0 });
      }
    }).then((unsubscribeFn) => {
      unsubscribe = unsubscribeFn;
    });
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the accurate preview in step with the project: every edit invalidates
  // the rendered file, so it is rendered again in the background.
  useEffect(() => {
    if (previewQuality !== "exact" || !isTauri || !hasClips || !contentKey || exactRendering) return undefined;
    if (exactRenderedHash === contentKey) return undefined;
    if (renderFailedKeyRef.current === contentKey || renderCancelledKeyRef.current === contentKey) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      renderFailedKeyRef.current = null;
      renderCancelledKeyRef.current = null;
      renderKeyRef.current = contentKey;
      const request = buildExportRequest(project as Project, "", project!.width, project!.height);
      setRenderProgress({ percent: 0, time: 0 });
      setExactRenderError(null);
      void renderPreviewPlayback(request)
        .then((result) => {
          if (renderKeyRef.current !== contentKey) return;
          setExactMediaId(result.mediaId);
          setExactRenderedHash(contentKey);
          setRenderProgress(null);
          recordMetric("preview accurate render", result.elapsedMs, "ms", {
            reused: result.reused,
          });
        })
        .catch((error: unknown) => {
          if (renderKeyRef.current !== contentKey) return;
          if (String(error).includes("cancelled")) {
            renderCancelledKeyRef.current = contentKey;
          } else {
            renderFailedKeyRef.current = contentKey;
          }
          setExactRenderError(error instanceof Error ? error.message : String(error));
          setRenderProgress(null);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [previewQuality, isTauri, hasClips, contentKey, exactRendering, exactRenderedHash, project, renderRetry]);

  // Paused: keep the accurate video on the playhead.
  useEffect(() => {
    const video = exactVideoRef.current;
    if (!video || !exactReady || playing) return;
    try {
      video.currentTime = Math.max(0, currentTime);
    } catch {
      // Metadata is not loaded yet; the seek is applied by the browser later.
    }
  }, [exactReady, playing, currentTime, exactVideoUrl]);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      cancelExactLoop();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (previewQuality === "exact" && exactReadyRef.current) {
        startExactLoop();
        return undefined;
      }
      void ensureAudio().then(() => {
        if (!playingRef.current) return;
        clockRef.current.last = performance.now();
        syncElements(timeRef.current, true);
        startLoop();
      });
      return undefined;
    }
    cancelExactLoop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (!exactReadyRef.current) {
      syncElements(timeRef.current, false);
      applyGains(timeRef.current);
      scheduleDraw();
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, previewQuality, exactReady]);

  useEffect(() => () => cancelExactLoop(), []);

  useEffect(() => {
    if (playing || exactReadyRef.current) return;
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
    if (!matchExport || playing || !project || !isTauri) {
      exactFrameRequestRef.current += 1;
      setExactFrame(null);
      setExactFrameBusy(false);
      setExactFrameError(null);
      return;
    }
    if (!project.tracks.some((track) => track.clips.length > 0)) {
      exactFrameRequestRef.current += 1;
      setExactFrame(null);
      setExactFrameBusy(false);
      setExactFrameError(null);
      return;
    }
    // Scrubbing fires a new time on every pointer move. Waiting for the
    // playhead to settle keeps one FFmpeg run per inspected frame.
    const time = currentTime;
    // Every run gets a token; a frame that arrives after the playhead moved
    // again is dropped instead of replacing the newer one.
    const token = exactFrameRequestRef.current + 1;
    exactFrameRequestRef.current = token;
    setExactFrameBusy(true);
    const timer = window.setTimeout(() => {
      const request = buildExportRequest(project, "", project.width, project.height);
      void renderPreviewFrame(request, time)
        .then((result) => {
          if (token !== exactFrameRequestRef.current) return;
          setExactFrame({ mediaId: result.mediaId, width: result.width, height: result.height });
          setExactFrameError(null);
          setExactFrameBusy(false);
          recordMetric("preview export frame", result.elapsedMs, "ms", {
            width: result.width,
            height: result.height,
          });
        })
        .catch((error: unknown) => {
          if (token !== exactFrameRequestRef.current) return;
          setExactFrame(null);
          setExactFrameError(error instanceof Error ? error.message : String(error));
          setExactFrameBusy(false);
        });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [matchExport, playing, currentTime, project]);

  useEffect(() => {
    timeRef.current = currentTime;
    if (!playingRef.current && !exactReadyRef.current) {
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

  const exactStatus: "rendering" | "ready" | "error" | "idle" | null =
    previewQuality !== "exact" || !isTauri || !hasClips
      ? null
      : exactRendering
        ? "rendering"
        : exactRenderError
          ? "error"
          : exactReady
            ? "ready"
            : "idle";
  const renderPercent = renderProgress?.percent ?? null;

  const setPreviewQualityAndPersist = (value: "fast" | "exact") => {
    setPreviewQuality(value);
    try {
      localStorage.setItem("librecut.preview.quality", value);
    } catch {
      // Private mode; the toggle still works for the session.
    }
    if (value === "fast") {
      // Release the FFmpeg the render may still be using.
      void cancelPreviewRender();
      renderKeyRef.current = null;
      setRenderProgress(null);
      setExactRenderError(null);
    }
  };

  const handleRenderVideoEnded = () => {
    useEditor.getState().setPlaying(false);
    useEditor.getState().setCurrentTime(duration);
  };

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
      <PreviewHeader
        project={project}
        showGuides={showGuides}
        onToggleGuides={() => setShowGuides((value) => !value)}
        onFullscreen={fullscreen}
        matchExport={matchExport}
        matchExportBusy={exactFrameBusy}
        matchExportDisabled={!isTauri}
        previewQuality={previewQuality}
        onToggleQuality={setPreviewQualityAndPersist}
        previewQualityDisabled={!isTauri}
        onToggleMatchExport={() => setMatchExport((value) => !value)}
      />

      <PreviewStage
        project={project}
        currentTime={currentTime}
        fps={fps}
        stageRef={stageRef}
        canvasRef={canvasRef}
        hiddenRef={hiddenRef}
        canvasBox={canvasBox}
        drawingCustomMask={drawingCustomMask}
        selectedClip={selectedClip}
        draftMaskPoints={draftMaskPoints}
        maskOverlayPoints={maskOverlayPoints}
        showGuides={showGuides}
        matchExport={canShowExportFrame}
        exactFrameUrl={!playing && exactFrame ? mediaUrl(exactFrame.mediaId) : null}
        exactFrameBusy={exactFrameBusy}
        exactFrameError={exactFrameError}
        exactFrameSize={exactFrame ? { width: exactFrame.width, height: exactFrame.height } : null}
        renderVideoUrl={exactVideoUrl}
        renderVideoRef={exactVideoRef}
        renderStatus={exactStatus}
        renderPercent={renderPercent}
        renderError={exactRenderError}
        onCancelRender={cancelAccurateRender}
        onRetryRender={retryAccurateRender}
        onRenderVideoEnded={handleRenderVideoEnded}
        onStartMask={startMaskDrawing}
        onExtendMask={extendMaskDrawing}
        onFinishMask={finishMaskDrawing}
        onTogglePlay={togglePlay}
      />

      <PreviewTransport
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        fps={fps}
        onTogglePlay={togglePlay}
        onStep={step}
        onGoToStart={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
    </section>
  );
}
