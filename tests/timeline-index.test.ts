import { describe, expect, it } from "vitest";
import { activeClipsAt, buildTimelineIndex } from "../src/lib/timelineIndex";
import type { Clip, Project, Track } from "../src/lib/types";

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

function track(id: string, clips: Clip[]): Track {
  return { id, kind: "video", name: id, muted: false, hidden: false, locked: false, clips };
}

function project(tracks: Track[]): Project {
  return {
    schemaVersion: 1,
    id: "project",
    name: "Test",
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: 0,
    updatedAt: 0,
    assets: [],
    tracks,
  };
}

describe("timeline index", () => {
  it("reports the total duration of the project", () => {
    const index = buildTimelineIndex(project([track("a", [clip("one", 0, 4), clip("two", 10, 2)])]));
    expect(index.duration).toBe(12);
  });

  it("finds the clip that covers a time", () => {
    const index = buildTimelineIndex(project([track("a", [clip("one", 0, 4), clip("two", 10, 2)])]));
    const active = activeClipsAt(index.tracks[0], 1);
    expect(active.map((item) => item.id)).toEqual(["one"]);
  });

  it("returns nothing between clips", () => {
    const index = buildTimelineIndex(project([track("a", [clip("one", 0, 4), clip("two", 10, 2)])]));
    expect(activeClipsAt(index.tracks[0], 7)).toEqual([]);
  });

  it("excludes a clip at its exact end", () => {
    const index = buildTimelineIndex(project([track("a", [clip("one", 0, 4)])]));
    expect(activeClipsAt(index.tracks[0], 4)).toEqual([]);
    expect(activeClipsAt(index.tracks[0], 3.999)).toHaveLength(1);
  });

  it("finds overlapping clips", () => {
    const index = buildTimelineIndex(project([track("a", [clip("one", 0, 10), clip("two", 5, 10)])]));
    expect(activeClipsAt(index.tracks[0], 7).map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("finds a long clip that started long before the playhead", () => {
    const index = buildTimelineIndex(project([track("a", [clip("long", 0, 600), clip("short", 590, 5)])]));
    expect(activeClipsAt(index.tracks[0], 592).map((item) => item.id)).toEqual(["long", "short"]);
  });

  it("keeps the order the track holds its clips in", () => {
    // The layers are drawn in track order, so the index must not reorder them.
    const index = buildTimelineIndex(project([track("a", [clip("late", 5, 10), clip("early", 0, 20)])]));
    expect(activeClipsAt(index.tracks[0], 6).map((item) => item.id)).toEqual(["late", "early"]);
  });

  it("maps clip ids back to their track", () => {
    const index = buildTimelineIndex(project([track("a", [clip("one", 0, 4)])]));
    const location = index.clipLocations.get("one");
    expect(location?.track.track.id).toBe("a");
    expect(location?.index).toBe(0);
  });

  it("handles an empty track", () => {
    const index = buildTimelineIndex(project([track("a", [])]));
    expect(activeClipsAt(index.tracks[0], 0)).toEqual([]);
    expect(index.duration).toBe(0);
  });
});
