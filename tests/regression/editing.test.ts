import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeProject } from "../../src/lib/project";
import { useEditor } from "../../src/stores/editor";
import type { Clip, Project, Track, TrackKind } from "../../src/lib/types";

/**
 * Editing regression checks.
 *
 * The scenarios run against the project files of earlier releases, so an
 * upgrade that changes how an old project behaves is caught here.
 */
function loadFixture(file: string): Project {
  const raw = readFileSync(join(__dirname, "..", "fixtures", "projects", file), "utf8");
  return normalizeProject(JSON.parse(raw) as Project);
}

function current(): Project {
  const project = useEditor.getState().project;
  if (!project) throw new Error("no project open");
  return project;
}

function track(kind: TrackKind, id?: string): Track {
  const found = current().tracks.find((item) => (id ? item.id === id : item.kind === kind));
  if (!found) throw new Error(`no ${kind} track in the project`);
  return found;
}

function clip(id: string): Clip {
  const found = current().tracks.flatMap((item) => item.clips).find((item) => item.id === id);
  if (!found) throw new Error(`no clip ${id} in the project`);
  return found;
}

function starts(items: Clip[]): number[] {
  return items.map((item) => Number(item.start.toFixed(3)));
}

function durations(items: Clip[]): number[] {
  return items.map((item) => Number(item.duration.toFixed(3)));
}

describe("editing regression", () => {
  beforeEach(() => {
    useEditor.getState().closeProject();
    useEditor.getState().openProject(loadFixture("v0.2-timeline-depth.librecut"));
  });

  it("splits a clip of a magnetic track and keeps it packed", () => {
    useEditor.getState().splitClip("clip-v02-main", 2);

    const main = track("video");
    expect(main.clips).toHaveLength(3);
    expect(starts(main.clips)).toEqual([0, 2, 6]);
    expect(durations(main.clips)).toEqual([2, 4, 5]);
    // The right half continues in the source media.
    expect(main.clips[1].trimIn).toBeCloseTo(2, 5);
  });

  it("re-times the speed ramp of both halves of a split", () => {
    useEditor.getState().splitClip("clip-v02-main", 3);

    const main = track("video");
    const [left, right] = main.clips;
    expect(left.speedRamp?.length).toBeGreaterThanOrEqual(2);
    expect(right.speedRamp?.length).toBeGreaterThanOrEqual(2);
    // The ramp points stay inside the clip they belong to.
    for (const point of left.speedRamp ?? []) {
      expect(point.time).toBeLessThanOrEqual(left.duration + 1e-6);
    }
    for (const point of right.speedRamp ?? []) {
      expect(point.time).toBeLessThanOrEqual(right.duration + 1e-6);
    }
    // The ramp ran at twice the speed where the clip was cut.
    expect(right.speedRamp?.[0].speed).toBeCloseTo(2, 5);
  });

  it("keeps a trim inside the source media", () => {
    useEditor.getState().trimClip("clip-v02-main", "end", 4);

    const main = track("video");
    expect(main.clips[0].duration).toBeCloseTo(4, 5);
    expect(main.clips[0].trimIn).toBe(0);
  });

  it("ripples a delete across the other tracks", () => {
    useEditor.getState().toggleRipple();
    useEditor.getState().deleteClip("clip-v02-main");

    const main = track("video");
    const voice = track("audio");
    // The magnetic track closes the gap it leaves behind.
    expect(main.clips.map((item) => item.id)).toEqual(["clip-v02-second"]);
    expect(main.clips[0].start).toBeCloseTo(0, 5);
    // The audio clip starts before the cut, so it keeps its length.
    expect(voice.clips[0].start).toBeCloseTo(0, 5);
    expect(voice.clips[0].duration).toBeCloseTo(11, 5);
  });

  it("does not move later clips on a magnetic track without ripple", () => {
    useEditor.getState().deleteClip("clip-v02-main");

    const main = track("video");
    expect(main.clips.map((item) => item.id)).toEqual(["clip-v02-second"]);
    expect(main.clips[0].start).toBeCloseTo(6, 5);
  });

  it("duplicates a clip and packs the magnetic track again", () => {
    useEditor.getState().duplicateClip("clip-v02-main");

    const main = track("video");
    expect(main.clips).toHaveLength(3);
    expect([...durations(main.clips)].sort((a, b) => a - b)).toEqual([5, 6, 6]);

    // The magnetic track has no gaps: every clip starts where the previous
    // one ends.
    const packed = [...main.clips].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const item of packed) {
      expect(item.start).toBeCloseTo(cursor, 5);
      cursor += item.duration;
    }
    expect(cursor).toBeCloseTo(17, 5);
  });

  it("restores a deleted clip with undo and redo", () => {
    useEditor.getState().deleteClip("clip-v02-main");
    expect(track("video").clips).toHaveLength(1);

    useEditor.getState().undo();
    expect(track("video").clips).toHaveLength(2);
    expect(track("video").clips[0].id).toBe("clip-v02-main");

    useEditor.getState().redo();
    expect(track("video").clips).toHaveLength(1);
  });

  it("leaves a locked track alone", () => {
    useEditor.getState().updateTrack("track-v02-voice", { locked: true });
    useEditor.getState().trimClip("clip-v02-voice", "end", 2);

    expect(clip("clip-v02-voice").duration).toBe(11);
  });

  it("adds a title clip to the text track", () => {
    useEditor.getState().addTextClip("Chapter one", 1);

    const text = track("text");
    expect(text.clips).toHaveLength(1);
    expect(text.clips[0].text?.text).toBe("Chapter one");
    expect(text.clips[0].start).toBe(1);
    expect(text.clips[0].duration).toBe(3);
  });

  it("turns imported subtitles into cue clips", () => {
    useEditor.getState().importSubtitleCues([
      { start: 0.5, end: 2, text: "First line" },
      { start: 2.5, end: 4.5, text: "Second line" },
    ]);

    const text = track("text");
    expect(text.clips).toHaveLength(2);
    expect(text.clips[0].subtitleCue).toBe(true);
    expect(text.clips[0].text?.text).toBe("First line");
    expect(text.clips[0].start).toBe(0.5);
    expect(text.clips[0].duration).toBeCloseTo(1.5, 5);
    expect(text.clips[1].start).toBe(2.5);
  });

  it("adds an effect clip to a new misc track", () => {
    useEditor.getState().addEffectClip({ name: "Teal & Orange", effect: { saturation: 1.2 } }, 0);

    const misc = track("misc");
    expect(misc.clips).toHaveLength(1);
    expect(misc.clips[0].effect?.saturation).toBe(1.2);
    expect(misc.clips[0].duration).toBe(5);
  });

  it("moves a clip to another track of the same kind", () => {
    useEditor.getState().addTrack("video");
    const targetId = current().tracks.filter((item) => item.kind === "video").at(-1)!.id;
    useEditor.getState().moveClipToTrack("clip-v02-second", targetId);

    expect(track("video", "track-v02-main").clips.map((item) => item.id)).toEqual(["clip-v02-main"]);
    expect(track("video", targetId).clips.map((item) => item.id)).toEqual(["clip-v02-second"]);
  });
});
