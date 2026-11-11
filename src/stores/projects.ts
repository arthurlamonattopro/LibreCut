import type { Project, ProjectSummary, Track, TrackKind } from "../lib/types";
import { projectDuration } from "../lib/time";
import { normalizeProject } from "../lib/project";
import { DEFAULT_DUCKING } from "../lib/audio";
import { logSlowOperation, projectProfile } from "../lib/performance";

const INDEX_KEY = "librecut:projects:v1";
const PROJECT_KEY = (id: string) => `librecut:project:${id}:v1`;

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

export function summarize(project: Project): ProjectSummary {
  const firstThumb = project.assets.find((asset) => asset.thumbnails.length > 0)?.thumbnails[0];
  return {
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    duration: projectDuration(project.tracks, 0),
    thumbnail: firstThumb,
  };
}

export function listProjects(): ProjectSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectSummary[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeIndex(summaries: ProjectSummary[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(summaries.slice(0, 100)));
  } catch {
    // The index is a convenience; a full quota should not break editing.
  }
}

export function persistProject(project: Project): ProjectSummary {
  const saveStarted = performance.now();
  const summary = summarize(project);
  const key = PROJECT_KEY(project.id);
  let serializedBytes = 0;

  try {
    const serialized = JSON.stringify(project);
    if (import.meta.env.DEV) serializedBytes = new Blob([serialized]).size;
    localStorage.setItem(key, serialized);
  } catch {
    // Thumbnails and waveforms are regenerable caches. Drop them rather than
    // failing the autosave when the WebView storage quota is tight.
    const slim: Project = {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, thumbnails: [], waveform: [] })),
    };
    try {
      const serialized = JSON.stringify(slim);
      if (import.meta.env.DEV) serializedBytes = new Blob([serialized]).size;
      localStorage.setItem(key, serialized);
    } catch {
      // Storage is unavailable; Save copy still provides a durable backup.
    }
  }

  const others = listProjects().filter((item) => item.id !== project.id);
  writeIndex([summary, ...others]);
  logSlowOperation("project save", saveStarted, {
    ...projectProfile(project),
    serializedBytes,
  });
  return summary;
}

export function loadProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY(id));
    if (!raw) return null;
    const project = JSON.parse(raw) as Project;
    if (project.schemaVersion !== 1 || !Array.isArray(project.tracks)) return null;
    return normalizeProject(project);
  } catch {
    return null;
  }
}

export function deleteProject(id: string): void {
  localStorage.removeItem(PROJECT_KEY(id));
  writeIndex(listProjects().filter((item) => item.id !== id));
}

export function clearAllProjects(): void {
  for (const item of listProjects()) {
    localStorage.removeItem(PROJECT_KEY(item.id));
  }
  localStorage.removeItem(INDEX_KEY);
}
