import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportRequest, previewRenderKey } from "../../src/lib/exportRequest";
import { normalizeProject } from "../../src/lib/project";
import type { Project } from "../../src/lib/types";

/**
 * Export regression checks.
 *
 * The mapping from a project to an export request is the contract between the
 * timeline and the FFmpeg filter graph, so it is checked with the project
 * files of the earlier releases.
 */
function loadFixture(file: string): Project {
  const raw = readFileSync(join(__dirname, "..", "fixtures", "projects", file), "utf8");
  return normalizeProject(JSON.parse(raw) as Project);
}

describe("export request regression", () => {
  it("turns a v0.1 project into a renderable request", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    const request = buildExportRequest(project, "out.mp4", 1920, 1080);

    expect(request.output).toBe("out.mp4");
    expect(request.width).toBe(1920);
    expect(request.height).toBe(1080);
    expect(request.fps).toBe(30);
    expect(request.duration).toBeCloseTo(7, 5);
    expect(request.encoder).toBe("libx264");

    // The video and the audio of the project, but not the title.
    expect(request.clips).toHaveLength(3);
    expect(request.clips.map((clip) => clip.trackId)).toEqual([
      "track-legacy-video",
      "track-legacy-video",
      "track-legacy-audio",
    ]);
    expect(request.texts).toHaveLength(1);
    expect(request.texts[0].text).toBe("Hello");
    expect(request.effects).toHaveLength(0);
  });

  it("keeps the track volume and the ducking of a v0.2 project", () => {
    const project = loadFixture("v0.2-timeline-depth.librecut");
    const request = buildExportRequest(project, "out.mp4", 1920, 1080);

    const video = request.clips.find((clip) => clip.trackId === "track-v02-main")!;
    const voice = request.clips.find((clip) => clip.trackId === "track-v02-voice")!;

    // The track level multiplies the clip level.
    expect(voice.volume).toBeCloseTo(0.9, 5);
    expect(video.volume).toBeCloseTo(1, 5);
    // The ducked track gets an envelope for the clip that plays over it.
    expect(voice.duckSegments.length).toBeGreaterThan(0);
    expect(voice.duckSegments[0].from).toBeCloseTo(1, 5);
    expect(voice.duckSegments[0].to).toBeLessThan(1);
    // The main track does not duck.
    expect(video.duckSegments).toHaveLength(0);
  });

  it("carries the speed ramp of a v0.2 clip into the request", () => {
    const project = loadFixture("v0.2-timeline-depth.librecut");
    const request = buildExportRequest(project, "out.mp4", 1920, 1080);

    const video = request.clips.find((clip) => clip.trackId === "track-v02-main")!;
    expect(video.speedRamp).toHaveLength(3);
    expect(video.speedRamp[1].speed).toBe(2);
  });

  it("keeps the LUT, the effect clip, and the transition of a v0.3 project", () => {
    const project = loadFixture("v0.3-effects-ecosystem.librecut");
    const request = buildExportRequest(project, "out.mp4", 1920, 1080);

    const first = request.clips[0];
    expect(first.lut).toBeUndefined();
    expect(first.keyframes).toHaveLength(2);
    expect(first.transitionOut.type).toBe("fade");
    // The legacy wipe name is normalized before the request is built.
    expect(request.clips[1].transitionIn.type).toBe("wiperight");

    expect(request.effects).toHaveLength(1);
    expect(request.effects[0].contrast).toBe(1.1);
    expect(request.effects[0].start).toBe(0);
    expect(request.effects[0].duration).toBe(8);
  });

  it("keeps the subtitle cue of a v0.4 project", () => {
    const project = loadFixture("v0.4-media-rendering.librecut");
    const request = buildExportRequest(project, "out.mp4", 1920, 1080);

    expect(request.texts).toHaveLength(1);
    expect(request.texts[0].text).toBe("This is a subtitle cue");
    expect(request.clips).toHaveLength(1);
  });

  it("scales the text size with the export height", () => {
    const project = loadFixture("v0.4-media-rendering.librecut");
    const request = buildExportRequest(project, "out.mp4", 1920, 540);

    // Half the height, half the size.
    expect(request.texts[0].size).toBeCloseTo(24, 5);
  });

  it("leaves out muted and hidden tracks", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    project.tracks[0].hidden = true;
    project.tracks[2].muted = true;
    const request = buildExportRequest(project, "out.mp4", 1920, 1080);

    // The hidden video track is gone, the muted audio track stays but is silent.
    expect(request.clips.map((clip) => clip.trackId)).toEqual(["track-legacy-audio"]);
    expect(request.clips[0].hasAudio).toBe(false);
  });

  it("carries the chosen audio encoding into the request", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    const defaults = buildExportRequest(project, "out.mp4", 1920, 1080);
    expect(defaults.audioCodec).toBe("aac");
    expect(defaults.audioBitrate).toBe(192);
    expect(defaults.audioSampleRate).toBe(48000);

    const lossless = buildExportRequest(project, "out.mp4", 1920, 1080, "libx264", {
      codec: "alac",
      bitrate: 320,
      sampleRate: 44100,
    });
    expect(lossless.audioCodec).toBe("alac");
    expect(lossless.audioBitrate).toBe(320);
    expect(lossless.audioSampleRate).toBe(44100);
  });

  it("keys the preview render by the picture, not the output path", () => {
    const project = loadFixture("v0.1-minimal.librecut");
    const first = buildExportRequest(project, "first.mp4", 1920, 1080);
    const second = buildExportRequest(project, "second.mp4", 1920, 1080);

    expect(previewRenderKey(first)).toBe(previewRenderKey(second));

    const changed = buildExportRequest(project, "second.mp4", 1920, 1080);
    changed.fps = 24;
    expect(previewRenderKey(first)).not.toBe(previewRenderKey(changed));

    const nudged = buildExportRequest(project, "second.mp4", 1920, 1080);
    nudged.clips[0].trimIn = 0.5;
    expect(previewRenderKey(first)).not.toBe(previewRenderKey(nudged));

    // Audio encoding changes the container, not the rendered frames.
    const differentAudio = buildExportRequest(project, "second.mp4", 1920, 1080, "libx264", {
      codec: "alac",
      bitrate: 320,
      sampleRate: 44100,
    });
    expect(previewRenderKey(first)).toBe(previewRenderKey(differentAudio));
  });
});
