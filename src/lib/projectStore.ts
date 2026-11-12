import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./media";
import { normalizeProject } from "./project";
import type { Project, ProjectSummary } from "./types";

/** Regenerable per-asset media caches: poster frames and waveform peaks. */
export interface AssetCache {
  thumbnails: string[];
  waveform: number[];
}

export interface ProjectCache {
  assets: Record<string, AssetCache>;
}

const INDEX_KEY = "librecut:projects:v1";
const PROJECT_KEY = (id: string) => `librecut:project:${id}:v1`;

/**
 * Splits a project into the editable document and the regenerable media
 * caches.
 *
 * Poster frames are base64 image data and waveforms are thousands of samples
 * per asset, so they dominate the serialized size of a long timeline. Keeping
 * them out of the autosaved document means an edit only re-serializes the
 * clips and tracks that actually changed.
 */
export function splitProject(project: Project): { document: Project; cache: ProjectCache } {
  const assets: Record<string, AssetCache> = {};
  const document: Project = {
    ...project,
    assets: project.assets.map((asset) => {
      assets[asset.id] = { thumbnails: asset.thumbnails, waveform: asset.waveform };
      return { ...asset, thumbnails: [], waveform: [] };
    }),
  };
  return { document, cache: { assets } };
}

/** Restores media caches into a project document. */
export function mergeProjectCache(project: Project, cache: ProjectCache | null): Project {
  if (!cache?.assets) return project;
  return {
    ...project,
    assets: project.assets.map((asset) => {
      const cached = cache.assets[asset.id];
      if (!cached) return asset;
      return { ...asset, thumbnails: cached.thumbnails, waveform: cached.waveform };
    }),
  };
}

function summarize(project: Project): ProjectSummary {
  let duration = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      duration = Math.max(duration, clip.start + clip.duration);
    }
  }
  const thumbnail = project.assets.find((asset) => asset.thumbnails.length > 0)?.thumbnails[0];
  return {
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    duration,
    thumbnail,
  };
}

// --- Browser fallback -------------------------------------------------------
// The editor runs inside Tauri, but the renderer is also opened in a plain
// browser during development. The localStorage path keeps that mode working.

function readLocalIndex(): ProjectSummary[] {
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

function writeLocalIndex(summaries: ProjectSummary[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(summaries.slice(0, 100)));
  } catch {
    // The index is a convenience; a full quota should not break editing.
  }
}

function readLocalProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY(id));
    if (!raw) return null;
    const project = JSON.parse(raw) as Project;
    if (project.schemaVersion !== 1 || !Array.isArray(project.tracks)) return null;
    return project;
  } catch {
    return null;
  }
}

// --- Public API -------------------------------------------------------------

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!isTauri) return readLocalIndex();
  try {
    return await invoke<ProjectSummary[]>("list_project_states");
  } catch {
    return readLocalIndex();
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  if (!isTauri) return readLocalProject(id);
  try {
    const [document, cache] = await Promise.all([
      invoke<string | null>("load_project_document", { id }),
      invoke<string | null>("load_project_cache", { id }),
    ]);
    if (!document) return null;
    const project = JSON.parse(document) as Project;
    const parsedCache = cache ? (JSON.parse(cache) as ProjectCache) : null;
    // Older documents get the values they are missing before they are used.
    return normalizeProject(mergeProjectCache(project, parsedCache));
  } catch {
    return readLocalProject(id);
  }
}

/**
 * Persists a project.
 *
 * `cacheChanged` should be set when media caches changed, for example after
 * an import. The caches are written next to the document so a normal edit
 * never re-serializes poster frames or waveforms.
 */
export async function persistProject(project: Project, cacheChanged = false): Promise<ProjectSummary> {
  const { document, cache } = splitProject(project);
  const summary = summarize(project);

  if (!isTauri) {
    try {
      localStorage.setItem(PROJECT_KEY(project.id), JSON.stringify(project));
    } catch {
      // Thumbnails and waveforms are regenerable caches. Drop them rather
      // than failing the autosave when the WebView storage quota is tight.
      const slim: Project = {
        ...project,
        assets: project.assets.map((asset) => ({ ...asset, thumbnails: [], waveform: [] })),
      };
      try {
        localStorage.setItem(PROJECT_KEY(project.id), JSON.stringify(slim));
      } catch {
        // Storage is unavailable; Save copy still provides a durable backup.
      }
    }
    writeLocalIndex([summary, ...readLocalIndex().filter((item) => item.id !== project.id)]);
    return summary;
  }

  try {
    return await invoke<ProjectSummary>("save_project_document", {
      id: project.id,
      document: JSON.stringify(document),
      cache: cacheChanged ? JSON.stringify(cache) : null,
      thumbnail: summary.thumbnail ?? null,
    });
  } catch {
    // Fall back to local storage so an edit is never lost.
    try {
      localStorage.setItem(PROJECT_KEY(project.id), JSON.stringify(project));
      writeLocalIndex([summary, ...readLocalIndex().filter((item) => item.id !== project.id)]);
    } catch {
      // Nothing else to try; the in-memory project is still intact.
    }
    return summary;
  }
}

export async function deleteProject(id: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke("delete_project_state", { id });
    } catch {
      // Fall through to the local cleanup below.
    }
  }
  try {
    localStorage.removeItem(PROJECT_KEY(id));
    writeLocalIndex(readLocalIndex().filter((item) => item.id !== id));
  } catch {
    // Nothing to clean up.
  }
}

export async function clearAllProjects(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("clear_project_states");
    } catch {
      // Fall through to the local cleanup below.
    }
  }
  try {
    for (const item of readLocalIndex()) {
      localStorage.removeItem(PROJECT_KEY(item.id));
    }
    localStorage.removeItem(INDEX_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Moves projects that were saved by an earlier build into the file-backed
 * library, so an upgrade does not lose work.
 */
export async function migrateLegacyProjects(): Promise<number> {
  const legacy = readLocalIndex();
  if (!legacy.length) return 0;
  let migrated = 0;
  for (const item of legacy) {
    const project = readLocalProject(item.id);
    if (!project) continue;
    try {
      await persistProject(project, true);
      localStorage.removeItem(PROJECT_KEY(item.id));
      migrated += 1;
    } catch {
      // Keep the legacy copy when the migration fails.
    }
  }
  if (migrated) writeLocalIndex([]);
  return migrated;
}
