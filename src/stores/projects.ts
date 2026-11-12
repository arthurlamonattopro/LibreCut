import type { Project, Track, TrackKind } from "../lib/types";
import { DEFAULT_DUCKING } from "../lib/audio";
import { t } from "../lib/i18n";

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
    name: name.trim() || t("Untitled project"),
    width,
    height,
    fps,
    createdAt: now,
    updatedAt: now,
    assets: [],
    tracks: [
      createTrack("video", t("Video {number}", { number: 1 }), true),
      createTrack("audio", t("Audio {number}", { number: 1 })),
      createTrack("text", t("Text {number}", { number: 1 })),
    ],
  };
}
