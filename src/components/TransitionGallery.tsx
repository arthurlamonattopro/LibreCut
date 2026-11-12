import { useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { TransitionPreview } from "./TransitionPreview";
import { TRANSITIONS, TRANSITION_GROUPS, type TransitionGroup } from "../lib/transitions";
import type { TransitionType } from "../lib/types";
import { useT } from "../lib/i18n";

type Edge = "in" | "out";
type Filter = "all" | TransitionGroup;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  ...TRANSITION_GROUPS.map((group) => ({ id: group.id as Filter, label: group.label })),
];

export interface TransitionGalleryProps {
  edge: Edge;
  onEdgeChange: (edge: Edge) => void;
  type: TransitionType;
  duration: number;
  maxDuration: number;
  /** True when the selected edge touches another clip. */
  onCut: boolean;
  cutLabel?: string;
  onSelect: (type: TransitionType) => void;
  onDuration: (duration: number) => void;
  onClear: () => void;
  onApplyToAll: () => void;
}

/**
 * The visual transition picker.
 *
 * Every card runs the real transition renderer on hover, using two synthetic
 * scenes. The cards are grouped by family, and the group chips keep a long
 * catalogue from turning into an endless list.
 */
export function TransitionGallery({
  edge,
  onEdgeChange,
  type,
  duration,
  maxDuration,
  onCut,
  cutLabel,
  onSelect,
  onDuration,
  onClear,
  onApplyToAll,
}: TransitionGalleryProps) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [hovered, setHovered] = useState<TransitionType | null>(null);
  const visible = filter === "all"
    ? TRANSITIONS
    : TRANSITIONS.filter((transition) => transition.group === filter);
  const groups = filter === "all"
    ? TRANSITION_GROUPS
    : TRANSITION_GROUPS.filter((group) => group.id === filter);
  const durationMax = Math.max(0.05, Math.min(5, maxDuration));
  // A stored duration can outlive a trim, so show the value the slider can
  // actually represent instead of a label that disagrees with its handle.
  const displayDuration = Math.min(duration, durationMax);
  const durationPresets = [0.15, 0.3, 0.5, 1].filter((value) => value <= durationMax);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg border border-line-soft bg-surface-2/50 p-1">
          {([
            ["in", "Into this clip", ArrowRight],
            ["out", "Out of this clip", ArrowLeft],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10.5px] font-medium transition ${
                edge === value ? "bg-raised text-ink shadow-sm" : "text-dim hover:text-ink"
              }`}
              aria-pressed={edge === value}
              onClick={() => onEdgeChange(value)}
            >
              <Icon size={12} aria-hidden="true" />
              {t(label)}
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-dim">
          {onCut
            ? t("This edge touches {clip}, so the transition plays across the cut.", {
                clip: cutLabel ?? t("the next clip"),
              })
            : t("No neighbouring clip touches this edge, so the transition fades the clip against the background.")}
        </p>
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[9.5px] font-medium transition ${
              filter === item.id
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-line bg-surface-2/60 text-dim hover:text-ink"
            }`}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {groups.map((group) => {
          const entries = visible.filter((transition) => transition.group === group.id);
          if (!entries.length) return null;
          return (
            <section key={group.id} aria-label={t(group.label)}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">{t(group.label)}</span>
                <span className="font-mono text-[8.5px] text-dim/80">{entries.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {entries.map((transition) => {
                  const selected = type === transition.type;
                  const playing = hovered === transition.type;
                  return (
                    <button
                      key={transition.type}
                      className={`group relative overflow-hidden rounded-lg border text-left transition ${
                        selected
                          ? "border-accent/70 shadow-[0_0_0_1px_#36c8d044]"
                          : "border-line hover:border-white/25"
                      }`}
                      aria-pressed={selected}
                      title={t("Preview {name}", { name: t(transition.label) })}
                      onClick={() => onSelect(transition.type)}
                      onMouseEnter={() => setHovered(transition.type)}
                      onMouseLeave={() => setHovered((current) => (current === transition.type ? null : current))}
                      onFocus={() => setHovered(transition.type)}
                      onBlur={() => setHovered((current) => (current === transition.type ? null : current))}
                    >
                      <div className="relative aspect-video overflow-hidden bg-surface-2">
                        <TransitionPreview type={transition.type} playing={playing} className="h-full w-full object-cover" />
                        <div className={`absolute inset-0 ring-1 ring-inset transition ${playing ? "ring-accent/60" : "ring-white/5"}`} />
                        {playing ? (
                          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[8px] font-medium text-accent backdrop-blur-sm">
                            <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent" /> {t("LIVE")}
                          </span>
                        ) : null}
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[8px] font-semibold text-[#071719]">
                            {t("IN USE")}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <span className={`truncate text-[10px] ${selected ? "text-ink" : "text-muted"}`}>{t(transition.label)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="space-y-2 rounded-lg border border-line-soft bg-surface-2/40 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">{t("Duration")}</span>
          <span className="font-mono text-[10px] text-ink">{displayDuration.toFixed(2)}s</span>
        </div>
        <input
          type="range"
          className="w-full"
          aria-label={t("Transition duration")}
          min={0.05}
          max={durationMax}
          step={0.05}
          value={displayDuration}
          aria-valuetext={t("{value} seconds", { value: displayDuration.toFixed(2) })}
          onChange={(event) => onDuration(Number(event.target.value))}
        />
        <div className="flex flex-wrap gap-1">
          {durationPresets.map((preset) => (
            <button
              key={preset}
              className={`rounded-md border px-2 py-1 font-mono text-[9px] transition ${
                Math.abs(displayDuration - preset) < 0.01
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line bg-surface-2/60 text-dim hover:text-ink"
              }`}
              onClick={() => onDuration(preset)}
            >
              {preset}s
            </button>
          ))}
          <button
            className="ml-auto flex items-center gap-1 rounded-md border border-line bg-surface-2/60 px-2 py-1 text-[9px] text-dim transition hover:border-error/40 hover:text-error"
            onClick={onClear}
            disabled={type === "none"}
          >
            <X size={10} /> {t("Clear")}
          </button>
        </div>
      </div>

      <button
        className="btn btn-secondary btn-sm w-full"
        onClick={onApplyToAll}
        disabled={type === "none"}
        title={t("Apply this transition to every touching cut on the track")}
      >
        <Sparkles size={12} /> {t("Apply to all cuts on this track")}
      </button>
    </div>
  );
}
