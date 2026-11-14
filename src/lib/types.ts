export type TrackKind = "video" | "audio" | "text" | "misc";
export type FitMode = "contain" | "cover";
export type ClipMask = "none" | "circle" | "square" | "rectangle" | "custom";

/** A point of a custom mask, in canvas coordinates normalized to 0..1. */
export interface MaskPoint {
  x: number;
  y: number;
}
export type KeyframeProperty = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
/**
 * Every transition the editor can render.
 *
 * The names match FFmpeg's `xfade` filter, so the exporter hands them to
 * FFmpeg unchanged. `wipe` is the name older projects used; it still loads and
 * behaves like a left-to-right wipe.
 */
export type TransitionType =
  | "none"
  | "fade"
  | "fadefast"
  | "fadeslow"
  | "fadeblack"
  | "fadewhite"
  | "fadegrays"
  | "dissolve"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "smoothleft"
  | "smoothright"
  | "smoothup"
  | "smoothdown"
  | "wipetl"
  | "wipetr"
  | "wipebl"
  | "wipebr"
  | "diagtl"
  | "diagtr"
  | "diagbl"
  | "diagbr"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "coverleft"
  | "coverright"
  | "coverup"
  | "coverdown"
  | "revealleft"
  | "revealright"
  | "revealup"
  | "revealdown"
  | "circleopen"
  | "circleclose"
  | "circlecrop"
  | "rectcrop"
  | "vertopen"
  | "vertclose"
  | "horzopen"
  | "horzclose"
  | "hlslice"
  | "hrslice"
  | "vuslice"
  | "vdslice"
  | "hlwind"
  | "hrwind"
  | "vuwind"
  | "vdwind"
  | "pixelize"
  | "hblur"
  | "radial"
  | "distance"
  | "zoomin"
  | "squeezeh"
  | "squeezev"
  | "wipe";

export interface Keyframe {
  property: KeyframeProperty;
  time: number;
  value: number;
}

/** Track-level ducking: the track is attenuated while other audio plays. */
export interface AudioDucking {
  enabled: boolean;
  /** Attenuation in decibels applied while the key signal is present. */
  amount: number;
  /** Key level in decibels that has to be reached before the track ducks. */
  threshold: number;
  /** Ramp-down time in seconds. */
  attack: number;
  /** Ramp-up time in seconds. */
  release: number;
}

/** Clip-level dynamics processing. */
export interface AudioCompressor {
  enabled: boolean;
  /** Threshold in decibels. */
  threshold: number;
  /** Compression ratio, 1 disables compression. */
  ratio: number;
  /** Attack time in milliseconds. */
  attack: number;
  /** Release time in milliseconds. */
  release: number;
}

/** A linear gain ramp on the project timeline, used to express ducking. */
export interface DuckSegment {
  start: number;
  end: number;
  from: number;
  to: number;
}

export interface ClipTransition {
  type: TransitionType;
  duration: number;
}

/** Speed at a point in clip-local timeline seconds. */
export interface SpeedPoint {
  time: number;
  speed: number;
}

export interface ChromaKeyOptions {
  enabled: boolean;
  color: string;
  similarity: number;
  softness: number;
}

export interface MediaInfo {
  name: string;
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  isVfr?: boolean;
  rotation: number;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number;
  sampleRate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  sizeBytes: number;
  isImage: boolean;
}

export interface RegisteredMedia {
  id: string;
  path: string;
  info: MediaInfo;
}

export type ProxyStatus = "none" | "generating" | "ready" | "failed";

export interface Asset {
  id: string;
  name: string;
  path: string;
  mediaId: string;
  previewMediaId: string;
  proxyId?: string;
  proxyStatus: ProxyStatus;
  info: MediaInfo;
  thumbnails: string[];
  waveform: number[];
  importedAt: number;
}

export interface TextOptions {
  text: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  fontWeight: "normal" | "bold";
  italic: boolean;
  fontFamily: string;
  align: "left" | "center" | "right";
  underline: boolean;
  characterSpacing: number;
  lineHeight: number;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  brightness: number;
  shadow: number;
  shadowColor: string;
  curve: number;
}

export interface ColorEffectOptions {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  sepia: number;
  blur: number;
  vignette: number;
  motionBlur: number;
  fadeIn: number;
  fadeOut: number;
  mask: "none" | "circle";
  maskX: number;
  maskY: number;
  maskSize: number;
}

export interface LutSettings {
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB triplets in .cube blue-fastest order, normalized to [0, 1]. */
  data: number[];
  cubeText: string;
  strength: number;
}

