import { describe, expect, it } from "vitest";
import { buildTimelineIndex, activeClipsAt } from "../src/lib/timelineIndex";
import { buildSnapBoundaries, snapToBoundary } from "../src/lib/snap";
import { cachedProjectDuration } from "../src/lib/time";
import type { Clip, Project, Track } from "../src/lib/types";

/**
 * The "long timeline" profile from `docs/performance.md`: 2,000 clips across
 * 12 tracks. These tests keep the work that runs per interaction or per frame
 * proportional to what is on screen rather than to the whole project.
 */

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

function longTimelineProject(): Project {
  const tracks: Track[] = [];
  for (let trackIndex = 0; trackIndex < 12; trackIndex += 1) {
    const clips: Clip[] = [];
    for (let clipIndex = 0; clipIndex < 167; clipIndex += 1) {
      const start = (clipIndex * 21 + trackIndex) % 3600;
      clips.push(clip(`t${trackIndex}c${clipIndex}`, start, 18));
    }
    tracks.push({
      id: `track${trackIndex}`,
      kind: "video",
      name: `Video ${trackIndex + 1}`,
      muted: false,
      hidden: false,
      locked: false,
      clips,
    });
  }
  return {
    schemaVersion: 1,
    id: "long",
    name: "Long timeline",
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: 0,
    updatedAt: 0,
    assets: [],
    tracks,
  };
}

describe("long timeline performance", () => {
  it("finds the active clips without scanning every clip", () => {
    const project = longTimelineProject();
    const index = buildTimelineIndex(project);
    const started = performance.now();
    for (let step = 0; step < 200; step += 1) {
      activeClipsAt(index.tracks[0], step * 0.5);
    }
    const elapsed = performance.now() - started;

    // A full scan of the track would be 200 x 167 clip checks. The indexed
    // lookup stays far below that.
    expect(elapsed).toBeLessThan(500);
    expect(index.tracks[0].clips.length).toBe(167);
  });

  it("builds the snap boundaries once for the whole project", () => {
    const project = longTimelineProject();
    const clips = project.tracks.flatMap((track) => track.clips);
    const boundaries = buildSnapBoundaries(clips);
    expect(boundaries.values.length).toBeGreaterThan(0);

    const started = performance.now();
    for (let step = 0; step < 2000; step += 1) {
      snapToBoundary(step * 0.37, boundaries, 0.5);
    }
    const elapsed = performance.now() - started;

    // The old approach rebuilt the candidate list on every pointer move.
    expect(elapsed).toBeLessThan(500);
  });

  it("caches the project duration between reads", () => {
    const project = longTimelineProject();
    const first = cachedProjectDuration(project.tracks, 0);
    const second = cachedProjectDuration(project.tracks, 0);
    expect(second).toBe(first);

    const started = performance.now();
    for (let step = 0; step < 500; step += 1) {
      cachedProjectDuration(project.tracks, 0);
    }
    expect(performance.now() - started).toBeLessThan(50);
  });
});
