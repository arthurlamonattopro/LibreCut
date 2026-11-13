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

describe("timeline selection", () => {
  it("adds clips with Ctrl-click and selects a Shift-click range", () => {
    useEditor.getState().openProject(project());
    const state = useEditor.getState();
    state.selectClip("one");
    state.selectClip("two", { additive: true });
    expect(useEditor.getState().selectedClipIds).toEqual(["one", "two"]);

    state.selectClip("three", { additive: true });
    expect(useEditor.getState().selectedClipIds).toEqual(["one", "two", "three"]);

    state.selectClip("one");
    state.selectClip("two", { range: true, trackId: "a" });
    expect(useEditor.getState().selectedClipIds).toEqual(["one", "two"]);
  });

  it("deletes every selected clip in one undo step", () => {
    useEditor.getState().openProject(project());
    const state = useEditor.getState();
    state.selectClip("one");
    state.selectClip("two", { additive: true });
    state.deleteSelected();

    expect(useEditor.getState().project!.tracks[0].clips).toHaveLength(0);
    expect(useEditor.getState().selectedClipIds).toEqual([]);

    useEditor.getState().undo();
    expect(useEditor.getState().project!.tracks[0].clips).toHaveLength(2);
    expect(useEditor.getState().selectedClipIds).toEqual(["one", "two"]);
  });

  it("does not record a history step just for selecting", () => {
    useEditor.getState().openProject(project());
    const state = useEditor.getState();
    state.selectClip("one");
    expect(useEditor.getState().undoStack).toHaveLength(0);
  });

  it("restores selection, playhead, zoom, snap, and ripple with undo", () => {
    useEditor.getState().openProject(project());
    const state = useEditor.getState();
    state.selectClip("one");
    state.setZoom(140);
    state.setCurrentTime(1.5);
    state.toggleSnap();
    state.toggleRipple();
    state.updateClip("one", { opacity: 0.4 });

    const afterEdit = useEditor.getState();
    afterEdit.setZoom(200);
    afterEdit.setCurrentTime(0.2);
    afterEdit.toggleSnap();
    afterEdit.toggleRipple();
    afterEdit.selectClip("two");

    useEditor.getState().undo();
    const restored = useEditor.getState();
    expect(restored.project!.tracks[0].clips[0].opacity).toBe(1);
    expect(restored.selectedClipIds).toEqual(["one"]);
    expect(restored.currentTime).toBeCloseTo(1.5, 5);
    expect(restored.zoom).toBe(140);
    expect(restored.snap).toBe(false);
    expect(restored.ripple).toBe(true);
  });

  it("does not assign a magnetic track when a project opens", () => {
    useEditor.getState().openProject(project());
    expect(useEditor.getState().project!.tracks.some((track) => track.magnetic)).toBe(false);
  });
});

describe("timeline overlap and track editing", () => {
  it("keeps a moved clip out of its neighbour", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().updateClip("two", { start: 1 });
    const clips = useEditor.getState().project!.tracks[0].clips;
    const first = clips.find((clip) => clip.id === "one")!;
    const second = clips.find((clip) => clip.id === "two")!;
    expect(second.start).toBeGreaterThanOrEqual(first.start + first.duration);
  });

  it("stops a trim at the next clip", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().trimClip("one", "end", 20);
    const clips = useEditor.getState().project!.tracks[0].clips;
    expect(clips[0].duration).toBeCloseTo(5, 5);
  });

  it("keeps ripple edits on the edited track", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().updateClip("three", { start: 7 }, false);
    useEditor.getState().toggleRipple();
    useEditor.getState().deleteClip("one");

    const tracks = useEditor.getState().project!.tracks;
    expect(tracks[0].clips[0].start).toBeCloseTo(3, 5);
    expect(tracks[1].clips[0].start).toBeCloseTo(7, 5);
  });

  it("deletes and reorders tracks", () => {
    useEditor.getState().openProject(project());
    useEditor.getState().addTrack("video");
    const added = useEditor.getState().project!.tracks.filter((track) => track.kind === "video").at(-1)!;
    useEditor.getState().moveTrack(added.id, -1);
    expect(useEditor.getState().project!.tracks.findIndex((track) => track.id === added.id)).toBe(0);

    useEditor.getState().deleteTrack(added.id);
    expect(useEditor.getState().project!.tracks.some((track) => track.id === added.id)).toBe(false);
  });
});
