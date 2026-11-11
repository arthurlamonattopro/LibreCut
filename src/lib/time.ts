export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function projectDuration(
  tracks: Array<{ clips: Array<{ start: number; duration: number }> }>,
  minimum = 8,
): number {
  let end = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return Math.max(minimum, end);
}

/**
 * Caches the project duration for a track list.
 *
 * Several components need the duration on every render, and recalculating it
 * means walking every clip. The result is memoized per track array, so it is
 * recomputed only when the timeline actually changes.
 */
export function cachedProjectDuration(
  tracks: Array<{ clips: Array<{ start: number; duration: number }> }>,
  minimum = 8,
): number {
  const cached = durationCache.get(tracks);
  if (cached && cached.minimum === minimum) return cached.value;
  const value = projectDuration(tracks, minimum);
  durationCache.set(tracks, { value, minimum });
  return value;
}

const durationCache = new WeakMap<
  object,
  { value: number; minimum: number }
>();

export function formatClock(seconds: number, fps = 30): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const frames = Math.floor((safe - whole) * fps);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function snapTime(
  value: number,
  candidates: number[],
  threshold: number,
): number {
  let result = value;
  let best = threshold;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance < best) {
      best = distance;
      result = candidate;
    }
  }
  return result;
}

export function parseNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
