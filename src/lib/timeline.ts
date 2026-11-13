import type { Clip, Project, Track } from "./types";

const EPSILON = 1e-6;

/** Stable ordering used by magnetic tracks and ripple helpers. */
export function sortTrackClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * The magnetic main track behaves like a fixed sequence: clips keep their
 * order but every gap is closed. Call this when a clip is inserted, split, or
 * duplicated. Ordinary moves, trims, and deletes leave the track alone so a
 * clip does not jump somewhere the user did not drop it.
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

/** Moves every unlocked clip of one track that starts at or after `time`. */
export function shiftTrackClipsAfter(
  track: Track,
  time: number,
  delta: number,
  exceptClipId?: string,
): void {
  if (Math.abs(delta) < EPSILON) return;
  for (const clip of track.clips) {
    if (clip.id === exceptClipId) continue;
    if (clip.start >= time - EPSILON) {
      clip.start = Math.max(0, clip.start + delta);
    }
  }
}

/**
 * Moves every unlocked clip that starts at or after `time` by `delta`.
 *
 * When `trackId` is supplied only that track moves. Ripple edits pass a track
 * id so a cut on the video track does not pull the audio and text out of sync.
 */
export function shiftClipsAfter(
  project: Project,
  time: number,
  delta: number,
  exceptClipId?: string,
  trackId?: string,
): void {
  if (Math.abs(delta) < EPSILON) return;
  for (const track of project.tracks) {
    if (trackId && track.id !== trackId) continue;
    if (track.locked) continue;
    shiftTrackClipsAfter(track, time, delta, exceptClipId);
  }
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function overlaps(start: number, duration: number, other: Clip): boolean {
  return start < other.start + other.duration - EPSILON && start + duration > other.start + EPSILON;
}

/**
 * The nearest start at or around `desiredStart` where a clip fits without
 * overlapping the other clips of the track.
 *
 * When a drop lands on an occupied spot the clip slides right (or left, when
 * `preferRight` is false) until it reaches a gap. Clips can therefore no longer
 * be stacked on top of each other on an ordinary track.
 */
export function findFreeStart(
  track: Track,
  moving: string | Iterable<string> | null | undefined,
  desiredStart: number,
  duration: number,
  preferRight = true,
): number {
  const ignored = moving == null
    ? new Set<string>()
    : typeof moving === "string"
      ? new Set([moving])
      : new Set(moving);
  const others = track.clips.filter((clip) => !ignored.has(clip.id));
  const start = Math.max(0, desiredStart);

  const collisions = (candidate: number) => others.filter((clip) => overlaps(candidate, duration, clip));
  if (!collisions(start).length) return start;

  const pushRight = (from: number): number => {
    let cursor = from;
    // The bounded loop is enough to walk a chain of touching clips.
    for (let attempt = 0; attempt <= others.length + 1; attempt += 1) {
      const hits = collisions(cursor);
      if (!hits.length) return cursor;
      const next = Math.max(...hits.map((clip) => clip.start + clip.duration));
      if (next <= cursor + EPSILON) return cursor + duration;
      cursor = next;
    }
    return cursor;
  };

  const pushLeft = (from: number): number | null => {
    let cursor = from;
    for (let attempt = 0; attempt <= others.length + 1; attempt += 1) {
      const hits = collisions(cursor);
      if (!hits.length) return cursor >= 0 ? cursor : null;
      const previous = Math.min(...hits.map((clip) => clip.start - duration));
      if (previous < 0 || Math.abs(previous - cursor) < EPSILON) return null;
      cursor = previous;
    }
    return cursor >= 0 ? cursor : null;
  };

  // Choose the closest gap instead of always throwing the clip to the far
  // right. `preferRight` only breaks a tie.
  const right = pushRight(start);
  const left = pushLeft(start);
  if (left == null) return right;
  const leftDistance = Math.abs(left - start);
  const rightDistance = Math.abs(right - start);
  if (Math.abs(leftDistance - rightDistance) < EPSILON) return preferRight ? right : left;
  return leftDistance < rightDistance ? left : right;
}

/** The closest clip edges around a clip on its track. */
export function neighborBounds(
  track: Track,
  clipId: string,
  clip: Clip,
): { previousEnd: number; nextStart: number } {
  const others = track.clips.filter((item) => item.id !== clipId);
  let previousEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const other of others) {
    if (other.start + other.duration <= clip.start + EPSILON) {
      previousEnd = Math.max(previousEnd, other.start + other.duration);
    }
    if (other.start >= clip.start + clip.duration - EPSILON) {
      nextStart = Math.min(nextStart, other.start);
    }
  }
  return { previousEnd, nextStart };
}

/**
 * Removes a clip. With ripple enabled, later clips on the same track close the
 * gap; other tracks keep their timing.
 */
export function removeClip(project: Project, clipId: string, ripple: boolean): void {
  const found = findClip(project, clipId);
  if (!found) return;
  const { track, clip } = found;
  const end = clip.start + clip.duration;
  const duration = clip.duration;

  track.clips = track.clips.filter((item) => item.id !== clipId);

  if (ripple && !track.locked) shiftTrackClipsAfter(track, end, -duration, clipId);
}

/** Removes several clips in one pass. */
export function removeClips(project: Project, clipIds: Iterable<string>, ripple: boolean): void {
  const ids = [...new Set(clipIds)];
  if (!ids.length) return;
  // Delete from the end of the timeline first, so a ripple on one cut does not
  // move another clip that is about to be removed.
  const ordered = ids
    .map((id) => ({ id, clip: findClip(project, id)?.clip }))
    .filter((item): item is { id: string; clip: Clip } => Boolean(item.clip))
    .sort((a, b) => b.clip.start - a.clip.start);
  for (const item of ordered) removeClip(project, item.id, ripple);
}

/**
 * Applies a ripple trim to the end of a clip. Later clips on the same track
 * follow the new end so no gap is left behind and no clips overlap.
 */
export function rippleTrimEnd(project: Project, clip: Clip, targetEnd: number): void {
  const found = project.tracks.find((item) => item.clips.includes(clip));
  if (!found) return;
  const oldEnd = clip.start + clip.duration;
  const newEnd = Math.max(clip.start + 0.1, targetEnd);
  const delta = newEnd - oldEnd;
  clip.duration = newEnd - clip.start;
  if (!found.locked) shiftTrackClipsAfter(found, oldEnd, delta, clip.id);
}

/**
 * Ripple trim of the in-point. The clip keeps its timeline position, loses
 * material from the head, and later clips on the same track slide by the same
 * amount. Negative deltas (extending the head) fall back to a normal trim.
 */
export function rippleTrimStart(
  project: Project,
  clip: Clip,
  targetStart: number,
  minDuration = 0.1,
): void {
  const found = project.tracks.find((item) => item.clips.includes(clip));
  if (!found) return;
  const delta = targetStart - clip.start;
  if (delta < 0) {
    clip.start = targetStart;
    clip.duration -= delta;
    clip.trimIn = Math.max(0, clip.trimIn + delta * clip.speed);
  } else {
    const maxDelta = clip.duration - minDuration;
    const applied = Math.min(delta, maxDelta);
    const oldEnd = clip.start + clip.duration;
    clip.duration -= applied;
    clip.trimIn = Math.max(0, clip.trimIn + applied * clip.speed);
    if (!found.locked) shiftTrackClipsAfter(found, oldEnd, -applied, clip.id);
  }
}
