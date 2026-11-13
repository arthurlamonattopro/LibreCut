import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { MediaPanel } from "./MediaPanel";
import { Preview } from "./Preview";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { ExportDialog } from "./ExportDialog";
import { AiStudio } from "./AiStudio";
import { PerformancePanel } from "./PerformancePanel";
import { useEditor } from "../../stores/editor";
import { persistProject } from "../../lib/projectStore";
import { pickProjectPath, saveProjectFile } from "../../lib/media";
import { recordMetric } from "../../lib/metrics";
import { toast } from "../../components/Toast";
import { announce } from "../../lib/announce";
import { hasOpenDialog } from "../../lib/a11y";
import { useT } from "../../lib/i18n";
import { formatDuration } from "../../lib/time";
import type { Project } from "../../lib/types";

const AUTOSAVE_DELAY_MS = 700;

export function Editor({ onBack }: { onBack: () => void }) {
  const t = useT();
  const project = useEditor((state) => state.project);
  const dirty = useEditor((state) => state.dirty);
  const mediaRevision = useEditor((state) => state.mediaRevision);
  const markSaved = useEditor((state) => state.markSaved);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [aiTool, setAiTool] = useState<"captions" | "speech" | "background">("captions");
  const [aiImageId, setAiImageId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [mediaWidth, setMediaWidth] = useState(() => Number(localStorage.getItem("librecut:media-width")) || 256);
  const [inspectorWidth, setInspectorWidth] = useState(() => Number(localStorage.getItem("librecut:inspector-width")) || 280);
  const [timelineHeight, setTimelineHeight] = useState(() => Number(localStorage.getItem("librecut:timeline-height")) || 310);
  // A save in flight must not be overwritten by a newer one, so writes are
  // queued and the newest snapshot always wins.
  const pendingSaveRef = useRef<Project | null>(null);
  const savingRef = useRef(false);
  const savedMediaRevisionRef = useRef(0);

  const saveCopy = useCallback(async () => {
    const current = useEditor.getState().project;
    if (!current) return;
    try {
      const path = await pickProjectPath(current.name);
      if (!path) return;
      await saveProjectFile(path, JSON.stringify(current, null, 2));
      toast(t("Project copy saved."), "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Could not save the project copy."), "error");
    }
  }, [t]);

  const flushSave = useCallback(async () => {
    if (savingRef.current) return;
    const snapshot = pendingSaveRef.current;
    if (!snapshot) return;
    pendingSaveRef.current = null;
    savingRef.current = true;
    setSaving(true);
    const started = performance.now();
    try {
      // The media caches live next to the project document, so they are only
      // written when they changed.
      const mediaRevision = useEditor.getState().mediaRevision;
      const cacheChanged = mediaRevision !== savedMediaRevisionRef.current;
      await persistProject(snapshot, cacheChanged);
      savedMediaRevisionRef.current = mediaRevision;
      recordMetric("project save", performance.now() - started);
      // A newer edit may have arrived while this save was running.
      if (!pendingSaveRef.current) markSaved();
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Could not save the project."), "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingSaveRef.current) void flushSave();
    }
  }, [markSaved, t]);

  useEffect(() => {
    if (!project || !dirty) {
      setSaving(false);
      return;
    }
    setSaving(true);
    const timer = window.setTimeout(() => {
      const latest = useEditor.getState().project;
      if (!latest) return;
      pendingSaveRef.current = latest;
      void flushSave();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [project, dirty, mediaRevision, flushSave]);

  useEffect(() => {
    const flush = () => {
      const latest = useEditor.getState().project;
      if (latest) pendingSaveRef.current = latest;
      void flushSave();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flushSave]);

  useEffect(() => {
    if (project) document.title = `${project.name} — LibreCut`;
    return () => {
      document.title = "LibreCut";
    };
  }, [project?.name]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // A dialog owns the keyboard while it is open, so the shortcuts of the
      // editor behind it do not fire.
      if (hasOpenDialog()) return;

      if (command && key === "s") {
        event.preventDefault();
        void saveCopy();
        return;
      }
      if (command && key === "e") {
        event.preventDefault();
        setExportOpen(true);
        return;
      }
      if (typing) return;

      const state = useEditor.getState();
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        announce(event.shiftKey ? t("Redo.") : t("Undo."));
        return;
      }
      if (command && key === "y") {
        event.preventDefault();
        state.redo();
        announce(t("Redo."));
        return;
      }
      if (command && key === "d") {
        event.preventDefault();
        state.duplicateSelected();
        return;
      }
      if (command && key === "a") {
        event.preventDefault();
        state.selectAll();
        announce(t("{count} clips selected.", { count: useEditor.getState().selectedClipIds.length }));
        return;
      }

      // Modified arrow keys belong to the timeline, which uses them to walk
      // the clips and to move and trim the focused one.
      if (command || event.altKey) return;

      switch (event.key) {
        case " ":
          if (target?.tagName === "BUTTON") return;
          event.preventDefault();
          state.setPlaying(!state.playing);
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          if (state.selectedClipId) {
            state.deleteSelected();
            announce(t("Clip removed from the timeline."));
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          state.setPlaying(false);
          state.setCurrentTime(state.currentTime - (event.shiftKey ? 1 : 1 / (state.project?.fps ?? 30)));
          announce(t("Playhead {time}.", { time: formatDuration(useEditor.getState().currentTime) }));
          break;
        case "ArrowRight":
          event.preventDefault();
          state.setPlaying(false);
          state.setCurrentTime(state.currentTime + (event.shiftKey ? 1 : 1 / (state.project?.fps ?? 30)));
          announce(t("Playhead {time}.", { time: formatDuration(useEditor.getState().currentTime) }));
          break;
        case "Home":
          event.preventDefault();
          state.setCurrentTime(0);
          announce(t("Playhead at the start."));
          break;
        case "End":
          event.preventDefault();
          if (state.project) {
            const end = state.project.tracks.reduce(
              (max, track) => Math.max(max, ...track.clips.map((clip) => clip.start + clip.duration)),
              0,
            );
            state.setCurrentTime(end);
            announce(t("Playhead at the end."));
          }
          break;
        case "Escape":
          state.selectClip(null);
          break;
        case "+":
        case "=":
          event.preventDefault();
          state.setZoom(state.zoom + 12);
          break;
        case "-":
          event.preventDefault();
          state.setZoom(state.zoom - 12);
          break;
        default:
          if (key === "s") {
            event.preventDefault();
            state.splitAtPlayhead();
            announce(t("Clip split at the playhead."));
          }
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveCopy, t]);

  if (!project) return null;

  const goBack = async () => {
    useEditor.getState().setPlaying(false);
    const latest = useEditor.getState().project;
    if (latest) {
      pendingSaveRef.current = latest;
      await flushSave();
    }
    onBack();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <TopBar onBack={goBack} onExport={() => setExportOpen(true)} onSaveCopy={() => void saveCopy()} onAiTools={() => setAiOpen(true)} onShowPerformance={() => setPerformanceOpen(true)} saving={saving} />
      <div className="flex min-h-0 flex-1">
        <MediaPanel width={mediaWidth} onOpenAi={(tool, imageId) => { setAiTool(tool); setAiImageId(imageId); setAiOpen(true); }} />
        <ResizeHandle axis="x" label={t("Resize the media panel")} min={180} max={480} onResize={(delta) => setMediaWidth((value) => Math.max(180, Math.min(480, value + delta)))} onCommit={(value) => localStorage.setItem("librecut:media-width", String(value))} value={mediaWidth} />
        <Preview />
        <ResizeHandle axis="x" reverse label={t("Resize the inspector")} min={220} max={480} onResize={(delta) => setInspectorWidth((value) => Math.max(220, Math.min(480, value + delta)))} onCommit={(value) => localStorage.setItem("librecut:inspector-width", String(value))} value={inspectorWidth} />
        <Inspector width={inspectorWidth} />
      </div>
      <ResizeHandle axis="y" reverse label={t("Resize the timeline")} min={180} max={620} onResize={(delta) => setTimelineHeight((value) => Math.max(180, Math.min(620, value + delta)))} onCommit={(value) => localStorage.setItem("librecut:timeline-height", String(value))} value={timelineHeight} />
      <Timeline height={timelineHeight} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <AiStudio open={aiOpen} onClose={() => setAiOpen(false)} initialTool={aiTool} initialImageId={aiImageId} />
      <PerformancePanel open={performanceOpen} onClose={() => setPerformanceOpen(false)} />
    </div>
  );
}

function ResizeHandle({ axis, label, min, max, reverse = false, onResize, onCommit, value }: {
  axis: "x" | "y";
  /** The name of the panel this handle resizes. */
  label: string;
  /** The bounds of the panel size, in pixels. */
  min: number;
  max: number;
  reverse?: boolean;
  onResize: (delta: number) => void;
  onCommit: (value: number) => void;
  value: number;
}) {
  const t = useT();
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef(value);
  latest.current = value;
  return <div
    role="separator"
    aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={t("{value} pixels", { value })}
    tabIndex={0}
    className={`group relative z-20 shrink-0 touch-none bg-line-soft transition-colors hover:bg-accent/70 focus-visible:bg-accent ${axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`}
    onPointerDown={(event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.clientX, y: event.clientY };
    }}
    onPointerMove={(event) => {
      if (!start.current || (event.buttons & 1) === 0) return;
      const current = axis === "x" ? event.clientX : event.clientY;
      const initial = axis === "x" ? start.current.x : start.current.y;
      let delta = current - initial;
      if (reverse) delta *= -1;
      start.current = { x: event.clientX, y: event.clientY };
      onResize(delta);
    }}
    onPointerUp={() => { start.current = null; onCommit(latest.current); }}
    onPointerCancel={() => { start.current = null; onCommit(latest.current); }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const delta = direction * (reverse ? -1 : 1) * (event.shiftKey ? 24 : 8);
      onResize(delta);
      onCommit(latest.current + delta);
    }}
  />;
}
