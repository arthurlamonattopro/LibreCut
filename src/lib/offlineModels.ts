import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./media";

export interface OfflineModelStatus {
  available: boolean;
  root: string;
  resourceRoot?: string | null;
  models: string[];
}

export interface ModelEnvironment {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  localModelPath: string;
}

const STRICT_KEY = "librecut.offlineModels.strict";

export function modelProtocolOrigin(): string {
  const windows = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
  return windows ? "http://librecutmodel.localhost" : "librecutmodel://localhost";
}

export function offlineModelFileUrl(model: string, file: string, origin = modelProtocolOrigin()): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/${model.replace(/^\/+/, "")}/${file.replace(/^\/+/, "")}`;
}

/** Point Transformers.js at the local model protocol and optionally forbid downloads. */
export function applyModelEnvironment(environment: ModelEnvironment, strict: boolean, origin = modelProtocolOrigin()): void {
  environment.allowLocalModels = true;
  environment.allowRemoteModels = !strict;
  environment.localModelPath = `${origin.replace(/\/$/, "")}/`;
}

export async function getOfflineModelStatus(): Promise<OfflineModelStatus> {
  return invoke<OfflineModelStatus>("offline_model_status");
}

export async function ensureModelsFolder(): Promise<string> {
  return invoke<string>("ensure_models_dir");
}

export function isStrictOffline(): boolean {
  try {
    return localStorage.getItem(STRICT_KEY) === "true";
  } catch {
    return false;
  }
}

export async function setStrictOffline(strict: boolean): Promise<void> {
  try {
    localStorage.setItem(STRICT_KEY, strict ? "true" : "false");
  } catch {
    // Storage can be unavailable in private browsing; the setting is best-effort.
  }
}

/**
 * Apply offline-model settings before a pipeline is created. Outside Tauri the
 * custom protocol does not exist, so only the strict/remote switch applies.
 */
export async function configureLocalModels(environment: ModelEnvironment): Promise<OfflineModelStatus | null> {
  const strict = isStrictOffline();
  if (!isTauri) {
    environment.allowRemoteModels = !strict;
    return null;
  }
  applyModelEnvironment(environment, strict);
  try {
    return await getOfflineModelStatus();
  } catch {
    return null;
  }
}
