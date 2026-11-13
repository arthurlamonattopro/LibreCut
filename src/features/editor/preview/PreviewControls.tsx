import { LayoutGrid, Maximize2, Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { formatClock } from "../../../lib/time";
import { useT } from "../../../lib/i18n";
import type { Project } from "../../../lib/types";

export function PreviewHeader({
  project,
  showGuides,
  onToggleGuides,
  onFullscreen,
}: {
  project: Project | null;
  showGuides: boolean;
  onToggleGuides: () => void;
  onFullscreen: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-line-soft px-4">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="font-medium text-ink">{t("Preview")}</span>
        <span>{project ? `${project.width}×${project.height}` : "—"}</span>
        <span className="text-dim" aria-hidden="true">·</span>
        <span>{project?.fps ?? 30} fps</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className={`btn btn-ghost btn-icon btn-sm ${showGuides ? "text-accent" : ""}`}
          onClick={onToggleGuides}
          title={t("Toggle title and action safe-area guides")}
          aria-label={t("Toggle title and action safe-area guides")}
          aria-pressed={showGuides}
        >
          <LayoutGrid size={13} aria-hidden="true" />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onFullscreen} title={t("Fullscreen preview")} aria-label={t("Fullscreen preview")}>
          <Maximize2 size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function PreviewTransport({
  playing,
  currentTime,
  duration,
  fps,
  onTogglePlay,
  onStep,
  onGoToStart,
}: {
  playing: boolean;
  currentTime: number;
  duration: number;
  fps: number;
  onTogglePlay: () => void;
  onStep: (direction: number) => void;
  onGoToStart: () => void;
}) {
  const t = useT();
  return (
    <div className="relative flex h-[52px] shrink-0 items-center justify-between gap-3 border-t border-line-soft bg-panel px-4">
      <div className="flex w-[180px] items-center gap-1">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onStep(-1)} title={t("Previous frame")} aria-label={t("Previous frame")}>
          <SkipBack size={14} aria-hidden="true" />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-surface transition hover:bg-white"
          onClick={onTogglePlay}
          title={playing ? t("Pause (Space)") : t("Play (Space)")}
          aria-label={playing ? t("Pause") : t("Play")}
          aria-pressed={playing}
        >
          {playing ? <Pause size={14} fill="currentColor" aria-hidden="true" /> : <Play size={14} fill="currentColor" className="ml-0.5" aria-hidden="true" />}
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onStep(1)} title={t("Next frame")} aria-label={t("Next frame")}>
          <SkipForward size={14} aria-hidden="true" />
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onGoToStart}
          title={t("Go to start")}
          aria-label={t("Go to the start of the timeline")}
        >
          <Square size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 font-mono text-[11.5px] tracking-tight">
        <span className="text-ink">{formatClock(currentTime, fps)}</span>
        <span className="text-dim/70" aria-hidden="true">/</span>
        <span className="text-dim">{formatClock(duration, fps)}</span>
      </div>
    </div>
  );
}
