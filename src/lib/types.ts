export type TrackKind = "video" | "audio" | "text" | "misc";
export type FitMode = "contain" | "cover";
export type ClipMask = "none" | "circle";
export type KeyframeProperty = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
export type TransitionType = "none" | "fade" | "wipe";

export interface Keyframe {
  property: KeyframeProperty;
  time: number;
  value: number;
}

export interface ClipTransition {
  type: TransitionType;
  duration: number;
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
  align: "left" | "center" | "right";
  underline: boolean;
  characterSpacing: number;
  outlineColor: string;
  outlineWidth: number;
  brightness: number;
  shadow: number;
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

export interface Clip {
  id: string;
  kind: TrackKind;
  name: string;
  assetId?: string;
  start: number;
  duration: number;
  trimIn: number;
  speed: number;
  volume: number;
  opacity: number;
  fit: FitMode;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  mask: ClipMask;
  chromaKey?: ChromaKeyOptions;
  fadeIn: number;
  fadeOut: number;
  pitch: number;
  bass: number;
  treble: number;
  effect?: ColorEffectOptions;
  keyframes: Keyframe[];
  transitionIn: ClipTransition;
  transitionOut: ClipTransition;
  text?: TextOptions;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
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
  start: number;
  duration: number;
  trimIn: number;
  speed: number;
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
  chromaKey?: ChromaKeyOptions;
  fadeIn: number;
  fadeOut: number;
  pitch: number;
  bass: number;
  treble: number;
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
  align: "left" | "center" | "right";
  underline: boolean;
  characterSpacing: number;
  outlineColor: string;
  outlineWidth: number;
  brightness: number;
  shadow: number;
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
}

export interface ExportResult {
  output: string;
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
