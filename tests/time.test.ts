import { describe, expect, it } from "vitest";
import {
  clamp,
  formatClock,
  formatDuration,
  projectDuration,
  snapTime,
} from "../src/lib/time";

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("projectDuration", () => {
  it("uses the furthest clip end", () => {
    const tracks = [
      { clips: [{ start: 0, duration: 2 }, { start: 4, duration: 3 }] },
      { clips: [{ start: 8, duration: 1 }] },
    ];
    expect(projectDuration(tracks, 0)).toBe(9);
  });

  it("honours the minimum", () => {
    expect(projectDuration([{ clips: [] }], 8)).toBe(8);
  });

  it("ignores empty tracks", () => {
    expect(projectDuration([], 4)).toBe(4);
  });
});

describe("formatClock", () => {
  it("formats hours, minutes, seconds, frames", () => {
    expect(formatClock(0, 30)).toBe("00:00:00:00");
    expect(formatClock(61.5, 30)).toBe("00:01:01:15");
    expect(formatClock(3661.25, 24)).toBe("01:01:01:06");
  });

  it("clamps negative time", () => {
    expect(formatClock(-3, 30)).toBe("00:00:00:00");
  });
});

describe("formatDuration", () => {
  it("formats m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9.9)).toBe("0:09");
    expect(formatDuration(125)).toBe("2:05");
  });
});

describe("snapTime", () => {
  it("snaps to the nearest candidate inside the threshold", () => {
    expect(snapTime(1.02, [0, 1, 2], 0.05)).toBe(1);
  });

  it("keeps the original value when nothing is close", () => {
    expect(snapTime(1.5, [0, 3], 0.05)).toBe(1.5);
  });

  it("prefers the closest candidate", () => {
    expect(snapTime(1.04, [1, 1.06], 0.1)).toBe(1.06);
    expect(snapTime(1.01, [1, 1.06], 0.1)).toBe(1);
  });
});
