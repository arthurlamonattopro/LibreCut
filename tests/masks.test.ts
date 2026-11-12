import { describe, expect, it } from "vitest";
import { normalizeProject } from "../src/lib/project";
import { useEditor } from "../src/stores/editor";
import type { Clip, Project } from "../src/lib/types";

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip",
    kind: "video",
    name: "Clip",
    start: 0,
    duration: 2,
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

function project(value: Clip): Project {
  return {
    schemaVersion: 1,
    id: "project",
    name: "Masks",
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: 0,
    updatedAt: 0,
    assets: [],
    tracks: [{ id: "video", kind: "video", name: "Video", muted: false, hidden: false, locked: false, clips: [value] }],
  };
}

describe("clip masks", () => {
  it("fills geometry for projects saved before masks had controls", () => {
    const value = clip({ mask: "square" });
    normalizeProject(project(value));

    expect(value.maskX).toBe(0.5);
    expect(value.maskY).toBe(0.5);
    expect(value.maskWidth).toBe(0.6);
    expect(value.maskHeight).toBe(0.6);
    expect(value.maskRotation).toBe(0);
    expect(value.maskPoints).toEqual([]);
  });

  it("keeps legacy circle masks covering the whole frame", () => {
    const value = clip({ mask: "circle" });
    normalizeProject(project(value));

    expect(value.maskWidth).toBe(1);
    expect(value.maskHeight).toBe(1);
  });

  it("stores a custom mask drawn on the preview", () => {
    useEditor.getState().openProject(project(clip()));
    const points = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.25 },
      { x: 0.5, y: 0.8 },
    ];

    useEditor.getState().updateClip("clip", { mask: "custom", maskPoints: points });

    const stored = useEditor.getState().project!.tracks[0].clips[0];
    expect(stored.mask).toBe("custom");
    expect(stored.maskPoints).toEqual(points);
  });
});
