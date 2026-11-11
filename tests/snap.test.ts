import { describe, expect, it } from "vitest";
import { buildSnapBoundaries, snapToBoundary, visibleTimeRange } from "../src/lib/snap";
import type { Clip } from "../src/lib/types";

function clip(id: string, start: number, duration: number): Clip {
  return {
    id,
    kind: "video",
    name: id,
    start,
    duration,
    trimIn: 0,
    speed: 1,
    volume: 1,
    opacity: 1,
    fit: "contain",
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    mask: "none",
    fadeIn: 0,
    fadeOut: 0,
    pitch: 0,
    bass: 0,
    treble: 0,
    mid: 0,
    bassFrequency: 180,
    midFrequency: 1000,
    midWidth: 1,
    trebleFrequency: 4000,
    pan: 0,
    compressor: { enabled: false, threshold: -18, ratio: 4, attack: 12, release: 180 },
    keyframes: [],
    transitionIn: { type: "none", duration: 0.5 },
    transitionOut: { type: "none", duration: 0.5 },
  };
}

describe("snap boundaries", () => {
  it("collects clip starts and ends in sorted order", () => {
    const boundaries = buildSnapBoundaries([
      clip("b", 5, 2),
      clip("a", 0, 3),
    ]);
    expect(boundaries.values).toEqual([0, 3, 5, 7]);
  });

  it("removes duplicate boundaries", () => {
    const boundaries = buildSnapBoundaries([
      clip("a", 0, 5),
      clip("b", 5, 5),
    ]);
    expect(boundaries.values).toEqual([0, 5, 10]);
  });

  it("includes extra snap points", () => {
    const boundaries = buildSnapBoundaries([clip("a", 10, 5)], [0, 7]);
    expect(boundaries.values).toEqual([0, 7, 10, 15]);
  });

  it("snaps to an extra snap point", () => {
    const boundaries = buildSnapBoundaries([clip("a", 10, 5)], [0, 7]);
    expect(snapToBoundary(6.8, boundaries, 0.5)).toBe(7);
  });

  it("snaps to the nearest boundary within the threshold", () => {
    const boundaries = buildSnapBoundaries([clip("a", 0, 5), clip("b", 10, 5)]);
    expect(snapToBoundary(9.6, boundaries, 0.5)).toBe(10);
    expect(snapToBoundary(10.4, boundaries, 0.5)).toBe(10);
    expect(snapToBoundary(0.2, boundaries, 0.5)).toBe(0);
  });

  it("leaves the value alone when it is outside the threshold", () => {
    const boundaries = buildSnapBoundaries([clip("a", 0, 5), clip("b", 10, 5)]);
    expect(snapToBoundary(7, boundaries, 0.5)).toBe(7);
  });

  it("does not snap when the threshold is zero", () => {
    const boundaries = buildSnapBoundaries([clip("a", 0, 5)]);
    expect(snapToBoundary(0.1, boundaries, 0)).toBe(0.1);
  });

  it("handles an empty boundary set", () => {
    const boundaries = buildSnapBoundaries([]);
    expect(snapToBoundary(3, boundaries, 1)).toBe(3);
  });

  it("snaps to the closest of two neighbouring boundaries", () => {
    const boundaries = buildSnapBoundaries([clip("a", 0, 10), clip("b", 10, 10)]);
    // 9.8 is 0.2 from 10 and 9.8 from 0, so it snaps to 10.
    expect(snapToBoundary(9.8, boundaries, 0.5)).toBe(10);
    // 9.6 is 0.4 from 10 and 9.6 from 0.
    expect(snapToBoundary(9.6, boundaries, 0.5)).toBe(10);
  });
});

describe("visible time range", () => {
  const LABEL = 154;

  it("covers the start of the timeline when not scrolled", () => {
    const range = visibleTimeRange(0, 900, 70, LABEL, 600);
    expect(range.start).toBe(0);
    expect(range.end).toBeCloseTo((900 - LABEL) / 70, 5);
  });

  it("follows the scroll position", () => {
    const range = visibleTimeRange(7000, 900, 70, LABEL, 600);
    expect(range.start).toBeCloseTo(100, 5);
    expect(range.end).toBeCloseTo(100 + (900 - LABEL) / 70, 5);
  });

  it("never starts before the beginning of the timeline", () => {
    const range = visibleTimeRange(0, 900, 70, LABEL, 600, 10);
    expect(range.start).toBe(0);
  });

  it("never reaches past the end of the timeline", () => {
    const range = visibleTimeRange(70000, 900, 70, LABEL, 600, 10);
    expect(range.end).toBe(600);
  });

  it("adds a margin on each side", () => {
    const plain = visibleTimeRange(7000, 900, 70, LABEL, 600);
    const padded = visibleTimeRange(7000, 900, 70, LABEL, 600, 5);
    expect(padded.start).toBeLessThan(plain.start);
    expect(padded.end).toBeGreaterThan(plain.end);
  });

  it("covers the whole timeline before the viewport is known", () => {
    const range = visibleTimeRange(0, 0, 70, LABEL, 600);
    expect(range).toEqual({ start: 0, end: 600 });
  });
});
