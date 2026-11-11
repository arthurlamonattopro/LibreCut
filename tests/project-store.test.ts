import { describe, expect, it } from "vitest";
import { mergeProjectCache, splitProject } from "../src/lib/projectStore";
import type { Asset, Project } from "../src/lib/types";

function asset(id: string): Asset {
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
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      rotation: 0,
      videoCodec: "h264",
      audioCodec: "aac",
      audioChannels: 2,
      sampleRate: 48000,
      hasVideo: true,
      hasAudio: true,
      sizeBytes: 1024,
      isImage: false,
    },
    thumbnails: ["data:image/jpeg;base64,AAA"],
    waveform: [0.1, -0.2],
    importedAt: 0,
  };
}

function project(assets: Asset[]): Project {
  return {
    schemaVersion: 1,
    id: "project",
    name: "Test",
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: 0,
    updatedAt: 0,
    assets,
    tracks: [],
  };
}

describe("project store", () => {
  it("moves the media caches out of the document", () => {
    const source = project([asset("one"), asset("two")]);
    const { document, cache } = splitProject(source);

    expect(document.assets.every((item) => item.thumbnails.length === 0 && item.waveform.length === 0)).toBe(true);
    expect(cache.assets.one.thumbnails).toEqual(["data:image/jpeg;base64,AAA"]);
    expect(cache.assets.two.waveform).toEqual([0.1, -0.2]);
  });

  it("leaves the edit data in the document", () => {
    const source = project([asset("one")]);
    const { document } = splitProject(source);
    expect(document.id).toBe(source.id);
    expect(document.name).toBe(source.name);
    expect(document.assets[0].path).toBe(source.assets[0].path);
  });

  it("restores the media caches", () => {
    const source = project([asset("one"), asset("two")]);
    const { document, cache } = splitProject(source);
    const restored = mergeProjectCache(document, cache);

    expect(restored.assets[0].thumbnails).toEqual(["data:image/jpeg;base64,AAA"]);
    expect(restored.assets[0].waveform).toEqual([0.1, -0.2]);
    expect(restored.assets[1].thumbnails).toEqual(["data:image/jpeg;base64,AAA"]);
  });

  it("leaves assets without a cached entry untouched", () => {
    const source = project([asset("one")]);
    const { document } = splitProject(source);
    const restored = mergeProjectCache(document, { assets: {} });
    expect(restored.assets[0].thumbnails).toEqual([]);
  });

  it("tolerates a missing cache", () => {
    const source = project([asset("one")]);
    const { document } = splitProject(source);
    expect(mergeProjectCache(document, null)).toBe(document);
  });

  it("round-trips a project without losing data", () => {
    const source = project([asset("one"), asset("two")]);
    const { document, cache } = splitProject(source);
    const restored = mergeProjectCache(document, cache);

    expect(restored.assets).toHaveLength(2);
    expect(restored.assets.map((item) => item.id)).toEqual(["one", "two"]);
    expect(restored.assets[0].thumbnails).toEqual(source.assets[0].thumbnails);
    expect(restored.assets[1].waveform).toEqual(source.assets[1].waveform);
  });
});
