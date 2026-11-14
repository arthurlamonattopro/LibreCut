import type { ReactNode } from "react";
import { LayoutGrid, Loader2, Maximize2, Pause, Play, ScanEye, SkipBack, SkipForward, Square, Zap, BadgeCheck } from "lucide-react";
import { formatClock } from "../../../lib/time";
import { useT } from "../../../lib/i18n";
import type { Project } from "../../../lib/types";

export function PreviewQualityPicker({
  quality,
  onChange,
  disabled,
}: {
  quality: "fast" | "exact";
  onChange: (quality: "fast" | "exact") => void;
  disabled?: boolean;
}) {
  const t = useT();
  const option = (value: "fast" | "exact", icon: ReactNode, label: string, title: string) => (
    <button
      data-quality={value}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition ${
        quality === value ? "bg-raised text-accent shadow-sm" : "text-muted hover:text-ink"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      onClick={() => onChange(value)}
      disabled={disabled}
      title={title}
      aria-pressed={quality === value}
      aria-label={label}
    >
      {icon}
      <span className="hidden text-[11px] sm:inline">{label}</span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label={t("Preview quality")}
      className="flex items-center rounded-lg border border-line-soft bg-surface-2/50 p-0.5"
    >
      {option("fast", <Zap size={12} aria-hidden="true" />, t("Fast"), t("Canvas preview: playback is fast and uses browser decoding"))}
      {option(
        "exact",
        <BadgeCheck size={12} aria-hidden="true" />,
        t("Exact"),
        t("Export-accurate playback: render the timeline with FFmpeg, then play the result"),
      )}
    </div>
  );
}

export function PreviewHeader({
  project,
  showGuides,
  onToggleGuides,
  onFullscreen,
  matchExport,
  matchExportBusy,
  matchExportDisabled,
  onToggleMatchExport,
  previewQuality,
  onToggleQuality,
  previewQualityDisabled,
}: {
  project: Project | null;
  showGuides: boolean;
  onToggleGuides: () => void;
  onFullscreen: () => void;
  matchExport: boolean;
  matchExportBusy: boolean;
  matchExportDisabled?: boolean;
  onToggleMatchExport: () => void;
  previewQuality: "fast" | "exact";
  onToggleQuality: (quality: "fast" | "exact") => void;
  previewQualityDisabled?: boolean;
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
      <div className="flex items-center gap-1.5">
        <PreviewQualityPicker quality={previewQuality} onChange={onToggleQuality} disabled={previewQualityDisabled} />
        <button
          className={`btn btn-sm gap-1.5 ${matchExport ? "btn-secondary text-accent" : "btn-ghost"} ${matchExportDisabled ? "cursor-not-allowed opacity-50" : ""}`}
          onClick={onToggleMatchExport}
          disabled={matchExportDisabled}
          title={matchExportDisabled ? t("Match export is available in the desktop app") : t("Render the paused frame with the FFmpeg export pipeline")}
          aria-label={t("Match export")}
          aria-pressed={matchExport}
        >
          {matchExport && matchExportBusy ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <ScanEye size={13} aria-hidden="true" />
          )}
          <span className="hidden text-[11px] sm:inline">{t("Match export")}</span>
        </button>
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
