import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
  MediaInfo,
  MediaProgress,
  MemorySnapshot,
  PreviewFrameResult,
  PreviewRenderProgress,
  PreviewRenderResult,
  RegisteredMedia,
  RuntimeStatus,
  StoredProjectSummary,
} from "./types";
import { t } from "./i18n";

export interface CaptionSegment { start: number; end: number; text: string }
export interface Transcription { text: string; segments: CaptionSegment[] }

export async function readMediaForAi(path: string): Promise<{ name: string; mimeType: string; dataBase64: string }> {
  return invoke("read_media_for_ai", { path });
}

export async function transcribeAudio(baseUrl: string, apiKey: string, model: string, path: string, language: string): Promise<Transcription> {
  const base = checkedAiEndpoint(baseUrl);
  const file = await readMediaForAi(path);
  const binary = atob(file.dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const form = new FormData();
  form.append("file", new File([bytes], file.name, { type: file.mimeType }));
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("language", language);
  form.append("timestamp_granularities[]", "segment");
  const response = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body: form });
  if (!response.ok) throw new Error(t("Transcription request failed ({status}): {message}", { status: response.status, message: (await response.text()).slice(0, 800) }));
  const result = await response.json() as Transcription;
  return { text: result.text ?? "", segments: Array.isArray(result.segments) ? result.segments : [] };
}

