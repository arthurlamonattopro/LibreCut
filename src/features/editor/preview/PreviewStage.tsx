import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { Play } from "lucide-react";
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
  selectedClip,
  draftMaskPoints,
  maskOverlayPoints,
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
  selectedClip?: Clip;
  draftMaskPoints: MaskPoint[];
  maskOverlayPoints: (points: MaskPoint[]) => string;
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
        className="relative max-h-full max-w-full rounded-[2px] bg-black ring-1 ring-white/15"
        style={{
          aspectRatio: project ? `${project.width} / ${project.height}` : "16 / 9",
          width: "100%",
          objectFit: "contain",
        }}
        onClick={() => {
          if (!drawingCustomMask) onTogglePlay();
        }}
      />
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
