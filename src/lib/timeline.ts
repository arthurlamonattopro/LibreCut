import type { Clip, Project, Track } from "./types";

const EPSILON = 1e-6;

/** Stable ordering used by magnetic tracks and ripple helpers. */
export function sortTrackClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * The magnetic main track behaves like a fixed sequence: clips keep their
 * order but every gap is closed. Call this after inserts, moves, trims, and
 * deletes that touch a magnetic track.
 */
export function compactMagneticTrack(track: Track): void {
  if (!track.magnetic || track.locked) return;
  sortTrackClips(track);
  let cursor = 0;
  for (const clip of track.clips) {
    if (Math.abs(clip.start - cursor) > EPSILON) clip.start = cursor;
    cursor += clip.duration;
  }
}

export function settleMagneticTracks(project: Project, trackIds?: Iterable<string>): void {
  const filter = trackIds ? new Set(trackIds) : null;
  for (const track of project.tracks) {
    if (filter && !filter.has(track.id)) continue;
    compactMagneticTrack(track);
  }
}

/** Moves every unlocked clip that starts at or after `time` by `delta`. */
export function shiftClipsAfter(
  project: Project,
  time: number,
  delta: number,
  exceptClipId?: string,
): void {
  if (Math.abs(delta) < EPSILON) return;
  for (const track of project.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (clip.id === exceptClipId) continue;
      if (clip.start >= time - EPSILON) {
        clip.start = Math.max(0, clip.start + delta);
      }
    }
  }
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}
/**
 * Removes a clip and, when ripple is enabled, closes the resulting gap across
 * every unlocked track so sync stays intact.
 */
export function removeClip(project: Project, clipId: string, ripple: boolean): void {
  const found = findClip(project, clipId);
  if (!found) return;
  const { track, clip } = found;
  const end = clip.start + clip.duration;
  const duration = clip.duration;

  track.clips = track.clips.filter((item) => item.id !== clipId);

  if (ripple) shiftClipsAfter(project, end, -duration, clipId);
  if (track.magnetic) compactMagneticTrack(track);
}

/**
 * Applies a ripple trim to the end of a clip. Downstream clips follow the new
 * end so no gap is left behind and no clips overlap.
 */
export function rippleTrimEnd(project: Project, clip: Clip, targetEnd: number): void {
  const oldEnd = clip.start + clip.duration;
  const newEnd = Math.max(clip.start + 0.1, targetEnd);
  const delta = newEnd - oldEnd;
  clip.duration = newEnd - clip.start;
  shiftClipsAfter(project, oldEnd, delta, clip.id);
  const track = project.tracks.find((item) => item.clips.includes(clip));
  if (track?.magnetic) compactMagneticTrack(track);
}

/**
 * Ripple trim of the in-point. The clip keeps its timeline position, loses
 * material from the head, and downstream clips slide left by the same amount.
 * Negative deltas (extending the head) fall back to a normal trim.
 */
export function rippleTrimStart(
  project: Project,
  clip: Clip,
  targetStart: number,
  minDuration = 0.1,
): void {
  const delta = targetStart - clip.start;
  if (delta < 0) {
    clip.start = targetStart;
    clip.duration -= delta;
    clip.trimIn = Math.max(0, clip.trimIn + delta * clip.speed);
  } else {
    const maxDelta = clip.duration - minDuration;
    const applied = Math.min(delta, maxDelta);
    clip.duration -= applied;
    clip.trimIn = Math.max(0, clip.trimIn + applied * clip.speed);
    shiftClipsAfter(project, clip.start + clip.duration + applied, -applied, clip.id);
  }
  const track = project.tracks.find((item) => item.clips.includes(clip));
  if (track?.magnetic) compactMagneticTrack(track);
}
