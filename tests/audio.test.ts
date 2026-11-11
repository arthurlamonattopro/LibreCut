import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUCKING,
  dbToGain,
  duckEnvelope,
  duckGainAt,
  duckKeyRegions,
  gainToDb,
  mergeRegions,
  midFilterQ,
  panGains,
  projectDuckingSegments,
} from "../src/lib/audio";
import type { Asset, Clip, Project, Track } from "../src/lib/types";

function asset(id: string, hasAudio = true): Asset {
  return {
    id,
    name: `${id}.wav`,
    path: `C:/media/${id}.wav`,
    mediaId: id,
    previewMediaId: id,
    proxyStatus: "none",
    importedAt: 0,
    thumbnails: [],
    waveform: [],
    info: {
      name: `${id}.wav`,
      path: `C:/media/${id}.wav`,
      duration: 30,
      width: 0,
      height: 0,
      fps: 0,
      rotation: 0,
      videoCodec: null,
      audioCodec: "pcm_s16le",
      audioChannels: 2,
      sampleRate: 48000,
      hasVideo: false,
      hasAudio,
      sizeBytes: 1024,
      isImage: false,
    },
  };
}

function clip(id: string, assetId: string, start: number, duration: number, volume = 1): Clip {
  return {
    id,
    kind: "audio",
    name: id,
    assetId,
    start,
    duration,
    trimIn: 0,
    speed: 1,
    volume,
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

function track(id: string, kind: Track["kind"], clips: Clip[], patch: Partial<Track> = {}): Track {
  return {
    id,
    kind,
    name: id,
    muted: false,
    hidden: false,
    locked: false,
    volume: 1,
    ducking: { ...DEFAULT_DUCKING },
    clips,
    ...patch,
  };
}

function project(tracks: Track[]): Project {
  return {
    schemaVersion: 1,
    id: "project",
    name: "Project",
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: 0,
    updatedAt: 0,
    assets: [asset("voice"), asset("music"), asset("quiet")],
    tracks,
  };
}

describe("ducking envelope", () => {
  it("ramps down, holds, and ramps back up", () => {
    const segments = duckEnvelope(
      { enabled: true, amount: 12, threshold: -30, attack: 0.25, release: 0.5 },
      [{ start: 1, end: 3 }],
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: 0.75, end: 1, from: 1, to: dbToGain(-12) });
    expect(segments[1]).toMatchObject({ start: 1, end: 3, from: dbToGain(-12), to: dbToGain(-12) });
    expect(segments[2]).toMatchObject({ start: 3, end: 3.5, from: dbToGain(-12), to: 1 });
  });

  it("keeps the level untouched before and after the envelope", () => {
    const segments = duckEnvelope(
      { enabled: true, amount: 12, threshold: -30, attack: 0.25, release: 0.5 },
      [{ start: 1, end: 3 }],
    );
    expect(duckGainAt(segments, 0)).toBe(1);
    expect(duckGainAt(segments, 10)).toBe(1);
    expect(duckGainAt(segments, 0.875)).toBeCloseTo((1 + dbToGain(-12)) / 2, 5);
    expect(duckGainAt(segments, 2)).toBeCloseTo(dbToGain(-12), 5);
  });

  it("returns no envelope when ducking is disabled", () => {
    const segments = duckEnvelope(
      { enabled: false, amount: 12, threshold: -30, attack: 0.25, release: 0.5 },
      [{ start: 1, end: 3 }],
    );
    expect(segments).toEqual([]);
  });

  it("merges overlapping key regions", () => {
    expect(mergeRegions([{ start: 2, end: 4 }, { start: 0, end: 1 }, { start: 3, end: 5 }])).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 5 },
    ]);
  });
});

describe("ducking key detection", () => {
  it("uses other tracks as the key signal and ignores ducked tracks", () => {
    const voice = track("voice-track", "audio", [clip("voice", "voice", 2, 4)]);
    const music = track("music-track", "audio", [clip("music", "music", 0, 8)], {
      ducking: { enabled: true, amount: 12, threshold: -30, attack: 0.25, release: 0.5 },
    });
    const otherDucked = track("other-track", "audio", [clip("other", "music", 0, 8)], {
      ducking: { enabled: true, amount: 6, threshold: -30, attack: 0.25, release: 0.5 },
    });

    const regions = duckKeyRegions(project([voice, music, otherDucked]), music);
    expect(regions).toEqual([{ start: 2, end: 6 }]);

    const segments = projectDuckingSegments(project([voice, music, otherDucked]));
    expect(segments.get("music-track")).toHaveLength(3);
    expect(segments.get("other-track")).toHaveLength(3);
    expect(segments.has("voice-track")).toBe(false);
  });

  it("skips key clips below the trigger threshold", () => {
    const voice = track("voice-track", "audio", [clip("voice", "quiet", 0, 4, 0.005)]);
    const music = track("music-track", "audio", [clip("music", "music", 0, 8)], {
      ducking: { enabled: true, amount: 12, threshold: -30, attack: 0.25, release: 0.5 },
    });

    expect(duckKeyRegions(project([voice, music]), music)).toEqual([]);
  });

  it("ignores muted tracks", () => {
    const voice = track("voice-track", "audio", [clip("voice", "voice", 1, 2)], { muted: true });
    const music = track("music-track", "audio", [clip("music", "music", 0, 8)], {
      ducking: { enabled: true, amount: 12, threshold: -30, attack: 0.25, release: 0.5 },
    });

    expect(duckKeyRegions(project([voice, music]), music)).toEqual([]);
  });
});

describe("audio helpers", () => {
  it("converts between decibels and linear gain", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it("maps a one-octave mid band to a Web Audio Q value", () => {
    expect(midFilterQ(1)).toBeCloseTo(3.01, 1);
    expect(midFilterQ(2)).toBeLessThan(midFilterQ(1));
  });

  it("pans with the Web Audio law", () => {
    expect(panGains(0)).toEqual({ left: 1, right: 1 });
    expect(panGains(-1).left).toBeCloseTo(0, 5);
    expect(panGains(-1).right).toBeCloseTo(0, 5);
    expect(panGains(1).left).toBeCloseTo(0, 5);
    expect(panGains(1).right).toBeCloseTo(1, 5);
  });
});
