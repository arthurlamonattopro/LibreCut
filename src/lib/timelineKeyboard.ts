/**
 * Keyboard navigation rules for the timeline.
 *
 * The timeline is a grid of tracks and clips, so the keyboard has to answer
 * two questions: which clip has focus, and which track is it on. These
 * helpers are pure so the rules can be tested without a DOM.
 */

export interface ClipPosition {
  id: string;
  start: number;
  duration: number;
}

/** The clips of a track in the order they appear on the timeline. */
export function orderedClips(clips: ClipPosition[]): ClipPosition[] {
  return [...clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * The clip before or after the given one inside the same track.
 *
 * Returns null at the ends of the track so the caller can keep the focus
 * where it is.
 */
export function nextClipInTrack(
  clips: ClipPosition[],
  currentId: string,
  direction: 1 | -1,
): ClipPosition | null {
  const ordered = orderedClips(clips);
  const index = ordered.findIndex((clip) => clip.id === currentId);
  if (index < 0) return ordered[0] ?? null;
  const next = index + direction;
  return next >= 0 && next < ordered.length ? ordered[next] : null;
}

/**
 * The clip that holds a point in time.
 *
 * Falls back to the closest clip that starts before it, so moving between
 * tracks lands on something near where the playhead is.
 */
export function clipAtTime(clips: ClipPosition[], time: number): ClipPosition | null {
  const ordered = orderedClips(clips);
  let best: ClipPosition | null = null;
  for (const clip of ordered) {
    if (time >= clip.start && time < clip.start + clip.duration) return clip;
    if (clip.start <= time) best = clip;
  }
  return best ?? ordered[0] ?? null;
}

/**
 * The clip to focus on the track above or below the current one.
 *
 * Empty tracks are skipped, and the search stops at the first track that
 * holds a clip.
 */
export function adjacentTrackClip(
  tracks: ClipPosition[][],
  trackIndex: number,
  direction: 1 | -1,
  time: number,
): { trackIndex: number; clip: ClipPosition } | null {
  for (let index = trackIndex + direction; index >= 0 && index < tracks.length; index += direction) {
    const clip = clipAtTime(tracks[index], time);
    if (clip) return { trackIndex: index, clip };
  }
  return null;
}

/**
 * How far a clip moves for one keyboard step.
 *
 * A frame keeps the edit on a frame boundary; the coarse step is a second,
 * which is the unit a person thinks in when they nudge a clip.
 */
export function nudgeStep(fps: number, coarse: boolean): number {
  return coarse ? 1 : 1 / Math.max(1, fps);
}
