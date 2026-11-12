import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MAX_SPEED, MIN_SPEED, clampSpeed, normalizeSpeedRamp } from "../lib/speed";
import type { SpeedPoint } from "../lib/types";
import { useT } from "../lib/i18n";

const GRAPH_HEIGHT = 134;
const PADDING = { top: 10, right: 10, bottom: 18, left: 30 };
const SPEED_TICKS = [0.25, 0.5, 1, 2, 4];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Log scale keeps the slow end of the ramp as readable as the fast end. */
function speedToRatio(speed: number): number {
  const low = Math.log(MIN_SPEED);
  const high = Math.log(MAX_SPEED);
  return (Math.log(clampSpeed(speed)) - low) / (high - low);
}

function ratioToSpeed(ratio: number): number {
  const low = Math.log(MIN_SPEED);
  const high = Math.log(MAX_SPEED);
  return Math.exp(low + clamp(ratio, 0, 1) * (high - low));
}

function rampPoints(points: SpeedPoint[] | undefined, duration: number, baseSpeed: number): SpeedPoint[] {
  if (points && points.length >= 2) return normalizeSpeedRamp(points, duration);
  return [
    { time: 0, speed: baseSpeed },
    { time: Math.max(0.1, duration), speed: baseSpeed },
  ];
}

