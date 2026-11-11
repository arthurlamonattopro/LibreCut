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

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function pathKey(path: string): string {
  return path.replaceAll("/", "\\").replaceAll(/\\+/g, "\\").toLowerCase();
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

  const importPaths = useCallback(
    async (paths: string[]) => {
      const existingPaths = new Set(
        (useEditor.getState().project?.assets ?? []).map((asset) => pathKey(asset.path)),
      );
      const supported = paths.filter((path) => SUPPORTED.has(extensionOf(path)));
      const usable = [...new Map(supported
        .map((path) => [pathKey(path), path] as const)).values()]
        .filter((path) => {
          const key = pathKey(path);
          if (existingPaths.has(key) || importingPathsRef.current.has(key)) return false;
          importingPathsRef.current.add(key);
          return true;
        });
      if (usable.length === 0) {
        if (paths.length > 0 && supported.length === 0) toast("No supported media files were found.", "error");
        return;
      }
      setImporting((value) => value + usable.length);

      for (const path of usable) {
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
            createProxy(path, info.height > 2160 ? 720 : 1080)
              .then((proxy) => {
                replaceAsset(asset.id, {
                  proxyId: proxy.id,
                  previewMediaId: proxy.id,
                  proxyStatus: "ready",
                });
                toast(`Preview proxy ready for ${info.name}`, "info");
              })
              .catch((error) => {
                replaceAsset(asset.id, { proxyStatus: "failed" });
                toast(
                  `Proxy failed for ${info.name}. Preview may be slower. ${
                    error instanceof Error ? error.message : ""
                  }`,
                  "error",
                );
              });
          }
        } catch (error) {
          toast(
            `Could not import ${path.split(/[\\/]/).pop() ?? "file"}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "error",
          );
        } finally {
          importingPathsRef.current.delete(pathKey(path));
          setImporting((value) => Math.max(0, value - 1));
        }
      }
    },
    [addAsset, replaceAsset],
  );

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

  return { importPaths, importFromDialog, importing, fileDragOver };
}
