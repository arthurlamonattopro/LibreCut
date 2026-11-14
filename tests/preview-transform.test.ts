import { describe, expect, it } from "vitest";
import {
  frameContainsPoint,
  frameCorners,
  visualFrameOf,
  type PreviewFrame,
} from "../src/lib/previewTransform";
import type { Asset, Clip, Project, TextOptions } from "../src/lib/types";

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip",
    kind: "video",
    name: "Clip",
    assetId: "asset",
    start: 0,
    duration: 4,
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
    ...overrides,
  };
}

function asset(width: number, height: number, rotation = 0): Asset {
  return {
    id: "asset",
    name: "asset.mp4",
    path: "asset.mp4",
    mediaId: "media",
    previewMediaId: "preview",
    proxyStatus: "none",
    importedAt: 0,
    thumbnails: [],
    waveform: [],
    info: {
      name: "asset.mp4",
      path: "asset.mp4",
      duration: 4,
      width,
      height,
      fps: 30,
      rotation,
      videoCodec: "h264",
      audioCodec: null,
      audioChannels: 2,
      sampleRate: 48000,
      hasVideo: true,
      hasAudio: false,
      sizeBytes: 1,
      isImage: false,
    },
  };
}

function project(): Project {
  return {
    schemaVersion: 1,
    id: "project",
    name: "Transform",
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: 0,
    updatedAt: 0,
    assets: [],
    tracks: [],
  };
}

const text = (overrides: Partial<TextOptions> = {}): TextOptions => ({
  text: "Hi",
  x: 0.5,
  y: 0.5,
  size: 100,
  rotation: 0,
  color: "#ffffff",
  fontWeight: "bold",
  italic: false,
  fontFamily: "Segoe UI",
  align: "center",
  underline: false,
  characterSpacing: 0,
  lineHeight: 1.2,
  outlineColor: "#000000",
  outlineWidth: 0,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  brightness: 1,
  shadow: 0,
  shadowColor: "#000000",
  curve: 0,
  ...overrides,
});

describe("preview transform geometry", () => {
  it("fits media with contain and follows the clip transform", () => {
    const square = visualFrameOf(clip(), project(), asset(1000, 1000), 1);

    expect(square).not.toBeNull();
    expect(square!.width).toBeCloseTo(1080, 5);
    expect(square!.height).toBeCloseTo(1080, 5);
    expect(square!.centerX).toBeCloseTo(960, 5);
    expect(square!.centerY).toBeCloseTo(540, 5);
  });

  it("applies position, scale, and rotation at the playhead", () => {
    const frame = visualFrameOf(
      clip({ x: 0.25, y: -0.25, scale: 0.5, rotation: 90 }),
      project(),
      asset(1920, 1080),
      1,
    );

    expect(frame!.width).toBeCloseTo(960, 5);
    expect(frame!.height).toBeCloseTo(540, 5);
    expect(frame!.centerX).toBeCloseTo(1440, 5);
    expect(frame!.centerY).toBeCloseTo(270, 5);
    expect(frame!.rotation).toBe(90);
  });

  it("uses the rotated source dimensions of phone footage", () => {
    const frame = visualFrameOf(clip(), project(), asset(1920, 1080, 90), 0);

    // 1080×1920 fits inside 1920×1080 by height: 1080 / 1920 = 0.5625.
    expect(frame!.width).toBeCloseTo(607.5, 5);
    expect(frame!.height).toBeCloseTo(1080, 5);
  });

  it("hit-tests inside the rotated frame", () => {
    const frame: PreviewFrame = { centerX: 0, centerY: 0, width: 200, height: 100, rotation: 90 };

    expect(frameContainsPoint(frame, 0, 0)).toBe(true);
    expect(frameContainsPoint(frame, 40, 0)).toBe(true);
    expect(frameContainsPoint(frame, 120, 0)).toBe(false);
    expect(frameContainsPoint(frame, 0, 120)).toBe(false);
  });

  it("returns the rotated corners of a frame", () => {
    const frame: PreviewFrame = { centerX: 100, centerY: 100, width: 200, height: 100, rotation: 90 };
    const corners = frameCorners(frame);

    expect(corners).toHaveLength(4);
    expect(corners[0].x).toBeCloseTo(150, 5);
    expect(corners[0].y).toBeCloseTo(0, 5);
    expect(corners[2].x).toBeCloseTo(50, 5);
    expect(corners[2].y).toBeCloseTo(200, 5);
  });

  it("maps text as a measured block around its anchor", () => {
    const base = clip({ kind: "text", assetId: undefined, text: text(), x: 0, y: 0 });
    const centered = visualFrameOf(base, project(), undefined, 0, (value) => value.length * 10);

    expect(centered!.width).toBeCloseTo(20, 5);
    expect(centered!.height).toBeCloseTo(120, 5);
    expect(centered!.centerX).toBeCloseTo(960, 5);
    expect(centered!.centerY).toBeCloseTo(540, 5);

    const leftRotated = visualFrameOf(
      { ...base, text: text({ align: "left", rotation: 90 }) },
      project(),
      undefined,
      0,
      (value) => value.length * 10,
    );
    // A left-aligned block is centered half a line width to the right of its
    // anchor, and that offset rotates with the text.
    expect(leftRotated!.centerX).toBeCloseTo(960, 5);
    expect(leftRotated!.centerY).toBeCloseTo(550, 5);
  });
});
