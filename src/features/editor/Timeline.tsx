import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioWaveform,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  Film,
  Gauge,
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
  type LucideIcon,
} from "lucide-react";
import { Waveform } from "../../components/Waveform";
import {
  assetForClip,
  clipById,
  useEditor,
} from "../../stores/editor";
import { cachedProjectDuration, clamp, formatClock, formatDuration } from "../../lib/time";
import { buildSnapBoundaries, snapToBoundary, visibleTimeRange } from "../../lib/snap";
import { recordMetric } from "../../lib/metrics";
import { DEFAULT_DUCKING } from "../../lib/audio";
import { normalizeSpeedRamp } from "../../lib/speed";
import { announce } from "../../lib/announce";
import { useT } from "../../lib/i18n";
import {
  adjacentTrackClip,
  nextClipInTrack,
  nudgeStep,
  orderedClips,
} from "../../lib/timelineKeyboard";
import type { Asset, Clip, Track, TrackKind } from "../../lib/types";

const LABEL_WIDTH = 154;
const MIN_ZOOM = 12;
const MAX_ZOOM = 320;

/** Extra seconds rendered on each side of the viewport. */
const VISIBLE_MARGIN_SECONDS = 4;

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
  const t = useT();

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ left: 0, right: 0 });
  /**
   * The clip that holds the keyboard focus.
   *
   * The timeline is a listbox per track, so only one clip is a tab stop and
   * the arrow keys move the focus between the rest.
   */
  const [focusedClipId, setFocusedClipId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string; clipId?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const duration = project ? cachedProjectDuration(project.tracks) : 0;
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

  // Only the clips that are on screen are rendered. A long timeline holds
  // thousands of clips, and giving each one a DOM node makes every edit
  // re-render far more than the viewport can show.
  const visibleRange = useMemo(() => {
    if (!project) return { start: 0, end: 0 };
    const total = cachedProjectDuration(project.tracks, 0);
    return visibleTimeRange(
      viewport.left,
      viewport.right ? viewport.right - viewport.left : 0,
      zoom,
      LABEL_WIDTH,
      total,
      VISIBLE_MARGIN_SECONDS,
    );
  }, [project, viewport, zoom]);

  const visibleClips = useMemo(() => {
    if (!project) return new Map<string, Clip[]>();
    const grouped = new Map<string, Clip[]>();
    for (const track of project.tracks) {
      const clips = track.clips.filter(
        (clip) => clip.start <= visibleRange.end && clip.start + clip.duration >= visibleRange.start,
      );
      if (clips.length) grouped.set(track.id, clips);
    }
    return grouped;
  }, [project, visibleRange]);

  /** The ids of every clip that is on screen. */
  const visibleClipIds = useMemo(() => {
    const ids = new Set<string>();
    for (const clips of visibleClips.values()) {
      for (const clip of clips) ids.add(clip.id);
    }
    return ids;
  }, [visibleClips]);

  /**
   * The visible clips of each track, in the order the tracks are drawn.
   *
   * The keyboard rules only need ids and times, so they work on plain
   * positions instead of the full clip.
   */
  const trackPositions = useMemo(
    () =>
      displayTracks.map((track) =>
        orderedClips(
          (visibleClips.get(track.id) ?? []).map((clip) => ({
            id: clip.id,
            start: clip.start,
            duration: clip.duration,
          })),
        ),
      ),
    [displayTracks, visibleClips],
  );

  /**
   * The clip that holds the tab stop of the timeline.
   *
   * The focused clip wins, then the selected one, and otherwise the first
   * clip on screen, so the timeline is always reachable with the keyboard.
   */
  const rovingClipId = useMemo(() => {
    if (focusedClipId && visibleClipIds.has(focusedClipId)) return focusedClipId;
    if (selectedClipId && visibleClipIds.has(selectedClipId)) return selectedClipId;
    for (const positions of trackPositions) {
      const first = positions[0];
      if (first) return first.id;
    }
    return null;
  }, [focusedClipId, selectedClipId, visibleClipIds, trackPositions]);

  // The ruler is only drawn where it can be seen. A one-second step over a
  // one-hour timeline would otherwise create thousands of ruler marks.
  const visibleTicks = useMemo(() => {
    if (!viewport.right) return ticks;
    // A tick at time t sits one label width into the scrolled content.
    const first = Math.max(0, Math.floor((viewport.left - LABEL_WIDTH) / zoom / step) - 1);
    const last = Math.min(ticks.length - 1, Math.ceil((viewport.right - LABEL_WIDTH) / zoom / step) + 1);
    return ticks.slice(first, last + 1);
  }, [ticks, viewport, step, zoom]);

  // The boundaries only change when a clip starts or ends somewhere else, so
  // they are rebuilt from a signature of the clip layout rather than from the
  // project object, which changes on every edit.
  const clipLayout = useMemo(
    () => project?.tracks.map((track) => track.clips.map((clip) => `${clip.start}:${clip.duration}`).join(",")).join("|") ?? "",
    [project],
  );
  const clipBoundaries = useMemo(
    () =>
      project
        ? buildSnapBoundaries(project.tracks.flatMap((track) => track.clips), [0, currentTime])
        : { values: [] as number[] },
    // The layout signature captures every start and duration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipLayout],
  );

  // The boundaries are captured when a drag starts. The dragged clip moves on
  // every pointer move, so rebuilding the sorted list each frame would cost
  // more than the drag itself.
  const dragBoundariesRef = useRef<{ values: number[] } | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setViewport({ left: element.scrollLeft, right: element.scrollLeft + element.clientWidth });
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    update();
    element.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const frameStarted = performance.now();
      const delta = (event.clientX - drag.startX) / zoom;
      const threshold = 9 / zoom;
      const state = useEditor.getState();
      const boundaries = dragBoundariesRef.current ?? clipBoundaries;

      if (drag.mode === "move") {
        let next = Math.max(0, drag.originalStart + delta);
        if (state.snap) next = Math.max(0, snapToBoundary(next, boundaries, threshold));
        state.updateClip(drag.clipId, { start: next }, false);
      } else if (drag.mode === "trim-start") {
        let next = Math.max(0, drag.originalStart + delta);
        if (state.snap) next = snapToBoundary(next, boundaries, threshold);
        state.trimClip(drag.clipId, "start", next);
      } else {
        let next = Math.max(0, drag.originalStart + drag.originalDuration + delta);
        if (state.snap) next = snapToBoundary(next, boundaries, threshold);
        state.trimClip(drag.clipId, "end", next);
      }
      // The handler time is what the user feels while dragging, so it is
      // recorded separately from the render that follows it.
      recordMetric("timeline drag", performance.now() - frameStarted);
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
      dragBoundariesRef.current = null;
      setDragging(false);
    };
    const onCancel = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      dragBoundariesRef.current = null;
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

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const close = () => setMenu(null);
    const onScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    // The first item takes focus, so the menu can be walked with the keyboard.
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
    first?.focus();
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

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
    // The snap candidates are captured once, so a drag does not rebuild the
    // sorted list on every pointer move.
    dragBoundariesRef.current = clipBoundaries;
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

  const openContextMenu = (event: ReactMouseEvent, track: Track) => {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-clip-id]");
    const clipId = target?.dataset.clipId;
    if (clipId) {
      selectClip(clipId);
      setPlaying(false);
    }
    setMenu({ x: event.clientX, y: event.clientY, trackId: track.id, clipId });
  };

  const menuTrack = menu ? project.tracks.find((track) => track.id === menu.trackId) : undefined;
  const menuClip = menu?.clipId
    ? project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === menu.clipId)
    : undefined;
  const menuClipAtPlayhead = Boolean(
    menuClip && currentTime > menuClip.start + 0.05 && currentTime < menuClip.start + menuClip.duration - 0.05,
  );

  const runMenuAction = (action: () => void) => {
    action();
    setMenu(null);
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      return;
    }
    if (event.key === "Tab") {
      setMenu(null);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1 + items.length) % items.length
          : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  /** Moves the keyboard focus to a clip that is on screen. */
  const focusClip = useCallback((clipId: string) => {
    setFocusedClipId(clipId);
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-clip-id="${clipId}"]`);
    element?.focus();
  }, []);

  /** Moves the focused clip along the timeline. */
  const moveClipWithKeyboard = (clip: Clip, direction: 1 | -1, coarse: boolean) => {
    const state = useEditor.getState();
    const step = nudgeStep(state.project?.fps ?? 30, coarse);
    const next = Math.max(0, clip.start + direction * step);
    if (Math.abs(next - clip.start) < 0.0001) return;
    state.recordSnapshot();
    state.updateClip(clip.id, { start: next }, false);
    announce(t("{name} moved to {time}.", { name: clip.name, time: formatClock(next, state.project?.fps ?? 30) }));
  };

  /** Drags one edge of the focused clip along the timeline. */
  const trimClipWithKeyboard = (clip: Clip, edge: "start" | "end", direction: 1 | -1, coarse: boolean) => {
    const state = useEditor.getState();
    const fps = state.project?.fps ?? 30;
    const step = nudgeStep(fps, coarse);
    const target = edge === "start"
      ? clip.start + direction * step
      : clip.start + clip.duration + direction * step;
    state.recordSnapshot();
    state.trimClip(clip.id, edge, target);
    // The trim clamps the edge to what the source allows, so the result is
    // read back rather than assumed.
    const updated = clipById(useEditor.getState(), clip.id);
    if (!updated) {
      announce(t("{name} trimmed.", { name: clip.name }));
      return;
    }
    announce(
      t(
        edge === "start" ? "{name} starts at {time}." : "{name} ends at {time}.",
        { name: clip.name, time: formatClock(edge === "start" ? updated.start : updated.start + updated.duration, fps) },
      ),
    );
  };

  /**
   * The keyboard model of the timeline.
   *
   * Plain arrows move the playhead, so the timeline adds its own levels:
   * Alt walks the clips, Ctrl moves the focused clip, and Ctrl+Alt drags
   * its edges.
   */
  const handleClipKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    clip: Clip,
    trackIndex: number,
  ) => {
    const state = useEditor.getState();
    const key = event.key;
    const trackClips = trackPositions[trackIndex] ?? [];

    if (key === "Enter" || key === " ") {
      event.preventDefault();
      event.stopPropagation();
      state.selectClip(clip.id);
      setCurrentTime(clip.start);
      announce(t("{name} selected at {time}.", { name: clip.name, time: formatDuration(clip.start) }));
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      state.selectClip(clip.id);
      state.deleteClip(clip.id);
      announce(t("{name} removed from the timeline.", { name: clip.name }));
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      state.selectClip(null);
      announce(t("Selection cleared."));
      return;
    }

    if (!event.altKey && !event.ctrlKey) return;

    if (event.altKey && !event.ctrlKey) {
      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        const next = nextClipInTrack(trackClips, clip.id, key === "ArrowRight" ? 1 : -1);
        if (next) focusClip(next.id);
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const found = adjacentTrackClip(trackPositions, trackIndex, key === "ArrowDown" ? 1 : -1, clip.start);
        if (found) focusClip(found.clip.id);
        return;
      }
    }

    if (event.ctrlKey && !event.altKey) {
      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        moveClipWithKeyboard(clip, key === "ArrowRight" ? 1 : -1, event.shiftKey);
        return;
      }
    }

    if (event.ctrlKey && event.altKey) {
      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        const direction: 1 | -1 = key === "ArrowRight" ? 1 : -1;
        // The arrow picks the edge, and Shift reverses which way it is
        // dragged: left trims the start, right trims the end.
        const edge = direction === 1 ? "end" : "start";
        trimClipWithKeyboard(clip, edge, event.shiftKey ? (direction === 1 ? -1 : 1) : direction, false);
        return;
      }
    }
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
      const boundaries = buildSnapBoundaries(
        currentProject.tracks.flatMap((item) => item.clips),
        [0, state.currentTime],
      );
      if (state.snap) time = Math.max(0, snapToBoundary(time, boundaries, 9 / state.zoom));
      state.recordSnapshot();
      state.addClip(assetId, targetTrack.id, time);
      setDropTrack(null);
    };

    window.addEventListener("librecut:asset-drop", onAssetDrop);
    return () => window.removeEventListener("librecut:asset-drop", onAssetDrop);
  }, []);

  return (
    <section
      style={{ height }}
      aria-label={t("Timeline")}
      className="flex min-h-[180px] shrink-0 flex-col border-t border-line-soft bg-panel/55"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-3">
        <div className="flex items-center gap-1">
          <span className="mr-2 font-mono text-[11px] tabular-nums text-muted" aria-label={t("Playhead at {time}", { time: formatClock(currentTime, project.fps) })}>
            {formatClock(currentTime, project.fps)}
          </span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={undo} disabled={undoDepth === 0} title={t("Undo (Ctrl+Z)")} aria-label={t("Undo")}>
            <Undo2 size={14} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={redo} disabled={redoDepth === 0} title={t("Redo (Ctrl+Y)")} aria-label={t("Redo")}>
            <Redo2 size={14} />
          </button>
          <div className="mx-1 h-4 w-px bg-line" />
          <button className="btn btn-ghost btn-sm" onClick={splitAtPlayhead} title={t("Split at playhead (S)")}>
            <Scissors size={13} /> {t("Split")}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={deleteSelected} title={t("Delete selected clip (Del)")} aria-label={t("Delete selected clip")}>
            <Trash2 size={14} />
          </button>
          <div className="mx-1 h-4 w-px bg-line" />
          <button
            className={`btn btn-sm ${snap ? "btn-secondary text-accent" : "btn-ghost"}`}
            onClick={toggleSnap}
            title={t("Toggle snapping")}
            aria-pressed={snap}
          >
            <Magnet size={13} /> {t("Snap")}
          </button>
          <button
            className={`btn btn-sm ${ripple ? "btn-secondary text-accent" : "btn-ghost"}`}
            onClick={toggleRipple}
            title={t("Ripple edits: trims and deletes shift later clips")}
            aria-pressed={ripple}
          >
            <ChevronsRight size={13} /> {t("Ripple")}
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
                  title={t("Add {kind} track", { kind: t(kind) })}
                  aria-label={t("Add {kind} track", { kind: t(kind) })}
                >
                  <Plus size={11} /> <Icon size={12} />
                </button>
              );
            })}
            <button className="btn btn-secondary btn-sm px-2" onClick={() => addEffectClip()} title={t("Add a color filter clip")} aria-label={t("Add a color filter clip")}>
              <SlidersHorizontal size={12} /> {t("Filter")}
            </button>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(zoom - 12)} title={t("Zoom out")} aria-label={t("Zoom out")}>
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
            title={t("Timeline zoom")}
            aria-label={t("Timeline zoom")}
            aria-valuetext={t("{pixels} pixels per second", { pixels: Math.round(zoom) })}
          />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(zoom + 12)} title={t("Zoom in")} aria-label={t("Zoom in")}>
            <ZoomIn size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fitZoom} title={t("Fit timeline")}>
            {t("Fit")}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative min-h-full" style={{ width: LABEL_WIDTH + contentWidth }}>
          <div className="sticky top-0 z-30 flex border-b border-line-soft bg-panel">
            <div className="sticky left-0 z-40 flex h-8 shrink-0 items-center border-r border-line-soft bg-panel px-3" style={{ width: LABEL_WIDTH }}>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-dim">{t("Tracks")}</span>
            </div>
            <div
              data-timeline-ruler
              // The ruler repeats the timecode of the playhead readout, so it
              // is decoration for a screen reader rather than content.
              aria-hidden="true"
              className="relative h-8 shrink-0 cursor-ew-resize select-none"
              style={{ width: contentWidth }}
              onPointerDown={beginScrub}
            >
              {visibleTicks.map((time) => (
                <div key={time} className="absolute top-0 h-full" style={{ left: time * zoom }}>
                  <div className="h-2 w-px bg-line" />
                  <span className="absolute left-1 top-2 whitespace-nowrap font-mono text-[9px] text-dim">
                    {rulerLabel(time, step)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {displayTracks.map((track, trackIndex) => {
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
                  onContextMenu={(event) => openContextMenu(event, track)}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={12} aria-hidden="true" className={track.kind === "text" ? "text-blue" : track.kind === "audio" ? "text-mint" : track.kind === "misc" ? "text-amber" : "text-accent"} />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink/90">{track.name}</span>
                    {track.magnetic ? <span className="rounded border border-accent/40 bg-accent-soft px-1 py-0.5 font-mono text-[8px] leading-none text-accent" title={t("Magnetic main track")}>MAIN</span> : null}
                    {track.ducking?.enabled ? <span className="rounded border border-mint/40 bg-mint/10 px-1 py-0.5 font-mono text-[8px] leading-none text-mint" title={t("Ducking under other audio")}>DUCK</span> : null}
                    <span className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-mono text-[8px] leading-none text-dim" title={t("{kind} layer {number}", { kind: t(track.kind), number: layerNumber })}>
                      {layerTag}{layerNumber}
                    </span>
                    <span className="text-[9px] text-dim">{track.clips.length}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {track.kind === "audio" || track.kind === "video" ? (
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                        onClick={() => updateTrack(track.id, { muted: !track.muted })}
                        title={track.muted ? t("Unmute track") : t("Mute track")}
                        aria-label={t("{action} {name}", { action: track.muted ? t("Unmute") : t("Mute"), name: track.name })}
                        aria-pressed={track.muted}
                      >
                        {track.muted ? <VolumeX size={11} aria-hidden="true" /> : <Volume2 size={11} aria-hidden="true" />}
                      </button>
                    ) : null}
                    {track.kind !== "audio" ? (
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                        onClick={() => updateTrack(track.id, { hidden: !track.hidden })}
                        title={track.hidden ? t("Show track") : t("Hide track")}
                        aria-label={t("{action} {name}", { action: track.hidden ? t("Show") : t("Hide"), name: track.name })}
                        aria-pressed={track.hidden}
                      >
                        {track.hidden ? <EyeOff size={11} aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />}
                      </button>
                    ) : null}
                    {track.kind === "video" ? (
                      <button
                        className={`flex h-5 w-5 items-center justify-center rounded transition hover:bg-white/5 ${track.magnetic ? "text-accent" : "text-dim hover:text-ink"}`}
                        onClick={() => setMagneticTrack(track.magnetic ? null : track.id)}
                        title={track.magnetic ? t("Disable magnetic main track") : t("Make this the magnetic main track")}
                        aria-pressed={Boolean(track.magnetic)}
                        aria-label={t("{action} {name} the magnetic main track", { action: track.magnetic ? t("Disable") : t("Make"), name: track.name })}
                      >
                        <Magnet size={11} aria-hidden="true" />
                      </button>
                    ) : null}
                    {track.kind === "audio" || track.kind === "video" ? (
                      <button
                        className={`flex h-5 w-5 items-center justify-center rounded transition hover:bg-white/5 ${track.ducking?.enabled ? "text-mint" : "text-dim hover:text-ink"}`}
                        onClick={() => updateTrack(track.id, { ducking: { ...DEFAULT_DUCKING, ...track.ducking, enabled: !track.ducking?.enabled } })}
                        title={track.ducking?.enabled ? t("Disable ducking on this track") : t("Duck this track under other audio")}
                        aria-pressed={Boolean(track.ducking?.enabled)}
                        aria-label={t("{action} ducking on {name}", { action: track.ducking?.enabled ? t("Disable") : t("Enable"), name: track.name })}
                      >
                        <AudioWaveform size={11} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                      onClick={() => updateTrack(track.id, { locked: !track.locked })}
                      title={track.locked ? t("Unlock track") : t("Lock track")}
                      aria-label={t("{action} {name}", { action: track.locked ? t("Unlock") : t("Lock"), name: track.name })}
                      aria-pressed={track.locked}
                    >
                      {track.locked ? <Lock size={11} aria-hidden="true" /> : <Unlock size={11} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                <div
                  className={`relative shrink-0 transition-colors ${
                    dropTrack === track.id ? "bg-accent-soft/60" : track.hidden ? "bg-[#101013]" : displayTracks.indexOf(track) % 2 === 0 ? "bg-[#121216]" : "bg-[#14151a]"
                  }`}
                  data-timeline-track={track.id}
                  role="listbox"
                  aria-label={t("{name} clips", { name: track.name })}
                  onContextMenu={(event) => openContextMenu(event, track)}
                  style={{
                    width: contentWidth,
                    height,
                    backgroundImage:
                      "repeating-linear-gradient(to right, #ffffff08 0, #ffffff08 1px, transparent 1px, transparent 100%)",
                    backgroundSize: `${Math.max(8, step * zoom)}px 100%`,
                  }}
                  onPointerDown={beginScrub}
                >
                  {visibleClips
                    .get(track.id)
                    ?.slice()
                    .sort((a, b) => a.start - b.start)
                    .map((clip) => (
                      <TimelineClip
                        key={clip.id}
                        clip={clip}
                        track={track}
                        asset={assetForClip(project, clip)}
                        selected={clip.id === selectedClipId}
                        focusable={clip.id === rovingClipId}
                        zoom={zoom}
                        height={height}
                        dragging={dragging && clip.id === selectedClipId}
                        onPointerDown={(event, mode) => beginInteraction(event, clip, track, mode)}
                        onKeyDown={(event) => handleClipKeyDown(event, clip, trackIndex)}
                        onFocus={() => setFocusedClipId(clip.id)}
                      />
                    ))}
                </div>
              </div>
            );
          })}

          <div className="flex" style={{ width: LABEL_WIDTH + contentWidth }}>
            <div className="sticky left-0 z-20 flex h-10 shrink-0 items-center border-r border-line-soft bg-[#17171b] px-2.5" style={{ width: LABEL_WIDTH }}>
              <button className="flex items-center gap-1 text-[10px] text-dim transition hover:text-ink" onClick={() => addTrack("video")}>
                <Plus size={11} /> {t("Add track")}
              </button>
            </div>
            <div className="h-10 flex-1 bg-[#121216]" />
          </div>

          <div
            className="pointer-events-none absolute top-0 z-10 w-px bg-accent"
            aria-hidden="true"
            style={{ left: LABEL_WIDTH + currentTime * zoom, height: 32 + project.tracks.reduce((sum, track) => sum + trackHeight(track.kind), 0) + 40 }}
          >
            <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-accent shadow-lg shadow-accent/30" />
          </div>
        </div>
      </div>

      {menu && menuTrack ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("Quick actions for {name}", { name: menuTrack.name })}
          onKeyDown={handleMenuKeyDown}
          className="animate-fade-in fixed z-[80] w-60 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-2xl shadow-black/60"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 440)),
            maxHeight: "min(72vh, 520px)",
          }}
        >
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-raised text-accent">
              {(() => {
                const MenuIcon = trackIcon(menuTrack.kind);
                return <MenuIcon size={12} aria-hidden="true" />;
              })()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-ink">{menuClip ? menuClip.name : menuTrack.name}</div>
              <div className="text-[9px] text-dim">
                {menuClip ? t("{name} · {kind} clip", { name: menuTrack.name, kind: t(menuClip.kind) }) : t("{kind} track · quick actions", { kind: t(menuTrack.kind) })}
              </div>
            </div>
          </div>
          <div className="my-1 h-px bg-line-soft" />

          {menuClip ? (
            <>
              <MenuLabel>{t("Clip")}</MenuLabel>
              <MenuRow
                icon={Scissors}
                label={t("Split at playhead")}
                shortcut="S"
                disabled={!menuClipAtPlayhead}
                onClick={() => runMenuAction(splitAtPlayhead)}
              />
              <MenuRow icon={Copy} label={t("Duplicate clip")} shortcut="Ctrl+D" onClick={() => runMenuAction(() => useEditor.getState().duplicateClip(menuClip.id))} />
              <MenuRow icon={Trash2} label={t("Delete clip")} shortcut="Del" danger onClick={() => runMenuAction(() => useEditor.getState().deleteClip(menuClip.id))} />

              <MenuLabel>{t("Speed")}</MenuLabel>
              <MenuRow
                icon={Gauge}
                label={t("Ramp up  0.5× → 2×")}
                onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
                  speedRamp: normalizeSpeedRamp([{ time: 0, speed: 0.5 }, { time: menuClip.duration, speed: 2 }], menuClip.duration),
                }))}
              />
              <MenuRow
                icon={Gauge}
                label={t("Ramp down  2× → 0.5×")}
                onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
                  speedRamp: normalizeSpeedRamp([{ time: 0, speed: 2 }, { time: menuClip.duration, speed: 0.5 }], menuClip.duration),
                }))}
              />
              <MenuRow
                icon={Gauge}
                label={t("Bullet time")}
                onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
                  speedRamp: normalizeSpeedRamp([
                    { time: 0, speed: 1 },
                    { time: menuClip.duration / 2, speed: 0.3 },
                    { time: menuClip.duration, speed: 1 },
                  ], menuClip.duration),
                }))}
              />
              <MenuRow
                icon={Gauge}
                label={t("Clear speed ramp")}
                disabled={!menuClip.speedRamp?.length}
                onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, { speedRamp: [] }))}
              />

              <MenuLabel>{t("Transition")}</MenuLabel>
              <MenuRow
                icon={ChevronsRight}
                label={t("Crossfade in · 0.5s")}
                checked={menuClip.transitionIn.type !== "none"}
                onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
                  transitionIn: menuClip.transitionIn.type === "none"
                    ? { type: "fade", duration: Math.min(0.5, menuClip.duration) }
                    : { ...menuClip.transitionIn, type: "none" },
                }))}
              />
              <MenuRow
                icon={ChevronsRight}
                label={t("Crossfade out · 0.5s")}
                checked={menuClip.transitionOut.type !== "none"}
                onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
                  transitionOut: menuClip.transitionOut.type === "none"
                    ? { type: "fade", duration: Math.min(0.5, menuClip.duration) }
                    : { ...menuClip.transitionOut, type: "none" },
                }))}
              />
            </>
          ) : null}

          <MenuLabel>{t("Track")}</MenuLabel>
          {menuTrack.kind === "audio" || menuTrack.kind === "video" ? (
            <MenuRow
              icon={menuTrack.muted ? VolumeX : Volume2}
              label={menuTrack.muted ? t("Unmute track") : t("Mute track")}
              checked={menuTrack.muted}
              onClick={() => runMenuAction(() => updateTrack(menuTrack.id, { muted: !menuTrack.muted }))}
            />
          ) : null}
          {menuTrack.kind !== "audio" ? (
            <MenuRow
              icon={menuTrack.hidden ? EyeOff : Eye}
              label={menuTrack.hidden ? t("Show track") : t("Hide track")}
              checked={menuTrack.hidden}
              onClick={() => runMenuAction(() => updateTrack(menuTrack.id, { hidden: !menuTrack.hidden }))}
            />
          ) : null}
          <MenuRow
            icon={menuTrack.locked ? Unlock : Lock}
            label={menuTrack.locked ? t("Unlock track") : t("Lock track")}
            checked={menuTrack.locked}
            onClick={() => runMenuAction(() => updateTrack(menuTrack.id, { locked: !menuTrack.locked }))}
          />
          {menuTrack.kind === "video" ? (
            <MenuRow
              icon={Magnet}
              label={menuTrack.magnetic ? t("Disable main track") : t("Make main track")}
              checked={Boolean(menuTrack.magnetic)}
              onClick={() => runMenuAction(() => setMagneticTrack(menuTrack.magnetic ? null : menuTrack.id))}
            />
          ) : null}
          {menuTrack.kind === "audio" || menuTrack.kind === "video" ? (
            <MenuRow
              icon={AudioWaveform}
              label={menuTrack.ducking?.enabled ? t("Disable ducking") : t("Duck under other audio")}
              checked={Boolean(menuTrack.ducking?.enabled)}
              onClick={() => runMenuAction(() => updateTrack(menuTrack.id, {
                ducking: { ...DEFAULT_DUCKING, ...menuTrack.ducking, enabled: !menuTrack.ducking?.enabled },
              }))}
            />
          ) : null}

          <MenuLabel>{t("Add")}</MenuLabel>
          <MenuRow icon={Film} label={t("Video track")} onClick={() => runMenuAction(() => addTrack("video"))} />
          <MenuRow icon={Music2} label={t("Audio track")} onClick={() => runMenuAction(() => addTrack("audio"))} />
          <MenuRow icon={Type} label={t("Text track")} onClick={() => runMenuAction(() => addTrack("text"))} />
          <MenuRow icon={SlidersHorizontal} label={t("Color filter at playhead")} onClick={() => runMenuAction(() => addEffectClip(undefined, currentTime))} />

          <MenuLabel>{t("Timeline")}</MenuLabel>
          <MenuRow icon={Magnet} label={t("Snapping")} checked={snap} onClick={() => runMenuAction(toggleSnap)} />
          <MenuRow icon={ChevronsRight} label={t("Ripple edits")} checked={ripple} onClick={() => runMenuAction(toggleRipple)} />
          <MenuRow icon={ZoomIn} label={t("Fit timeline")} onClick={() => runMenuAction(fitZoom)} />
        </div>
      ) : null}
    </section>
  );
}

function MenuLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[8.5px] font-semibold uppercase tracking-[0.13em] text-dim/80">
      {children}
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  shortcut,
  disabled,
  danger,
  checked,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-error hover:bg-error/10" : checked ? "text-accent hover:bg-accent-soft/60" : "text-muted hover:bg-white/5 hover:text-ink"
      }`}
      onClick={onClick}
    >
      <Icon size={12} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="font-mono text-[9px] text-dim">{shortcut}</span> : null}
      {checked !== undefined ? <span className={`h-1.5 w-1.5 rounded-full ${checked ? "bg-accent" : "bg-line"}`} aria-hidden="true" /> : null}
    </button>
  );
}


function TimelineClip({
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