export async function synthesizeSpeech(baseUrl: string, apiKey: string, model: string, voice: string, text: string, language: string): Promise<string> {
  const base = checkedAiEndpoint(baseUrl);
  const languageName = ({ en: "English", es: "Spanish", pt: "Portuguese", fr: "French" } as Record<string, string>)[language] ?? "English";
  const response = await fetch(`${base}/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, voice, input: text, response_format: "wav", instructions: `Speak in ${languageName}.` }) });
  if (!response.ok) throw new Error(t("Speech request failed ({status}): {message}", { status: response.status, message: (await response.text()).slice(0, 800) }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return invoke<string>("save_ai_audio", { dataBase64: btoa(binary) });
}

function checkedAiEndpoint(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error(t("Use HTTPS for cloud providers, or localhost for a local AI server."));
  }
  return url.toString().replace(/\/$/, "");
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function mediaUrl(mediaId: string): string {
  const host = navigator.userAgent.includes("Windows")
    ? "http://librecut.localhost"
    : "librecut://localhost";
  return `${host}/media/${encodeURIComponent(mediaId)}`;
}

export async function registerMedia(path: string): Promise<RegisteredMedia> {
  return invoke<RegisteredMedia>("register_media", { path });
}

export async function generateThumbnails(path: string): Promise<string[]> {
  return invoke<string[]>("generate_thumbnails", { path });
}

export async function generateWaveform(path: string): Promise<number[]> {
  return invoke<number[]>("generate_waveform", { path, buckets: 1200 });
}

export async function createProxy(path: string, height = 720): Promise<RegisteredMedia> {
  return invoke<RegisteredMedia>("create_proxy", { path, height });
}

export async function removeProxyCache(proxyId: string): Promise<void> {
  return invoke("remove_proxy_cache", { proxyId });
}

export async function exportProject(request: ExportRequest): Promise<ExportResult> {
  return invoke<ExportResult>("export_project", { request });
}

/**
 * Renders one frame with the export filter graph.
 *
 * The result is a PNG in the media registry, so it is shown through
 * `mediaUrl` like any other media. This is the export renderer: the frame has
 * the same scaling, colour processing, font rasterisation, and transitions a
 * full render produces.
 */
export async function renderPreviewFrame(
  request: ExportRequest,
  time: number,
): Promise<PreviewFrameResult> {
  return invoke<PreviewFrameResult>("render_preview_frame", { request, time });
}

/**
 * Renders the timeline into a file the preview can play.
 *
 * The file is produced by the export filter graph, so it contains the exact
 * frames and the exact audio an export produces. A cached file for an
 * unchanged project is returned without rendering.
 */
export async function renderPreviewPlayback(
  request: ExportRequest,
): Promise<PreviewRenderResult> {
  return invoke<PreviewRenderResult>("render_preview_playback", { request });
}

/** Stops the accurate preview render in progress. */
export async function cancelPreviewRender(): Promise<void> {
  return invoke("cancel_preview_render");
}

export async function cancelExport(): Promise<void> {
  return invoke("cancel_export");
}

export async function isExporting(): Promise<boolean> {
  return invoke<boolean>("is_exporting");
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("runtime_status");
}

/**
 * Reads the working set of the editor and of the FFmpeg children it spawned.
 * The two are reported separately because the editor budget in
 * `docs/performance.md` excludes FFmpeg child processes.
 */
export async function getMemorySnapshot(): Promise<MemorySnapshot> {
  return invoke<MemorySnapshot>("runtime_memory");
}

/** Stores the editable part of a project in the on-disk library. */
export async function saveProjectDocument(
  id: string,
  document: string,
  cache?: string,
): Promise<StoredProjectSummary> {
  return invoke<StoredProjectSummary>("save_project_document", { id, document, cache });
}

/** Reads a stored project document, or null when it is missing. */
export async function loadProjectDocument(id: string): Promise<string | null> {
  return invoke<string | null>("load_project_document", { id });
}

/** Reads the regenerable media caches of a stored project. */
export async function loadProjectCache(id: string): Promise<string | null> {
  return invoke<string | null>("load_project_cache", { id });
}

/** Lists the projects held in the on-disk library. */
export async function listProjectStates(): Promise<StoredProjectSummary[]> {
  return invoke<StoredProjectSummary[]>("list_project_states");
}

/** Removes a project from the on-disk library. */
export async function deleteProjectState(id: string): Promise<void> {
  return invoke("delete_project_state", { id });
}

/** Removes every project from the on-disk library. */
export async function clearProjectStates(): Promise<void> {
  return invoke("clear_project_states");
}

/** Writes a profiling report into the app data folder and returns its path. */
export async function writeDiagnosticsReport(name: string, contents: string): Promise<string> {
  return invoke<string>("write_diagnostics_report", { name, contents });
}

export async function revealFile(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function openFolder(path: string): Promise<void> {
  await openPath(path);
}

const mediaFilters = () => [
  { name: t("Video and audio"), extensions: ["mp4", "mov", "webm", "mkv", "avi", "m4v", "mp3", "wav", "m4a", "aac", "flac", "ogg"] },
  { name: t("Video"), extensions: ["mp4", "mov", "webm", "mkv", "avi", "m4v"] },
  { name: t("Audio"), extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] },
  { name: t("Images"), extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
];

export async function pickMediaFiles(): Promise<string[]> {
  const result = await open({ multiple: true, directory: false, filters: mediaFilters() });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export async function pickExportPath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: `${defaultName.replace(/[\\/:*?"<>|]/g, "-")}.mp4`,
    filters: [{ name: t("MP4 video"), extensions: ["mp4"] }],
  });
  return result ?? null;
}

export async function pickProjectPath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: `${defaultName.replace(/[\\/:*?"<>|]/g, "-")}.librecut`,
    filters: [{ name: t("LibreCut project"), extensions: ["librecut"] }],
  });
  return result ?? null;
}

export async function pickProjectToOpen(): Promise<string | null> {
  const result = await open({
    multiple: false,
    directory: false,
    filters: [{ name: t("LibreCut project"), extensions: ["librecut"] }],
  });
  return typeof result === "string" ? result : null;
}

export async function saveProjectFile(path: string, projectJson: string): Promise<void> {
  return invoke("save_project", { path, contents: projectJson });
}

export async function loadProjectFile(path: string): Promise<string> {
  return invoke<string>("load_project", { path });
}

export async function detectHardwareEncoder(): Promise<boolean> {
  try {
    return await invoke<boolean>("has_nvenc");
  } catch {
    return false;
  }
}

export type { ExportProgress, MediaProgress, MediaInfo, PreviewRenderProgress };
