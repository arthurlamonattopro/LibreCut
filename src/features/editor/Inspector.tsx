import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Film,
  Music2,
  AudioLines,
  SlidersHorizontal,
  Scissors,
  Trash2,
  Type,
} from "lucide-react";
import { Slider } from "../../components/Slider";
import {
  assetForClip,
  selectedClip,
  selectedTrackOfClip,
  useEditor,
  type ClipPatch,
} from "../../stores/editor";
import { clamp, formatClock, formatDuration, projectDuration } from "../../lib/time";
import { MAX_SPEED, MIN_SPEED, normalizeSpeedRamp, speedAt } from "../../lib/speed";
import type { Clip, KeyframeProperty, SpeedPoint, Track, TransitionType } from "../../lib/types";
import { DEFAULT_COMPRESSOR, DEFAULT_DUCKING } from "../../lib/audio";
import { parseCubeLut, lutSettingsFromCube } from "../../lib/lut";

function sectionTitle(title: string) {
  return <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">{title}</div>;
}

const QUICK_EFFECTS = [
  { name: "Original", values: { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, blur: 0 } },
  { name: "Black & white", values: { brightness: 0, contrast: 1.05, saturation: 0, hue: 0, sepia: 0, blur: 0 } },
  { name: "Warm", values: { brightness: 0.03, contrast: 1.05, saturation: 1.15, hue: -8, sepia: 0.12, blur: 0 } },
  { name: "Cool", values: { brightness: 0.02, contrast: 1.08, saturation: 0.92, hue: 14, sepia: 0, blur: 0 } },
  { name: "Vintage", values: { brightness: -0.04, contrast: 0.92, saturation: 0.78, hue: -5, sepia: 0.42, blur: 0.25 } },
  { name: "Dream", values: { brightness: 0.08, contrast: 0.9, saturation: 1.1, hue: 0, sepia: 0.08, blur: 1.2 } },
  { name: "High contrast", values: { brightness: 0, contrast: 1.45, saturation: 1.08, hue: 0, sepia: 0, blur: 0 } },
];

function NumberField({
  label,
  value,
  onCommit,
  min = 0,
  max = 100000,
  step = 0.1,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(2));
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setDraft(next.toFixed(2));
    onCommit(next);
  };

  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="relative">
        <input
          className="field pr-8 font-mono text-[12px]"
          value={draft}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              (event.target as HTMLInputElement).blur();
            }
            if (event.key === "Escape") {
              setDraft(value.toFixed(2));
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        {suffix ? <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-dim">{suffix}</span> : null}
      </div>
    </label>
  );
}

