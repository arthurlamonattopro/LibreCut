import type { Project, Track, TrackKind } from "../lib/types";
import { DEFAULT_DUCKING } from "../lib/audio";

export function newId(): string {
  return crypto.randomUUID();
}

export function createTrack(kind: TrackKind, name: string, magnetic = false): Track {
  return {
    id: newId(),
    kind,
    name,
    muted: false,
    hidden: false,
    locked: false,
    magnetic,
    volume: 1,
    ducking: { ...DEFAULT_DUCKING },
    clips: [],
  };
}

export function createProject(
  name: string,
  width: number,
  height: number,
  fps: number,
): Project {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: newId(),
    name: name.trim() || "Untitled project",
    width,
    height,
    fps,
    createdAt: now,
    updatedAt: now,
    assets: [],
    tracks: [
      createTrack("video", "Video 1", true),
      createTrack("audio", "Audio 1"),
      createTrack("text", "Text 1"),
    ],
  };
}
