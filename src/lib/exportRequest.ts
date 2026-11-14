import { projectDuckingSegments } from "./audio";
import { cachedProjectDuration } from "./time";
import type {
  ExportAudioSettings,
  ExportClipRequest,
  ExportEffectRequest,
  ExportRequest,
  ExportTextRequest,
  Project,
} from "./types";

export type ExportEncoder = "libx264" | "nvenc";

/**
 * Defaults for the audio stream. AAC at 192 kbps and 48 kHz is the safe choice
 * that plays everywhere; the export dialog lets the user change all three.
 */
export const DEFAULT_EXPORT_AUDIO: ExportAudioSettings = {
  codec: "aac",
  bitrate: 192,
  sampleRate: 48000,
};

/**
 * Translates the editor's project model into the export request the Rust
 * backend renders.
 *
 * The mapping is the contract between the timeline and the FFmpeg filter
 * graph, so it lives outside the export dialog and stays testable: the
 * regression suite loads real project files and checks the request they
 * produce.
 */
export function buildExportRequest(
  project: Project,
  output: string,
  width: number,
  height: number,
  encoder: ExportEncoder = "libx264",
  audio: ExportAudioSettings = DEFAULT_EXPORT_AUDIO,
): ExportRequest {
  const clips: ExportClipRequest[] = [];
  const ducking = projectDuckingSegments(project);
  for (const track of project.tracks) {
    if (track.hidden || track.kind === "text") continue;
    const trackVolume = track.volume ?? 1;
    const duckSegments = ducking.get(track.id) ?? [];
    for (const clip of track.clips) {
      const asset = clip.assetId ? project.assets.find((item) => item.id === clip.assetId) : undefined;
      if (!asset) continue;

      if (track.kind === "video" && (asset.info.hasVideo || asset.info.isImage)) {
        clips.push({
          path: asset.path,
          trackId: track.id,
          start: clip.start,
          duration: clip.duration,
          trimIn: clip.trimIn,
          speed: clip.speed,
          speedRamp: clip.speedRamp ?? [],
          volume: clip.volume * trackVolume,
          opacity: clip.opacity,
          hasAudio: asset.info.hasAudio && !track.muted,
          hasVideo: true,
          isImage: asset.info.isImage,
          fit: clip.fit,
          x: clip.x,
          y: clip.y,
          scale: clip.scale,
          rotation: clip.rotation,
          mask: clip.mask,
          maskX: clip.maskX ?? 0.5,
          maskY: clip.maskY ?? 0.5,
          maskWidth: clip.maskWidth ?? 0.6,
          maskHeight: clip.maskHeight ?? 0.6,
          maskRotation: clip.maskRotation ?? 0,
          maskPoints: clip.maskPoints ?? [],
          chromaKey: clip.chromaKey,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          pitch: clip.pitch,
          bass: clip.bass,
          treble: clip.treble,
          mid: clip.mid,
          bassFrequency: clip.bassFrequency,
          midFrequency: clip.midFrequency,
          midWidth: clip.midWidth,
          trebleFrequency: clip.trebleFrequency,
          pan: clip.pan,
          compressor: clip.compressor,
          duckSegments,
          keyframes: clip.keyframes,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut,
        });
      } else if (track.kind === "audio" && asset.info.hasAudio) {
        clips.push({
          path: asset.path,
          trackId: track.id,
          start: clip.start,
          duration: clip.duration,
          trimIn: clip.trimIn,
          speed: clip.speed,
          speedRamp: clip.speedRamp ?? [],
          volume: clip.volume * trackVolume,
          opacity: 1,
          // A muted track is silent in the preview, so it is silent in the
          // export as well.
          hasAudio: !track.muted,
          hasVideo: false,
          isImage: false,
          fit: "contain",
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          mask: "none",
          maskX: 0.5,
          maskY: 0.5,
          maskWidth: 0.6,
          maskHeight: 0.6,
          maskRotation: 0,
          maskPoints: [],
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          pitch: clip.pitch,
          bass: clip.bass,
          treble: clip.treble,
          mid: clip.mid,
          bassFrequency: clip.bassFrequency,
          midFrequency: clip.midFrequency,
          midWidth: clip.midWidth,
          trebleFrequency: clip.trebleFrequency,
          pan: clip.pan,
          compressor: clip.compressor,
          duckSegments,
          keyframes: clip.keyframes,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut,
        });
      }
    }
  }

  const scale = height / project.height;
  const effects: ExportEffectRequest[] = project.tracks
    .filter((track) => track.kind === "misc" && !track.hidden)
    .flatMap((track) =>
      track.clips
        .filter((clip) => clip.effect)
        .map((clip) => ({
          ...clip.effect!,
          start: clip.start,
          duration: clip.duration,
          opacity: clip.opacity,
          lut: clip.lut,
        })),
    );
  const texts: ExportTextRequest[] = project.tracks
    .filter((track) => track.kind === "text" && !track.hidden)
    .flatMap((track) =>
      track.clips
        .filter((clip) => clip.text)
        .map((clip) => ({
          text: clip.text!.text,
          start: clip.start,
          duration: clip.duration,
          x: clip.text!.x,
          y: clip.text!.y,
          size: clip.text!.size * scale,
          rotation: clip.text!.rotation,
          keyframes: clip.keyframes,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut,
          color: clip.text!.color,
          fontWeight: clip.text!.fontWeight,
          italic: clip.text!.italic,
          fontFamily: clip.text!.fontFamily,
          align: clip.text!.align,
          underline: clip.text!.underline,
          characterSpacing: clip.text!.characterSpacing * scale,
          lineHeight: clip.text!.lineHeight,
          outlineColor: clip.text!.outlineColor,
          outlineWidth: clip.text!.outlineWidth * scale,
          backgroundColor: clip.text!.backgroundColor,
          backgroundOpacity: clip.text!.backgroundOpacity,
          brightness: clip.text!.brightness,
          shadow: clip.text!.shadow,
          shadowColor: clip.text!.shadowColor,
          curve: clip.text!.curve,
          opacity: clip.opacity,
        })),
    );

  return {
    output,
    width,
    height,
    fps: project.fps,
    duration: cachedProjectDuration(project.tracks, 0),
    clips,
    texts,
    effects,
    encoder,
    audioCodec: audio.codec,
    audioBitrate: audio.bitrate,
    audioSampleRate: audio.sampleRate,
  };
}

/**
 * A stable content key for an export request.
 *
 * Used to tell whether a rendered preview still matches the project. The
 * output path is ignored, so changing *where* a file goes does not invalidate
 * the preview; anything that changes the pixels (including invisible settings
 * like frame rate) does. Audio encoding only affects the container, not the
 * rendered frames, so the preview key ignores it as well.
 */
export function previewRenderKey(request: ExportRequest): string {
  const rest: Partial<ExportRequest> = { ...request };
  delete rest.output;
  delete rest.audioCodec;
  delete rest.audioBitrate;
  delete rest.audioSampleRate;
  const json = JSON.stringify(rest);
  let hash = 0x811c9dc5 >>> 0;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
