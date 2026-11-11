import { describe, expect, it } from "vitest";
import { useEditor } from "../src/stores/editor";
import type { Project } from "../src/lib/types";

function project(): Project {
  const clip = (id: string, start: number, duration: number) => ({
    id,
    kind: "video" as const,
    name: id,
    start,
    duration,
    trimIn: 0,
    speed: 1,
    volume: 1,
    opacity: 1,
    fit: "contain" as const,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    mask: "none" as const,
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
    transitionIn: { type: "none" as const, duration: 0.5 },
    transitionOut: { type: "none" as const, duration: 0.5 },
  });
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
    tracks: [
      { id: "a", kind: "video", name: "A", muted: false, hidden: false, locked: false, clips: [clip("one", 0, 2), clip("two", 5, 3)] },
      { id: "b", kind: "audio", name: "B", muted: false, hidden: false, locked: false, clips: [clip("three", 0, 4)] },
    ],
  };
}

describe("editor clip lookup", () => {
  it("updates a clip on any track", () => {
    const store = useEditor.getState();
    store.openProject(project());
    useEditor.getState().updateClip("three", { opacity: 0.25 });

    const clips = useEditor.getState().project!.tracks[1].clips;
    expect(clips[0].opacity).toBe(0.25);
  });

  it("updates a clip on the first track", () => {
    const store = useEditor.getState();
    store.openProject(project());
    useEditor.getState().updateClip("two", { opacity: 0.5 });

    const clips = useEditor.getState().project!.tracks[0].clips;
    expect(clips[1].opacity).toBe(0.5);
    expect(clips[0].opacity).toBe(1);
  });

  it("ignores an unknown clip", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().updateClip("missing", { opacity: 0.5 });
    expect(useEditor.getState().project!.tracks[0].clips[0].opacity).toBe(1);
  });

  it("trims a clip without touching the others", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().trimClip("one", "end", 1.5);

    const clips = useEditor.getState().project!.tracks[0].clips;
    expect(clips[0].duration).toBeCloseTo(1.5, 5);
    expect(clips[1].duration).toBe(3);
  });

  it("resolves the selected clip and its track", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().selectClip("three");

    const state = useEditor.getState();
    expect(state.project!.tracks[1].clips[0].id).toBe("three");
  });
});
