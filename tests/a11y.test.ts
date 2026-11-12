import { describe, expect, it } from "vitest";
import {
  adjacentTrackClip,
  clipAtTime,
  nextClipInTrack,
  nudgeStep,
  orderedClips,
} from "../src/lib/timelineKeyboard";

const clip = (id: string, start: number, duration = 1) => ({ id, start, duration });

describe("timeline keyboard navigation", () => {
  it("orders the clips of a track by their start time", () => {
    const ordered = orderedClips([clip("c", 4), clip("a", 1), clip("b", 2)]);
    expect(ordered.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("walks to the next and previous clip of a track", () => {
    const clips = [clip("a", 0), clip("b", 2), clip("c", 4)];
    expect(nextClipInTrack(clips, "b", 1)?.id).toBe("c");
    expect(nextClipInTrack(clips, "b", -1)?.id).toBe("a");
  });

  it("stays put at the ends of a track", () => {
    const clips = [clip("a", 0), clip("b", 2)];
    expect(nextClipInTrack(clips, "a", -1)).toBeNull();
    expect(nextClipInTrack(clips, "b", 1)).toBeNull();
  });

  it("finds the clip that covers the playhead", () => {
    const clips = [clip("a", 0, 2), clip("b", 3, 2)];
    expect(clipAtTime(clips, 1)?.id).toBe("a");
    expect(clipAtTime(clips, 4)?.id).toBe("b");
  });

  it("falls back to the closest clip that starts before the playhead", () => {
    const clips = [clip("a", 0, 2), clip("b", 5, 2)];
    expect(clipAtTime(clips, 3)?.id).toBe("a");
  });

  it("moves to the track above and below, skipping empty tracks", () => {
    const tracks = [[clip("a", 0)], [], [clip("c", 0)]];
    const down = adjacentTrackClip(tracks, 0, 1, 0);
    expect(down?.trackIndex).toBe(2);
    expect(down?.clip.id).toBe("c");
    expect(adjacentTrackClip(tracks, 2, 1, 0)).toBeNull();
    expect(adjacentTrackClip(tracks, 0, -1, 0)).toBeNull();
  });

  it("moves a clip by a frame, or by a second when asked for a coarse step", () => {
    expect(nudgeStep(30, false)).toBeCloseTo(1 / 30, 6);
    expect(nudgeStep(30, true)).toBe(1);
  });
});
