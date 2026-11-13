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
import { Plus } from "lucide-react";
import {
  assetForClip,
  clipById,
  useEditor,
} from "../../stores/editor";
import { cachedProjectDuration, clamp, formatClock, formatDuration } from "../../lib/time";
import { buildSnapBoundaries, snapToBoundary, visibleTimeRange } from "../../lib/snap";
import { recordMetric } from "../../lib/metrics";
import { announce } from "../../lib/announce";
import { useT } from "../../lib/i18n";
import {
  adjacentTrackClip,
  nextClipInTrack,
  nudgeStep,
  orderedClips,
} from "../../lib/timelineKeyboard";
import type { Clip, Track } from "../../lib/types";
import { TimelineClip } from "./timeline/TimelineClip";
import { TimelineContextMenu, type TimelineMenuState } from "./timeline/TimelineContextMenu";
import {
  LABEL_WIDTH,
  MIN_ZOOM,
  MAX_ZOOM,
  VISIBLE_MARGIN_SECONDS,
  rulerLabel,
  rulerStep,
  trackHeight,
  trackIcon,
  type DragMode,
  type DragState,
} from "./timeline/geometry";
import { TimelineToolbar } from "./timeline/TimelineToolbar";
import { TimelineTrackHeader } from "./timeline/TimelineTrackHeader";

