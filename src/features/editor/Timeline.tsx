import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AudioWaveform,
  ChevronsRight,
  Eye,
  EyeOff,
  Film,
  Lock,
  Magnet,
  Music2,
  SlidersHorizontal,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Waveform } from "../../components/Waveform";
import {
  assetForClip,
  useEditor,
} from "../../stores/editor";
import { clamp, formatClock, projectDuration, snapTime } from "../../lib/time";
import { DEFAULT_DUCKING } from "../../lib/audio";
import type { Asset, Clip, Track, TrackKind } from "../../lib/types";

const LABEL_WIDTH = 154;
const MIN_ZOOM = 12;
const MAX_ZOOM = 320;

function trackHeight(kind: TrackKind): number {
  if (kind === "misc") return 60;
  if (kind === "video") return 82;
  if (kind === "audio") return 68;
  return 60;
}

function trackIcon(kind: TrackKind) {
  return kind === "video" ? Film : kind === "audio" ? Music2 : kind === "misc" ? SlidersHorizontal : Type;
}

function rulerStep(zoom: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step * zoom >= 64) ?? 1200;
}

function rulerLabel(seconds: number, step: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (step < 1) return `${m}:${s.toFixed(2).padStart(5, "0")}`;
  return `${m}:${Math.floor(s).toString().padStart(2, "0")}`;
}

type DragMode = "move" | "trim-start" | "trim-end";

interface DragState {
  mode: DragMode;
  clipId: string;
  trackId: string;
  startX: number;
  originalStart: number;
  originalDuration: number;
}

