import type { Clip } from "./types";

/**
 * The time range that the timeline viewport shows.
 *
 * The track lane starts after the sticky label column, so the lane is hidden
 * behind the label until the scroll position passes it. `margin` keeps a few
 * seconds of clips rendered on each side so a scroll does not reveal blank
 * space before the next paint.
 */
export function visibleTimeRange(
  scrollLeft: number,
  viewportWidth: number,
  zoom: number,
  labelWidth: number,
  duration: number,
  margin = 0,
): { start: number; end: number } {
  if (!viewportWidth) return { start: 0, end: duration };
  const start = Math.max(0, scrollLeft / zoom - margin);
  const end = Math.min(duration, (scrollLeft + viewportWidth - labelWidth) / zoom + margin);
  return { start, end };
}

/**
 * Builds the snap boundaries for the timeline.
 *
 * The candidate set used to be rebuilt on every pointer move, which allocated
 * an array of all clip boundaries for each mouse event. The boundaries are now
 * sorted once per project, and the nearest candidate is found with a binary
 * search, so a drag stays cheap on a long timeline.
 *
 * `extra` holds the additional snap points that are not clip edges, such as
 * the start of the timeline and the playhead.
 */
export type SnapBoundaries = {
  /** Sorted clip starts and ends, without duplicates. */
  values: number[];
};

export function buildSnapBoundaries(
  clips: Iterable<Clip>,
  extra: number[] = [],
): SnapBoundaries {
  const values: number[] = [...extra];
  for (const clip of clips) {
    values.push(clip.start, clip.start + clip.duration);
  }
  values.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of values) {
    if (!unique.length || Math.abs(unique[unique.length - 1] - value) > 1e-6) {
      unique.push(value);
    }
  }
  return { values: unique };
}

/**
 * Returns the boundary closest to `value` when it lies within `threshold`,
 * otherwise the original value.
 */
export function snapToBoundary(
  value: number,
  boundaries: SnapBoundaries,
  threshold: number,
): number {
  const values = boundaries.values;
  if (!values.length || threshold <= 0) return value;

  // First candidate at or after `value`.
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < value) low = mid + 1;
    else high = mid;
  }

  let best = value;
  let bestDistance = threshold;
  if (low < values.length) {
    const distance = Math.abs(values[low] - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = values[low];
    }
  }
  if (low > 0) {
    const distance = Math.abs(values[low - 1] - value);
    if (distance < bestDistance) best = values[low - 1];
  }
  return best;
}
