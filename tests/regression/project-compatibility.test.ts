import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSupportedProject, normalizeProject, PROJECT_SCHEMA_VERSION } from "../../src/lib/project";
import { mergeProjectCache, splitProject } from "../../src/lib/projectStore";
import type { Project } from "../../src/lib/types";

/**
 * Project files written by earlier LibreCut builds.
 *
 * The fixtures keep the field sets of the releases that wrote them, so a
 * regression in the upgrade path shows up here instead of in a user's
 * project library.
 */
const FIXTURES = [
  { file: "v0.1-minimal.librecut", version: "v0.1" },
  { file: "v0.2-timeline-depth.librecut", version: "v0.2" },
  { file: "v0.3-effects-ecosystem.librecut", version: "v0.3" },
  { file: "v0.4-media-rendering.librecut", version: "v0.4" },
];

function fixturePath(file: string): string {
  return join(__dirname, "..", "fixtures", "projects", file);
}

function loadFixture(file: string): Project {
  const raw = readFileSync(fixturePath(file), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  expect(isSupportedProject(parsed)).toBe(true);
  return normalizeProject(parsed as Project);
}

describe("project compatibility", () => {
  it("reads every project file shipped by an earlier release", () => {
    for (const { file, version } of FIXTURES) {
      const project = loadFixture(file);
      expect(project.schemaVersion, version).toBe(PROJECT_SCHEMA_VERSION);
      expect(project.tracks.length, version).toBeGreaterThan(0);
      expect(project.assets.length, version).toBeGreaterThan(0);
    }
  });

  it("keeps the clips and the timeline of an older project", () => {
    const project = loadFixture("v0.1-minimal.librecut");

    expect(project.name).toBe("Legacy v0.1 project");
    expect(project.width).toBe(1920);
    expect(project.height).toBe(1080);
    expect(project.fps).toBe(30);
    expect(project.tracks.map((track) => track.kind)).toEqual(["video", "text", "audio"]);
    expect(project.tracks[0].clips.map((clip) => clip.id)).toEqual(["clip-legacy-a", "clip-legacy-b"]);
    expect(project.tracks[0].clips[1].start).toBe(4);
    expect(project.tracks[0].clips[1].trimIn).toBe(1);
    expect(project.tracks[2].clips[0].volume).toBe(0.6);
  });

  it("fills in the track fields that v0.1 did not have", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    const [video, text, audio] = project.tracks;

    expect(video.magnetic).toBe(true);
    expect(video.volume).toBe(1);
    expect(video.ducking).toEqual({
      enabled: false,
      amount: 12,
      threshold: -30,
      attack: 0.25,
      release: 0.6,
    });
    expect(text.magnetic).toBe(false);
    expect(audio.volume).toBe(1);
  });

  it("fills in the clip fields that v0.1 did not have", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    const clip = project.tracks[0].clips[0];

    expect(clip.speedRamp).toEqual([]);
    expect(clip.keyframes).toEqual([]);
    expect(clip.mid).toBe(0);
    expect(clip.bassFrequency).toBe(180);
    expect(clip.midFrequency).toBe(1000);
    expect(clip.midWidth).toBe(1);
    expect(clip.trebleFrequency).toBe(4000);
    expect(clip.pan).toBe(0);
    expect(clip.compressor).toEqual({
      enabled: false,
      threshold: -18,
      ratio: 4,
      attack: 12,
      release: 180,
    });
    expect(clip.transitionIn).toEqual({ type: "none", duration: 0.5 });
    expect(clip.transitionOut).toEqual({ type: "none", duration: 0.5 });
    expect(clip.mask).toBe("none");
    expect(clip.maskX).toBe(0.5);
    expect(clip.maskY).toBe(0.5);
    expect(clip.maskWidth).toBe(0.6);
    expect(clip.maskHeight).toBe(0.6);
    expect(clip.maskRotation).toBe(0);
    expect(clip.maskPoints).toEqual([]);
  });

  it("fills in the text fields that v0.1 did not have", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    const text = project.tracks[1].clips[0].text!;

    expect(text.italic).toBe(false);
    expect(text.fontFamily).toBe("Segoe UI");
    expect(text.lineHeight).toBe(1.2);
    expect(text.backgroundColor).toBe("#000000");
    expect(text.backgroundOpacity).toBe(0);
    expect(text.shadowColor).toBe("#000000");
    // The outline was already part of v0.1, so its value is kept.
    expect(text.outlineColor).toBe("#000000");
    expect(text.outlineWidth).toBe(2);
  });

  it("keeps the magnetic track and the ducking of a v0.2 project", () => {
    const project = loadFixture("v0.2-timeline-depth.librecut");
    const [main, voice] = project.tracks;

    expect(main.magnetic).toBe(true);
    expect(main.clips[0].speedRamp).toHaveLength(3);
    expect(main.clips[0].compressor.enabled).toBe(true);
    expect(voice.ducking?.enabled).toBe(true);
    expect(voice.ducking?.amount).toBe(10);
    expect(voice.volume).toBe(0.9);
  });

  it("keeps the LUT, the keyframes, and the effect clip of a v0.3 project", () => {
    const project = loadFixture("v0.3-effects-ecosystem.librecut");
    const [main, fx] = project.tracks;

    expect(main.clips[0].lut?.title).toBe("Teal Orange");
    expect(main.clips[0].lut?.strength).toBe(0.8);
    expect(main.clips[0].keyframes).toHaveLength(2);
    expect(fx.clips[0].effect?.contrast).toBe(1.1);
    expect(fx.clips[0].effect?.saturation).toBe(1.15);
  });

  it("renames the legacy wipe transition to the directional name", () => {
    const project = loadFixture("v0.3-effects-ecosystem.librecut");
    const clip = project.tracks[0].clips[1];

    expect(clip.transitionIn.type).toBe("wiperight");
    expect(clip.transitionOut.type).toBe("none");
  });

  it("keeps the subtitle cue of a v0.4 project", () => {
    const project = loadFixture("v0.4-media-rendering.librecut");
    const cue = project.tracks[1].clips[0];

    expect(cue.subtitleCue).toBe(true);
    expect(cue.text?.text).toBe("This is a subtitle cue");
    expect(project.assets[0].info.isVfr).toBe(true);
  });

  it("refuses a project written by a newer build", () => {
    const raw = JSON.parse(readFileSync(fixturePath("v0.4-media-rendering.librecut"), "utf8"));
    const future = { ...raw, schemaVersion: PROJECT_SCHEMA_VERSION + 1 };

    expect(isSupportedProject(future)).toBe(false);
  });

  it("refuses a document that is not a project", () => {
    expect(isSupportedProject(null)).toBe(false);
    expect(isSupportedProject({ schemaVersion: 1 })).toBe(false);
    expect(isSupportedProject({ schemaVersion: 1, tracks: {} })).toBe(false);
  });

  it("normalizes an older project the same way twice", () => {
    for (const { file } of FIXTURES) {
      const once = normalizeProject(loadFixture(file));
      const twice = normalizeProject(JSON.parse(JSON.stringify(once)) as Project);
      expect(twice, file).toEqual(once);
    }
  });

  it("keeps the edit data of an older project through a save round trip", () => {
    const project = loadFixture("v0.2-timeline-depth.librecut");
    const { document, cache } = splitProject(project);
    const restored = mergeProjectCache(JSON.parse(JSON.stringify(document)) as Project, cache);

    expect(restored.tracks).toHaveLength(2);
    expect(restored.tracks[0].clips).toHaveLength(2);
    expect(restored.tracks[0].clips[0].speedRamp).toHaveLength(3);
    expect(restored.tracks[1].clips[0].duration).toBe(11);
    expect(restored.assets[0].path).toBe("C:\\Media\\interview.mp4");
  });
});