export function Timeline({ height = 310 }: { height?: number }) {
  const project = useEditor((state) => state.project);
  const currentTime = useEditor((state) => state.currentTime);
  const selectedClipId = useEditor((state) => state.selectedClipId);
  const zoom = useEditor((state) => state.zoom);
  const snap = useEditor((state) => state.snap);
  const ripple = useEditor((state) => state.ripple);
  const setZoom = useEditor((state) => state.setZoom);
  const setCurrentTime = useEditor((state) => state.setCurrentTime);
  const setPlaying = useEditor((state) => state.setPlaying);
  const addTrack = useEditor((state) => state.addTrack);
  const addEffectClip = useEditor((state) => state.addEffectClip);
  const selectClip = useEditor((state) => state.selectClip);
  const recordSnapshot = useEditor((state) => state.recordSnapshot);
  const updateTrack = useEditor((state) => state.updateTrack);
  const toggleSnap = useEditor((state) => state.toggleSnap);
  const toggleRipple = useEditor((state) => state.toggleRipple);
  const setMagneticTrack = useEditor((state) => state.setMagneticTrack);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const splitAtPlayhead = useEditor((state) => state.splitAtPlayhead);
  const deleteSelected = useEditor((state) => state.deleteSelected);
  const undoDepth = useEditor((state) => state.undoStack.length);
  const redoDepth = useEditor((state) => state.redoStack.length);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dropTrack, setDropTrack] = useState<string | null>(null);

  const duration = project ? projectDuration(project.tracks) : 0;
  const timelineDuration = Math.max(30, duration + 8);
  const contentWidth = Math.max(400, timelineDuration * zoom);
  const step = rulerStep(zoom);
  const displayTracks = project
    ? [
        ...project.tracks.filter((track) => track.kind === "misc").slice().reverse(),
        ...project.tracks.filter((track) => track.kind === "text").slice().reverse(),
        ...project.tracks.filter((track) => track.kind === "video").slice().reverse(),
        ...project.tracks.filter((track) => track.kind === "audio").slice().reverse(),
      ]
    : [];

  const ticks = useMemo(() => {
    const result: number[] = [];
    for (let time = 0; time <= timelineDuration; time += step) {
      result.push(Number(time.toFixed(4)));
    }
    return result;
  }, [step, timelineDuration]);

  const clipBoundaries = useMemo(() => {
    if (!project) return [];
    const values = [0, currentTime];
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        values.push(clip.start, clip.start + clip.duration);
      }
    }
    return values;
  }, [project, currentTime]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (event.clientX - drag.startX) / zoom;
      const threshold = 9 / zoom;
      const state = useEditor.getState();
      const candidates = clipBoundaries.filter((value) => Math.abs(value - drag.originalStart) > 0.001);

      if (drag.mode === "move") {
        let next = Math.max(0, drag.originalStart + delta);
        if (state.snap) next = Math.max(0, snapTime(next, candidates, threshold));
        state.updateClip(drag.clipId, { start: next }, false);
      } else if (drag.mode === "trim-start") {
        let next = Math.max(0, drag.originalStart + delta);
        if (state.snap) next = snapTime(next, candidates, threshold);
        state.trimClip(drag.clipId, "start", next);
      } else {
        let next = Math.max(0, drag.originalStart + drag.originalDuration + delta);
        if (state.snap) next = snapTime(next, candidates, threshold);
        state.trimClip(drag.clipId, "end", next);
      }
    };

    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.mode === "move") {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-timeline-track]");
        const targetTrackId = target?.dataset.timelineTrack;
        if (targetTrackId && targetTrackId !== drag.trackId) {
          useEditor.getState().moveClipToTrack(drag.clipId, targetTrackId);
        } else {
          useEditor.getState().settleMagneticTrack(drag.trackId);
        }
      }
      dragRef.current = null;
      setDragging(false);
    };
    const onCancel = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [zoom, clipBoundaries]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!scrubRef.current) return;
      const target = document.querySelector<HTMLElement>("[data-timeline-ruler]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const time = clamp((event.clientX - rect.left) / zoom, 0, timelineDuration);
      setCurrentTime(time);
    };
    const onUp = () => {
      scrubRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [zoom, timelineDuration, setCurrentTime]);

  if (!project) return null;

  const beginInteraction = (
    event: ReactPointerEvent,
    clip: Clip,
    track: Track,
    mode: DragMode,
  ) => {
    if (event.button !== 0 || track.locked) return;
    event.stopPropagation();
    setPlaying(false);
    selectClip(clip.id);
    recordSnapshot();
    dragRef.current = {
      mode,
      clipId: clip.id,
      trackId: track.id,
      startX: event.clientX,
      originalStart: clip.start,
      originalDuration: clip.duration,
    };
    setDragging(true);
  };

  const beginScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    if ((event.target as HTMLElement).closest("[data-clip]")) return;
    setPlaying(false);
    scrubRef.current = true;
    const rect = target.getBoundingClientRect();
    const time = clamp((event.clientX - rect.left) / zoom, 0, timelineDuration);
    setCurrentTime(time);
  };

  const fitZoom = () => {
    const width = scrollRef.current?.clientWidth ?? 900;
    const target = Math.max(120, width - LABEL_WIDTH - 36);
    setZoom(clamp(target / timelineDuration, MIN_ZOOM, MAX_ZOOM));
  };

  useEffect(() => {
    const onAssetDrop = (event: Event) => {
      const { assetId, trackId, clientX } = (event as CustomEvent<{
        assetId: string;
        trackId: string;
        clientX: number;
      }>).detail;
      const state = useEditor.getState();
      const currentProject = state.project;
      if (!currentProject) return;
      const asset = currentProject.assets.find((item) => item.id === assetId);
      if (!asset) return;
      const requestedTrack = currentProject.tracks.find((item) => item.id === trackId);
      if (!requestedTrack) return;

      const kind = asset.info.hasVideo || asset.info.isImage ? "video" : "audio";
      const targetTrack = requestedTrack.kind === kind && !requestedTrack.locked
        ? requestedTrack
        : currentProject.tracks.find((item) => item.kind === kind && !item.locked);
      if (!targetTrack) return;

      const targetElement = document.querySelector<HTMLElement>(`[data-timeline-track="${targetTrack.id}"]`);
      if (!targetElement) return;
      const rect = targetElement.getBoundingClientRect();
      let time = Math.max(0, (clientX - rect.left) / state.zoom);
      const boundaries = [0, state.currentTime, ...currentProject.tracks.flatMap((item) =>
        item.clips.flatMap((clip) => [clip.start, clip.start + clip.duration]),
      )];
      if (state.snap) time = Math.max(0, snapTime(time, boundaries, 9 / state.zoom));
      state.recordSnapshot();
      state.addClip(assetId, targetTrack.id, time);
      setDropTrack(null);
    };

    window.addEventListener("librecut:asset-drop", onAssetDrop);
    return () => window.removeEventListener("librecut:asset-drop", onAssetDrop);
  }, []);

  return (
    <section style={{ height }} className="flex min-h-[180px] shrink-0 flex-col border-t border-line-soft bg-panel/55">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-3">
        <div className="flex items-center gap-1">
          <span className="mr-2 font-mono text-[11px] tabular-nums text-muted">{formatClock(currentTime, project.fps)}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={undo} disabled={undoDepth === 0} title="Undo (Ctrl+Z)">
            <Undo2 size={14} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={redo} disabled={redoDepth === 0} title="Redo (Ctrl+Y)">
            <Redo2 size={14} />
          </button>
          <div className="mx-1 h-4 w-px bg-line" />
          <button className="btn btn-ghost btn-sm" onClick={splitAtPlayhead} title="Split at playhead (S)">
            <Scissors size={13} /> Split
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={deleteSelected} title="Delete selected clip (Del)">
            <Trash2 size={14} />
          </button>
          <div className="mx-1 h-4 w-px bg-line" />
          <button
            className={`btn btn-sm ${snap ? "btn-secondary text-accent" : "btn-ghost"}`}
            onClick={toggleSnap}
            title="Toggle snapping"
          >
            <Magnet size={13} /> Snap
          </button>
          <button
            className={`btn btn-sm ${ripple ? "btn-secondary text-accent" : "btn-ghost"}`}
            onClick={toggleRipple}
            title="Ripple edits: trims and deletes shift later clips"
            aria-pressed={ripple}
          >
            <ChevronsRight size={13} /> Ripple
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
                  title={`Add ${kind} track`}
                >
                  <Plus size={11} /> <Icon size={12} />
                </button>
              );
            })}
            <button className="btn btn-secondary btn-sm px-2" onClick={() => addEffectClip()} title="Add a color filter clip">
              <SlidersHorizontal size={12} /> Filter
            </button>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(zoom - 12)} title="Zoom out">
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
            title="Timeline zoom"
          />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(zoom + 12)} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fitZoom} title="Fit timeline">
            Fit
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative min-h-full" style={{ width: LABEL_WIDTH + contentWidth }}>
          <div className="sticky top-0 z-30 flex border-b border-line-soft bg-panel">
            <div className="sticky left-0 z-40 flex h-8 shrink-0 items-center border-r border-line-soft bg-panel px-3" style={{ width: LABEL_WIDTH }}>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-dim">Tracks</span>
            </div>
            <div
              data-timeline-ruler
              className="relative h-8 shrink-0 cursor-ew-resize select-none"
              style={{ width: contentWidth }}
              onPointerDown={beginScrub}
            >
              {ticks.map((time) => (
                <div key={time} className="absolute top-0 h-full" style={{ left: time * zoom }}>
                  <div className="h-2 w-px bg-line" />
                  <span className="absolute left-1 top-2 whitespace-nowrap font-mono text-[9px] text-dim">
                    {rulerLabel(time, step)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {displayTracks.map((track) => {
            const height = trackHeight(track.kind);
            const Icon = trackIcon(track.kind);
            const layerNumber = project.tracks
              .slice(0, project.tracks.indexOf(track) + 1)
              .filter((item) => item.kind === track.kind).length;
            const layerTag = track.kind === "video" ? "V" : track.kind === "audio" ? "A" : track.kind === "text" ? "T" : "M";
            return (
              <div key={track.id} className="flex border-b border-line-soft">
                <div
                  className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r border-line-soft bg-[#191a1f] px-2.5"
                  style={{ width: LABEL_WIDTH, height }}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={12} className={track.kind === "text" ? "text-blue" : track.kind === "audio" ? "text-mint" : track.kind === "misc" ? "text-amber" : "text-accent"} />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink/90">{track.name}</span>
                    {track.magnetic ? <span className="rounded border border-accent/40 bg-accent-soft px-1 py-0.5 font-mono text-[8px] leading-none text-accent" title="Magnetic main track">MAIN</span> : null}
                    {track.ducking?.enabled ? <span className="rounded border border-mint/40 bg-mint/10 px-1 py-0.5 font-mono text-[8px] leading-none text-mint" title="Ducking under other audio">DUCK</span> : null}
                    <span className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-mono text-[8px] leading-none text-dim" title={`${track.kind} layer ${layerNumber}`}>
                      {layerTag}{layerNumber}
                    </span>
                    <span className="text-[9px] text-dim">{track.clips.length}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {track.kind === "audio" || track.kind === "video" ? (
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                        onClick={() => updateTrack(track.id, { muted: !track.muted })}
                        title={track.muted ? "Unmute track" : "Mute track"}
                      >
                        {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                      </button>
                    ) : null}
                    {track.kind !== "audio" ? (
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                        onClick={() => updateTrack(track.id, { hidden: !track.hidden })}
                        title={track.hidden ? "Show track" : "Hide track"}
                      >
                        {track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    ) : null}
                    {track.kind === "video" ? (
                      <button
                        className={`flex h-5 w-5 items-center justify-center rounded transition hover:bg-white/5 ${track.magnetic ? "text-accent" : "text-dim hover:text-ink"}`}
                        onClick={() => setMagneticTrack(track.magnetic ? null : track.id)}
                        title={track.magnetic ? "Disable magnetic main track" : "Make this the magnetic main track"}
                        aria-pressed={Boolean(track.magnetic)}
                      >
                        <Magnet size={11} />
                      </button>
                    ) : null}
                    {track.kind === "audio" || track.kind === "video" ? (
                      <button
                        className={`flex h-5 w-5 items-center justify-center rounded transition hover:bg-white/5 ${track.ducking?.enabled ? "text-mint" : "text-dim hover:text-ink"}`}
                        onClick={() => updateTrack(track.id, { ducking: { ...DEFAULT_DUCKING, ...track.ducking, enabled: !track.ducking?.enabled } })}
                        title={track.ducking?.enabled ? "Disable ducking on this track" : "Duck this track under other audio"}
                        aria-pressed={Boolean(track.ducking?.enabled)}
                      >
                        <AudioWaveform size={11} />
                      </button>
                    ) : null}
                    <button
                      className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                      onClick={() => updateTrack(track.id, { locked: !track.locked })}
                      title={track.locked ? "Unlock track" : "Lock track"}
                    >
                      {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
                    </button>
                  </div>
                </div>

                <div
                  className={`relative shrink-0 transition-colors ${
                    dropTrack === track.id ? "bg-accent-soft/60" : track.hidden ? "bg-[#101013]" : displayTracks.indexOf(track) % 2 === 0 ? "bg-[#121216]" : "bg-[#14151a]"
                  }`}
                  data-timeline-track={track.id}
                  style={{
                    width: contentWidth,
                    height,
                    backgroundImage:
                      "repeating-linear-gradient(to right, #ffffff08 0, #ffffff08 1px, transparent 1px, transparent 100%)",
                    backgroundSize: `${Math.max(8, step * zoom)}px 100%`,
                  }}
                  onPointerDown={beginScrub}
                >
                  {track.clips
                    .slice()
                    .sort((a, b) => a.start - b.start)
                    .map((clip) => (
                      <TimelineClip
                        key={clip.id}
                        clip={clip}
                        track={track}
                        asset={assetForClip(project, clip)}
                        selected={clip.id === selectedClipId}
                        zoom={zoom}
                        height={height}
                        dragging={dragging && clip.id === selectedClipId}
                        onPointerDown={(event, mode) => beginInteraction(event, clip, track, mode)}
                      />
                    ))}
                </div>
              </div>
            );
          })}

          <div className="flex" style={{ width: LABEL_WIDTH + contentWidth }}>
            <div className="sticky left-0 z-20 flex h-10 shrink-0 items-center border-r border-line-soft bg-[#17171b] px-2.5" style={{ width: LABEL_WIDTH }}>
              <button className="flex items-center gap-1 text-[10px] text-dim transition hover:text-ink" onClick={() => addTrack("video")}>
                <Plus size={11} /> Add track
              </button>
            </div>
            <div className="h-10 flex-1 bg-[#121216]" />
          </div>

          <div
            className="pointer-events-none absolute top-0 z-10 w-px bg-accent"
            style={{ left: LABEL_WIDTH + currentTime * zoom, height: 32 + project.tracks.reduce((sum, track) => sum + trackHeight(track.kind), 0) + 40 }}
          >
            <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-accent shadow-lg shadow-accent/30" />
          </div>
        </div>
      </div>
    </section>
  );
}

function TimelineClip({
  clip,
  track,
  asset,
  selected,
  zoom,
  height,
  dragging,
  onPointerDown,
}: {
  clip: Clip;
  track: Track;
  asset?: Asset;
  selected: boolean;
  zoom: number;
  height: number;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent, mode: DragMode) => void;
}) {
  const width = Math.max(8, clip.duration * zoom);
  const left = clip.start * zoom;
  const isAudio = clip.kind === "audio" || (clip.kind === "video" && asset?.info.hasAudio);
  const volumeFrames = clip.keyframes
    .filter((frame) => frame.property === "volume")
    .sort((a, b) => a.time - b.time);
  const automationPoints = volumeFrames.length >= 2
    ? volumeFrames
        .map((frame) => `${((frame.time / Math.max(0.001, clip.duration)) * 100).toFixed(2)},${(100 - Math.min(2, Math.max(0, frame.value)) * 50).toFixed(2)}`)
        .join(" ")
    : "";

  return (
    <div
      data-clip
      className={`group absolute top-1.5 overflow-hidden rounded-md border text-left transition-shadow ${
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
    >
      {clip.kind === "video" && asset?.thumbnails.length ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: `linear-gradient(90deg, #00000055, #00000022), url(${asset.thumbnails[0]})`,
            backgroundSize: "auto 100%, auto 140%",
            backgroundPosition: "left center, left center",
            backgroundRepeat: "no-repeat, repeat-x",
          }}
        />
      ) : null}
      {clip.kind === "video" ? <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" /> : null}
      {isAudio && asset?.waveform.length ? (
        <div className="pointer-events-none absolute inset-x-1 bottom-1 top-4 opacity-80">
          <Waveform peaks={asset.waveform} height={height - 30} color={clip.kind === "audio" ? "#5be7a9" : "#ff9b7e"} />
        </div>
      ) : null}

      <div className="pointer-events-none relative flex h-full flex-col justify-between px-1.5 py-1">
        <div className="flex items-center gap-1 overflow-hidden">
          {clip.kind === "text" ? <Type size={9} className="shrink-0 text-blue" /> : clip.kind === "misc" ? <SlidersHorizontal size={9} className="shrink-0 text-amber" /> : null}
          <span className="truncate text-[9.5px] font-semibold leading-tight text-white/90">
            {clip.kind === "text" ? clip.text?.text || clip.name : clip.name}
          </span>
        </div>
        {width > 56 ? (
          <div className="flex items-center justify-between gap-1">
            <span className="truncate font-mono text-[8px] text-white/45">{clip.duration.toFixed(1)}s</span>
            {asset?.proxyStatus === "ready" ? <span className="text-[7.5px] uppercase tracking-wide text-mint/70">proxy</span> : null}
          </div>
        ) : null}
      </div>

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
          style={{ left: Math.min(width - 6, Math.max(0, frame.time * zoom - 3)) }}
          title={`${frame.property} keyframe at ${frame.time.toFixed(2)}s`}
        />
      )) : null}

      <button
        className={`absolute bottom-0 left-0 top-0 z-10 w-[7px] cursor-ew-resize transition-colors ${
          selected ? "bg-accent/70 hover:bg-accent" : "bg-transparent hover:bg-accent/50"
        }`}
        onPointerDown={(event) => onPointerDown(event, "trim-start")}
        aria-label="Trim clip start"
      />
      <button
        className={`absolute bottom-0 right-0 top-0 z-10 w-[7px] cursor-ew-resize transition-colors ${
          selected ? "bg-accent/70 hover:bg-accent" : "bg-transparent hover:bg-accent/50"
        }`}
        onPointerDown={(event) => onPointerDown(event, "trim-end")}
        aria-label="Trim clip end"
      />
    </div>
  );
}
