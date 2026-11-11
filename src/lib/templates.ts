import type { Project, Track, Clip } from "./types";
import { createProject, createTrack, newId } from "../stores/projects";

/** Portable templates intentionally contain no media paths. */
export interface ProjectTemplate {
  formatVersion: 1;
  name: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  tracks: Track[];
}

export const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  { formatVersion: 1, name: "Short social video", description: "Vertical 30 fps edit with title, video, and music tracks.", width: 1080, height: 1920, fps: 30, tracks: [] },
  { formatVersion: 1, name: "YouTube video", description: "Landscape 30 fps edit with title, video, and music tracks.", width: 1920, height: 1080, fps: 30, tracks: [] },
  { formatVersion: 1, name: "Square story", description: "Square 30 fps edit with title, video, and music tracks.", width: 1080, height: 1080, fps: 30, tracks: [] },
];

export function parseProjectTemplate(value: unknown): ProjectTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Template must be a JSON object.");
  const raw = value as Record<string, unknown>;
  if (raw.formatVersion !== 1 || typeof raw.name !== "string" || !raw.name.trim()) throw new Error("Unsupported or invalid template format.");
  if (![raw.width, raw.height, raw.fps].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) throw new Error("Template canvas settings are invalid.");
  if (!Array.isArray(raw.tracks) || raw.tracks.length > 64) throw new Error("Template tracks are invalid.");
  // Templates are metadata only: reject media-bearing content and unrecognized
  // tracks to avoid importing arbitrary local file references.
  const tracks = raw.tracks.map((track) => {
    if (!track || typeof track !== "object" || Array.isArray(track)) throw new Error("Template contains an invalid track.");
    const t = track as Track;
    if (!Array.isArray(t.clips) || t.clips.some((clip) => (clip as Clip).assetId)) throw new Error("Templates cannot include media references.");
    return t;
  });
  return { formatVersion: 1, name: raw.name.trim().slice(0, 80), description: typeof raw.description === "string" ? raw.description.slice(0, 240) : "", width: raw.width as number, height: raw.height as number, fps: raw.fps as number, tracks };
}

export function createProjectFromTemplate(template: ProjectTemplate, name: string): Project {
  const project = createProject(name, template.width, template.height, template.fps);
  project.tracks = template.tracks.length
    ? structuredClone(template.tracks).map((track) => ({ ...track, id: newId(), clips: track.clips.map((clip) => ({ ...clip, id: newId() })) }))
    : [createTrack("video", "Video 1"), createTrack("text", "Titles"), createTrack("audio", "Music")];
  const mainVideo = project.tracks.find((track) => track.kind === "video");
  if (mainVideo) mainVideo.magnetic = true;
  return project;
}
