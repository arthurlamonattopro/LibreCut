import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { assetForClip, useEditor } from "../../../stores/editor";
import { clipValue } from "../../../lib/animation";
import { clamp } from "../../../lib/time";
import type { CanvasBox } from "../../../lib/previewCanvas";
import {
  frameContainsPoint,
  frameCorners,
  visualFrameOf,
  type PreviewFrame,
} from "../../../lib/previewTransform";
import type { Clip, Project } from "../../../lib/types";
import { useT } from "../../../lib/i18n";

/** How close the pointer has to be to a handle, in screen pixels. */
const HANDLE_HIT_RADIUS = 11;
/** Size of a corner handle, in screen pixels. */
const HANDLE_SIZE = 8;
/** Distance from the top edge to the rotation handle, in screen pixels. */
const ROTATE_OFFSET = 26;
/** Magnet strength around the canvas center, in screen pixels. */
const SNAP_DISTANCE = 7;

const ACCENT = "#36c8d0";
const HANDLE_STROKE = "#071719";

type Candidate = { clip: Clip; frame: PreviewFrame };

type DragKind = "move" | "scale" | "rotate";

interface DragState {
  kind: DragKind;
  clipId: string;
  pointerId: number;
  isText: boolean;
  rect: DOMRect;
  centerClientX: number;
  centerClientY: number;
  startClientX: number;
  startClientY: number;
  startDistance: number;
  lastAngle: number;
  rotation: number;
  startScale: number;
  startSize: number;
  /** Clip position as a canvas fraction: a center offset, or text coordinates. */
  baseX: number;
  baseY: number;
  recorded: boolean;
}

function projectPoint(
  project: Project,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * project.width,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * project.height,
  };
}

/** The frame of every visible clip, topmost first. */
function visibleCandidates(project: Project, time: number): Candidate[] {
  const media: Candidate[] = [];
  const texts: Candidate[] = [];
  for (const track of project.tracks) {
    if (track.hidden || track.kind === "audio") continue;
    for (const clip of track.clips) {
      if (time < clip.start || time >= clip.start + clip.duration) continue;
      const asset = clip.assetId ? assetForClip(project, clip) : undefined;
      const frame = visualFrameOf(clip, project, asset, time);
      if (!frame) continue;
      const candidate = { clip, frame };
      if (track.kind === "text") texts.push(candidate);
      else media.push(candidate);
    }
  }
  // The compositor paints media in track order and text on top, so the last
  // candidate it painted is the first one a click should hit.
  return [...texts.reverse(), ...media.reverse()];
}

