import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { SlidersHorizontal, Type } from "lucide-react";
import { Waveform } from "../../../components/Waveform";
import { useT } from "../../../lib/i18n";
import { normalizeSpeedRamp } from "../../../lib/speed";
import { formatDuration } from "../../../lib/time";
import type { Asset, Clip, Track } from "../../../lib/types";
import type { DragMode } from "./geometry";

export function TimelineClip({
  clip,
  track,
  asset,
  selected,
  focusable,
  zoom,
  height,
  dragging,
  onPointerDown,
  onKeyDown,
  onFocus,
}: {
  clip: Clip;
  track: Track;
  asset?: Asset;
  selected: boolean;
  /** Whether the clip is the tab stop of its track. */
  focusable: boolean;
  zoom: number;
  height: number;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent, mode: DragMode) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
}) {
  const width = Math.max(8, clip.duration * zoom);
  const left = clip.start * zoom;
  const t = useT();
  const isAudio = clip.kind === "audio" || (clip.kind === "video" && asset?.info.hasAudio);
  // A transition belongs to the cut, so the band sits on the edge the
  // transition plays on.
  const transitionIn = clip.transitionIn.type !== "none" ? clip.transitionIn.duration * zoom : 0;
  const transitionOut = clip.transitionOut.type !== "none" ? clip.transitionOut.duration * zoom : 0;
  const volumeFrames = clip.keyframes
    .filter((frame) => frame.property === "volume")
    .sort((a, b) => a.time - b.time);
  const automationPoints = volumeFrames.length >= 2
    ? volumeFrames
        .map((frame) => `${((frame.time / Math.max(0.001, clip.duration)) * 100).toFixed(2)},${(100 - Math.min(2, Math.max(0, frame.value)) * 50).toFixed(2)}`)
        .join(" ")
    : "";
  // The speed curve is drawn on the clip so a ramp is visible without opening
  // the inspector. The vertical axis is logarithmic, matching the ramp editor.
  const ramp = clip.speedRamp?.length ? normalizeSpeedRamp(clip.speedRamp, clip.duration) : [];
  const speedPoints = ramp.length >= 2
    ? ramp
        .map((point) => {
          const low = Math.log(0.25);
          const high = Math.log(4);
          const ratio = (Math.log(Math.min(4, Math.max(0.25, point.speed))) - low) / (high - low);
          return `${((point.time / Math.max(0.001, clip.duration)) * 100).toFixed(2)},${(100 - ratio * 88 - 6).toFixed(2)}`;
        })
        .join(" ")
    : "";
  const speedRange = ramp.length >= 2
    ? `${Math.min(...ramp.map((point) => point.speed)).toFixed(2)}–${Math.max(...ramp.map((point) => point.speed)).toFixed(2)}×`
    : "";
  const label = clip.kind === "text" ? clip.text?.text || clip.name : clip.name;

  return (
    <div
      data-clip
      data-clip-id={clip.id}
      role="option"
      aria-selected={selected}
      aria-label={t("{label}, {kind} clip, starts at {start}, lasts {duration} seconds, on {track}", {
        label,
        kind: t(clip.kind),
        start: formatDuration(clip.start),
        duration: clip.duration.toFixed(1),
        track: track.name,
      })}
      tabIndex={focusable ? 0 : -1}
      className={`group absolute top-1.5 overflow-hidden rounded-md border text-left transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        selected
          ? "z-10 border-accent shadow-[0_0_0_1px_#36c8d066,0_6px_18px_-8px_#000]"
          : "border-white/10 hover:border-white/25"
      } ${track.locked ? "cursor-default" : dragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        left,
        width,
        height: height - 12,
        background:
          clip.kind === "text"
            ? "linear-gradient(135deg, #273149, #1a2234)"
            : clip.kind === "misc"
              ? "linear-gradient(135deg, #3c3320, #282319)"
            : clip.kind === "audio"
              ? "linear-gradient(135deg, #173a2e, #122a23)"
              : "linear-gradient(135deg, #2b2522, #201b18)",
      }}
      onPointerDown={(event) => onPointerDown(event, "move")}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {clip.kind === "video" && asset?.thumbnails.length ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          aria-hidden="true"
          style={{
            backgroundImage: `linear-gradient(90deg, #00000055, #00000022), url(${asset.thumbnails[0]})`,
            backgroundSize: "auto 100%, auto 140%",
            backgroundPosition: "left center, left center",
            backgroundRepeat: "no-repeat, repeat-x",
          }}
        />
      ) : null}
      {clip.kind === "video" ? <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" aria-hidden="true" /> : null}
      {transitionIn > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-accent/55 to-transparent"
          style={{ width: Math.min(transitionIn, width) }}
          aria-hidden="true"
        />
      ) : null}
      {transitionOut > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-accent/55 to-transparent"
          style={{ width: Math.min(transitionOut, width) }}
          aria-hidden="true"
        />
      ) : null}
      {isAudio && asset?.waveform.length ? (
        <div className="pointer-events-none absolute inset-x-1 bottom-1 top-4 opacity-80" aria-hidden="true">
          <Waveform peaks={asset.waveform} height={height - 30} color={clip.kind === "audio" ? "#5be7a9" : "#ff9b7e"} />
        </div>
      ) : null}

      <div className="pointer-events-none relative flex h-full flex-col justify-between px-1.5 py-1" aria-hidden="true">
        <div className="flex items-center gap-1 overflow-hidden">
          {clip.kind === "text" ? <Type size={9} className="shrink-0 text-blue" /> : clip.kind === "misc" ? <SlidersHorizontal size={9} className="shrink-0 text-amber" /> : null}
          <span className="truncate text-[9.5px] font-semibold leading-tight text-white/90">
            {label}
          </span>
        </div>
        {width > 56 ? (
          <div className="flex items-center justify-between gap-1">
            <span className="truncate font-mono text-[8px] text-white/45">{clip.duration.toFixed(1)}s</span>
            {speedRange ? <span className="truncate font-mono text-[7.5px] text-amber/90">{speedRange}</span> : null}
            {asset?.proxyStatus === "ready" ? <span className="text-[7.5px] uppercase tracking-wide text-mint/70">{t("proxy")}</span> : null}
          </div>
        ) : null}
      </div>

      {speedPoints ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={speedPoints} fill="none" stroke="rgba(240,190,98,0.9)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}

      {automationPoints ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={automationPoints} fill="none" stroke="rgba(105,217,162,0.85)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}

      {clip.keyframes.length ? clip.keyframes.map((frame, index) => (
        <span
          key={`${frame.property}-${frame.time}-${index}`}
          className="pointer-events-none absolute top-1 h-1.5 w-1.5 rotate-45 bg-accent shadow-[0_0_4px_rgba(54,200,160,0.8)]"
          aria-hidden="true"
          style={{ left: Math.min(width - 6, Math.max(0, frame.time * zoom - 3)) }}
          title={t("{property} keyframe at {time}s", {
            property: t(frame.property[0].toUpperCase() + frame.property.slice(1)),
            time: frame.time.toFixed(2),
          })}
        />
      )) : null}

      {/* The trim handles are pointer affordances. The keyboard trims the
          focused clip instead, so they stay out of the focus order. */}
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 top-0 z-10 w-[7px] cursor-ew-resize transition-colors ${
          selected ? "bg-accent/70 hover:bg-accent" : "bg-transparent hover:bg-accent/50"
        }`}
        onPointerDown={(event) => onPointerDown(event, "trim-start")}
      />
      <span
        aria-hidden="true"
        className={`absolute bottom-0 right-0 top-0 z-10 w-[7px] cursor-ew-resize transition-colors ${
          selected ? "bg-accent/70 hover:bg-accent" : "bg-transparent hover:bg-accent/50"
        }`}
        onPointerDown={(event) => onPointerDown(event, "trim-end")}
      />
    </div>
  );
}
