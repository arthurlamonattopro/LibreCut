import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { MediaPanel } from "./MediaPanel";
import { Preview } from "./Preview";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { ExportDialog } from "./ExportDialog";
import { AiStudio } from "./AiStudio";
import { useEditor } from "../../stores/editor";
import { persistProject } from "../../stores/projects";
import { pickProjectPath, saveProjectFile } from "../../lib/media";
import { toast } from "../../components/Toast";

export function Editor({ onBack }: { onBack: () => void }) {
  const project = useEditor((state) => state.project);
  const dirty = useEditor((state) => state.dirty);
  const markSaved = useEditor((state) => state.markSaved);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTool, setAiTool] = useState<"captions" | "speech" | "background">("captions");
  const [aiImageId, setAiImageId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [mediaWidth, setMediaWidth] = useState(() => Number(localStorage.getItem("librecut:media-width")) || 256);
  const [inspectorWidth, setInspectorWidth] = useState(() => Number(localStorage.getItem("librecut:inspector-width")) || 280);
  const [timelineHeight, setTimelineHeight] = useState(() => Number(localStorage.getItem("librecut:timeline-height")) || 310);

  const saveCopy = useCallback(async () => {
    const current = useEditor.getState().project;
    if (!current) return;
    try {
      const path = await pickProjectPath(current.name);
      if (!path) return;
      await saveProjectFile(path, JSON.stringify(current, null, 2));
      toast("Project copy saved.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the project copy.", "error");
    }
  }, []);

  useEffect(() => {
    if (!project || !dirty) {
      setSaving(false);
      return;
    }
    setSaving(true);
    const timer = window.setTimeout(() => {
      const latest = useEditor.getState().project;
      if (latest) {
        persistProject(latest);
        markSaved();
      }
      setSaving(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, dirty, markSaved]);

  useEffect(() => {
    const flush = () => {
      const latest = useEditor.getState().project;
      if (latest) persistProject(latest);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (project) document.title = `${project.name} ÔÇö LibreCut`;
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
        return;
      }
      if (command && key === "y") {
        event.preventDefault();
        state.redo();
        return;
      }
      if (command && key === "d") {
        event.preventDefault();
        if (state.selectedClipId) state.duplicateClip(state.selectedClipId);
        return;
      }

      switch (event.key) {
        case " ":
          if (target?.tagName === "BUTTON") return;
          event.preventDefault();
          state.setPlaying(!state.playing);
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          state.deleteSelected();
          break;
        case "ArrowLeft":
          event.preventDefault();
          state.setPlaying(false);
          state.setCurrentTime(state.currentTime - (event.shiftKey ? 1 : 1 / (state.project?.fps ?? 30)));
          break;
        case "ArrowRight":
          event.preventDefault();
          state.setPlaying(false);
          state.setCurrentTime(state.currentTime + (event.shiftKey ? 1 : 1 / (state.project?.fps ?? 30)));
          break;
        case "Home":
          event.preventDefault();
          state.setCurrentTime(0);
          break;
        case "End":
          event.preventDefault();
          if (state.project) {
            const end = state.project.tracks.reduce(
              (max, track) => Math.max(max, ...track.clips.map((clip) => clip.start + clip.duration)),
              0,
            );
            state.setCurrentTime(end);
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
          }
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveCopy]);

  if (!project) return null;

  const goBack = () => {
    useEditor.getState().setPlaying(false);
    persistProject(project);
    onBack();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <TopBar onBack={goBack} onExport={() => setExportOpen(true)} onSaveCopy={() => void saveCopy()} onAiTools={() => setAiOpen(true)} saving={saving} />
      <div className="flex min-h-0 flex-1">
        <MediaPanel width={mediaWidth} onOpenAi={(tool, imageId) => { setAiTool(tool); setAiImageId(imageId); setAiOpen(true); }} />
        <ResizeHandle axis="x" onResize={(delta) => setMediaWidth((value) => Math.max(180, Math.min(480, value + delta)))} onCommit={(value) => localStorage.setItem("librecut:media-width", String(value))} value={mediaWidth} />
        <Preview />
        <ResizeHandle axis="x" reverse onResize={(delta) => setInspectorWidth((value) => Math.max(220, Math.min(480, value + delta)))} onCommit={(value) => localStorage.setItem("librecut:inspector-width", String(value))} value={inspectorWidth} />
        <Inspector width={inspectorWidth} />
      </div>
      <ResizeHandle axis="y" reverse onResize={(delta) => setTimelineHeight((value) => Math.max(180, Math.min(620, value + delta)))} onCommit={(value) => localStorage.setItem("librecut:timeline-height", String(value))} value={timelineHeight} />
      <Timeline height={timelineHeight} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <AiStudio open={aiOpen} onClose={() => setAiOpen(false)} initialTool={aiTool} initialImageId={aiImageId} />
    </div>
  );
}

function ResizeHandle({ axis, reverse = false, onResize, onCommit, value }: {
  axis: "x" | "y";
  reverse?: boolean;
  onResize: (delta: number) => void;
  onCommit: (value: number) => void;
  value: number;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef(value);
  latest.current = value;
  return <div
    role="separator"
    aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    aria-label={axis === "x" ? "Resize editor panel" : "Resize timeline"}
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