export function PreviewTransformOverlay({
  project,
  currentTime,
  canvasBox,
  enabled,
}: {
  project: Project | null;
  currentTime: number;
  canvasBox: CanvasBox;
  enabled: boolean;
}) {
  const t = useT();
  const selectedClipId = useEditor((state) => state.selectedClipId);
  const playing = useEditor((state) => state.playing);
  const updateClip = useEditor((state) => state.updateClip);
  const selectClip = useEditor((state) => state.selectClip);
  const recordSnapshot = useEditor((state) => state.recordSnapshot);
  const setPlaying = useEditor((state) => state.setPlaying);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cursor, setCursor] = useState("default");
  const [snapAxes, setSnapAxes] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });

  const candidates = useMemo(
    () => (project && enabled ? visibleCandidates(project, currentTime) : []),
    [project, currentTime, enabled],
  );
  const selected = candidates.find((candidate) => candidate.clip.id === selectedClipId);
  const hovered = candidates.find((candidate) => candidate.clip.id === hoveredId && candidate !== selected);

  if (!project || !enabled || canvasBox.width <= 0 || canvasBox.height <= 0) return null;

  const scaleX = canvasBox.width / project.width;
  const scaleY = canvasBox.height / project.height;

  /** Projects a frame's corners into screen pixels inside the overlay. */
  const pointsOf = (frame: PreviewFrame) => frameCorners(frame).map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
  const polygonOf = (frame: PreviewFrame) =>
    pointsOf(frame).map((point) => `${point.x},${point.y}`).join(" ");

  /** Corner and rotation-handle positions of the selected frame, in client pixels. */
  const handleGeometry = (frame: PreviewFrame, rect: DOMRect) => {
    const sx = rect.width / project.width;
    const sy = rect.height / project.height;
    const radians = (frame.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const centerX = rect.left + frame.centerX * sx;
    const centerY = rect.top + frame.centerY * sy;
    const halfWidth = (frame.width * sx) / 2;
    const halfHeight = (frame.height * sy) / 2;
    const corners = [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ].map(([x, y]) => ({
      x: centerX + x * cos - y * sin,
      y: centerY + x * sin + y * cos,
    }));
    const rotateLocalY = -halfHeight - ROTATE_OFFSET;
    return {
      centerX,
      centerY,
      corners,
      rotate: {
        x: centerX - rotateLocalY * sin,
        y: centerY + rotateLocalY * cos,
      },
    };
  };

  const hitHandle = (
    frame: PreviewFrame,
    rect: DOMRect,
    clientX: number,
    clientY: number,
  ): { kind: "rotate" | "scale"; corner?: number } | null => {
    const geometry = handleGeometry(frame, rect);
    if (Math.hypot(clientX - geometry.rotate.x, clientY - geometry.rotate.y) <= HANDLE_HIT_RADIUS) {
      return { kind: "rotate" };
    }
    for (let index = 0; index < geometry.corners.length; index += 1) {
      const corner = geometry.corners[index];
      if (Math.hypot(clientX - corner.x, clientY - corner.y) <= HANDLE_HIT_RADIUS) {
        return { kind: "scale", corner: index };
      }
    }
    return null;
  };

  const hitCandidate = (
    rect: DOMRect,
    clientX: number,
    clientY: number,
  ): Candidate | null => {
    const point = projectPoint(project, rect, clientX, clientY);
    return candidates.find((candidate) => frameContainsPoint(candidate.frame, point.x, point.y)) ?? null;
  };

  const cursorForHandle = (frame: PreviewFrame, kind: "rotate" | "scale", corner?: number) => {
    if (kind === "rotate") return "grab";
    // A 45° corner of an unrotated frame is a diagonal resize; follow the
    // frame's rotation so a rotated clip still gets the sensible cursor.
    const diagonal = (frame.rotation + (corner === 1 || corner === 3 ? -45 : 45)) % 180;
    const angle = Math.abs(diagonal) % 180;
    return angle > 22.5 && angle < 67.5 ? "nesw-resize" : "nwse-resize";
  };

  const beginDrag = (
    kind: DragKind,
    candidate: Candidate,
    event: ReactPointerEvent<SVGSVGElement>,
    rect: DOMRect,
  ) => {
    const { clip, frame } = candidate;
    const isText = Boolean(clip.text);
    const geometry = handleGeometry(frame, rect);
    // Text rotates around its anchor, which is not the center of a
    // left- or right-aligned block. Rotating around that anchor keeps the
    // text under the pointer.
    let centerClientX = geometry.centerX;
    let centerClientY = geometry.centerY;
    if (kind === "rotate" && isText) {
      const localTime = clamp(currentTime - clip.start, 0, clip.duration);
      centerClientX = rect.left + clipValue(clip, "x", localTime) * rect.width;
      centerClientY = rect.top + clipValue(clip, "y", localTime) * rect.height;
    }
    const startAngle = Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX) * 180 / Math.PI;
    dragRef.current = {
      kind,
      clipId: clip.id,
      pointerId: event.pointerId,
      isText,
      rect,
      centerClientX,
      centerClientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startDistance: Math.max(
        1,
        Math.hypot(event.clientX - centerClientX, event.clientY - centerClientY),
      ),
      lastAngle: startAngle,
      rotation: isText ? clip.text!.rotation : clip.rotation,
      startScale: clip.scale,
      startSize: clip.text?.size ?? 0,
      baseX: isText ? clip.text!.x : clip.x,
      baseY: isText ? clip.text!.y : clip.y,
      recorded: false,
    };
    setPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();

    if (selected) {
      const handle = hitHandle(selected.frame, rect, event.clientX, event.clientY);
      if (handle) {
        setCursor(handle.kind === "rotate" ? "grabbing" : cursorForHandle(selected.frame, handle.kind, handle.corner));
        beginDrag(handle.kind, selected, event, rect);
        return;
      }
    }

    // The topmost clip painted at the pointer wins. Test candidates before the
    // selected clip's body: text is painted above every other layer, and a
    // selected full-frame video would otherwise swallow every click on it.
    const hit = hitCandidate(rect, event.clientX, event.clientY);
    if (hit) {
      if (hit.clip.id !== selectedClipId) selectClip(hit.clip.id);
      setCursor("move");
      beginDrag("move", hit, event, rect);
      return;
    }

    // Empty canvas: clear the selection first, otherwise keep the old
    // click-to-play behaviour of the preview.
    if (selectedClipId) {
      selectClip(null);
      setCursor("default");
    } else {
      setPlaying(!playing);
    }
  };

  const updateDrag = (drag: DragState, event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.recorded) {
      // A plain click should select without nudging the clip or adding an undo
      // step; only a real drag starts changing the project.
      if (Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      ) < 3) return;
      drag.recorded = true;
      recordSnapshot();
    }

    if (drag.kind === "move") {
      const dx = ((event.clientX - drag.startClientX) / Math.max(1, drag.rect.width));
      const dy = ((event.clientY - drag.startClientY) / Math.max(1, drag.rect.height));
      let x = drag.baseX + dx;
      let y = drag.baseY + dy;
      let snapX = false;
      let snapY = false;
      if (!event.shiftKey) {
        const threshold = SNAP_DISTANCE / Math.max(1, drag.rect.width);
        const thresholdY = SNAP_DISTANCE / Math.max(1, drag.rect.height);
        const centerX = drag.isText ? 0.5 : 0;
        const centerY = drag.isText ? 0.5 : 0;
        if (Math.abs(x - centerX) < threshold) {
          x = centerX;
          snapX = true;
        }
        if (Math.abs(y - centerY) < thresholdY) {
          y = centerY;
          snapY = true;
        }
      }
      setSnapAxes((previous) =>
        previous.x === snapX && previous.y === snapY ? previous : { x: snapX, y: snapY },
      );
      if (drag.isText) {
        updateClip(drag.clipId, {
          text: { x: clamp(x, 0, 1), y: clamp(y, 0, 1) },
        }, false);
      } else {
        updateClip(drag.clipId, {
          x: clamp(x, -1, 1),
          y: clamp(y, -1, 1),
        }, false);
      }
      return;
    }

    if (drag.kind === "scale") {
      const distance = Math.hypot(
        event.clientX - drag.centerClientX,
        event.clientY - drag.centerClientY,
      );
      const ratio = distance / drag.startDistance;
      if (drag.isText) {
        updateClip(drag.clipId, {
          text: { size: Math.round(clamp(drag.startSize * ratio, 8, 300) * 10) / 10 },
        }, false);
      } else {
        updateClip(drag.clipId, {
          scale: clamp(drag.startScale * ratio, 0.05, 4),
        }, false);
      }
      return;
    }

    const angle = Math.atan2(
      event.clientY - drag.centerClientY,
      event.clientX - drag.centerClientX,
    ) * 180 / Math.PI;
    let delta = angle - drag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    drag.lastAngle = angle;
    drag.rotation += delta;
    const rotation = event.shiftKey ? Math.round(drag.rotation / 15) * 15 : drag.rotation;
    if (drag.isText) {
      updateClip(drag.clipId, { text: { rotation } }, false);
    } else {
      updateClip(drag.clipId, { rotation }, false);
    }
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setSnapAxes({ x: false, y: false });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setCursor("default");
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.pointerId === event.pointerId) updateDrag(drag, event);
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (selected) {
      const handle = hitHandle(selected.frame, rect, event.clientX, event.clientY);
      if (handle) {
        setCursor(cursorForHandle(selected.frame, handle.kind, handle.corner));
        setHoveredId(null);
        return;
      }
    }
    const hit = hitCandidate(rect, event.clientX, event.clientY);
    setHoveredId(hit?.clip.id ?? null);
    setCursor(hit ? "move" : "default");
  };

  const handlePointerLeave = () => {
    if (dragRef.current) return;
    setHoveredId(null);
    setCursor("default");
  };

  const selectedPoints = selected ? pointsOf(selected.frame) : null;
  const rotateHandle = selected && selectedPoints
    ? (() => {
      const edge = {
        x: (selectedPoints[0].x + selectedPoints[1].x) / 2,
        y: (selectedPoints[0].y + selectedPoints[1].y) / 2,
      };
      const center = {
        x: selected.frame.centerX * scaleX,
        y: selected.frame.centerY * scaleY,
      };
      const length = Math.hypot(edge.x - center.x, edge.y - center.y) || 1;
      return {
        x: edge.x + ((edge.x - center.x) / length) * ROTATE_OFFSET,
        y: edge.y + ((edge.y - center.y) / length) * ROTATE_OFFSET,
        edge,
      };
    })()
    : null;

  return (
    <svg
      ref={svgRef}
      className="absolute z-[6] touch-none select-none"
      style={{
        left: canvasBox.left,
        top: canvasBox.top,
        width: canvasBox.width,
        height: canvasBox.height,
        cursor,
      }}
      viewBox={`0 0 ${canvasBox.width} ${canvasBox.height}`}
      preserveAspectRatio="none"
      role="application"
      aria-label={t("Move and scale clips on the preview")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onPointerLeave={handlePointerLeave}
    >
      <rect width={canvasBox.width} height={canvasBox.height} fill="transparent" pointerEvents="all" />

      {snapAxes.x ? (
        <line
          x1={canvasBox.width / 2}
          y1={0}
          x2={canvasBox.width / 2}
          y2={canvasBox.height}
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="5 5"
          opacity={0.8}
          pointerEvents="none"
        />
      ) : null}
      {snapAxes.y ? (
        <line
          x1={0}
          y1={canvasBox.height / 2}
          x2={canvasBox.width}
          y2={canvasBox.height / 2}
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="5 5"
          opacity={0.8}
          pointerEvents="none"
        />
      ) : null}

      {hovered && !selected ? (
        <polygon
          points={polygonOf(hovered.frame)}
          fill="rgba(54, 200, 208, 0.06)"
          stroke="rgba(255, 255, 255, 0.55)"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      ) : null}

      {selected && selectedPoints && rotateHandle ? (
        <g pointerEvents="none">
          <polygon
            points={selectedPoints.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.5}
          />
          <line
            x1={rotateHandle.edge.x}
            y1={rotateHandle.edge.y}
            x2={rotateHandle.x}
            y2={rotateHandle.y}
            stroke={ACCENT}
            strokeWidth={1.5}
          />
          <circle
            cx={rotateHandle.x}
            cy={rotateHandle.y}
            r={5}
            fill={HANDLE_STROKE}
            stroke={ACCENT}
            strokeWidth={1.5}
          />
          {selectedPoints.map((point, index) => (
            <rect
              key={index}
              x={point.x - HANDLE_SIZE / 2}
              y={point.y - HANDLE_SIZE / 2}
              width={HANDLE_SIZE}
              height={HANDLE_SIZE}
              fill={ACCENT}
              stroke={HANDLE_STROKE}
              strokeWidth={1.5}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
