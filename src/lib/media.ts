import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
  MediaInfo,
  MediaProgress,
  RegisteredMedia,
  RuntimeStatus,
} from "./types";

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
  if (!response.ok) throw new Error(`Transcription request failed (${response.status}): ${(await response.text()).slice(0, 800)}`);
  const result = await response.json() as Transcription;
  return { text: result.text ?? "", segments: Array.isArray(result.segments) ? result.segments : [] };
}

export async function synthesizeSpeech(baseUrl: string, apiKey: string, model: string, voice: string, text: string, language: string): Promise<string> {
  const base = checkedAiEndpoint(baseUrl);
  const languageName = ({ en: "English", es: "Spanish", pt: "Portuguese", fr: "French" } as Record<string, string>)[language] ?? "English";
  const response = await fetch(`${base}/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, voice, input: text, response_format: "wav", instructions: `Speak in ${languageName}.` }) });
  if (!response.ok) throw new Error(`Speech request failed (${response.status}): ${(await response.text()).slice(0, 800)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return invoke<string>("save_ai_audio", { dataBase64: btoa(binary) });
}

function checkedAiEndpoint(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Use HTTPS for cloud providers, or localhost for a local AI server.");
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

export async function cancelExport(): Promise<void> {
  return invoke("cancel_export");
}

export async function isExporting(): Promise<boolean> {
  return invoke<boolean>("is_exporting");
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("runtime_status");
}

export async function revealFile(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function openFolder(path: string): Promise<void> {
  await openPath(path);
}

const MEDIA_FILTERS = [
  { name: "Video and audio", extensions: ["mp4", "mov", "webm", "mkv", "avi", "m4v", "mp3", "wav", "m4a", "aac", "flac", "ogg"] },
  { name: "Video", extensions: ["mp4", "mov", "webm", "mkv", "avi", "m4v"] },
  { name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] },
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
];

export async function pickMediaFiles(): Promise<string[]> {
  const result = await open({ multiple: true, directory: false, filters: MEDIA_FILTERS });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export async function pickExportPath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: `${defaultName.replace(/[\\/:*?"<>|]/g, "-")}.mp4`,
    filters: [{ name: "MP4 video", extensions: ["mp4"] }],
  });
  return result ?? null;
}

export async function pickProjectPath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: `${defaultName.replace(/[\\/:*?"<>|]/g, "-")}.librecut`,
    filters: [{ name: "LibreCut project", extensions: ["librecut"] }],
  });
  return result ?? null;
}

export async function pickProjectToOpen(): Promise<string | null> {
  const result = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "LibreCut project", extensions: ["librecut"] }],
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

export type { ExportProgress, MediaProgress, MediaInfo };