export function Timeline({ height = 310 }: { height?: number }) {
  const project = useEditor((state) => state.project);
  const currentTime = useEditor((state) => state.currentTime);
  const selectedClipId = useEditor((state) => state.selectedClipId);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const zoom = useEditor((state) => state.zoom);
  const setZoom = useEditor((state) => state.setZoom);
  const setCurrentTime = useEditor((state) => state.setCurrentTime);
  const setPlaying = useEditor((state) => state.setPlaying);
  const addTrack = useEditor((state) => state.addTrack);
  const selectClip = useEditor((state) => state.selectClip);
  const t = useT();

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; marquee: boolean; additive: boolean } | null>(null);
  const marqueeRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    base: string[];
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState({ left: 0, right: 0 });
  /**
   * The clip that holds the keyboard focus.
   *
   * The timeline is a listbox per track, so only one clip is a tab stop and
   * the arrow keys move the focus between the rest.
   */
  const [focusedClipId, setFocusedClipId] = useState<string | null>(null);
  const [menu, setMenu] = useState<TimelineMenuState | null>(null);
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

  // Keep the playhead in view while playback runs or an edit moves it.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const x = LABEL_WIDTH + currentTime * zoom;
    const viewLeft = element.scrollLeft + LABEL_WIDTH;
    const viewRight = element.scrollLeft + element.clientWidth;
    if (x < viewLeft || x > viewRight - 16) {
      element.scrollLeft = Math.max(0, x - LABEL_WIDTH - element.clientWidth * 0.35);
    }
  }, [currentTime, zoom]);

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
        const applied = next - drag.originalStart;
        if (Math.abs(applied) < 1e-6) return;
        // Selecting a clip is not an undo step. The snapshot is taken when the
        // pointer first moves, so the first Ctrl+Z after a click undoes an edit.
        if (!drag.snapshotTaken) {
          state.recordSnapshot();
          drag.snapshotTaken = true;
        }
        state.setClipStarts(
          drag.members.map((member) => ({
            clipId: member.clipId,
            start: Math.max(0, member.originalStart + applied),
          })),
          false,
        );
      } else {
        if (Math.abs(delta) < 1e-6) return;
        if (!drag.snapshotTaken) {
          state.recordSnapshot();
          drag.snapshotTaken = true;
        }
        if (drag.mode === "trim-start") {
          let next = Math.max(0, drag.originalStart + delta);
          if (state.snap) next = snapToBoundary(next, boundaries, threshold);
          state.trimClip(drag.clipId, "start", next);
        } else {
          let next = Math.max(0, drag.originalStart + drag.originalDuration + delta);
          if (state.snap) next = snapToBoundary(next, boundaries, threshold);
          state.trimClip(drag.clipId, "end", next);
        }
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
        const state = useEditor.getState();
        const targetTrack = state.project?.tracks.find((track) => track.id === targetTrackId);
        if (targetTrack && targetTrackId !== drag.trackId) {
          // Move every dragged clip that the target track can hold, in one undo
          // step. A video clip dropped on an audio track is still refused.
          const ids = drag.members
            .filter((member) => {
              const source = state.project?.tracks.find((track) => track.id === member.trackId);
              return source?.kind === targetTrack.kind;
            })
            .map((member) => member.clipId);
          if (ids.length) state.moveClipsToTrack(ids, targetTrack.id, !drag.snapshotTaken);
        }
      }
      dragRef.current = null;
      dragBoundariesRef.current = null;
      setDragging(false);
      setDropTrack(null);
    };
    const onCancel = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      dragBoundariesRef.current = null;
      setDragging(false);
      setDropTrack(null);
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
    const updateMarqueeBox = (event: PointerEvent) => {
      const box = marqueeRef.current;
      const content = contentRef.current;
      if (!box || !content) return;
      box.currentX = event.clientX;
      box.currentY = event.clientY;
      const rect = content.getBoundingClientRect();
      const left = Math.min(box.startX, box.currentX) - rect.left;
      const top = Math.min(box.startY, box.currentY) - rect.top;
      setMarqueeBox({
        left,
        top,
        width: Math.abs(box.currentX - box.startX),
        height: Math.abs(box.currentY - box.startY),
      });
    };

    const selectInMarquee = () => {
      const box = marqueeRef.current;
      const content = contentRef.current;
      if (!box || !content) return;
      const left = Math.min(box.startX, box.currentX);
      const right = Math.max(box.startX, box.currentX);
      const top = Math.min(box.startY, box.currentY);
      const bottom = Math.max(box.startY, box.currentY);
      const ids = new Set(box.base);
      content.querySelectorAll<HTMLElement>("[data-clip-id]").forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
          const id = element.dataset.clipId;
          if (id) ids.add(id);
        }
      });
      useEditor.getState().setClipSelection([...ids]);
    };

    const onMove = (event: PointerEvent) => {
      if (scrubRef.current) {
        const start = pointerStartRef.current;
        if (start?.marquee && !marqueeRef.current) {
          const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
          if (moved > 4) {
            scrubRef.current = false;
            marqueeRef.current = {
              startX: start.x,
              startY: start.y,
              currentX: event.clientX,
              currentY: event.clientY,
              base: start.additive ? useEditor.getState().selectedClipIds : [],
            };
            updateMarqueeBox(event);
            return;
          }
        }
        if (marqueeRef.current) {
          updateMarqueeBox(event);
          return;
        }
        const target = document.querySelector<HTMLElement>("[data-timeline-ruler]");
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const time = clamp((event.clientX - rect.left) / zoom, 0, timelineDuration);
        setCurrentTime(time);
        return;
      }
      if (marqueeRef.current) updateMarqueeBox(event);
    };

    const onUp = () => {
      if (marqueeRef.current) {
        selectInMarquee();
        marqueeRef.current = null;
        setMarqueeBox(null);
      } else if (scrubRef.current && pointerStartRef.current?.marquee && !pointerStartRef.current.additive) {
        // A plain click on empty timeline space clears the selection.
        useEditor.getState().setClipSelection([]);
      }
      scrubRef.current = false;
      pointerStartRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
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
    const additive = event.ctrlKey || event.metaKey;
    const range = event.shiftKey;
    if (range || additive) {
      selectClip(clip.id, { additive, range, trackId: track.id });
      return;
    }
    if (mode !== "move") {
      selectClip(clip.id);
    } else if (!selectedClipIds.includes(clip.id)) {
      selectClip(clip.id);
    }
    const selection = useEditor.getState().selectedClipIds;
    const memberIds = mode === "move" && selection.includes(clip.id)
      ? selection
      : [clip.id];
    const members = memberIds.flatMap((id) => {
      for (const sourceTrack of project.tracks) {
        const sourceClip = sourceTrack.clips.find((item) => item.id === id);
        if (sourceClip) {
          return [{ clipId: sourceClip.id, trackId: sourceTrack.id, originalStart: sourceClip.start }];
        }
      }
      return [];
    });
    dragRef.current = {
      mode,
      clipId: clip.id,
      trackId: track.id,
      startX: event.clientX,
      originalStart: clip.start,
      originalDuration: clip.duration,
      members: members.length ? members : [{ clipId: clip.id, trackId: track.id, originalStart: clip.start }],
      snapshotTaken: false,
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
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      marquee: !target.hasAttribute("data-timeline-ruler"),
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
    };
    const rect = target.getBoundingClientRect();
    const time = clamp((event.clientX - rect.left) / zoom, 0, timelineDuration);
    setCurrentTime(time);
  };

  const openContextMenu = (event: ReactMouseEvent, track: Track) => {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-clip-id]");
    const clipId = target?.dataset.clipId;
    if (clipId) {
      if (!useEditor.getState().selectedClipIds.includes(clipId)) selectClip(clipId);
      setPlaying(false);
    }
    setMenu({ x: event.clientX, y: event.clientY, trackId: track.id, clipId });
  };

  /** Moves the keyboard focus to a clip that is on screen. */
  const focusClip = useCallback((clipId: string) => {
    setFocusedClipId(clipId);
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-clip-id="${clipId}"]`);
    element?.focus();
  }, []);

  /** Moves the focused clip, or the whole selection, along the timeline. */
  const moveClipWithKeyboard = (clip: Clip, direction: 1 | -1, coarse: boolean) => {
    const state = useEditor.getState();
    const step = nudgeStep(state.project?.fps ?? 30, coarse);
    if (state.selectedClipIds.length > 1 && state.selectedClipIds.includes(clip.id)) {
      state.moveSelectedClips(direction * step);
      announce(t("{count} clips moved.", { count: state.selectedClipIds.length }));
      return;
    }
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
      if (state.selectedClipIds.includes(clip.id) && state.selectedClipIds.length > 1) {
        const count = state.selectedClipIds.length;
        state.deleteSelected();
        announce(t("{count} clips removed from the timeline.", { count }));
      } else {
        state.selectClip(clip.id);
        state.deleteClip(clip.id);
        announce(t("{name} removed from the timeline.", { name: clip.name }));
      }
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
      <TimelineToolbar onFit={fitZoom} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div ref={contentRef} className="relative min-h-full" style={{ width: LABEL_WIDTH + contentWidth }}>
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
            const layerNumber = project.tracks
              .slice(0, project.tracks.indexOf(track) + 1)
              .filter((item) => item.kind === track.kind).length;
            const layerTag = track.kind === "video" ? "V" : track.kind === "audio" ? "A" : track.kind === "text" ? "T" : "M";
            return (
              <div key={track.id} className="flex border-b border-line-soft">
                <TimelineTrackHeader
                  track={track}
                  height={height}
                  layerNumber={layerNumber}
                  layerTag={layerTag}
                  onContextMenu={(event) => openContextMenu(event, track)}
                />

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
                        selected={selectedClipIds.includes(clip.id)}
                        focusable={clip.id === rovingClipId}
                        zoom={zoom}
                        height={height}
                        dragging={dragging && selectedClipIds.includes(clip.id)}
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
            <div className="sticky left-0 z-20 flex h-10 shrink-0 items-center gap-0.5 border-r border-line-soft bg-[#17171b] px-2" style={{ width: LABEL_WIDTH }}>
              <span className="mr-1 text-[10px] text-dim">{t("Add")}</span>
              {(["video", "audio", "text", "misc"] as const).map((kind) => {
                const Icon = trackIcon(kind);
                return (
                  <button
                    key={kind}
                    className="flex h-6 w-6 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
                    onClick={() => addTrack(kind)}
                    title={t("Add {kind} track", { kind: t(kind) })}
                    aria-label={t("Add {kind} track", { kind: t(kind) })}
                  >
                    <Plus size={9} aria-hidden="true" />
                    <Icon size={11} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <div className="h-10 flex-1 bg-[#121216]" />
          </div>

          {marqueeBox ? (
            <div
              className="pointer-events-none absolute z-20 border border-accent bg-accent-soft"
              aria-hidden="true"
              style={{
                left: marqueeBox.left,
                top: marqueeBox.top,
                width: marqueeBox.width,
                height: marqueeBox.height,
              }}
            />
          ) : null}

          <div
            className="pointer-events-none absolute top-0 z-10 w-px bg-accent"
            aria-hidden="true"
            style={{ left: LABEL_WIDTH + currentTime * zoom, height: 32 + project.tracks.reduce((sum, track) => sum + trackHeight(track.kind), 0) + 40 }}
          >
            <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-accent shadow-lg shadow-accent/30" />
          </div>
        </div>
      </div>

      {menu ? (
        <TimelineContextMenu
          menu={menu}
          menuRef={menuRef}
          onClose={() => setMenu(null)}
          onFit={fitZoom}
        />
      ) : null}
    </section>
  );
}