function RangeNumber({ label, value, min, max, step, suffix, displayScale = 1, onChange, onRecord }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string;
  displayScale?: number;
  onChange: (value: number) => void; onRecord: () => void;
}) {
  const [draft, setDraft] = useState((value * displayScale).toFixed(2));
  useEffect(() => setDraft((value * displayScale).toFixed(2)), [value, displayScale]);
  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) { setDraft((value * displayScale).toFixed(2)); return; }
    const next = Math.min(max, Math.max(min, parsed / displayScale));
    setDraft((next * displayScale).toFixed(2));
    onChange(next);
  };
  return <div>
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div className="relative w-[76px] shrink-0">
        <input aria-label={label} type="number" className="field h-7 py-0 pr-6 text-right font-mono text-[11px]" value={draft} min={min * displayScale} max={max * displayScale} step={step * displayScale}
          onFocus={onRecord} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") { commit(); (event.target as HTMLInputElement).blur(); } if (event.key === "Escape") { setDraft((value * displayScale).toFixed(2)); (event.target as HTMLInputElement).blur(); } }} />
        {suffix ? <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-dim">{suffix}</span> : null}
      </div>
    </div>
    <input aria-label={`${label} slider`} type="range" className="w-full" value={value} min={min} max={max} step={step}
      onPointerDown={onRecord} onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

function SpeedRampEditor({
  clip,
  playhead,
  onUpdate,
  onRecord,
}: {
  clip: Clip;
  playhead: number;
  onUpdate: (patch: ClipPatch, record?: boolean) => void;
  onRecord: () => void;
}) {
  const ramp = normalizeSpeedRamp(clip.speedRamp, clip.duration);
  const active = Boolean(clip.speedRamp?.length) && ramp.length >= 2;
  const local = clamp(playhead - clip.start, 0, clip.duration);
  const apply = (points: SpeedPoint[], record = true) => {
    if (record) onRecord();
    onUpdate({ speedRamp: normalizeSpeedRamp(points, clip.duration) }, false);
  };
  const presets: Array<[string, SpeedPoint[]]> = [
    ["Ramp up", [{ time: 0, speed: 0.5 }, { time: clip.duration, speed: 2 }]],
    ["Ramp down", [{ time: 0, speed: 2 }, { time: clip.duration, speed: 0.5 }]],
    ["Bullet time", [{ time: 0, speed: 1 }, { time: clip.duration / 2, speed: 0.3 }, { time: clip.duration, speed: 1 }]],
    ["Whip", [{ time: 0, speed: 0.6 }, { time: clip.duration / 2, speed: 3 }, { time: clip.duration, speed: 1 }]],
  ];

  return (
    <div className="space-y-2 rounded-lg border border-line-soft bg-surface-2/35 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">Speed ramp</span>
        {active ? (
          <button className="text-[10px] text-dim transition hover:text-ink" onClick={() => apply([])}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map(([label, points]) => (
          <button key={label} className="btn btn-ghost btn-sm px-2 text-[10px]" onClick={() => apply(points)}>
            {label}
          </button>
        ))}
      </div>
      {active ? (
        <div className="space-y-1">
          {ramp.map((point, index) => {
            const edge = index === 0 || index === ramp.length - 1;
            return (
              <div key={`${index}-${point.time}`} className="flex items-center gap-1.5">
                <span className="w-8 shrink-0 text-[9.5px] text-dim">{edge ? (index === 0 ? "Start" : "End") : "Key"}</span>
                <input
                  aria-label="Ramp point time"
                  className="field h-7 min-w-0 flex-1 px-1.5 text-right font-mono text-[10px]"
                  type="number"
                  min={0}
                  max={clip.duration}
                  step={0.05}
                  value={Number(point.time.toFixed(2))}
                  disabled={edge}
                  onFocus={onRecord}
                  onChange={(event) => {
                    const time = clamp(Number(event.target.value), 0, clip.duration);
                    const points = ramp.map((item, itemIndex) => (itemIndex === index ? { ...item, time } : item));
                    apply(points, false);
                  }}
                />
                <span className="text-[9px] text-dim">s</span>
                <input
                  aria-label="Ramp point speed"
                  className="field h-7 w-16 px-1.5 text-right font-mono text-[10px]"
                  type="number"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step={0.05}
                  value={Number(point.speed.toFixed(2))}
                  onFocus={onRecord}
                  onChange={(event) => {
                    const speed = clamp(Number(event.target.value), MIN_SPEED, MAX_SPEED);
                    const points = ramp.map((item, itemIndex) => (itemIndex === index ? { ...item, speed } : item));
                    apply(points, false);
                  }}
                />
                <span className="w-7 text-[9px] text-dim">×</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[10px] leading-relaxed text-dim">Pick a preset or add a point at the playhead to ease the clip from one speed to another.</p>
      )}
      <button
        className="btn btn-secondary btn-sm w-full"
        onClick={() => {
          const base = active ? ramp : [
            { time: 0, speed: clip.speed },
            { time: clip.duration, speed: clip.speed },
          ];
          const points = base.filter((point) => Math.abs(point.time - local) > 0.02);
          points.push({ time: local, speed: speedAt(base, clip.duration, local) });
          apply(points);
        }}
      >
        Add point at playhead
      </button>
    </div>
  );
}

export function Inspector({ width = 280 }: { width?: number }) {
  const project = useEditor((state) => state.project);
  const clip = useEditor(selectedClip);
  const track = useEditor(selectedTrackOfClip);
  const updateClip = useEditor((state) => state.updateClip);
  const updateTrack = useEditor((state) => state.updateTrack);
  const recordSnapshot = useEditor((state) => state.recordSnapshot);
  const duplicateClip = useEditor((state) => state.duplicateClip);
  const deleteSelected = useEditor((state) => state.deleteSelected);
  const splitAtPlayhead = useEditor((state) => state.splitAtPlayhead);
  const extractAudio = useEditor((state) => state.extractAudio);
  const currentTime = useEditor((state) => state.currentTime);

  if (!project) return null;

  const total = projectDuration(project.tracks, 0);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-l border-line-soft bg-panel">
      <div className="flex h-11 shrink-0 items-center border-b border-line-soft px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
        Inspector
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {clip && track ? (
          <ClipInspector
            clip={clip}
            track={track}
            trackName={track.name}
            onUpdate={(patch, record) => updateClip(clip.id, patch, record)}
            onUpdateTrack={(patch, record) => updateTrack(track.id, patch, record)}
            onRecord={recordSnapshot}
            onDuplicate={() => duplicateClip(clip.id)}
            onDelete={deleteSelected}
            onSplit={splitAtPlayhead}
            onExtractAudio={() => extractAudio(clip.id)}
            playhead={currentTime}
          />
        ) : (
          <ProjectInspector
            name={project.name}
            width={project.width}
            height={project.height}
            fps={project.fps}
            duration={total}
            assetCount={project.assets.length}
            trackCount={project.tracks.length}
            clipCount={project.tracks.reduce((sum, item) => sum + item.clips.length, 0)}
          />
        )}
      </div>
    </aside>
  );
}

function ClipInspector({
  clip,
  track,
  trackName,
  onUpdate,
  onUpdateTrack,
  onRecord,
  onDuplicate,
  onDelete,
  onSplit,
  onExtractAudio,
  playhead,
}: {
  clip: Clip;
  track: Track;
  trackName: string;
  onUpdate: (patch: ClipPatch, record?: boolean) => void;
  onUpdateTrack: (patch: Partial<Track>, record?: boolean) => void;
  onRecord: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSplit: () => void;
  onExtractAudio: () => void;
  playhead: number;
}) {
  const [activeTab, setActiveTab] = useState<"Video" | "Masks" | "Audio">("Video");
  const [lutError, setLutError] = useState("");
  const [keyframeProperty, setKeyframeProperty] = useState<KeyframeProperty>(clip.kind === "audio" ? "volume" : "opacity");
  useEffect(() => setActiveTab(clip.kind === "audio" ? "Audio" : "Video"), [clip.id, clip.kind]);
  useEffect(() => setKeyframeProperty(clip.kind === "audio" ? "volume" : "opacity"), [clip.id, clip.kind]);
  const project = useEditor((state) => state.project);
  const asset = project ? assetForClip(project, clip) : undefined;
  const Icon = clip.kind === "text" ? Type : clip.kind === "audio" ? Music2 : clip.kind === "misc" ? SlidersHorizontal : Film;
  const canSplit = playhead > clip.start + 0.05 && playhead < clip.start + clip.duration - 0.05;

  const applyVolumeAutomation = (from: number, to: number, edge: 0 | 1) => {
    const length = Math.min(1, clip.duration / 2);
    const frames = clip.keyframes.filter((frame) => frame.property !== "volume");
    frames.push(
      { property: "volume", time: edge === 0 ? 0 : clip.duration - length, value: from },
      { property: "volume", time: edge === 0 ? length : clip.duration, value: to },
    );
    onRecord();
    onUpdate({ keyframes: frames.sort((a, b) => a.time - b.time) });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-accent">
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{clip.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-dim">
            <span>{trackName}</span>
            <span>·</span>
            <span className="capitalize">{clip.kind}</span>
            {asset?.proxyStatus === "ready" ? (
              <>
                <span>·</span>
                <span className="text-mint">proxy</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Start"
          value={clip.start}
          min={0}
          step={1 / 30}
          suffix="s"
          onCommit={(value) => onUpdate({ start: value })}
        />
        <NumberField
          label="Duration"
          value={clip.duration}
          min={0.1}
          step={1 / 30}
          suffix="s"
          onCommit={(value) => onUpdate({ duration: value })}
        />
      </div>

      {clip.kind !== "misc" ? <RangeNumber label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} suffix="×" onRecord={onRecord} onChange={(value) => onUpdate({ speed: value }, false)} /> : null}

      {clip.kind !== "misc" ? <SpeedRampEditor clip={clip} playhead={playhead} onUpdate={onUpdate} onRecord={onRecord} /> : null}

      {clip.kind !== "misc" ? (
        <>
          <div className="divider" />
          {sectionTitle("Transitions")}
          <div className="grid grid-cols-2 gap-3">
            {(["transitionIn", "transitionOut"] as const).map((edge) => (
              <label key={edge} className="block">
                <span className="label">{edge === "transitionIn" ? "In" : "Out"}</span>
                <select className="field" value={clip[edge].type} onChange={(event) => onUpdate({ [edge]: { ...clip[edge], type: event.target.value as TransitionType } })}>
                  <option value="none">None</option><option value="fade">Fade</option><option value="wipe">Wipe</option>
                </select>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="In duration" value={clip.transitionIn.duration} min={0.05} max={Math.min(5, clip.duration)} step={0.05} suffix="s" onCommit={(value) => onUpdate({ transitionIn: { ...clip.transitionIn, duration: value } })} />
            <NumberField label="Out duration" value={clip.transitionOut.duration} min={0.05} max={Math.min(5, clip.duration)} step={0.05} suffix="s" onCommit={(value) => onUpdate({ transitionOut: { ...clip.transitionOut, duration: value } })} />
          </div>
          <div className="divider" />
          {sectionTitle("Keyframes & animation")}
          <div className="flex gap-2">
            <select className="field min-w-0 flex-1" value={keyframeProperty} onChange={(event) => setKeyframeProperty(event.target.value as KeyframeProperty)} aria-label="Animated property">
              {(clip.kind === "video" ? ["x", "y", "scale", "rotation", "opacity", "volume"] : clip.kind === "text" ? ["x", "y", "rotation", "opacity"] : ["opacity", "volume"]).map((property) => <option key={property} value={property}>{property[0].toUpperCase() + property.slice(1)}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm shrink-0" onClick={() => {
              const localTime = Math.max(0, Math.min(clip.duration, playhead - clip.start));
              const base = clip.kind === "text" && clip.text && (keyframeProperty === "x" || keyframeProperty === "y" || keyframeProperty === "rotation") ? clip.text[keyframeProperty] : clip[keyframeProperty];
              const frames = clip.keyframes.filter((frame) => !(frame.property === keyframeProperty && Math.abs(frame.time - localTime) < 1 / 30));
              frames.push({ property: keyframeProperty, time: localTime, value: base });
              onRecord();
              onUpdate({ keyframes: frames.sort((a, b) => a.time - b.time) });
            }}>Add key</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ["Fade in", "opacity", 0, 1, 0],
              ["Zoom in", "scale", 0.7, 1, 0],
              ["Slide in", "x", -0.5, 0, 0],
              ["Fade out", "opacity", 1, 0, 1],
            ] as const).filter(([, property]) => property === "opacity" || clip.kind === "video" || (clip.kind === "text" && property === "x")).map(([label, property, from, to, out]) => (
              <button key={label} className="btn btn-ghost btn-sm" onClick={() => {
                const length = Math.min(0.6, clip.duration / 2);
                const firstTime = out ? Math.max(0, clip.duration - length) : 0;
                const lastTime = out ? clip.duration : length;
                const frames = clip.keyframes.filter((frame) => frame.property !== property);
                frames.push({ property, time: firstTime, value: from }, { property, time: lastTime, value: to });
                onRecord();
                onUpdate({ keyframes: frames.sort((a, b) => a.time - b.time) });
              }}>{label}</button>
            ))}
          </div>
          {clip.keyframes.length ? <div className="space-y-1.5">
            {clip.keyframes.slice().sort((a, b) => a.time - b.time).map((frame, index) => (
              <div key={`${frame.property}-${frame.time}-${index}`} className="flex items-center gap-2 rounded-md border border-line-soft bg-surface-2/40 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{frame.property} · {frame.time.toFixed(2)}s</span>
                <input aria-label={`${frame.property} keyframe value`} className="field h-7 w-[72px] px-1.5 text-right font-mono text-[10px]" type="number" step="0.01" value={frame.value} onFocus={onRecord} onChange={(event) => {
                  const value = Number(event.target.value);
                  onUpdate({ keyframes: clip.keyframes.map((item) => item.property === frame.property && item.time === frame.time ? { ...item, value } : item) }, false);
                }} />
                <button className="text-dim hover:text-error" aria-label="Remove keyframe" onClick={() => onUpdate({ keyframes: clip.keyframes.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
              </div>
            ))}
          </div> : <p className="text-[10px] text-dim">Add a key at the playhead, then change the property value to animate between keys.</p>}
        </>
      ) : null}

      {clip.kind === "video" || clip.kind === "audio" ? (
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-line-soft bg-surface-2/50 p-1" role="tablist" aria-label="Clip settings">
          {(clip.kind === "video" ? (["Video", "Masks", "Audio"] as const) : (["Audio"] as const)).map((tab) => (
            <button key={tab} role="tab" aria-selected={activeTab === tab}
              className={`rounded-md px-2 py-1.5 text-[10.5px] font-medium transition ${activeTab === tab ? "bg-raised text-ink shadow-sm" : "text-dim hover:text-ink"}`}
              onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </div>
      ) : null}

      {clip.kind === "misc" && clip.effect ? (
        <>
          <div className="rounded-lg border border-line-soft bg-surface-2/40 p-2.5">
            {sectionTitle("3D LUT")}
            <label className="btn btn-secondary btn-sm w-full cursor-pointer justify-center">
              Import .cube LUT
              <input className="hidden" type="file" accept=".cube,text/plain" onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try {
                  const lut = lutSettingsFromCube(parseCubeLut(await file.text()));
                  lut.title = file.name.replace(/\.cube$/i, "") || lut.title;
                  onUpdate({ lut, name: `${lut.title} LUT` });
                  setLutError("");
                } catch (error) {
                  setLutError(error instanceof Error ? error.message : String(error));
                }
              }} />
            </label>
            {clip.lut ? <>
              <div className="mt-2 truncate text-[10px] text-muted" title={clip.lut.title}>{clip.lut.title} · {clip.lut.size}³</div>
              <div className="mt-2" onPointerDown={onRecord}><Slider label="LUT strength" value={clip.lut.strength} min={0} max={1} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ lut: { ...clip.lut!, strength: value } }, false)} /></div>
              <button className="mt-2 text-[10px] text-dim hover:text-error" onClick={() => onUpdate({ lut: undefined, name: "Color filter" })}>Remove LUT</button>
            </> : <p className="mt-2 text-[10px] text-dim">Import a 3D .cube file to apply it to the image.</p>}
            {lutError ? <p role="alert" className="mt-2 text-[10px] leading-relaxed text-error">{lutError}</p> : null}
          </div>
          {sectionTitle("Quick effects")}
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_EFFECTS.map((preset) => (
              <button key={preset.name} className="btn btn-secondary btn-sm justify-center" onClick={() => onUpdate({
                name: preset.name === "Original" ? "Color filter" : `${preset.name} effect`,
                effect: { ...clip.effect!, ...preset.values },
              })}>{preset.name}</button>
            ))}
          </div>
          <div className="divider" />
          {sectionTitle("Color filters")}
          <div className="space-y-3">
            <RangeNumber label="Brightness" value={clip.effect.brightness} min={-1} max={1} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { brightness: value } }, false)} />
            <RangeNumber label="Contrast" value={clip.effect.contrast} min={0} max={2} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { contrast: value } }, false)} />
            <RangeNumber label="Saturation" value={clip.effect.saturation} min={0} max={2} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { saturation: value } }, false)} />
            <RangeNumber label="Hue" value={clip.effect.hue} min={-180} max={180} step={1} suffix="°" onRecord={onRecord} onChange={(value) => onUpdate({ effect: { hue: value } }, false)} />
            <RangeNumber label="Sepia" value={clip.effect.sepia} min={0} max={1} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { sepia: value } }, false)} />
            <RangeNumber label="Blur" value={clip.effect.blur} min={0} max={20} step={0.1} suffix="px" onRecord={onRecord} onChange={(value) => onUpdate({ effect: { blur: value } }, false)} />
            <RangeNumber label="Vignette" value={clip.effect.vignette} min={0} max={1} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { vignette: value } }, false)} />
            <RangeNumber label="Motion blur" value={clip.effect.motionBlur} min={0} max={1} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { motionBlur: value } }, false)} />
            <RangeNumber label="Fade in" value={clip.effect.fadeIn} min={0} max={clip.duration} step={0.05} suffix="s" onRecord={onRecord} onChange={(value) => onUpdate({ effect: { fadeIn: value } }, false)} />
            <RangeNumber label="Fade out" value={clip.effect.fadeOut} min={0} max={clip.duration} step={0.05} suffix="s" onRecord={onRecord} onChange={(value) => onUpdate({ effect: { fadeOut: value } }, false)} />
          </div>
          <div className="mt-4">
            <span className="label">Mask function</span>
            <select className="field" value={clip.effect.mask} onChange={(event) => onUpdate({ effect: { mask: event.target.value as "none" | "circle" } })}>
              <option value="none">Full frame</option><option value="circle">Circle</option>
            </select>
          </div>
          {clip.effect.mask === "circle" ? <div className="mt-3 space-y-3">
            <RangeNumber label="Mask X" value={clip.effect.maskX} min={0} max={1} step={0.01} suffix="%" displayScale={100} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { maskX: value } }, false)} />
            <RangeNumber label="Mask Y" value={clip.effect.maskY} min={0} max={1} step={0.01} suffix="%" displayScale={100} onRecord={onRecord} onChange={(value) => onUpdate({ effect: { maskY: value } }, false)} />
            <RangeNumber label="Mask size" value={clip.effect.maskSize} min={0.05} max={1.5} step={0.01} suffix="×" onRecord={onRecord} onChange={(value) => onUpdate({ effect: { maskSize: value } }, false)} />
          </div> : null}
          <div className="mt-4" onPointerDown={onRecord}><Slider label="Effect opacity" value={clip.opacity} min={0} max={1} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ opacity: value }, false)} /></div>
        </>
      ) : null}

      {clip.kind === "video" && activeTab === "Video" ? (
        <>
          <div className="divider" />
          <div>
            {sectionTitle("Frame")}
            <div className="grid grid-cols-2 gap-2">
              {(["contain", "cover"] as const).map((fit) => (
                <button
                  key={fit}
                  className={`rounded-lg border px-3 py-2 text-[11.5px] capitalize transition ${
                    clip.fit === fit
                      ? "border-accent/50 bg-accent-soft text-ink"
                      : "border-line bg-surface-2/60 text-muted hover:bg-panel-2"
                  }`}
                  onClick={() => onUpdate({ fit })}
                >
                  {fit === "contain" ? "Fit inside" : "Fill frame"}
                </button>
              ))}
            </div>
          </div>

          <div onPointerDown={onRecord}>
            <Slider
              label="Opacity"
              value={clip.opacity}
              min={0}
              max={1}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => onUpdate({ opacity: value }, false)}
            />
          </div>

        </>
      ) : null}

      {clip.kind === "video" && activeTab === "Video" ? (
        <>
          <div>
            {sectionTitle("Transform")}
            <div className="space-y-3">
              <RangeNumber label="Position X" value={clip.x} min={-1} max={1} step={0.01} suffix="%" displayScale={100} onRecord={onRecord} onChange={(value) => onUpdate({ x: value }, false)} />
              <RangeNumber label="Position Y" value={clip.y} min={-1} max={1} step={0.01} suffix="%" displayScale={100} onRecord={onRecord} onChange={(value) => onUpdate({ y: value }, false)} />
              <RangeNumber label="Scale" value={clip.scale} min={0.05} max={4} step={0.05} suffix="×" onRecord={onRecord} onChange={(value) => onUpdate({ scale: value }, false)} />
              <RangeNumber label="Rotation" value={clip.rotation} min={-1800} max={1800} step={1} suffix="°" onRecord={onRecord} onChange={(value) => onUpdate({ rotation: value }, false)} />
            </div>
            <p className="mt-1.5 text-[10px] text-dim">Position is an offset from the canvas center, as a fraction of canvas size.</p>
          </div>
        </>
      ) : null}

      {clip.kind === "video" && activeTab === "Masks" ? (
        <div className="space-y-5">
          {sectionTitle("Mask shape")}
          <div className="grid grid-cols-2 gap-2">
            {([ ["none", "None"], ["circle", "Circle"] ] as const).map(([mask, label]) => (
              <button key={mask} className={`rounded-lg border px-3 py-2 text-[11.5px] transition ${clip.mask === mask ? "border-accent/50 bg-accent-soft text-ink" : "border-line bg-surface-2/60 text-muted hover:bg-panel-2"}`} onClick={() => onUpdate({ mask })}>{label}</button>
            ))}
          </div>
          <div className="divider" />
          {sectionTitle("Chroma key")}
          <p className="-mt-2 text-[10px] leading-relaxed text-dim">Key out a sampled solid-color backdrop such as a clean green or blue screen. For AI subject cutouts from images, open AI tools → Local → Background remover.</p>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input type="checkbox" checked={clip.chromaKey?.enabled ?? false} onChange={(event) => onUpdate({ chromaKey: { enabled: event.target.checked, color: clip.chromaKey?.color ?? "#00ff00", similarity: clip.chromaKey?.similarity ?? 0.22, softness: clip.chromaKey?.softness ?? 0.08 } })} />
            Enable chroma key
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[["#00ff00", "Green"], ["#0000ff", "Blue"]].map(([color, label]) => <button key={color} className={`btn btn-ghost btn-sm ${clip.chromaKey?.color === color ? "text-accent" : ""}`} onClick={() => onUpdate({ chromaKey: { enabled: true, color, similarity: clip.chromaKey?.similarity ?? 0.22, softness: clip.chromaKey?.softness ?? 0.08 } })}>{label}</button>)}
          </div>
          <label className="flex items-center justify-between text-[11px] text-muted"><span>Key color</span><input aria-label="Chroma key color" type="color" className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" value={clip.chromaKey?.color ?? "#00ff00"} onChange={(event) => onUpdate({ chromaKey: { enabled: true, color: event.target.value, similarity: clip.chromaKey?.similarity ?? 0.22, softness: clip.chromaKey?.softness ?? 0.08 } })} /></label>
          <RangeNumber label="Color similarity" value={clip.chromaKey?.similarity ?? 0.22} min={0.01} max={1} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ chromaKey: { enabled: true, color: clip.chromaKey?.color ?? "#00ff00", similarity: value, softness: clip.chromaKey?.softness ?? 0.08 } }, false)} />
          <RangeNumber label="Edge softness" value={clip.chromaKey?.softness ?? 0.08} min={0} max={1} step={0.01} onRecord={onRecord} onChange={(value) => onUpdate({ chromaKey: { enabled: true, color: clip.chromaKey?.color ?? "#00ff00", similarity: clip.chromaKey?.similarity ?? 0.22, softness: value } }, false)} />
        </div>
      ) : null}

      {clip.kind !== "text" && activeTab === "Audio" ? (
        <>
          {sectionTitle("Level")}
          <div onPointerDown={onRecord} className="space-y-3">
            <Slider label="Clip volume" value={clip.volume} min={0} max={2} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ volume: value }, false)} />
            <Slider label="Track volume" value={track.volume ?? 1} min={0} max={2} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdateTrack({ volume: value }, false)} />
            <Slider
              label="Pan"
              value={clip.pan}
              min={-1}
              max={1}
              step={0.01}
              format={(value) => (Math.abs(value) < 0.01 ? "Center" : value < 0 ? `${Math.round(-value * 100)}% left` : `${Math.round(value * 100)}% right`)}
              onChange={(value) => onUpdate({ pan: value }, false)}
            />
            <RangeNumber label="Pitch" value={clip.pitch} min={-12} max={12} step={0.1} suffix="st" onRecord={onRecord} onChange={(value) => onUpdate({ pitch: value }, false)} />
          </div>

          {sectionTitle("Equalizer")}
          <div className="space-y-3">
            <RangeNumber label="Low gain" value={clip.bass} min={-12} max={12} step={0.5} suffix="dB" onRecord={onRecord} onChange={(value) => onUpdate({ bass: value }, false)} />
            <RangeNumber label="Low frequency" value={clip.bassFrequency} min={40} max={1000} step={10} suffix="Hz" onRecord={onRecord} onChange={(value) => onUpdate({ bassFrequency: value }, false)} />
            <RangeNumber label="Mid gain" value={clip.mid} min={-24} max={24} step={0.5} suffix="dB" onRecord={onRecord} onChange={(value) => onUpdate({ mid: value }, false)} />
            <RangeNumber label="Mid frequency" value={clip.midFrequency} min={100} max={8000} step={50} suffix="Hz" onRecord={onRecord} onChange={(value) => onUpdate({ midFrequency: value }, false)} />
            <RangeNumber label="Mid width" value={clip.midWidth} min={0.25} max={4} step={0.25} suffix="oct" onRecord={onRecord} onChange={(value) => onUpdate({ midWidth: value }, false)} />
            <RangeNumber label="High gain" value={clip.treble} min={-12} max={12} step={0.5} suffix="dB" onRecord={onRecord} onChange={(value) => onUpdate({ treble: value }, false)} />
            <RangeNumber label="High frequency" value={clip.trebleFrequency} min={2000} max={16000} step={100} suffix="Hz" onRecord={onRecord} onChange={(value) => onUpdate({ trebleFrequency: value }, false)} />
          </div>

          {sectionTitle("Dynamics")}
          <label className="mb-3 flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={clip.compressor?.enabled ?? false}
              onChange={(event) => onUpdate({ compressor: { enabled: event.target.checked } })}
            />
            Enable compressor
          </label>
          <div className="space-y-3">
            <RangeNumber label="Threshold" value={clip.compressor?.threshold ?? DEFAULT_COMPRESSOR.threshold} min={-60} max={0} step={1} suffix="dB" onRecord={onRecord} onChange={(value) => onUpdate({ compressor: { threshold: value } }, false)} />
            <RangeNumber label="Ratio" value={clip.compressor?.ratio ?? DEFAULT_COMPRESSOR.ratio} min={1} max={20} step={0.5} suffix=":1" onRecord={onRecord} onChange={(value) => onUpdate({ compressor: { ratio: value } }, false)} />
            <RangeNumber label="Attack" value={clip.compressor?.attack ?? DEFAULT_COMPRESSOR.attack} min={0.1} max={500} step={1} suffix="ms" onRecord={onRecord} onChange={(value) => onUpdate({ compressor: { attack: value } }, false)} />
            <RangeNumber label="Release" value={clip.compressor?.release ?? DEFAULT_COMPRESSOR.release} min={10} max={2000} step={10} suffix="ms" onRecord={onRecord} onChange={(value) => onUpdate({ compressor: { release: value } }, false)} />
          </div>

          {sectionTitle("Fades")}
          <div className="space-y-3">
            <RangeNumber label="Fade in" value={clip.fadeIn} min={0} max={clip.duration} step={0.05} suffix="s" onRecord={onRecord} onChange={(value) => onUpdate({ fadeIn: value }, false)} />
            <RangeNumber label="Fade out" value={clip.fadeOut} min={0} max={clip.duration} step={0.05} suffix="s" onRecord={onRecord} onChange={(value) => onUpdate({ fadeOut: value }, false)} />
          </div>

          {sectionTitle("Automation")}
          <div className="flex flex-wrap gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={() => applyVolumeAutomation(0, 1, 0)}>Volume fade in</button>
            <button className="btn btn-ghost btn-sm" onClick={() => applyVolumeAutomation(1, 0, 1)}>Volume fade out</button>
            <button className="btn btn-ghost btn-sm" onClick={() => applyVolumeAutomation(0.4, 1.6, 0)}>Volume ramp up</button>
            <button className="btn btn-ghost btn-sm" onClick={() => applyVolumeAutomation(1.6, 0.4, 0)}>Volume ramp down</button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onRecord();
                onUpdate({ keyframes: clip.keyframes.filter((frame) => frame.property !== "volume") });
              }}
            >
              Clear
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-dim">Volume automation is drawn on the timeline and is applied in the preview and the exported file.</p>

          {sectionTitle("Ducking")}
          <label className="mb-3 flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={track.ducking?.enabled ?? false}
              onChange={(event) => onUpdateTrack({ ducking: { ...DEFAULT_DUCKING, ...track.ducking, enabled: event.target.checked } })}
            />
            Duck this track under other audio
          </label>
          <div className="space-y-3">
            <RangeNumber label="Duck amount" value={track.ducking?.amount ?? DEFAULT_DUCKING.amount} min={0} max={24} step={0.5} suffix="dB" onRecord={onRecord} onChange={(value) => onUpdateTrack({ ducking: { ...DEFAULT_DUCKING, ...track.ducking, amount: value } }, false)} />
            <RangeNumber label="Trigger threshold" value={track.ducking?.threshold ?? DEFAULT_DUCKING.threshold} min={-60} max={0} step={1} suffix="dB" onRecord={onRecord} onChange={(value) => onUpdateTrack({ ducking: { ...DEFAULT_DUCKING, ...track.ducking, threshold: value } }, false)} />
            <RangeNumber label="Attack" value={track.ducking?.attack ?? DEFAULT_DUCKING.attack} min={0.01} max={2} step={0.01} suffix="s" onRecord={onRecord} onChange={(value) => onUpdateTrack({ ducking: { ...DEFAULT_DUCKING, ...track.ducking, attack: value } }, false)} />
            <RangeNumber label="Release" value={track.ducking?.release ?? DEFAULT_DUCKING.release} min={0.05} max={5} step={0.05} suffix="s" onRecord={onRecord} onChange={(value) => onUpdateTrack({ ducking: { ...DEFAULT_DUCKING, ...track.ducking, release: value } }, false)} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-dim">The track is attenuated while other, non-ducking tracks play audio above the trigger threshold. Preview and export use the same envelope.</p>

          {clip.kind === "video" && asset?.info.hasAudio ? (
            <button className="btn btn-secondary btn-sm mt-4 w-full" onClick={onExtractAudio}><AudioLines size={13} /> Extract audio to timeline</button>
          ) : null}
        </>
      ) : null}

      {clip.kind === "text" && clip.text ? (
        <>
          <div className="divider" />
          <div>
            {sectionTitle("Text")}
            <textarea
              className="field field-textarea"
              value={clip.text.text}
              onFocus={onRecord}
              onChange={(event) => onUpdate({ text: { text: event.target.value } }, false)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Size"
              value={clip.text.size}
              min={8}
              max={300}
              step={1}
              suffix="px"
              onCommit={(value) => onUpdate({ text: { size: value } })}
            />
            <label className="block">
              <span className="label">Color</span>
              <div className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-[#101013] px-2">
                <input
                  type="color"
                  className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                  value={clip.text.color}
                  onFocus={onRecord}
                  onChange={(event) => onUpdate({ text: { color: event.target.value } }, false)}
                />
                <span className="font-mono text-[10.5px] uppercase text-muted">{clip.text.color}</span>
              </div>
            </label>
          </div>

          <RangeNumber label="Text rotation" value={clip.text.rotation} min={-1800} max={1800} step={1} suffix="°" onRecord={onRecord} onChange={(value) => onUpdate({ text: { rotation: value } }, false)} />

          <label className="block">
            <span className="label">Font family</span>
            <select className="field" value={clip.text.fontFamily} onChange={(event) => onUpdate({ text: { fontFamily: event.target.value } })}>
              {["Segoe UI", "Arial", "Georgia", "Times New Roman", "Courier New", "Impact", "Trebuchet MS", "Verdana"].map((family) => (
                <option key={family} value={family}>{family}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="label">Weight</span>
              <button
                className={`flex h-[34px] w-full items-center justify-center gap-2 rounded-lg border text-[11.5px] transition ${
                  clip.text.fontWeight === "bold"
                    ? "border-accent/50 bg-accent-soft"
                    : "border-line bg-surface-2/60 text-muted"
                }`}
                onClick={() => onUpdate({ text: { fontWeight: clip.text?.fontWeight === "bold" ? "normal" : "bold" } })}
              >
                <Bold size={13} /> {clip.text.fontWeight === "bold" ? "Bold" : "Regular"}
              </button>
            </div>
            <div>
              <span className="label">Align</span>
              <div className="grid grid-cols-3 gap-1">
                {([
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const).map(([align, AlignIcon]) => (
                  <button
                    key={align}
                    className={`flex h-[34px] items-center justify-center rounded-lg border transition ${
                      clip.text?.align === align
                        ? "border-accent/50 bg-accent-soft text-ink"
                        : "border-line bg-surface-2/60 text-dim hover:text-ink"
                    }`}
                    onClick={() => onUpdate({ text: { align } })}
                  >
                    <AlignIcon size={13} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              className={`flex h-[34px] items-center justify-center gap-2 rounded-lg border text-[11.5px] italic transition ${
                clip.text.italic ? "border-accent/50 bg-accent-soft" : "border-line bg-surface-2/60 text-muted"
              }`}
              onClick={() => onUpdate({ text: { italic: !clip.text?.italic } })}
              aria-pressed={clip.text.italic}
            >
              <Type size={13} /> Italic
            </button>
            <NumberField label="Line height" value={clip.text.lineHeight} min={0.8} max={3} step={0.05} suffix="×" onCommit={(value) => onUpdate({ text: { lineHeight: value } })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div onPointerDown={onRecord}>
              <Slider
                label="Horizontal"
                value={clip.text.x}
                min={0}
                max={1}
                step={0.01}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => onUpdate({ text: { x: value } }, false)}
              />
            </div>
            <div onPointerDown={onRecord}>
              <Slider
                label="Vertical"
                value={clip.text.y}
                min={0}
                max={1}
                step={0.01}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => onUpdate({ text: { y: value } }, false)}
              />
            </div>
          </div>

          <div onPointerDown={onRecord}>
            <Slider label="Text opacity" value={clip.opacity} min={0} max={1} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ opacity: value }, false)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Outline width" value={clip.text.outlineWidth} min={0} max={20} step={0.5} suffix="px" onCommit={(value) => onUpdate({ text: { outlineWidth: value } })} />
            <NumberField label="Character spacing" value={clip.text.characterSpacing} min={-5} max={40} step={0.5} suffix="px" onCommit={(value) => onUpdate({ text: { characterSpacing: value } })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Outline color</span>
              <div className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-[#101013] px-2">
                <input type="color" className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" value={clip.text.outlineColor} onFocus={onRecord} onChange={(event) => onUpdate({ text: { outlineColor: event.target.value } }, false)} />
                <span className="font-mono text-[10px] uppercase text-muted">{clip.text.outlineColor}</span>
              </div>
            </label>
            <div>
              <span className="label">Underline</span>
              <button className={`flex h-[34px] w-full items-center justify-center rounded-lg border text-[12px] font-semibold underline ${clip.text.underline ? "border-accent/50 bg-accent-soft" : "border-line bg-surface-2/60 text-muted"}`} onClick={() => onUpdate({ text: { underline: !clip.text?.underline } })}>U</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Shadow color</span>
              <div className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-[#101013] px-2">
                <input type="color" className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" value={clip.text.shadowColor} onFocus={onRecord} onChange={(event) => onUpdate({ text: { shadowColor: event.target.value } }, false)} />
                <span className="font-mono text-[10px] uppercase text-muted">{clip.text.shadowColor}</span>
              </div>
            </label>
            <label className="block">
              <span className="label">Box color</span>
              <div className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-[#101013] px-2">
                <input type="color" className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" value={clip.text.backgroundColor} onFocus={onRecord} onChange={(event) => onUpdate({ text: { backgroundColor: event.target.value } }, false)} />
                <span className="font-mono text-[10px] uppercase text-muted">{clip.text.backgroundColor}</span>
              </div>
            </label>
          </div>

          <div className="space-y-3">
            <div onPointerDown={onRecord}><Slider label="Brightness" value={clip.text.brightness} min={0} max={2} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ text: { brightness: value } }, false)} /></div>
            <div onPointerDown={onRecord}><Slider label="Shadow" value={clip.text.shadow} min={0} max={1} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ text: { shadow: value } }, false)} /></div>
            <div onPointerDown={onRecord}><Slider label="Text box opacity" value={clip.text.backgroundOpacity} min={0} max={1} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onUpdate({ text: { backgroundOpacity: value } }, false)} /></div>
            <RangeNumber label="Text arc" value={clip.text.curve} min={-360} max={360} step={1} suffix="°" onRecord={onRecord} onChange={(value) => onUpdate({ text: { curve: value } }, false)} />
          </div>
        </>
      ) : null}

      <div className="divider" />

      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onSplit} disabled={!canSplit} title="Split at playhead">
          <Scissors size={13} /> Split
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </button>
      </div>
      <button className="btn btn-danger btn-sm w-full" onClick={onDelete}>
        <Trash2 size={13} /> Remove clip
      </button>

      <div className="rounded-xl border border-line-soft bg-surface-2/40 px-3 py-2.5 text-[10.5px] leading-relaxed text-dim">
        Tip: drag the trim handles on the timeline to change the in and out points. Drag the middle of a clip to move it.
      </div>
    </div>
  );
}

