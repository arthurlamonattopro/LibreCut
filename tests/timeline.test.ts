import { describe, expect, it } from "vitest";
import {
  compactMagneticTrack,
  removeClip,
  rippleTrimEnd,
  rippleTrimStart,
  shiftClipsAfter,
} from "../src/lib/timeline";
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
    keyframes: [],
    transitionIn: { type: "none", duration: 0.5 },
    transitionOut: { type: "none", duration: 0.5 },
  };
}

function track(id: string, clips: Clip[], magnetic = false): Track {
  return { id, kind: "video", name: id, muted: false, hidden: false, locked: false, magnetic, clips };
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

function starts(t: Track): number[] {
  return t.clips.map((item) => Number(item.start.toFixed(3)));
}

describe("magnetic main track", () => {
  it("packs clips in start order and closes gaps", () => {
    const main = track("main", [clip("b", 5, 2), clip("a", 0, 2), clip("c", 9, 1)], true);
    compactMagneticTrack(main);
    expect(main.clips.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(starts(main)).toEqual([0, 2, 4]);
  });

  it("leaves non-magnetic and locked tracks alone", () => {
    const plain = track("plain", [clip("a", 4, 1)]);
    compactMagneticTrack(plain);
    expect(plain.clips[0].start).toBe(4);

    const locked = track("locked", [clip("a", 4, 1)], true);
    locked.locked = true;
    compactMagneticTrack(locked);
    expect(locked.clips[0].start).toBe(4);
  });

  it("reorders a dropped clip based on its new position", () => {
    const main = track("main", [clip("a", 0, 2), clip("b", 2, 2)], true);
    const moved = main.clips[0];
    moved.start = 2.5;
    compactMagneticTrack(main);
    expect(main.clips.map((item) => item.id)).toEqual(["b", "a"]);
    expect(starts(main)).toEqual([0, 2]);
  });
});

describe("ripple edits", () => {
  it("shifts unlocked clips after a cut point", () => {
    const a = track("a", [clip("one", 0, 2), clip("two", 4, 2)]);
    const b = track("b", [clip("three", 8, 1)]);
    const p = project([a, b]);
    shiftClipsAfter(p, 4, -2);
    expect(a.clips[1].start).toBe(2);
    expect(b.clips[0].start).toBe(6);
  });

  it("closes the gap across tracks when ripple-deleting", () => {
    const main = track("main", [clip("a", 0, 2), clip("b", 2, 2), clip("c", 4, 2)], true);
    const audio = track("audio", [clip("music", 0, 6)]);
    const p = project([main, audio]);
    removeClip(p, "b", true);
    expect(starts(main)).toEqual([0, 2]);
    expect(main.clips.map((item) => item.id)).toEqual(["a", "c"]);
    // The long audio clip starts before the cut, so its start is unchanged.
    expect(audio.clips[0].start).toBe(0);
  });

  it("ripples downstream clips on a plain track", () => {
    const overlay = track("overlay", [clip("a", 0, 2), clip("b", 6, 2)]);
    const p = project([overlay]);
    removeClip(p, "a", true);
    expect(overlay.clips[0].start).toBe(4);
  });

  it("compacts a magnetic track even without ripple mode", () => {
    const main = track("main", [clip("a", 0, 2), clip("b", 2, 2)], true);
    const p = project([main]);
    removeClip(p, "a", false);
    expect(starts(main)).toEqual([0]);
  });

  it("ripple-trims the end and moves following clips", () => {
    const main = track("main", [clip("a", 0, 4), clip("b", 4, 2)], true);
    const p = project([main]);
    rippleTrimEnd(p, main.clips[0], 3);
    expect(main.clips[0].duration).toBe(3);
    expect(main.clips[1].start).toBe(3);
  });

  it("ripple-trims the start without moving the clip", () => {
    const overlay = track("overlay", [clip("a", 2, 4), clip("b", 8, 2)]);
    const p = project([overlay]);
    rippleTrimStart(p, overlay.clips[0], 3);
    expect(overlay.clips[0].start).toBe(2);
    expect(overlay.clips[0].duration).toBe(3);
    expect(overlay.clips[0].trimIn).toBe(1);
    expect(overlay.clips[1].start).toBe(7);
  });

  it("extends the head with a normal trim", () => {
    const overlay = track("overlay", [clip("a", 2, 4)]);
    const p = project([overlay]);
    overlay.clips[0].trimIn = 2;
    rippleTrimStart(p, overlay.clips[0], 1);
    expect(overlay.clips[0].start).toBe(1);
    expect(overlay.clips[0].duration).toBe(5);
    expect(overlay.clips[0].trimIn).toBe(1);
  });
});