function Sparkline({ points, duration, active }: { points: SpeedPoint[]; duration: number; active: boolean }) {
  const safeDuration = Math.max(0.1, duration);
  const path = points
    .map((point, index) => {
      const x = (point.time / safeDuration) * 46;
      const y = 20 - speedToRatio(point.speed) * 18;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 48 24" className="h-5 w-12 shrink-0" aria-hidden="true">
      <path d={`${path} L 46 22 L 0 22 Z`} fill={active ? "#36c8d033" : "#ffffff0d"} />
      <path d={path} fill="none" stroke={active ? "#36c8d0" : "#85898f"} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export interface SpeedRampGraphProps {
  /** Clip-local duration in seconds. */
  duration: number;
  /** The stored ramp, or undefined when the clip plays at a constant speed. */
  points?: SpeedPoint[];
  /** The constant speed used when no ramp is stored. */
  baseSpeed: number;
  /** Clip-local playhead position, in seconds. */
  playhead?: number;
  /** True when the stored ramp is active. */
  active: boolean;
  onChange: (points: SpeedPoint[]) => void;
  /** Called once when a drag starts, so an undo step is recorded. */
  onRecord: () => void;
}

/**
 * The visual speed-ramp editor.
 *
 * Points are dragged directly on the graph. The vertical axis is logarithmic,
 * so 0.5x and 2x sit the same distance from 1x. Clicking empty space adds a
 * point, double-clicking or right-clicking a point removes it.
 */
export function SpeedRampGraph({
  duration,
  points,
  baseSpeed,
  playhead,
  active,
  onChange,
  onRecord,
}: SpeedRampGraphProps) {
  const t = useT();
  const safeDuration = Math.max(0.1, duration);
  const display = useMemo(() => rampPoints(points, safeDuration, baseSpeed), [points, safeDuration, baseSpeed]);
  const displayRef = useRef(display);
  displayRef.current = display;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(240);
  const gradientId = `ramp-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  // Pointer geometry is measured against the SVG, not the container: the
  // container also holds the hint footer, which would squash the y axis.
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<number | null>(null);
  const recordedRef = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(160, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chartWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const chartHeight = GRAPH_HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (time: number) => PADDING.left + (time / safeDuration) * chartWidth;
  const yFor = (speed: number) => PADDING.top + (1 - speedToRatio(speed)) * chartHeight;
  const timeFor = (x: number) => clamp((x - PADDING.left) / chartWidth, 0, 1) * safeDuration;
  const speedFor = (y: number) => ratioToSpeed(1 - (y - PADDING.top) / chartHeight);

  /** Applies a point move that keeps the curve ordered and the edges pinned. */
  const movePoint = (index: number, x: number, y: number) => {
    const current = displayRef.current;
    if (!current[index]) return;
    const isEdge = index === 0 || index === current.length - 1;
    const previous = current[index - 1];
    const next = current[index + 1];
    const minTime = previous ? previous.time + 0.03 : 0;
    const maxTime = next ? next.time - 0.03 : safeDuration;
    const time = isEdge
      ? index === 0 ? 0 : safeDuration
      : clamp(timeFor(x), minTime, maxTime);
    const speed = speedFor(y);
    const updated = current.map((point, pointIndex) => (pointIndex === index ? { time, speed } : point));
    onChangeRef.current(updated);
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const index = draggingRef.current;
      const element = svgRef.current;
      if (index === null || !element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (!recordedRef.current) {
        recordedRef.current = true;
        onRecordRef.current();
      }
      const x = (event.clientX - rect.left) * (width / rect.width);
      const y = (event.clientY - rect.top) * (GRAPH_HEIGHT / rect.height);
      movePoint(index, x, y);
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // `movePoint` reads the live points from a ref, so only the geometry
    // needs to be part of the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, safeDuration]);

  const beginDrag = (index: number, event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // preventDefault keeps the drag from selecting text, but it also blocks
    // the implicit focus, so focus the handle explicitly for keyboard users.
    event.currentTarget.focus();
    setSelected(index);
    recordedRef.current = false;
    draggingRef.current = index;
  };

  const addPoint = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    const element = svgRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) * (width / rect.width);
    const y = (event.clientY - rect.top) * (GRAPH_HEIGHT / rect.height);
    const time = timeFor(x);
    const speed = speedFor(y);
    if (time <= 0.03 || time >= safeDuration - 0.03) return;
    const current = displayRef.current;
    if (current.some((point) => Math.abs(point.time - time) < 0.05)) return;
    onRecord();
    const next = [...current, { time, speed }].sort((a, b) => a.time - b.time);
    setSelected(next.findIndex((point) => point.time === time));
    onChange(next);
  };

  const removePoint = (index: number) => {
    const current = displayRef.current;
    if (index <= 0 || index >= current.length - 1) return;
    onRecord();
    const next = current.filter((_, pointIndex) => pointIndex !== index);
    setSelected(null);
    onChange(next);
  };

  const nudgePoint = (index: number, event: ReactKeyboardEvent<SVGCircleElement>) => {
    const current = displayRef.current;
    const point = current[index];
    if (!point) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removePoint(index);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const isEdge = index === 0 || index === current.length - 1;
    // The edges pin the ramp to the clip start and end, so time nudges do
    // nothing there. Avoid recording an undo step for a no-op.
    if (isEdge && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    const speedStep = event.shiftKey ? 0.25 : 0.05;
    const previous = current[index - 1];
    const next = current[index + 1];
    const updated = current.map((item, pointIndex) => {
      if (pointIndex !== index) return item;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const minimum = previous ? previous.time + 0.03 : 0;
        const maximum = next ? next.time - 0.03 : safeDuration;
        return { ...item, time: clamp(item.time + direction * step, minimum, maximum) };
      }
      const direction = event.key === "ArrowUp" ? 1 : -1;
      return { ...item, speed: clampSpeed(item.speed + direction * speedStep) };
    });
    const changed = updated.some((item, pointIndex) =>
      item.time !== current[pointIndex].time || item.speed !== current[pointIndex].speed,
    );
    if (!changed) return;
    onRecord();
    onChange(updated);
  };

  const curve = display.map((point) => `${xFor(point.time).toFixed(2)},${yFor(point.speed).toFixed(2)}`).join(" ");
  const area = `${PADDING.left},${PADDING.top + chartHeight} ${curve} ${xFor(safeDuration).toFixed(2)},${PADDING.top + chartHeight}`;
  const playheadRatio = playhead === undefined ? null : clamp(playhead / safeDuration, 0, 1);
  const activeSpeed = playhead === undefined
    ? null
    : (() => {
        const current = displayRef.current;
        for (let index = 0; index < current.length - 1; index += 1) {
          const from = current[index];
          const to = current[index + 1];
          if (playhead <= to.time) {
            const ratio = (playhead - from.time) / Math.max(0.0001, to.time - from.time);
            return from.speed + (to.speed - from.speed) * ratio;
          }
        }
        return current[current.length - 1]?.speed ?? baseSpeed;
      })();

  return (
    <div ref={containerRef} className="relative select-none rounded-lg border border-line-soft bg-[#0d0e11]">
      <svg
        ref={svgRef}
        width={width}
        height={GRAPH_HEIGHT}
        role="group"
        aria-label={t("Speed ramp graph. Drag points to change time and speed.")}
        className="block"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#36c8d0" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#36c8d0" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={chartWidth}
          height={chartHeight}
          fill="transparent"
          pointerEvents="all"
          className="cursor-crosshair"
          onPointerDown={addPoint}
        >
          <title>{t("Click to add a speed point")}</title>
        </rect>

        {SPEED_TICKS.map((speed) => {
          const y = yFor(speed);
          const isBase = Math.abs(speed - 1) < 0.001;
          return (
            <g key={speed} aria-hidden="true">
              <line
                x1={PADDING.left}
                x2={PADDING.left + chartWidth}
                y1={y}
                y2={y}
                stroke={isBase ? "#ffffff1f" : "#ffffff0b"}
                strokeDasharray={isBase ? undefined : "2 3"}
              />
              <text x={PADDING.left - 5} y={y + 3} textAnchor="end" fill={isBase ? "#a5a9b1" : "#5f646c"} fontSize="8" fontFamily="Cascadia Code, Consolas, monospace">
                {speed}×
              </text>
            </g>
          );
        })}

        {[0, 0.5, 1].map((ratio) => (
          <text
            key={ratio}
            x={PADDING.left + chartWidth * ratio}
            y={GRAPH_HEIGHT - 5}
            textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}
            fill="#5f646c"
            fontSize="8"
            fontFamily="Cascadia Code, Consolas, monospace"
            aria-hidden="true"
          >
            {(safeDuration * ratio).toFixed(1)}s
          </text>
        ))}

        <polygon points={area} fill={`url(#${gradientId})`} pointerEvents="none" aria-hidden="true" />
        <polyline
          points={curve}
          fill="none"
          stroke={active ? "#36c8d0" : "#85898f"}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          aria-hidden="true"
        />

        {playheadRatio !== null ? (
          <g pointerEvents="none" aria-hidden="true">
            <line
              x1={PADDING.left + chartWidth * playheadRatio}
              x2={PADDING.left + chartWidth * playheadRatio}
              y1={PADDING.top}
              y2={PADDING.top + chartHeight}
              stroke="#f5f6f7"
              strokeOpacity="0.55"
              strokeDasharray="3 3"
            />
            {activeSpeed !== null ? (
              <circle
                cx={PADDING.left + chartWidth * playheadRatio}
                cy={yFor(activeSpeed)}
                r="3"
                fill="#f5f6f7"
                stroke="#0d0e11"
                strokeWidth="1.5"
              />
            ) : null}
          </g>
        ) : null}

        {display.map((point, index) => {
          const isEdge = index === 0 || index === display.length - 1;
          const isSelected = selected === index;
          return (
            <g key={`${index}-${point.time}`}>
              <circle
                cx={xFor(point.time)}
                cy={yFor(point.speed)}
                r={isSelected ? 7 : 5}
                fill={isSelected ? "#36c8d0" : "#15171b"}
                stroke={isSelected ? "#e8ffff" : "#36c8d0"}
                strokeWidth="2"
                className="cursor-grab focus-visible:outline-none"
                tabIndex={0}
                role="slider"
                aria-label={t("{edge} at {time} seconds", {
                  edge: isEdge ? t(index === 0 ? "Start" : "End") : t("Ramp point"),
                  time: point.time.toFixed(2),
                })}
                aria-valuemin={MIN_SPEED}
                aria-valuemax={MAX_SPEED}
                aria-valuenow={Number(point.speed.toFixed(2))}
                aria-valuetext={t("{speed} times speed at {time} seconds", {
                  speed: point.speed.toFixed(2),
                  time: point.time.toFixed(2),
                })}
                onPointerDown={(event) => beginDrag(index, event)}
                onFocus={() => setSelected(index)}
                onDoubleClick={() => removePoint(index)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  removePoint(index);
                }}
                onKeyDown={(event) => nudgePoint(index, event)}
              >
                <title>{isEdge ? t("Drag to change the speed at this edge") : t("Drag to move, double-click to remove")}</title>
              </circle>
            </g>
          );
        })}

        {selected !== null && display[selected] ? (
          <g pointerEvents="none" aria-hidden="true">
            <rect
              x={clamp(xFor(display[selected].time) - 30, PADDING.left, width - 66)}
              y={clamp(yFor(display[selected].speed) - 26, PADDING.top, GRAPH_HEIGHT - 24)}
              width="60"
              height="18"
              rx="4"
              fill="#0b0c0e"
              stroke="#343840"
            />
            <text
              x={clamp(xFor(display[selected].time) - 30, PADDING.left, width - 66) + 30}
              y={clamp(yFor(display[selected].speed) - 26, PADDING.top, GRAPH_HEIGHT - 24) + 12}
              textAnchor="middle"
              fill="#d8dadd"
              fontSize="8.5"
              fontFamily="Cascadia Code, Consolas, monospace"
            >
              {display[selected].time.toFixed(2)}s · {display[selected].speed.toFixed(2)}×
            </text>
          </g>
        ) : null}
      </svg>
      <div className="flex items-center justify-between border-t border-line-soft/70 px-2 py-1 text-[9px] text-dim">
        <span>{t("Click to add · drag to shape · double-click to remove")}</span>
        <span className="font-mono">{active ? `${Math.round(display[0].speed * 100)}% → ${Math.round(display[display.length - 1].speed * 100)}%` : t("Constant")}</span>
      </div>
    </div>
  );
}

/** A small read-only curve, used by the preset cards. */
export function SpeedRampPreset({ points, duration, active, label, onClick }: { points: SpeedPoint[]; duration: number; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
        active ? "border-accent/50 bg-accent-soft" : "border-line bg-surface-2/50 hover:border-line hover:bg-panel-2"
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      <Sparkline points={points} duration={duration} active={active} />
      <span className="min-w-0 truncate text-[10px] text-muted">{label}</span>
    </button>
  );
}
