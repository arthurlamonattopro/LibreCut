import type { AudioCompressor, AudioDucking, Clip, DuckSegment, Project, Track } from "./types";

export const DEFAULT_DUCKING: AudioDucking = {
  enabled: false,
  amount: 12,
  threshold: -30,
  attack: 0.25,
  release: 0.6,
};

export const DEFAULT_COMPRESSOR: AudioCompressor = {
  enabled: false,
  threshold: -18,
  ratio: 4,
  attack: 12,
  release: 180,
};

export const DEFAULT_BASS_FREQUENCY = 180;
export const DEFAULT_MID_FREQUENCY = 1000;
export const DEFAULT_MID_WIDTH = 1;
export const DEFAULT_TREBLE_FREQUENCY = 4000;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-6, gain));
}

/**
 * Q factor (in decibels, as used by the Web Audio API) that produces a peaking
 * filter with the given width in octaves.
 */
export function midFilterQ(widthOctaves: number): number {
  const width = clamp(widthOctaves, 0.1, 6);
  const q = 1 / (2 * Math.sinh((Math.LN2 * width) / 2));
  return 20 * Math.log10(Math.max(1e-6, q));
}

/** Stereo pan gains matching the Web Audio API panning law. */
export function panGains(pan: number): { left: number; right: number } {
  const value = clamp(pan, -1, 1);
  if (value < 0) return { left: Math.cos((value * Math.PI) / 2), right: 1 + value };
  if (value > 0) return { left: 1 - value, right: Math.sin((value * Math.PI) / 2) };
  return { left: 1, right: 1 };
}

export interface TimeRegion {
  start: number;
  end: number;
}

/** Merges overlapping and touching regions into a sorted list. */
export function mergeRegions(regions: TimeRegion[]): TimeRegion[] {
  const sorted = regions
    .filter((region) => region.end > region.start)
    .map((region) => ({ start: region.start, end: region.end }))
    .sort((a, b) => a.start - b.start);
  const merged: TimeRegion[] = [];
  for (const region of sorted) {
    const last = merged[merged.length - 1];
    if (last && region.start <= last.end) {
      last.end = Math.max(last.end, region.end);
    } else {
      merged.push(region);
    }
  }
  return merged;
}

/**
 * Regions where other audio is loud enough to trigger ducking on the target
 * track. Tracks that duck themselves are never used as the key signal.
 */
export function duckKeyRegions(project: Project, target: Track): TimeRegion[] {
  const threshold = target.ducking?.threshold ?? DEFAULT_DUCKING.threshold;
  const regions: TimeRegion[] = [];
  // Resolving each clip's asset with a scan would cost O(clips x assets) on a
  // long timeline, so the audio-capable assets are collected once.
  const audibleAssets = new Set(
    project.assets.filter((asset) => asset.info.hasAudio).map((asset) => asset.id),
  );
  for (const track of project.tracks) {
    if (track.id === target.id) continue;
    if (track.muted || track.hidden) continue;
    if (track.ducking?.enabled) continue;
    for (const clip of track.clips) {
      if (!clip.assetId || !audibleAssets.has(clip.assetId)) continue;
      if (gainToDb(clip.volume) < threshold) continue;
      regions.push({ start: clip.start, end: clip.start + clip.duration });
    }
  }
  return mergeRegions(regions);
}

export function clipHasAudio(project: Project, clip: Clip): boolean {
  if (!clip.assetId) return false;
  const asset = project.assets.find((item) => item.id === clip.assetId);
  return Boolean(asset?.info.hasAudio);
}

/**
 * Builds the gain envelope that attenuates a track while the key signal plays.
 * Each segment is a linear ramp on the project timeline.
 */
export function duckEnvelope(settings: AudioDucking, regions: TimeRegion[]): DuckSegment[] {
  const amount = clamp(settings.amount, 0, 24);
  if (!settings.enabled || amount <= 0.001 || !regions.length) return [];
  const gain = dbToGain(-amount);
  const attack = clamp(settings.attack, 0.01, 5);
  const release = clamp(settings.release, 0.01, 10);
  const windows = mergeRegions(
    regions.map((region) => ({
      start: Math.max(0, region.start - attack),
      end: region.end + release,
    })),
  );

  const segments: DuckSegment[] = [];
  for (const window of windows) {
    const span = Math.max(0.001, window.end - window.start);
    const scale = span < attack + release ? span / (attack + release) : 1;
    const attackTime = attack * scale;
    const releaseTime = release * scale;
    segments.push({ start: window.start, end: window.start + attackTime, from: 1, to: gain });
    segments.push({ start: window.start + attackTime, end: window.end - releaseTime, from: gain, to: gain });
    segments.push({ start: window.end - releaseTime, end: window.end, from: gain, to: 1 });
  }
  return segments.filter((segment) => segment.end - segment.start > 0.0005);
}

/** Gain multiplier applied by a ducking envelope at a point in time. */
export function duckGainAt(segments: DuckSegment[], time: number): number {
  for (const segment of segments) {
    if (time < segment.start) break;
    if (time <= segment.end) {
      const span = segment.end - segment.start;
      if (span <= 0.0005) return segment.to;
      const progress = (time - segment.start) / span;
      return segment.from + (segment.to - segment.from) * progress;
    }
  }
  return 1;
}

/** Ducking envelopes for every ducked track in the project. */
export function projectDuckingSegments(project: Project): Map<string, DuckSegment[]> {
  const result = new Map<string, DuckSegment[]>();
  for (const track of project.tracks) {
    if (!track.ducking?.enabled) continue;
    result.set(track.id, duckEnvelope(track.ducking, duckKeyRegions(project, track)));
  }
  return result;
}
