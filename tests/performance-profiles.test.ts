import { describe, expect, it } from "vitest";
import { buildTimelineIndex, activeClips } from "../src/lib/timelineIndex";
import { buildSnapBoundaries, snapToBoundary, visibleTimeRange } from "../src/lib/snap";
import { cachedProjectDuration } from "../src/lib/time";
import { splitProject, mergeProjectCache } from "../src/lib/projectStore";
import type { Asset, Clip, Project, Track } from "../src/lib/types";

/**
 * The "4K sources" and "long timeline" profiles from `docs/performance.md`.
 *
 * These tests cover the work the editor does per interaction and per frame
 * on projects at the sizes the profiles describe.
 */

function clip(id: string, start: number, duration: number, assetId?: string): Clip {
  return {
    id,
    kind: assetId ? "video" : "text",
    name: id,
    assetId,
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

function asset(id: string): Asset {
  // A poster frame is a base64 JPEG at 180 px wide, which is a few kilobytes
  // of text once encoded.
  const poster = `data:image/jpeg;base64,${"A".repeat(15 * 1024)}`;
  return {
    id,
    name: `${id}.mp4`,
    path: `C:/media/${id}.mp4`,
    mediaId: "runtime",
    previewMediaId: "runtime",
    proxyStatus: "none",
    info: {
      name: `${id}.mp4`,
      path: `C:/media/${id}.mp4`,
      duration: 600,
      width: 3840,
      height: 2160,
      fps: 30,
      rotation: 0,
      videoCodec: "hevc",
      audioCodec: "aac",
      audioChannels: 2,
      sampleRate: 48000,
      hasVideo: true,
      hasAudio: true,
      sizeBytes: 1024,
      isImage: false,
    },
    thumbnails: Array.from({ length: 12 }, () => poster),
    waveform: Array.from({ length: 2400 }, (_, index) => Math.sin(index / 10)),
    importedAt: 0,
  };
}

function longTimelineProject(): Project {
  const assets = Array.from({ length: 30 }, (_, index) => asset(`asset${index}`));
  const tracks: Track[] = [];
  for (let trackIndex = 0; trackIndex < 12; trackIndex += 1) {
    const clips: Clip[] = [];
    for (let clipIndex = 0; clipIndex < 167; clipIndex += 1) {
      const start = (clipIndex * 21 + trackIndex * 3) % 3600;
      clips.push(
        clip(`t${trackIndex}c${clipIndex}`, start, 18, `asset${(clipIndex + trackIndex) % 30}`),
      );
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
    assets,
    tracks,
  };
}

describe("long timeline and 4K source profiles", () => {
  it("keeps the per-frame work proportional to the screen", () => {
    const project = longTimelineProject();
    const index = buildTimelineIndex(project);

    const started = performance.now();
    for (let step = 0; step < 300; step += 1) {
      activeClips(index, step * 0.5);
    }
    const elapsed = performance.now() - started;

    // The old implementation walked all 2,000 clips for every frame.
    expect(elapsed).toBeLessThan(400);
  });

  it("keeps the snap search cheap across 2,000 clips", () => {
    const project = longTimelineProject();
    const boundaries = buildSnapBoundaries(project.tracks.flatMap((track) => track.clips));

    const started = performance.now();
    for (let step = 0; step < 5000; step += 1) {
      snapToBoundary(step * 0.13, boundaries, 0.5);
    }
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(500);
  });

  it("renders a bounded number of clips for the viewport", () => {
    const project = longTimelineProject();
    const duration = cachedProjectDuration(project.tracks, 0);
    const range = visibleTimeRange(0, 900, 70, 154, duration, 4);

    const visible = project.tracks.flatMap((track) =>
      track.clips.filter(
        (item) => item.start <= range.end && item.start + item.duration >= range.start,
      ),
    );

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(project.tracks.flatMap((t) => t.clips).length);
  });

  it("keeps the autosaved document small by leaving the media caches out", () => {
    const project = longTimelineProject();
    const { document, cache } = splitProject(project);

    const documentSize = JSON.stringify(document).length;
    const fullSize = JSON.stringify(project).length;

    // The poster frames and waveforms are the bulk of a project, and they are
    // regenerable, so the autosaved document must be far smaller.
    expect(documentSize).toBeLessThan(fullSize / 4);
    expect(Object.keys(cache.assets)).toHaveLength(30);

    const restored = mergeProjectCache(document, cache);
    expect(JSON.stringify(restored).length).toBe(fullSize);
  });
  it("rebuilds the project without losing media caches", () => {
    const project = longTimelineProject();
    const { document, cache } = splitProject(project);
    const restored = mergeProjectCache(document, cache);

    expect(restored.assets).toHaveLength(30);
    expect(restored.assets[0].thumbnails).toHaveLength(12);
    expect(restored.assets[0].waveform).toHaveLength(2400);
    expect(restored.tracks).toHaveLength(12);
  });
});