export interface Clip {
  id: string;
  kind: TrackKind;
  name: string;
  assetId?: string;
  start: number;
  duration: number;
  trimIn: number;
  speed: number;
  speedRamp?: SpeedPoint[];
  volume: number;
  opacity: number;
  fit: FitMode;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  mask: ClipMask;
  /** Mask center on the canvas, as a fraction of the canvas size. */
  maskX?: number;
  maskY?: number;
  /** Mask size as a fraction of the canvas' shorter side. */
  maskWidth?: number;
  /** Rectangle height as a fraction of the canvas' shorter side. */
  maskHeight?: number;
  /** Mask rotation around its center, in degrees. */
  maskRotation?: number;
  /** Polygon points for a custom mask, normalized to the canvas. */
  maskPoints?: MaskPoint[];
  chromaKey?: ChromaKeyOptions;
  fadeIn: number;
  fadeOut: number;
  pitch: number;
  bass: number;
  treble: number;
  /** Mid band gain in decibels. */
  mid: number;
  /** Low shelf frequency in hertz. */
  bassFrequency: number;
  /** Mid band frequency in hertz. */
  midFrequency: number;
  /** Mid band width in octaves. */
  midWidth: number;
  /** High shelf frequency in hertz. */
  trebleFrequency: number;
  /** Stereo pan, -1 hard left to 1 hard right. */
  pan: number;
  compressor: AudioCompressor;
  effect?: ColorEffectOptions;
  lut?: LutSettings;
  keyframes: Keyframe[];
  transitionIn: ClipTransition;
  transitionOut: ClipTransition;
  text?: TextOptions;
  subtitleCue?: boolean;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  /** The main (magnetic) track keeps its clips packed with no gaps. */
  magnetic?: boolean;
  /** Track level in the mix. */
  volume?: number;
  /** Ducking applied when other audio plays over this track. */
  ducking?: AudioDucking;
  clips: Clip[];
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt: number;
  updatedAt: number;
  assets: Asset[];
  tracks: Track[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt: number;
  updatedAt: number;
  duration: number;
  thumbnail?: string;
}

export interface ExportClipRequest {
  path: string;
  /** The track the clip belongs to, used to find neighbouring clips. */
  trackId?: string;
  start: number;
  duration: number;
  trimIn: number;
  speed: number;
  speedRamp: SpeedPoint[];
  volume: number;
  opacity: number;
  hasAudio: boolean;
  hasVideo: boolean;
  isImage: boolean;
  fit: FitMode;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  mask: ClipMask;
  maskX: number;
  maskY: number;
  maskWidth: number;
  maskHeight: number;
  maskRotation: number;
  maskPoints: MaskPoint[];
  chromaKey?: ChromaKeyOptions;
  fadeIn: number;
  fadeOut: number;
  pitch: number;
  bass: number;
  treble: number;
  mid: number;
  bassFrequency: number;
  midFrequency: number;
  midWidth: number;
  trebleFrequency: number;
  pan: number;
  compressor: AudioCompressor;
  duckSegments: DuckSegment[];
  keyframes: Keyframe[];
  transitionIn: ClipTransition;
  transitionOut: ClipTransition;
}

export interface ExportTextRequest {
  text: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  size: number;
  color: string;
  fontWeight: "normal" | "bold";
  italic: boolean;
  fontFamily: string;
  align: "left" | "center" | "right";
  underline: boolean;
  characterSpacing: number;
  lineHeight: number;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  brightness: number;
  shadow: number;
  shadowColor: string;
  curve: number;
  opacity: number;
  rotation: number;
  keyframes: Keyframe[];
  transitionIn: ClipTransition;
  transitionOut: ClipTransition;
}

export interface ExportEffectRequest extends ColorEffectOptions {
  start: number;
  duration: number;
  opacity: number;
  lut?: LutSettings;
}

export type ExportAudioCodec = "aac" | "alac";

/** Audio encoding for the exported file, separate from the project itself. */
export interface ExportAudioSettings {
  codec: ExportAudioCodec;
  /** Target bitrate in kbps. Lossless codecs ignore it. */
  bitrate: number;
  /** Output sample rate in hertz. */
  sampleRate: number;
}

export interface ExportRequest {
  output: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  clips: ExportClipRequest[];
  texts: ExportTextRequest[];
  effects: ExportEffectRequest[];
  encoder?: "libx264" | "nvenc" | "qsv" | "amf";
  quality?: "draft" | "balanced" | "high";
  audioCodec?: ExportAudioCodec;
  audioBitrate?: number;
  audioSampleRate?: number;
}

export interface ExportResult {
  output: string;
  elapsedMs: number;
}

/** A single frame rendered by the export pipeline for the preview. */
export interface PreviewFrameResult {
  /** Media-registry id for the PNG, served over the regular media protocol. */
  mediaId: string;
  width: number;
  height: number;
  time: number;
  elapsedMs: number;
}

/** Progress of an "export-accurate" preview render. */
export interface PreviewRenderProgress {
  percent: number;
  time: number;
}

/** A finished "export-accurate" preview render. */
export interface PreviewRenderResult {
  /** Media-registry id for the rendered file. */
  mediaId: string;
  /** Stable content key of the rendered project. */
  key: string;
  /** True when the cached file was reused without rendering anything. */
  reused: boolean;
  elapsedMs: number;
}

export interface ExportProgress {
  percent: number;
  time: number;
  speed: string;
  fps: number;
}

export interface MediaProgress {
  kind: string;
  path: string;
  percent: number;
}

export type RuntimeToolSource = "bundled" | "override" | "path" | "missing";

export interface RuntimeToolStatus {
  name: string;
  path: string;
  version: string | null;
  source: RuntimeToolSource;
  available: boolean;
}

export interface RuntimeStatus {
  ready: boolean;
  ffmpeg: RuntimeToolStatus;
  ffprobe: RuntimeToolStatus;
}

/** Summary of a project held in the on-disk project library. */
export interface StoredProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt: number;
  updatedAt: number;
  duration: number;
}

/** Memory footprint of the editor and of the FFmpeg children it spawned. */
export interface MemorySnapshot {
  appWorkingSetBytes: number;
  appPeakWorkingSetBytes: number;
  ffmpegWorkingSetBytes: number;
  ffmpegPeakWorkingSetBytes: number;
  ffmpegProcessCount: number;
}
