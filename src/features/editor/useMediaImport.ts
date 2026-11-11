import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEditor } from "../../stores/editor";
import {
  createProxy,
  generateThumbnails,
  generateWaveform,
  pickMediaFiles,
  registerMedia,
} from "../../lib/media";
import type { Asset, MediaProgress } from "../../lib/types";
import { toast } from "../../components/Toast";

const SUPPORTED = new Set([
  "mp4", "m4v", "mov", "webm", "mkv", "avi",
  "mp3", "wav", "m4a", "aac", "flac", "ogg",
  "png", "jpg", "jpeg", "webp", "bmp", "gif", "avif",
]);
const proxyQueue: Array<() => void> = [];
let runningProxies = 0;
function queuedProxy(path: string, height: number): Promise<Awaited<ReturnType<typeof createProxy>>> {
  return new Promise((resolve, reject) => {
    proxyQueue.push(() => {
      runningProxies += 1;
      void createProxy(path, height).then(resolve, reject).finally(() => {
        runningProxies -= 1;
        proxyQueue.shift()?.();
      });
    });
    if (runningProxies < 2 && proxyQueue.length) proxyQueue.shift()?.();
  });
}

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function pathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replaceAll(/\/+$/g, "");
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
    ? normalized.toLowerCase()
    : normalized;
}

function needsProxy(info: Asset["info"]): boolean {
  if (info.isImage || !info.hasVideo) return false;
  const codec = info.videoCodec?.toLowerCase() ?? "";
  return info.height > 1080 || !["h264", "vp8", "vp9", "av1"].includes(codec);
}

export function useMediaImport() {
  const addAsset = useEditor((state) => state.addAsset);
  const replaceAsset = useEditor((state) => state.replaceAsset);
  const [importing, setImporting] = useState(0);
  const [fileDragOver, setFileDragOver] = useState(false);
  const importPathsRef = useRef<(paths: string[]) => Promise<void>>(async () => undefined);
  const importingPathsRef = useRef(new Set<string>());
  const retryProxy = useCallback((asset: Asset) => {
    replaceAsset(asset.id, { proxyStatus: "generating" });
    void queuedProxy(asset.path, asset.info.height > 2160 ? 720 : 1080).then((proxy) => {
      replaceAsset(asset.id, { proxyId: proxy.id, previewMediaId: proxy.id, proxyStatus: "ready" });
    }).catch((error) => {
      replaceAsset(asset.id, { proxyStatus: "failed" });
      toast(`Proxy failed for ${asset.name}. Retry or continue with the original source. ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, [replaceAsset]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      const existingPaths = new Set(
        (useEditor.getState().project?.assets ?? []).map((asset) => pathKey(asset.path)),
      );
      const supported = paths.filter((path) => SUPPORTED.has(extensionOf(path)));
      const unsupported = paths.filter((path) => !SUPPORTED.has(extensionOf(path)));
      const usable = [...new Map(supported
        .map((path) => [pathKey(path), path] as const)).values()]
        .filter((path) => {
          const key = pathKey(path);
          if (existingPaths.has(key) || importingPathsRef.current.has(key)) return false;
          importingPathsRef.current.add(key);
          return true;
        });
      if (usable.length === 0) {
        if (unsupported.length) toast(`Unsupported format${unsupported.length > 1 ? "s" : ""}: ${unsupported.map((path) => path.split(/[\\/]/).pop()).slice(0, 3).join(", ")}. Supported: MP4, MOV, WebM, MKV, AVI, common audio, and image files. Import subtitles from the Text tab.`, "error");
        return;
      }
      setImporting((value) => value + usable.length);
      if (unsupported.length) toast(`Skipped unsupported files: ${unsupported.map((path) => path.split(/[\\/]/).pop()).slice(0, 3).join(", ")}. Subtitle files can be imported from the Text tab.`, "info");
      let nextPath = 0;
      await Promise.all(Array.from({ length: Math.min(3, usable.length) }, async () => {
        while (nextPath < usable.length) {
          const path = usable[nextPath++];
          const importStarted = performance.now();
        try {
          const registered = await registerMedia(path);
          const info = registered.info;
          const [thumbnails, waveform] = await Promise.all([
            generateThumbnails(path).catch(() => [] as string[]),
            info.hasAudio ? generateWaveform(path).catch(() => [] as number[]) : Promise.resolve([] as number[]),
          ]);

          const asset: Asset = {
            id: crypto.randomUUID(),
            name: info.name,
            path,
            mediaId: registered.id,
            previewMediaId: registered.id,
            proxyStatus: "none",
            info,
            thumbnails,
            waveform,
            importedAt: Date.now(),
          };
          addAsset(asset);
          toast(`Imported ${info.name}`, "success");

          if (needsProxy(info)) {
            replaceAsset(asset.id, { proxyStatus: "generating" });
            retryProxy(asset);
          }
          const elapsedMs = performance.now() - importStarted;
          if (elapsedMs > 250 && import.meta.env.DEV) {
            console.warn("LibreCut slow media import", { elapsedMs: Math.round(elapsedMs), width: info.width, height: info.height, hasAudio: info.hasAudio });
          }
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          const diagnosis = /probe|decode|invalid data|moov atom|corrupt|stream/i.test(details)
            ? " The file may be damaged or use a codec this FFmpeg build cannot read. Try remuxing or transcoding it to H.264 MP4."
            : " Check that the file exists and is readable.";
          toast(
            `Could not import ${path.split(/[\\/]/).pop() ?? "file"}: ${
              details
            }${diagnosis}`,
            "error",
          );
        } finally {
          importingPathsRef.current.delete(pathKey(path));
          setImporting((value) => Math.max(0, value - 1));
        }
        }
      }));
    },
    [addAsset, replaceAsset, retryProxy],
  );

  useEffect(() => {
    // A persisted `generating` flag means the app closed before the background job completed.
    for (const asset of useEditor.getState().project?.assets ?? []) {
      if (asset.proxyStatus === "generating") retryProxy(asset);
    }
  }, [retryProxy]);

  importPathsRef.current = importPaths;

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        switch (event.payload.type) {
          case "enter":
          case "over":
            setFileDragOver(true);
            break;
          case "leave":
            setFileDragOver(false);
            break;
          case "drop":
            setFileDragOver(false);
            void importPathsRef.current(event.payload.paths);
            break;
        }
      })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => undefined);
    return () => dispose?.();
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void listen<MediaProgress>("media-progress", (event) => {
      if (event.payload.kind !== "proxy") return;
      // The asset card already shows a spinner; this handler exists so the
      // progress stream is consumed and available for future UI.
    })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => undefined);
    return () => dispose?.();
  }, []);

  const importFromDialog = useCallback(async () => {
    const paths = await pickMediaFiles();
    await importPaths(paths);
  }, [importPaths]);

  return { importPaths, importFromDialog, importing, fileDragOver, retryProxy };
}
