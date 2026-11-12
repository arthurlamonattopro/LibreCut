import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEditor } from "../../stores/editor";
import {
  createProxy,
  generateThumbnails,
  generateWaveform,
  isTauri,
  pickMediaFiles,
  registerMedia,
} from "../../lib/media";
import type { Asset, MediaProgress } from "../../lib/types";
import { toast } from "../../components/Toast";
import { logSlowOperation } from "../../lib/performance";
import { t } from "../../lib/i18n";

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
      toast(t("Proxy failed for {name}. Retry or continue with the original source. {message}", {
        name: asset.name,
        message: error instanceof Error ? error.message : String(error),
      }), "error");
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
        if (unsupported.length) toast(t(
          unsupported.length > 1
            ? "Unsupported formats: {files}. Supported: MP4, MOV, WebM, MKV, AVI, common audio, and image files. Import subtitles from the Text tab."
            : "Unsupported format: {files}. Supported: MP4, MOV, WebM, MKV, AVI, common audio, and image files. Import subtitles from the Text tab.",
          { files: unsupported.map((path) => path.split(/[\\/]/).pop()).slice(0, 3).join(", ") },
        ), "error");
        return;
      }
      setImporting((value) => value + usable.length);
      if (unsupported.length) toast(t("Skipped unsupported files: {files}. Subtitle files can be imported from the Text tab.", {
        files: unsupported.map((path) => path.split(/[\\/]/).pop()).slice(0, 3).join(", "),
      }), "info");
      let nextPath = 0;
      await Promise.all(Array.from({ length: Math.min(3, usable.length) }, async () => {
        while (nextPath < usable.length) {
          const path = usable[nextPath++];
          const importStarted = performance.now();
        try {
          const probeStarted = performance.now();
          const registered = await registerMedia(path);
          const info = registered.info;
          logSlowOperation("media probe", probeStarted, {
            width: info.width, height: info.height, bytes: info.sizeBytes,
          });

          // The asset appears as soon as it is probed. Poster frames and the
          // waveform are filled in afterwards, so the editor stays usable
          // while a 4K source is analyzed.
          const asset: Asset = {
            id: crypto.randomUUID(),
            name: info.name,
            path,
            mediaId: registered.id,
            previewMediaId: registered.id,
            proxyStatus: "none",
            info,
            thumbnails: [],
            waveform: [],
            importedAt: Date.now(),
          };
          addAsset(asset);
          toast(t("Imported {name}", { name: info.name }), "success");

          const analysisStarted = performance.now();
          const [thumbnails, waveform] = await Promise.all([
            generateThumbnails(path).catch(() => [] as string[]),
            info.hasAudio ? generateWaveform(path).catch(() => [] as number[]) : Promise.resolve([] as number[]),
          ]);
          logSlowOperation("media analysis", analysisStarted, {
            thumbnails: thumbnails.length, waveformSamples: waveform.length,
            width: info.width, height: info.height,
          });
          if (thumbnails.length || waveform.length) {
            replaceAsset(asset.id, { thumbnails, waveform });
          }

          if (needsProxy(info)) {
            replaceAsset(asset.id, { proxyStatus: "generating" });
            retryProxy(asset);
          }
          logSlowOperation("media import", importStarted, {
            width: info.width, height: info.height, hasAudio: info.hasAudio,
          }, 250);
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          const diagnosis = /probe|decode|invalid data|moov atom|corrupt|stream/i.test(details)
            ? t("The file may be damaged or use a codec this FFmpeg build cannot read. Try remuxing or transcoding it to H.264 MP4.")
            : t("Check that the file exists and is readable.");
          toast(
            `${t("Could not import {name}: {message}", {
              name: path.split(/[\\/]/).pop() ?? t("file"),
              message: details,
            })} ${diagnosis}`,
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
    // Drag and drop is a desktop-only feature. Outside Tauri the webview
    // call throws synchronously, which would take the editor down with it.
    if (!isTauri) return;
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
