import {
  DEFAULT_BASS_FREQUENCY,
  DEFAULT_COMPRESSOR,
  DEFAULT_DUCKING,
  DEFAULT_MID_FREQUENCY,
  DEFAULT_MID_WIDTH,
  DEFAULT_TREBLE_FREQUENCY,
} from "./audio";
import type { Project } from "./types";

/**
 * Fills in values that older project files do not contain. The project format
 * stays backwards compatible: missing fields get their default instead of
 * failing to load.
 */
export function normalizeProject(project: Project): Project {
  for (const track of project.tracks) {
    track.magnetic ??= false;
    track.volume ??= 1;
    track.ducking ??= { ...DEFAULT_DUCKING };
    if (!Array.isArray(track.clips)) track.clips = [];
  }
  if (!project.tracks.some((track) => track.magnetic)) {
    const firstVideo = project.tracks.find((track) => track.kind === "video");
    if (firstVideo) firstVideo.magnetic = true;
  }
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      clip.x ??= 0;
      clip.y ??= 0;
      clip.scale ??= 1;
      clip.rotation ??= 0;
      clip.mask ??= "none";
      clip.maskX ??= 0.5;
      clip.maskY ??= 0.5;
      // Older circle masks covered the whole frame; keep them looking the same
      // while new masks start a little smaller.
      if (clip.maskWidth === undefined) clip.maskWidth = clip.mask === "circle" ? 1 : 0.6;
      if (clip.maskHeight === undefined) clip.maskHeight = clip.mask === "circle" ? 1 : 0.6;
      clip.maskRotation ??= 0;
      if (!Array.isArray(clip.maskPoints)) clip.maskPoints = [];
      clip.fadeIn ??= 0;
      clip.fadeOut ??= 0;
      clip.pitch ??= 0;
      clip.bass ??= 0;
      clip.treble ??= 0;
      clip.mid ??= 0;
      clip.bassFrequency ??= DEFAULT_BASS_FREQUENCY;
      clip.midFrequency ??= DEFAULT_MID_FREQUENCY;
      clip.midWidth ??= DEFAULT_MID_WIDTH;
      clip.trebleFrequency ??= DEFAULT_TREBLE_FREQUENCY;
      clip.pan ??= 0;
      clip.compressor ??= { ...DEFAULT_COMPRESSOR };
      clip.speedRamp ??= [];
      clip.keyframes ??= [];
      clip.transitionIn ??= { type: "none", duration: 0.5 };
      clip.transitionOut ??= { type: "none", duration: 0.5 };
      // Older projects used a single wipe name; the catalogue now names every
      // direction separately.
      if (clip.transitionIn.type === "wipe") clip.transitionIn.type = "wiperight";
      if (clip.transitionOut.type === "wipe") clip.transitionOut.type = "wiperight";
      if (clip.kind === "misc") {
        clip.effect ??= {
          brightness: 0,
          contrast: 1,
          saturation: 1,
          hue: 0,
          sepia: 0,
          blur: 0,
          vignette: 0,
          motionBlur: 0,
          fadeIn: 0,
          fadeOut: 0,
          mask: "none",
          maskX: 0.5,
          maskY: 0.5,
          maskSize: 0.5,
        };
        clip.effect.sepia ??= 0;
        clip.effect.vignette ??= 0;
        clip.effect.motionBlur ??= 0;
        clip.effect.fadeIn ??= 0;
        clip.effect.fadeOut ??= 0;
      }
      if (clip.text) {
        clip.text.underline ??= false;
        clip.text.characterSpacing ??= 0;
        clip.text.italic ??= false;
        clip.text.fontFamily ??= "Segoe UI";
        clip.text.lineHeight ??= 1.2;
        clip.text.outlineColor ??= "#000000";
        clip.text.outlineWidth ??= 0;
        clip.text.backgroundColor ??= "#000000";
        clip.text.backgroundOpacity ??= 0;
        clip.text.brightness ??= 1;
        clip.text.shadow ??= 0.5;
        clip.text.shadowColor ??= "#000000";
        clip.text.curve ??= 0;
        clip.text.rotation ??= 0;
      }
    }
  }
  return project;
}
