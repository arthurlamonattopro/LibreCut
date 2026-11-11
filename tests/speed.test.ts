import { describe, expect, it } from "vitest";
import {
  normalizeSpeedRamp,
  rampSegments,
  sourceDurationAt,
  sourceOffsetAt,
  speedAt,
} from "../src/lib/speed";

describe("speed ramp math", () => {
  it("adds endpoints and sorts points", () => {
    const ramp = normalizeSpeedRamp([{ time: 2, speed: 2 }], 4);
    expect(ramp.map((point) => point.time)).toEqual([0, 2, 4]);
    expect(ramp[0].speed).toBe(2);
    expect(ramp[2].speed).toBe(2);
  });

  it("clamps speeds and times", () => {
    const ramp = normalizeSpeedRamp([{ time: -2, speed: 99 }, { time: 99, speed: 0 }], 4);
    expect(ramp[0].time).toBe(0);
    expect(ramp[ramp.length - 1].time).toBe(4);
    expect(ramp.every((point) => point.speed >= 0.25 && point.speed <= 4)).toBe(true);
  });

  it("interpolates speed linearly", () => {
    const ramp = [{ time: 0, speed: 1 }, { time: 4, speed: 3 }];
    expect(speedAt(ramp, 4, 0)).toBe(1);
    expect(speedAt(ramp, 4, 2)).toBe(2);
    expect(speedAt(ramp, 4, 4)).toBe(3);
  });

  it("integrates a linear ramp for source offsets", () => {
    const ramp = [{ time: 0, speed: 1 }, { time: 4, speed: 3 }];
    expect(sourceOffsetAt(ramp, 4, 0)).toBe(0);
    expect(sourceOffsetAt(ramp, 4, 2)).toBe(3);
    expect(sourceDurationAt(ramp, 4)).toBe(8);
  });

  it("treats an absent ramp as constant speed", () => {
    expect(sourceOffsetAt([], 4, 2)).toBe(2);
    expect(sourceDurationAt(undefined, 4)).toBe(4);
  });

  it("approximates the same source duration with constant segments", () => {
    const ramp = [{ time: 0, speed: 1 }, { time: 4, speed: 3 }];
    const segments = rampSegments(ramp, 4);
    const total = segments.reduce((sum, segment) => sum + segment.sourceDuration, 0);
    expect(segments.length).toBeGreaterThan(1);
    expect(total).toBeCloseTo(8, 1);
    expect(segments[0].sourceStart).toBe(0);
  });

  it("slices ramp points when splitting a clip", () => {
    const ramp = [{ time: 0, speed: 1 }, { time: 2, speed: 2 }, { time: 4, speed: 1 }];
    expect(normalizeSpeedRamp(ramp, 4).length).toBe(3);
    const right = normalizeSpeedRamp(
      ramp.filter((point) => point.time >= 2).map((point) => ({ ...point, time: point.time - 2 })),
      2,
    );
    expect(right[0].time).toBe(0);
    expect(right[1].time).toBe(2);
  });
});
