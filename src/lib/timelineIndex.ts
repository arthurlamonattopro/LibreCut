import type { Clip, Project, Track } from "./types";

/**
 * A time-ordered view of the clips on one track.
 *
 * The preview needs the clips that are on screen at a given time, and it needs
 * them many times per second. Scanning every clip of every track for each
 * frame costs O(clips) per frame, which shows up as dropped frames on a long
 * timeline. The clips are sorted once and the active set is found with a
 * binary search plus a short walk backwards.
 */
export interface TrackIndex {
  /** The track this index describes. */
  track: Track;
  /** Clips ordered by start time, for the binary search. */
  clips: Clip[];
  /**
   * The position of each clip in the track's clip array. Layers are drawn in
   * this order, so the original ordering has to be preserved.
   */
  order: number[];
  /**
   * `prefixMaxEnd[i]` is the latest end time among clips `0..i`. It lets the
   * search stop as soon as no earlier clip can still be active.
   */
  prefixMaxEnd: number[];
}

export interface TimelineIndex {
  tracks: TrackIndex[];
  /** Maps a clip id to its track and index, for O(1) lookups. */
  clipLocations: Map<string, { track: TrackIndex; index: number }>;
  duration: number;
}

export function buildTimelineIndex(project: Project): TimelineIndex {
  const tracks: TrackIndex[] = [];
  const clipLocations = new Map<string, { track: TrackIndex; index: number }>();
  let duration = 0;

  for (const track of project.tracks) {
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    const prefixMaxEnd: number[] = new Array(clips.length);
    const order: number[] = new Array(clips.length);
    const arrayPosition = new Map(track.clips.map((clip, index) => [clip.id, index]));
    let maxEnd = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const end = clip.start + clip.duration;
      if (end > maxEnd) maxEnd = end;
      prefixMaxEnd[index] = maxEnd;
      order[index] = arrayPosition.get(clip.id) ?? index;
      if (end > duration) duration = end;
    }
    const trackIndex: TrackIndex = { track, clips, prefixMaxEnd, order };
    for (let index = 0; index < clips.length; index += 1) {
      clipLocations.set(clips[index].id, { track: trackIndex, index });
    }
    tracks.push(trackIndex);
  }

  return { tracks, clipLocations, duration };
}

/**
 * Returns the clips of a track that are on screen at `time`.
 *
 * A clip is active when it has started but has not ended yet. Overlapping
 * clips are handled: the search walks back while an earlier clip could still
 * be running.
 */
export function activeClipsAt(track: TrackIndex, time: number): Clip[] {
  const { clips, prefixMaxEnd } = track;
  if (!clips.length) return [];

  // Index of the first clip that starts after `time`.
  let low = 0;
  let high = clips.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (clips[mid].start <= time) low = mid + 1;
    else high = mid;
  }

  const active: number[] = [];
  for (let index = low - 1; index >= 0; index -= 1) {
    // No earlier clip can be active once the latest end time is in the past.
    if (prefixMaxEnd[index] <= time) break;
    const clip = clips[index];
    if (clip.start + clip.duration > time) active.push(index);
  }
  // The walk-back yields clips in reverse order. Restore the order the track
  // holds them in, because that is the order the layers are drawn in.
  active.sort((a, b) => track.order[a] - track.order[b]);
  return active.map((index) => clips[index]);
}

/** Returns the clips of every track that are on screen at `time`. */
export function activeClips(
  index: TimelineIndex,
  time: number,
): Array<{ track: Track; clip: Clip }> {
  const result: Array<{ track: Track; clip: Clip }> = [];
  for (const track of index.tracks) {
    for (const clip of activeClipsAt(track, time)) {
      result.push({ track: track.track, clip });
    }
  }
  return result;
}
