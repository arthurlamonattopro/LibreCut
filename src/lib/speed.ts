import type { SpeedPoint } from "./types";

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

export interface TimedSpeedPoint {
  time: number;
  speed: number;
}

export interface SpeedSegment {
  /** Output (timeline) time where the segment starts. */
  start: number;
  /** Output duration of the segment. */
  duration: number;
  /** Constant speed used to approximate the segment. */
  speed: number;
  /** Source offset where the segment starts, relative to the clip trim. */
  sourceStart: number;
  /** Amount of source material consumed by the segment. */
  sourceDuration: number;
}

export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

/**
 * Ramp points are stored in clip-local seconds. This adds endpoints when the
 * curve does not start or end at the clip edges, sorts them, and removes
 * duplicate timestamps.
 */
export function normalizeSpeedRamp(points: SpeedPoint[] | undefined, duration: number): TimedSpeedPoint[] {
  const safeDuration = Math.max(0.1, duration);
  const cleaned = (points ?? [])
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.speed))
    .map((point) => ({
      time: Math.min(safeDuration, Math.max(0, point.time)),
      speed: clampSpeed(point.speed),
    }))
    .sort((a, b) => a.time - b.time);

  const unique: TimedSpeedPoint[] = [];
  for (const point of cleaned) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.time - point.time) < 1e-4) {
      unique[unique.length - 1] = point;
    } else {
      unique.push(point);
    }
  }

  if (unique.length === 0) return [];
  if (unique[0].time > 1e-4) unique.unshift({ time: 0, speed: unique[0].speed });
  if (unique[unique.length - 1].time < safeDuration - 1e-4) {
    unique.push({ time: safeDuration, speed: unique[unique.length - 1].speed });
  }
  return unique;
}

export function hasSpeedRamp(points: SpeedPoint[] | undefined): boolean {
  return Boolean(points && points.length >= 2);
}

/** Interpolated speed at a clip-local time. */
export function speedAt(points: SpeedPoint[] | undefined, duration: number, time: number): number {
  const ramp = normalizeSpeedRamp(points, duration);
  if (ramp.length < 2) return 1;
  const target = Math.min(duration, Math.max(0, time));
  for (let index = 0; index < ramp.length - 1; index += 1) {
    const from = ramp[index];
    const to = ramp[index + 1];
    if (target <= to.time) {
      const span = Math.max(1e-6, to.time - from.time);
      return from.speed + (to.speed - from.speed) * ((target - from.time) / span);
    }
  }
  return ramp[ramp.length - 1].speed;
}

/**
 * Amount of source media consumed from the clip's in-point to `time`. The
 * speed curve is linear between points, so each segment integrates exactly to
 * `(s0 + s1) / 2 * duration`.
 */
export function sourceOffsetAt(points: SpeedPoint[] | undefined, duration: number, time: number): number {
  const ramp = normalizeSpeedRamp(points, duration);
  if (ramp.length < 2) return Math.max(0, time);
  const target = Math.min(duration, Math.max(0, time));
  let source = 0;
  for (let index = 0; index < ramp.length - 1; index += 1) {
    const from = ramp[index];
    const to = ramp[index + 1];
    if (target <= from.time) break;
    const end = Math.min(target, to.time);
    const span = end - from.time;
    if (span <= 0) continue;
    const endSpeed = from.speed + (to.speed - from.speed) * (span / Math.max(1e-6, to.time - from.time));
    source += ((from.speed + endSpeed) / 2) * span;
  }
  return source;
}

export function sourceDurationAt(points: SpeedPoint[] | undefined, duration: number): number {
  return sourceOffsetAt(points, duration, duration);
}

/**
 * Approximates a ramp as constant-speed segments. The FFmpeg audio graph can
 * only hold a constant `atempo` per segment, so the sampling follows the curve:
 * it targets one percent of speed and twenty milliseconds of timeline, capped
 * at 600 segments. The video graph uses the exact continuous curve instead.
 */
export function rampSegments(points: SpeedPoint[] | undefined, duration: number): SpeedSegment[] {
  const safeDuration = Math.max(0.05, duration);
  const ramp = normalizeSpeedRamp(points, safeDuration);
  if (ramp.length < 2) {
    return [{ start: 0, duration: safeDuration, speed: 1, sourceStart: 0, sourceDuration: safeDuration }];
  }

  const speedSpan = ramp.slice(1).reduce((sum, point, index) => sum + Math.abs(point.speed - ramp[index].speed), 0);
  const byChange = Math.ceil(speedSpan / 0.01);
  const byTime = Math.ceil(safeDuration / 0.02);
  const sampleCount = Math.min(600, Math.max(ramp.length - 1, byChange, byTime, 1));
  const step = safeDuration / sampleCount;
  const segments: SpeedSegment[] = [];
  let sourceCursor = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const start = index * step;
    const end = index === sampleCount - 1 ? safeDuration : (index + 1) * step;
    const middle = (start + end) / 2;
    const speed = clampSpeed(speedAt(ramp, safeDuration, middle));
    const segmentDuration = end - start;
    const sourceDuration = speed * segmentDuration;
    segments.push({ start, duration: segmentDuration, speed, sourceStart: sourceCursor, sourceDuration });
    sourceCursor += sourceDuration;
  }
  return segments;
}

/** Re-times ramp points when the clip is trimmed or split. */
export function sliceSpeedRamp(
  points: SpeedPoint[] | undefined,
  from: number,
  to: number,
): SpeedPoint[] {
  if (!hasSpeedRamp(points)) return [];
  const ramp = normalizeSpeedRamp(points, Math.max(to, 0.1));
  const sliced: SpeedPoint[] = [];
  for (const point of ramp) {
    if (point.time >= from - 1e-4 && point.time <= to + 1e-4) {
      sliced.push({ time: Math.max(0, point.time - from), speed: point.speed });
    }
  }
  const length = Math.max(0.1, to - from);
  if (!sliced.some((point) => point.time <= 1e-4)) {
    sliced.unshift({ time: 0, speed: speedAt(ramp, Math.max(to, 0.1), from) });
  }
  if (!sliced.some((point) => Math.abs(point.time - length) < 1e-4)) {
    sliced.push({ time: length, speed: speedAt(ramp, Math.max(to, 0.1), to) });
  }
  return sliced.sort((a, b) => a.time - b.time);
}
