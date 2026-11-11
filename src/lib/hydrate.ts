import { createProxy, generateThumbnails, generateWaveform, isTauri, registerMedia } from "./media";
import type { Asset, Project } from "./types";

export interface HydratedProject {
  project: Project;
  missing: string[];
}

/**
 * Media registry IDs live in the Rust process and are lost when the app
 * restarts. Re-register every asset path before the project is opened so the
 * `librecut://` protocol can serve the files again.
 */
export async function hydrateProject(project: Project): Promise<HydratedProject> {
  if (!isTauri) return { project, missing: [] };

  const missing: string[] = [];

  const assets = await Promise.all(
    project.assets.map(async (asset): Promise<Asset> => {
      try {
        const registered = await registerMedia(asset.path);
        const info = registered.info;
        const next: Asset = {
          ...asset,
          info,
          mediaId: registered.id,
          previewMediaId: registered.id,
          proxyId: undefined,
          proxyStatus: asset.proxyStatus === "ready" ? "generating" : "none",
        };

        if (next.thumbnails.length === 0) {
          next.thumbnails = await generateThumbnails(asset.path).catch(() => []);
        }
        if (next.waveform.length === 0 && info.hasAudio) {
          next.waveform = await generateWaveform(asset.path).catch(() => []);
        }
        return next;
      } catch {
        missing.push(asset.path);
        return asset;
      }
    }),
  );

  return { project: { ...project, assets }, missing };
}

/**
 * Rebuilds preview proxies that existed when the project was saved. Proxies
 * are cached on disk, so this is usually just a probe.
 */
export async function rebuildProxies(
  project: Project,
  replaceAsset: (assetId: string, patch: Partial<Asset>) => void,
): Promise<void> {
  if (!isTauri) return;

  for (const asset of project.assets) {
    if (asset.proxyStatus !== "generating") continue;
    try {
      const height = asset.info.height > 2160 ? 720 : 1080;
      const proxy = await createProxy(asset.path, height);
      replaceAsset(asset.id, {
        proxyId: proxy.id,
        previewMediaId: proxy.id,
        proxyStatus: "ready",
      });
    } catch {
      replaceAsset(asset.id, { proxyId: undefined, proxyStatus: "failed" });
    }
  }
}
