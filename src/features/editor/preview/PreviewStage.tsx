import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { BadgeCheck, CircleAlert, Loader2, Play } from "lucide-react";
import { formatClock } from "../../../lib/time";
import { useT } from "../../../lib/i18n";
import type { CanvasBox } from "../../../lib/previewCanvas";
import type { Clip, MaskPoint, Project } from "../../../lib/types";

export function PreviewStage({
  project,
  currentTime,
  fps,
  stageRef,
  canvasRef,
  hiddenRef,
  canvasBox,
  drawingCustomMask,
  showGuides,
  selectedClip,
  draftMaskPoints,
  maskOverlayPoints,
  matchExport,
  exactFrameUrl,
  exactFrameBusy,
  exactFrameError,
  exactFrameSize,
  renderVideoUrl,
  renderVideoRef,
  renderStatus,
  renderPercent,
  renderError,
  onCancelRender,
  onRetryRender,
  onRenderVideoEnded,
  onStartMask,
  onExtendMask,
  onFinishMask,
  onTogglePlay,
}: {
  project: Project | null;
  currentTime: number;
  fps: number;
  stageRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  hiddenRef: RefObject<HTMLDivElement | null>;
  canvasBox: CanvasBox;
  drawingCustomMask: boolean;
  showGuides: boolean;
  selectedClip?: Clip;
  draftMaskPoints: MaskPoint[];
  maskOverlayPoints: (points: MaskPoint[]) => string;
  matchExport: boolean;
  exactFrameUrl: string | null;
  exactFrameBusy: boolean;
  exactFrameError: string | null;
  exactFrameSize: { width: number; height: number } | null;
  renderVideoUrl: string | null;
  renderVideoRef: RefObject<HTMLVideoElement | null>;
  renderStatus: "idle" | "rendering" | "ready" | "error" | null;
  renderPercent: number | null;
  renderError: string | null;
  onCancelRender: () => void;
  onRetryRender: () => void;
  onRenderVideoEnded: () => void;
  onStartMask: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onExtendMask: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onFinishMask: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onTogglePlay: () => void;
}) {
  const t = useT();
  return (
    <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#09090b] p-5">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("Preview of {name} at {time}", { name: project?.name ?? t("the project"), time: formatClock(currentTime, fps) })}
        className="relative block max-h-full max-w-full rounded-[2px] bg-black ring-1 ring-white/15"
        onClick={() => {
          if (!drawingCustomMask) onTogglePlay();
        }}
      />
      {renderVideoUrl && canvasBox.width > 0 ? (
        // The accurate preview: the timeline rendered by the export graph.
        <video
          ref={renderVideoRef}
          src={renderVideoUrl}
          className="pointer-events-none absolute z-[1] rounded-[2px] bg-black ring-1 ring-white/15"
          style={{
            left: canvasBox.left,
            top: canvasBox.top,
            width: canvasBox.width,
            height: canvasBox.height,
          }}
          preload="auto"
          playsInline
          onEnded={onRenderVideoEnded}
        />
      ) : null}
      {exactFrameUrl && canvasBox.width > 0 ? (
        // The export renderer produced this frame at the project resolution,
        // so the stage is only a viewport here: scaling a finished still image
        // is not a second compositor.
        <img
          src={exactFrameUrl}
          alt={t("Export frame at {time}", { time: formatClock(currentTime, fps) })}
          className="pointer-events-none absolute rounded-[2px] ring-1 ring-white/15"
          style={{
            left: canvasBox.left,
            top: canvasBox.top,
            width: canvasBox.width,
            height: canvasBox.height,
          }}
        />
      ) : null}
      {showGuides && project && canvasBox.width > 0 ? (
        // The same safe areas the canvas paints. The export frame is a still
        // image over the canvas, so the guides are a separate overlay instead.
        <svg
          className="pointer-events-none absolute z-10"
          style={{
            left: canvasBox.left,
            top: canvasBox.top,
            width: canvasBox.width,
            height: canvasBox.height,
          }}
          viewBox={`0 0 ${project.width} ${project.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            x={project.width * 0.05}
            y={project.height * 0.05}
            width={project.width * 0.9}
            height={project.height * 0.9}
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1.5}
            strokeDasharray="7.5 6"
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x={project.width * 0.1}
            y={project.height * 0.1}
            width={project.width * 0.8}
            height={project.height * 0.8}
            fill="none"
            stroke="rgba(84,214,222,0.55)"
            strokeWidth={1.5}
            strokeDasharray="7.5 6"
            vectorEffect="non-scaling-stroke"
          />
          {[1 / 3, 2 / 3].map((fraction) => (
            <line
              key={`v${fraction}`}
              x1={project.width * fraction}
              y1={0}
              x2={project.width * fraction}
              y2={project.height}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[1 / 3, 2 / 3].map((fraction) => (
            <line
              key={`h${fraction}`}
              x1={0}
              y1={project.height * fraction}
              x2={project.width}
              y2={project.height * fraction}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={project.width * 0.475}
            y1={project.height / 2}
            x2={project.width * 0.525}
            y2={project.height / 2}
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={project.width / 2}
            y1={project.height * 0.475}
            x2={project.width / 2}
            y2={project.height * 0.525}
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={project.width * 0.05 + 8}
            y={project.height * 0.05 + 8}
            fill="rgba(255,255,255,0.55)"
            fontSize={Math.max(10, Math.round(project.width * 0.011))}
            fontFamily="Segoe UI, sans-serif"
          >
            {t("ACTION SAFE")}
          </text>
          <text
            x={project.width * 0.1 + 8}
            y={project.height * 0.1 + 8}
            fill="rgba(84,214,222,0.75)"
            fontSize={Math.max(10, Math.round(project.width * 0.011))}
            fontFamily="Segoe UI, sans-serif"
          >
            {t("TITLE SAFE")}
          </text>
        </svg>
      ) : null}
      {matchExport ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-3 top-3 z-10 flex max-w-[70%] items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[10px] text-white/75 ring-1 ring-white/10"
        >
          {exactFrameBusy || !exactFrameUrl ? (
            <Loader2 size={11} className="shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <BadgeCheck size={11} className="shrink-0 text-accent" aria-hidden="true" />
          )}
          <span className="truncate" title={exactFrameError ?? undefined}>
            {exactFrameError
              ? t("Export frame failed: {message}", { message: exactFrameError.replace(/\s+/g, " ") })
              : exactFrameBusy || !exactFrameSize
                ? t("Rendering export frame…")
                : t("Export frame · {width}×{height}", {
                  width: exactFrameSize.width,
                  height: exactFrameSize.height,
                })}
          </span>
        </div>
      ) : null}
      {renderStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-3 right-3 z-10 flex max-w-[80%] items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] text-white/75 ring-1 ring-white/10"
        >
          {renderStatus === "rendering" ? (
            <>
              <Loader2 size={11} className="shrink-0 animate-spin" aria-hidden="true" />
              <span className="truncate">
                {t("Rendering accurate preview… {percent}%", { percent: renderPercent != null ? Math.round(renderPercent) : 0 })}
              </span>
              <button
                className="btn pointer-events-auto h-5 shrink-0 rounded-full border border-white/20 px-2 text-[10px] text-white/80 transition hover:bg-white/10 hover:text-white"
                onClick={onCancelRender}
                title={t("Stop the accurate preview render")}
                aria-label={t("Stop the accurate preview render")}
              >
                {t("Cancel")}
              </button>
            </>
          ) : renderStatus === "error" ? (
            <>
              <CircleAlert size={11} className="shrink-0 text-error" aria-hidden="true" />
              <span className="truncate" title={renderError ?? undefined}>
                {t("Accurate preview failed: {message}", { message: (renderError ?? t("unknown error")).replace(/\s+/g, " ") })}
              </span>
              <button
                className="btn pointer-events-auto h-5 shrink-0 rounded-full border border-white/20 px-2 text-[10px] text-white/80 transition hover:bg-white/10 hover:text-white"
                onClick={onRetryRender}
                title={t("Render the accurate preview again")}
                aria-label={t("Render the accurate preview again")}
              >
                {t("Retry")}
              </button>
            </>
          ) : renderStatus === "ready" ? (
            <>
              <BadgeCheck size={11} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">{t("Export-accurate playback")}</span>
            </>
          ) : (
            <>
              <Loader2 size={11} className="shrink-0 animate-spin" aria-hidden="true" />
              <span className="truncate">{t("Accurate preview…")}</span>
            </>
          )}
        </div>
      ) : null}
      {drawingCustomMask && canvasBox.width > 0 ? (
        <svg
          className="absolute z-10 touch-none select-none"
          style={{
            left: canvasBox.left,
            top: canvasBox.top,
            width: canvasBox.width,
            height: canvasBox.height,
            cursor: "crosshair",
          }}
          viewBox={`0 0 ${canvasBox.width} ${canvasBox.height}`}
          preserveAspectRatio="none"
          role="application"
          aria-label={t("Draw the custom mask on the preview")}
          onPointerDown={onStartMask}
          onPointerMove={onExtendMask}
          onPointerUp={onFinishMask}
          onPointerCancel={onFinishMask}
        >
          <rect width={canvasBox.width} height={canvasBox.height} fill="transparent" />
          {selectedClip?.maskPoints && selectedClip.maskPoints.length >= 3 ? (
            <polygon
              points={maskOverlayPoints(selectedClip.maskPoints)}
              fill="rgba(167, 139, 250, 0.14)"
              stroke="#a78bfa"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {draftMaskPoints.length >= 2 ? (
            <polygon
              points={maskOverlayPoints(draftMaskPoints)}
              fill="rgba(167, 139, 250, 0.18)"
              stroke="#c4b5fd"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      ) : null}
      {drawingCustomMask ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[10.5px] text-white/80 ring-1 ring-white/10">
          {t("Drag on the preview to draw the mask")}
        </div>
      ) : null}
      {project && project.tracks.every((track) => track.clips.length === 0) ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Play size={18} className="text-white/60" />
          </div>
          <p className="text-[12px] font-medium text-white/80">{t("Your preview is empty")}</p>
          <p className="max-w-[250px] text-[11px] leading-relaxed text-white/60">
            {t("Import media, then add a clip to the timeline to see it here.")}
          </p>
        </div>
      ) : null}
      <div ref={hiddenRef} className="pointer-events-none absolute left-[-99999px] top-0 h-px w-px overflow-hidden opacity-0" />
    </div>
  );
}
