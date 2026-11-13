import {
  ChevronsRight,
  Magnet,
  Plus,
  Redo2,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEditor } from "../../../stores/editor";
import { formatClock } from "../../../lib/time";
import { useT } from "../../../lib/i18n";
import { MAX_ZOOM, MIN_ZOOM, trackIcon } from "./geometry";

export function TimelineToolbar({ onFit }: { onFit: () => void }) {
  const project = useEditor((state) => state.project);
  const currentTime = useEditor((state) => state.currentTime);
  const zoom = useEditor((state) => state.zoom);
  const snap = useEditor((state) => state.snap);
  const ripple = useEditor((state) => state.ripple);
  const setZoom = useEditor((state) => state.setZoom);
  const addTrack = useEditor((state) => state.addTrack);
  const addEffectClip = useEditor((state) => state.addEffectClip);
  const toggleSnap = useEditor((state) => state.toggleSnap);
  const toggleRipple = useEditor((state) => state.toggleRipple);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const splitAtPlayhead = useEditor((state) => state.splitAtPlayhead);
  const deleteSelected = useEditor((state) => state.deleteSelected);
  const undoDepth = useEditor((state) => state.undoStack.length);
  const redoDepth = useEditor((state) => state.redoStack.length);
  const t = useT();

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-3">
      <div className="flex items-center gap-1">
        <span className="mr-2 font-mono text-[11px] tabular-nums text-muted" aria-label={t("Playhead at {time}", { time: formatClock(currentTime, project?.fps ?? 30) })}>
          {formatClock(currentTime, project?.fps ?? 30)}
        </span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={undo} disabled={undoDepth === 0} title={t("Undo (Ctrl+Z)")} aria-label={t("Undo")}>
          <Undo2 size={14} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={redo} disabled={redoDepth === 0} title={t("Redo (Ctrl+Y)")} aria-label={t("Redo")}>
          <Redo2 size={14} />
        </button>
        <div className="mx-1 h-4 w-px bg-line" />
        <button className="btn btn-ghost btn-sm" onClick={splitAtPlayhead} title={t("Split at playhead (S)")}>
          <Scissors size={13} /> {t("Split")}
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={deleteSelected} title={t("Delete selected clip (Del)")} aria-label={t("Delete selected clip")}>
          <Trash2 size={14} />
        </button>
        <div className="mx-1 h-4 w-px bg-line" />
        <button
          className={`btn btn-sm ${snap ? "btn-secondary text-accent" : "btn-ghost"}`}
          onClick={toggleSnap}
          title={t("Toggle snapping")}
          aria-pressed={snap}
        >
          <Magnet size={13} /> {t("Snap")}
        </button>
        <button
          className={`btn btn-sm ${ripple ? "btn-secondary text-accent" : "btn-ghost"}`}
          onClick={toggleRipple}
          title={t("Ripple edits: trims and deletes shift later clips")}
          aria-pressed={ripple}
        >
          <ChevronsRight size={13} /> {t("Ripple")}
        </button>
      </div>

      <div className="flex items-center gap-1">
        <div className="mr-2 flex items-center gap-0.5">
          {(["video", "audio", "text", "misc"] as const).map((kind) => {
            const Icon = trackIcon(kind);
            return (
              <button
                key={kind}
                className="btn btn-ghost btn-sm px-2"
                onClick={() => addTrack(kind)}
                title={t("Add {kind} track", { kind: t(kind) })}
                aria-label={t("Add {kind} track", { kind: t(kind) })}
              >
                <Plus size={11} /> <Icon size={12} />
              </button>
            );
          })}
          <button className="btn btn-secondary btn-sm px-2" onClick={() => addEffectClip()} title={t("Add a color filter clip")} aria-label={t("Add a color filter clip")}>
            <SlidersHorizontal size={12} /> {t("Filter")}
          </button>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(zoom - 12)} title={t("Zoom out")} aria-label={t("Zoom out")}>
          <ZoomOut size={14} />
        </button>
        <input
          type="range"
          className="w-28"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={1}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          title={t("Timeline zoom")}
          aria-label={t("Timeline zoom")}
          aria-valuetext={t("{pixels} pixels per second", { pixels: Math.round(zoom) })}
        />
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(zoom + 12)} title={t("Zoom in")} aria-label={t("Zoom in")}>
          <ZoomIn size={14} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onFit} title={t("Fit timeline")}>
          {t("Fit")}
        </button>
      </div>
    </div>
  );
}
