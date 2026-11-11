import { useEffect, useRef, useState } from "react";
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
import { clipValue, transitionState } from "../../lib/animation";
import { sourceOffsetAt, speedAt } from "../../lib/speed";
import { duckGainAt, midFilterQ, projectDuckingSegments } from "../../lib/audio";
import type { ChromaKeyOptions, DuckSegment, Project } from "../../lib/types";

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

type Clock = { last: number; lastUi: number };
type MotionHistory = { frames: HTMLCanvasElement[]; lastTime: number };

function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
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

export function Preview() {
  const project = useEditor((state) => state.project);
  const currentTime = useEditor((state) => state.currentTime);
  const playing = useEditor((state) => state.playing);
  const setPlaying = useEditor((state) => state.setPlaying);
  const setCurrentTime = useEditor((state) => state.setCurrentTime);

  const [showGuides, setShowGuides] = useState(false);
  const guidesRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionHistoryRef = useRef<Map<string, MotionHistory>>(new Map());
  const chromaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<Map<string, PoolEntry>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const duckRef = useRef<{ project: Project | null; segments: Map<string, DuckSegment[]> }>({ project: null, segments: new Map() });
  const rafRef = useRef(0);
  const drawRafRef = useRef(0);
  const retryDrawRef = useRef<number | null>(null);
  const clockRef = useRef<Clock>({ last: 0, lastUi: 0 });
  const projectRef = useRef(project);
  const playingRef = useRef(playing);
  const timeRef = useRef(currentTime);

  const duration = project ? projectDuration(project.tracks, 0) : 0;
  const fps = project?.fps ?? 30;

  const syncPool = () => {
    const activeProject = projectRef.current;
    const container = hiddenRef.current;
    if (!activeProject || !container) return;

    const wanted = new Map<string, { mediaId: string; kind: "video" | "audio" | "image" }>();
    for (const track of activeProject.tracks) {
      if (track.kind === "text") continue;
      for (const clip of track.clips) {
        const asset = assetForClip(activeProject, clip);
        if (!asset) continue;
        const kind = asset.info.isImage ? "image" : asset.info.hasVideo ? "video" : "audio";
        wanted.set(clip.id, {
          mediaId: asset.previewMediaId || asset.mediaId,
          kind,
        });
      }
    }

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
        poolRef.current.set(clipId, { kind, el: media, mediaId });
      }
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
      if (entry.kind === "image" || entry.source) continue;
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
    }
  };

  const syncElements = (time: number, isPlaying: boolean) => {
    const activeProject = projectRef.current;
    if (!activeProject) return;
    const active = new Set<string>();

    for (const track of activeProject.tracks) {
      if (track.hidden || track.kind === "audio") continue;
      for (const clip of track.clips) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
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
    }

    // Audio-only tracks.
    for (const track of activeProject.tracks) {
      if (track.hidden || track.kind !== "audio") continue;
      for (const clip of track.clips) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        active.add(clip.id);
        const entry = poolRef.current.get(clip.id);
        if (!entry || entry.kind === "image") continue;
        const media = entry.el as HTMLMediaElement;
        const localTime = time - clip.start;
        const rampSpeed = clip.speedRamp?.length ? speedAt(clip.speedRamp, clip.duration, localTime) : clip.speed;
        const audioRate = Math.min(8, Math.max(0.0625, rampSpeed * Math.pow(2, clip.pitch / 12)));
        media.preservesPitch = clip.pitch === 0;
        const target = Math.max(0, clip.trimIn + (clip.speedRamp?.length ? sourceOffsetAt(clip.speedRamp, clip.duration, localTime) : localTime * audioRate));
        if (Math.abs(media.currentTime - target) > (isPlaying ? 0.22 : 0.015)) {
          try {
            media.currentTime = target;
          } catch {
            // Ignore transient seek failures.
          }
        }
        media.playbackRate = audioRate;
        if (isPlaying) {
          if (media.paused) void media.play().catch(() => undefined);
        } else if (!media.paused) {
          media.pause();
        }
      }
    }

    for (const [clipId, entry] of poolRef.current) {
      if (active.has(clipId) || entry.kind === "image") continue;
      const media = entry.el as HTMLMediaElement;
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
    for (const track of activeProject.tracks) {
      if (track.kind === "text") continue;
      const trackVolume = track.volume ?? 1;
      const ducking = duckSegments.get(track.id);
      for (const clip of track.clips) {
        const entry = poolRef.current.get(clip.id);
        if (!entry?.gain) continue;
        const isActive = !track.hidden && time >= clip.start && time < clip.start + clip.duration;
        const local = time - clip.start;
        const fadeIn = clip.fadeIn > 0 ? Math.min(1, local / clip.fadeIn) : 1;
        const fadeOut = clip.fadeOut > 0 ? Math.min(1, (clip.duration - local) / clip.fadeOut) : 1;
        const transitions = transitionState(clip, time, false);
        const volume = clipValue(clip, "volume", local);
        const duck = ducking ? duckGainAt(ducking, time) : 1;
        const target = isActive
          ? Math.min(4, Math.max(0, volume)) * Math.min(fadeIn, fadeOut) * transitions.alpha * trackVolume * duck * (track.muted ? 0 : 1)
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
    }
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

    for (const track of activeProject.tracks) {
      if (track.hidden || track.kind === "text" || track.kind === "audio") continue;
      for (const clip of track.clips) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const entry = poolRef.current.get(clip.id);
        if (!entry) continue;
        if (entry.kind === "image") {
          const image = entry.el as HTMLImageElement;
          if (!image.complete) continue;
          ctx.save();
          const transition = transitionState(clip, time);
          if (transition.wipeIn < 1) { ctx.beginPath(); ctx.rect(0, 0, activeProject.width * transition.wipeIn, activeProject.height); ctx.clip(); }
          if (transition.wipeOut < 1) { ctx.beginPath(); ctx.rect(activeProject.width * (1 - transition.wipeOut), 0, activeProject.width * transition.wipeOut, activeProject.height); ctx.clip(); }
          ctx.translate(activeProject.width * (0.5 + clipValue(clip, "x", time - clip.start)), activeProject.height * (0.5 + clipValue(clip, "y", time - clip.start)));
          ctx.rotate((clipValue(clip, "rotation", time - clip.start) * Math.PI) / 180);
          ctx.scale(clipValue(clip, "scale", time - clip.start), clipValue(clip, "scale", time - clip.start));
          if (clip.mask === "circle") {
            ctx.beginPath();
            ctx.arc(0, 0, Math.min(activeProject.width, activeProject.height) / 2, 0, Math.PI * 2);
            ctx.clip();
          }
          ctx.globalAlpha = clipValue(clip, "opacity", time - clip.start) * transition.alpha;
          const keyed = clip.chromaKey?.enabled ? keyedFrame(image, image.naturalWidth, image.naturalHeight, clip.chromaKey, chromaCanvasRef.current ?? (chromaCanvasRef.current = document.createElement("canvas"))) : image;
          drawFitted(
            ctx,
            keyed,
            image.naturalWidth,
            image.naturalHeight,
            activeProject.width,
            activeProject.height,
            clip.fit,
          );
          ctx.restore();
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
          ctx.save();
          const transition = transitionState(clip, time);
          if (transition.wipeIn < 1) { ctx.beginPath(); ctx.rect(0, 0, activeProject.width * transition.wipeIn, activeProject.height); ctx.clip(); }
          if (transition.wipeOut < 1) { ctx.beginPath(); ctx.rect(activeProject.width * (1 - transition.wipeOut), 0, activeProject.width * transition.wipeOut, activeProject.height); ctx.clip(); }
          ctx.translate(activeProject.width * (0.5 + clipValue(clip, "x", time - clip.start)), activeProject.height * (0.5 + clipValue(clip, "y", time - clip.start)));
          ctx.rotate((clipValue(clip, "rotation", time - clip.start) * Math.PI) / 180);
          ctx.scale(clipValue(clip, "scale", time - clip.start), clipValue(clip, "scale", time - clip.start));
          if (clip.mask === "circle") {
            ctx.beginPath();
            ctx.arc(0, 0, Math.min(activeProject.width, activeProject.height) / 2, 0, Math.PI * 2);
            ctx.clip();
          }
          ctx.globalAlpha = clipValue(clip, "opacity", time - clip.start) * transition.alpha;
          const keyed = clip.chromaKey?.enabled ? keyedFrame(video, video.videoWidth, video.videoHeight, clip.chromaKey, chromaCanvasRef.current ?? (chromaCanvasRef.current = document.createElement("canvas"))) : video;
          drawFitted(
            ctx,
            keyed,
            video.videoWidth,
            video.videoHeight,
            activeProject.width,
            activeProject.height,
            clip.fit,
          );
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;

    const effects = activeProject.tracks
      .filter((track) => track.kind === "misc" && !track.hidden)
      .flatMap((track) => track.clips)
      .filter((clip) => clip.effect && time >= clip.start && time < clip.start + clip.duration);
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

    for (const track of activeProject.tracks) {
      if (track.hidden || track.kind !== "text") continue;
      for (const clip of track.clips) {
        if (time < clip.start || time >= clip.start + clip.duration || !clip.text) continue;
        const text = clip.text;
        const transition = transitionState(clip, time, false);
        const x = clipValue(clip, "x", time - clip.start, text.x) * activeProject.width;
        const y = clipValue(clip, "y", time - clip.start, text.y) * activeProject.height;
        ctx.save();
        if (transition.wipeIn < 1) { ctx.beginPath(); ctx.rect(0, 0, activeProject.width * transition.wipeIn, activeProject.height); ctx.clip(); }
        if (transition.wipeOut < 1) { ctx.beginPath(); ctx.rect(activeProject.width * (1 - transition.wipeOut), 0, activeProject.width * transition.wipeOut, activeProject.height); ctx.clip(); }
        ctx.translate(x, y);
        ctx.rotate((clipValue(clip, "rotation", time - clip.start, text.rotation) * Math.PI) / 180);
        ctx.globalAlpha = clipValue(clip, "opacity", time - clip.start) * transition.alpha;
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
      ctx.fillText("ACTION SAFE", projectWidth * 0.05 + line * 6, projectHeight * 0.05 + line * 5);
      ctx.fillStyle = "rgba(84,214,222,0.75)";
      ctx.fillText("TITLE SAFE", projectWidth * 0.1 + line * 6, projectHeight * 0.1 + line * 5);
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
      const activeProject = projectRef.current;
      const total = activeProject ? projectDuration(activeProject.tracks, 0) : 0;
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
      syncElements(next, true);
      applyGains(next);
      drawFrame(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    projectRef.current = project;
    syncPool();
    syncElements(timeRef.current, playingRef.current);
    applyGains(timeRef.current);
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useEffect(() => {
    return useEditor.subscribe((state, previous) => {
      if (state.project !== previous.project) {
        projectRef.current = state.project;
        syncPool();
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
      syncElements(currentTime, false);
      applyGains(currentTime);
      scheduleDraw();
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
    <section className="flex min-w-0 flex-1 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line-soft px-4">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="font-medium text-ink">Preview</span>
          <span>{project ? `${project.width}×${project.height}` : "—"}</span>
          <span className="text-dim/50">·</span>
          <span>{project?.fps ?? 30} fps</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={`btn btn-ghost btn-icon btn-sm ${showGuides ? "text-accent" : ""}`}
            onClick={() => setShowGuides((value) => !value)}
            title="Toggle title and action safe-area guides"
            aria-pressed={showGuides}
          >
            <LayoutGrid size={13} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={fullscreen} title="Fullscreen preview">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#09090b] p-5">
        <canvas
          ref={canvasRef}
          className="relative max-h-full max-w-full rounded-[2px] bg-black ring-1 ring-white/15"
          style={{
            aspectRatio: project ? `${project.width} / ${project.height}` : "16 / 9",
            width: "100%",
            objectFit: "contain",
          }}
          onClick={togglePlay}
        />
        {project && project.tracks.every((track) => track.clips.length === 0) ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <Play size={18} className="text-white/60" />
            </div>
            <p className="text-[12px] font-medium text-white/70">Your preview is empty</p>
            <p className="max-w-[250px] text-[11px] leading-relaxed text-white/35">
              Import media, then add a clip to the timeline to see it here.
            </p>
          </div>
        ) : null}
        <div ref={hiddenRef} className="pointer-events-none absolute left-[-99999px] top-0 h-px w-px overflow-hidden opacity-0" />
      </div>

      <div className="relative flex h-[52px] shrink-0 items-center justify-between gap-3 border-t border-line-soft bg-panel px-4">
        <div className="flex w-[180px] items-center gap-1">
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => step(-1)} title="Previous frame">
            <SkipBack size={14} />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-surface transition hover:bg-white"
            onClick={togglePlay}
            title={playing ? "Pause (Space)" : "Play (Space)"}
          >
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => step(1)} title="Next frame">
            <SkipForward size={14} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => {
              setPlaying(false);
              setCurrentTime(0);
            }}
            title="Go to start"
          >
            <Square size={12} />
          </button>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 font-mono text-[11.5px] tracking-tight">
          <span className="text-ink">{formatClock(currentTime, fps)}</span>
          <span className="text-dim/50">/</span>
          <span className="text-dim">{formatClock(duration, fps)}</span>
        </div>

      </div>
    </section>
  );
}