function ProjectInspector({
  name,
  width,
  height,
  fps,
  duration,
  assetCount,
  trackCount,
  clipCount,
}: {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  assetCount: number;
  trackCount: number;
  clipCount: number;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[13px] font-semibold">{name}</div>
        <div className="mt-1 text-[11px] text-dim">Project settings and shortcuts</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          ["Canvas", `${width}×${height}`],
          ["Frame rate", `${fps} fps`],
          ["Duration", formatDuration(duration)],
          ["Clips", `${clipCount}`],
          ["Tracks", `${trackCount}`],
          ["Media", `${assetCount}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line-soft bg-surface-2/50 px-3 py-2.5">
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-dim">{label}</div>
            <div className="mt-0.5 font-mono text-[12px] text-ink/90">{value}</div>
          </div>
        ))}
      </div>

      <div>
        {sectionTitle("Timeline position")}
        <div className="rounded-xl border border-line-soft bg-surface-2/50 px-3 py-2.5 font-mono text-[12px] text-muted">
          {formatClock(duration, fps)}
        </div>
      </div>

      <div className="divider" />

      <div>
        {sectionTitle("Shortcuts")}
        <div className="space-y-1.5">
          {[
            ["Play / pause", "Space"],
            ["Split at playhead", "S"],
            ["Delete clip", "Del"],
            ["Undo / redo", "Ctrl+Z / Ctrl+Y"],
            ["Save copy", "Ctrl+S"],
            ["Export", "Ctrl+E"],
            ["Zoom timeline", "+ / −"],
          ].map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-muted">{label}</span>
              <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[9.5px] text-dim">{keys}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line-soft bg-surface-2/40 px-3 py-2.5 text-[10.5px] leading-relaxed text-dim">
        Select a clip to edit its transform, timing, audio, and text. Changes are saved to this PC automatically.
      </div>
    </div>
  );
}
