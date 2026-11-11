import type { Project, ProjectSummary, Track, TrackKind } from "../lib/types";
import { projectDuration } from "../lib/time";

const INDEX_KEY = "librecut:projects:v1";
const PROJECT_KEY = (id: string) => `librecut:project:${id}:v1`;

export function newId(): string {
  return crypto.randomUUID();
}

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: newId(),
    kind,
    name,
    muted: false,
    hidden: false,
    locked: false,
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
      createTrack("video", "Video 1"),
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
  const summary = summarize(project);
  const key = PROJECT_KEY(project.id);

  try {
    localStorage.setItem(key, JSON.stringify(project));
  } catch {
    // Thumbnails and waveforms are regenerable caches. Drop them rather than
    // failing the autosave when the WebView storage quota is tight.
    const slim: Project = {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, thumbnails: [], waveform: [] })),
    };
    try {
      localStorage.setItem(key, JSON.stringify(slim));
    } catch {
      // Storage is unavailable; Save copy still provides a durable backup.
    }
  }

  const others = listProjects().filter((item) => item.id !== project.id);
  writeIndex([summary, ...others]);
  return summary;
}

export function loadProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY(id));
    if (!raw) return null;
    const project = JSON.parse(raw) as Project;
    if (project.schemaVersion !== 1 || !Array.isArray(project.tracks)) return null;
    for (const track of project.tracks) for (const clip of track.clips) {
      clip.x ??= 0;
      clip.y ??= 0;
      clip.scale ??= 1;
      clip.rotation ??= 0;
      clip.mask ??= "none";
      clip.fadeIn ??= 0;
      clip.fadeOut ??= 0;
      clip.pitch ??= 0;
      clip.bass ??= 0;
      clip.treble ??= 0;
      clip.keyframes ??= [];
      clip.transitionIn ??= { type: "none", duration: 0.5 };
      clip.transitionOut ??= { type: "none", duration: 0.5 };
      if (clip.kind === "misc") {
        clip.effect ??= { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, blur: 0, vignette: 0, motionBlur: 0, fadeIn: 0, fadeOut: 0, mask: "none", maskX: 0.5, maskY: 0.5, maskSize: 0.5 };
        clip.effect.sepia ??= 0;
        clip.effect.vignette ??= 0;
        clip.effect.motionBlur ??= 0;
        clip.effect.fadeIn ??= 0;
        clip.effect.fadeOut ??= 0;
      }
      if (clip.text) {
        clip.text.underline ??= false;
        clip.text.characterSpacing ??= 0;
        clip.text.outlineColor ??= "#000000";
        clip.text.outlineWidth ??= 0;
        clip.text.brightness ??= 1;
        clip.text.shadow ??= 0.5;
        clip.text.curve ??= 0;
        clip.text.rotation ??= 0;
      }
    }
    return project;
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
