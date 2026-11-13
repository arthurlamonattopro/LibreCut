import { produce } from "immer";
import { create } from "zustand";
import type { Asset, AudioCompressor, Clip, ColorEffectOptions, LutSettings, Project, TextOptions, Track, TrackKind } from "../lib/types";
import { clamp, cachedProjectDuration } from "../lib/time";
import {
  compactMagneticTrack,
  findClip,
  findFreeStart,
  neighborBounds,
  removeClips,
  rippleTrimEnd,
  rippleTrimStart,
} from "../lib/timeline";
import { sliceSpeedRamp } from "../lib/speed";
import {
  DEFAULT_BASS_FREQUENCY,
  DEFAULT_COMPRESSOR,
  DEFAULT_MID_FREQUENCY,
  DEFAULT_MID_WIDTH,
  DEFAULT_TREBLE_FREQUENCY,
} from "../lib/audio";
import { createTrack, newId } from "./projects";
import { t } from "../lib/i18n";

export type ClipPatch = Omit<Partial<Clip>, "text" | "effect" | "compressor" | "lut"> & {
  text?: Partial<TextOptions>;
  effect?: Partial<ColorEffectOptions>;
  compressor?: Partial<AudioCompressor>;
  lut?: LutSettings;
};

/** Everything that an undo step restores, not only the project document. */
export interface EditorSnapshot {
  project: Project;
  selectedClipIds: string[];
  selectedClipId: string | null;
  selectionAnchorId: string | null;
  currentTime: number;
  zoom: number;
  snap: boolean;
  ripple: boolean;
}

export interface SelectClipOptions {
  /** Ctrl/Cmd-click: add the clip, or remove it when it is already selected. */
  additive?: boolean;
  /** Shift-click: select the range from the anchor to this clip. */
  range?: boolean;
  /** The track that owns the clicked clip, used for range selection. */
  trackId?: string;
}

interface EditorState {
  project: Project | null;
  currentTime: number;
  playing: boolean;
  /** The primary selection, kept for the inspector and the preview. */
  selectedClipId: string | null;
  /** Every selected clip. */
  selectedClipIds: string[];
  /** The clip a Shift-click range grows from. */
  selectionAnchorId: string | null;
  zoom: number;
  snap: boolean;
  ripple: boolean;
  dirty: boolean;
  savedAt: number;
  /**
   * Counts changes to the regenerable media caches. The caches are stored
   * apart from the project document, so the editor writes them out when this
   * number changes.
   */
  mediaRevision: number;
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  openProject: (project: Project) => void;
  closeProject: () => void;
  renameProject: (name: string) => void;
  addAsset: (asset: Asset) => void;
  replaceAsset: (assetId: string, patch: Partial<Asset>) => void;
  removeAsset: (assetId: string) => void;
  addClip: (assetId: string, trackId?: string, start?: number) => void;
  extractAudio: (clipId: string) => void;
  addTextClip: (text?: string, at?: number, style?: Partial<TextOptions>) => void;
  importSubtitleCues: (cues: Array<{ start: number; end: number; text: string }>) => void;
  addEffectClip: (preset?: { name: string; effect: Partial<ColorEffectOptions> }, at?: number) => void;
  addTrack: (kind: TrackKind) => void;
  deleteTrack: (trackId: string) => void;
  moveTrack: (trackId: string, direction: 1 | -1) => void;
  moveTrackUp: (trackId: string) => void;
  moveTrackDown: (trackId: string) => void;
  reorderTrack: (trackId: string, targetIndex: number) => void;
  moveClipToTrack: (clipId: string, trackId: string) => void;
  moveClipsToTrack: (clipIds: string[], trackId: string, record?: boolean) => void;
  updateClip: (clipId: string, patch: ClipPatch, record?: boolean) => void;
  trimClip: (clipId: string, edge: "start" | "end", time: number) => void;
  splitClip: (clipId: string, time: number) => void;
  splitAtPlayhead: () => void;
  duplicateClip: (clipId: string) => void;
  duplicateSelected: () => void;
  deleteClip: (clipId: string) => void;
  deleteClips: (clipIds: string[]) => void;
  deleteSelected: () => void;
  selectClip: (clipId: string | null, options?: boolean | SelectClipOptions) => void;
  setClipSelection: (clipIds: string[]) => void;
  selectClips: (clipIds: string[]) => void;
  toggleClipSelection: (clipId: string) => void;
  selectClipRange: (clipId: string, trackId?: string, additive?: boolean) => void;
  selectAll: () => void;
  updateTrack: (trackId: string, patch: Partial<Track>, record?: boolean) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;
  toggleRipple: () => void;
  setMagneticTrack: (trackId: string | null) => void;
  settleMagneticTrack: (trackId: string) => void;
  /** Applies absolute starts to a group of clips in one undo step. */
  setClipStarts: (moves: Array<{ clipId: string; start: number }>, record?: boolean) => void;
  /** Nudges every selected clip by the same amount. */
  moveSelectedClips: (delta: number, record?: boolean) => void;
  recordSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  mutate: (fn: (project: Project) => void, record?: boolean) => void;
}

function findAvailableTrack(
  project: Project,
  kind: TrackKind,
  start: number,
  duration: number,
  preferredTrackId?: string,
): Track | undefined {
  const overlaps = (track: Track) => track.clips.some((clip) =>
    start < clip.start + clip.duration && start + duration > clip.start,
  );
  const preferred = preferredTrackId
    ? project.tracks.find((track) => track.id === preferredTrackId && track.kind === kind)
    : undefined;
  if (preferred && !preferred.locked) {
    if (!overlaps(preferred) || preferred.magnetic) return preferred;
    // The user targeted a specific, occupied non-magnetic track.
    return undefined;
  }
  if (!preferredTrackId) {
    // The magnetic main track accepts inserts even when the drop point is
    // occupied; its clips are repacked in order afterwards.
    const magnetic = project.tracks.find((track) => track.kind === kind && track.magnetic && !track.locked);
    if (magnetic) return magnetic;
  }
  return project.tracks.find((track) => track.kind === kind && !track.locked && !overlaps(track));
}

function createLayer(project: Project, kind: TrackKind): Track {
  const count = project.tracks.filter((track) => track.kind === kind).length + 1;
  const label = kind === "video" ? t("Video") : kind === "audio" ? t("Audio") : kind === "text" ? t("Text") : t("Misc");
  const track = createTrack(kind, `${label} ${count}`);
  let insertAt = project.tracks.length;
  for (let index = project.tracks.length - 1; index >= 0; index -= 1) {
    if (project.tracks[index].kind === kind) {
      insertAt = index + 1;
      break;
    }
  }
  project.tracks.splice(insertAt, 0, track);
  return track;
}

/**
 * The number of undo steps to keep.
 *
 * The clip count is read from a cached total, because this runs on every
 * mutation and counting the clips of a long timeline each time would cost
 * more than the edit itself.
 */
function historyLimit(project: Project): number {
  const clips = cachedClipCount(project);
  if (clips > 2_000 || project.assets.length > 500) return 8;
  if (clips > 800 || project.assets.length > 200) return 16;
  if (clips > 300 || project.assets.length > 80) return 32;
  return 100;
}

/** Counts the clips of a project, memoized per track array. */
function cachedClipCount(project: Project): number {
  const cached = clipCountCache.get(project.tracks);
  if (cached !== undefined) return cached;
  const count = project.tracks.reduce((total, track) => total + track.clips.length, 0);
  clipCountCache.set(project.tracks, count);
  return count;
}

const clipCountCache = new WeakMap<Track[], number>();

/** Captures the parts of the editor that undo and redo should restore. */
function snapshotOf(state: EditorState): EditorSnapshot {
  return {
    project: state.project as Project,
    selectedClipIds: state.selectedClipIds,
    selectedClipId: state.selectedClipId,
    selectionAnchorId: state.selectionAnchorId,
    currentTime: state.currentTime,
    zoom: state.zoom,
    snap: state.snap,
    ripple: state.ripple,
  };
}

/** Drops ids that no longer point at a clip. */
function existingClipIds(project: Project, ids: Iterable<string>): string[] {
  const index = clipIndex(project.tracks);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id) || !index.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  currentTime: 0,
  playing: false,
  selectedClipId: null,
  selectedClipIds: [],
  selectionAnchorId: null,
  zoom: 70,
  snap: true,
  ripple: false,
  dirty: false,
  savedAt: Date.now(),
  mediaRevision: 0,
  undoStack: [],
  redoStack: [],

  openProject: (project) => {
    const tracks = project.tracks.map((track) => ({ ...track, magnetic: Boolean(track.magnetic) }));
    set({
      project: { ...project, tracks },
      currentTime: 0,
      playing: false,
      selectedClipId: null,
      selectedClipIds: [],
      selectionAnchorId: null,
      snap: true,
      ripple: false,
      dirty: false,
      savedAt: Date.now(),
      undoStack: [],
      redoStack: [],
    });
  },

  closeProject: () => {
    set({
      project: null,
      currentTime: 0,
      playing: false,
      selectedClipId: null,
      selectedClipIds: [],
      selectionAnchorId: null,
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
  },

  renameProject: (name) => {
    set((state) => {
      if (!state.project) return {};
      return {
        project: { ...state.project, name: name.trim() || t("Untitled project"), updatedAt: Date.now() },
        dirty: true,
      };
    });
  },

  addAsset: (asset) => {
    get().mutate((project) => {
      if (!project.assets.some((existing) => existing.id === asset.id)) {
        project.assets.push(asset);
      }
    });
    set({ mediaRevision: get().mediaRevision + 1 });
  },

  replaceAsset: (assetId, patch) => {
    get().mutate((project) => {
      const asset = project.assets.find((item) => item.id === assetId);
      if (asset) Object.assign(asset, patch);
    }, false);
    // Poster frames and waveforms are stored apart from the project document,
    // so a change to them has to be written out separately.
    if (patch.thumbnails || patch.waveform) {
      set({ mediaRevision: get().mediaRevision + 1 });
    }
  },

  removeAsset: (assetId) => {
    get().mutate((project) => {
      project.assets = project.assets.filter((asset) => asset.id !== assetId);
      for (const track of project.tracks) {
        track.clips = track.clips.filter((clip) => clip.assetId !== assetId);
      }
    });
    set({ mediaRevision: get().mediaRevision + 1 });
  },

  addClip: (assetId, trackId, start) => {
    const state = get();
    const project = state.project;
    if (!project) return;
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return;

    const kind: TrackKind = asset.info.hasVideo || asset.info.isImage ? "video" : "audio";
    const requestedTrack = trackId ? project.tracks.find((item) => item.id === trackId) : undefined;
    if (requestedTrack?.locked) return;

    const clipStart = Math.max(0, start ?? state.currentTime);
    const duration = asset.info.isImage ? 5 : Math.max(0.1, asset.info.duration || 5);
    const clip: Clip = {
      id: newId(),
      kind,
      name: asset.name,
      assetId: asset.id,
      start: clipStart,
      duration,
      trimIn: 0,
      speed: 1,
      speedRamp: [],
      volume: 1,
      opacity: 1,
      fit: "contain",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      mask: "none",
      maskX: 0.5,
      maskY: 0.5,
      maskWidth: 0.6,
      maskHeight: 0.6,
      maskRotation: 0,
      maskPoints: [],
      chromaKey: { enabled: false, color: "#00ff00", similarity: 0.22, softness: 0.08 },
      fadeIn: 0,
      fadeOut: 0,
      keyframes: [],
      transitionIn: { type: "none", duration: 0.5 },
      transitionOut: { type: "none", duration: 0.5 },
      pitch: 0,
      bass: 0,
      treble: 0,
      mid: 0,
      bassFrequency: DEFAULT_BASS_FREQUENCY,
      midFrequency: DEFAULT_MID_FREQUENCY,
      midWidth: DEFAULT_MID_WIDTH,
      trebleFrequency: DEFAULT_TREBLE_FREQUENCY,
      pan: 0,
      compressor: { ...DEFAULT_COMPRESSOR },
    };

    get().mutate((draft) => {
      let target = findAvailableTrack(draft, kind, clipStart, duration, trackId);
      if (!target) target = createLayer(draft, kind);
      target.clips.push(clip);
      compactMagneticTrack(target);
    });
    set({ selectedClipId: clip.id, selectedClipIds: [clip.id], selectionAnchorId: clip.id, playing: false });
  },

  extractAudio: (clipId) => {
    const state = get();
    const project = state.project;
    if (!project) return;
    const source = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
    const asset = source?.assetId ? project.assets.find((item) => item.id === source.assetId) : undefined;
    if (!source || source.kind !== "video" || !asset?.info.hasAudio) return;
    const clip: Clip = {
      ...source,
      id: newId(),
      kind: "audio",
      name: `${source.name} audio`,
      opacity: 1,
      fit: "contain",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      mask: "none",
    };
    get().mutate((draft) => {
      let target = findAvailableTrack(draft, "audio", clip.start, clip.duration);
      if (!target) target = createLayer(draft, "audio");
      target.clips.push(clip);
    });
    set({ selectedClipId: clip.id, selectedClipIds: [clip.id], selectionAnchorId: clip.id, playing: false });
  },

  addTextClip: (text, at, style) => {
    const state = get();
    if (!state.project) return;
    const start = Math.max(0, at ?? state.currentTime);
    const clip: Clip = {
      id: newId(),
      kind: "text",
      name: text?.trim() || "Text",
      start,
      duration: 3,
      trimIn: 0,
      speed: 1,
      speedRamp: [],
      volume: 1,
      opacity: 1,
      fit: "contain",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      mask: "none",
      fadeIn: 0,
      fadeOut: 0,
      keyframes: [],
      transitionIn: { type: "none", duration: 0.5 },
      transitionOut: { type: "none", duration: 0.5 },
      pitch: 0,
      bass: 0,
      treble: 0,
      mid: 0,
      bassFrequency: DEFAULT_BASS_FREQUENCY,
      midFrequency: DEFAULT_MID_FREQUENCY,
      midWidth: DEFAULT_MID_WIDTH,
      trebleFrequency: DEFAULT_TREBLE_FREQUENCY,
      pan: 0,
      compressor: { ...DEFAULT_COMPRESSOR },
      text: {
        text: text?.trim() || t("Your text"),
        x: 0.5,
        y: 0.5,
        size: Math.round(state.project.height * 0.075),
        rotation: 0,
        color: "#FFFFFF",
        fontWeight: "bold",
        italic: false,
        fontFamily: "Segoe UI",
        align: "center",
        underline: false,
        characterSpacing: 0,
        lineHeight: 1.2,
        outlineColor: "#000000",
        outlineWidth: 0,
        backgroundColor: "#000000",
        backgroundOpacity: 0,
        brightness: 1,
        shadow: 0.5,
        shadowColor: "#000000",
        curve: 0,
        ...style,
      },
    };

    get().mutate((draft) => {
      let track = findAvailableTrack(draft, "text", start, clip.duration);
      if (!track) track = createLayer(draft, "text");
      track.clips.push(clip);
    });
    set({ selectedClipId: clip.id, selectedClipIds: [clip.id], selectionAnchorId: clip.id, playing: false });
  },

  importSubtitleCues: (cues) => {
    if (!cues.length) return;
    get().mutate((project) => {
      let track = project.tracks.find((item) => item.kind === "text" && !item.locked);
      if (!track) track = createLayer(project, "text");
      for (const cue of cues) {
        const start = Math.max(0, cue.start);
        const duration = Math.max(0.1, cue.end - start);
        track.clips.push({
          id: newId(), kind: "text", name: cue.text.replace(/\s+/g, " ").slice(0, 40) || t("Subtitle cue"),
          start, duration, trimIn: 0, speed: 1, speedRamp: [], volume: 1, opacity: 1, fit: "contain",
          x: 0, y: 0, scale: 1, rotation: 0, mask: "none", fadeIn: 0, fadeOut: 0, pitch: 0,
          bass: 0, treble: 0, mid: 0, bassFrequency: DEFAULT_BASS_FREQUENCY, midFrequency: DEFAULT_MID_FREQUENCY,
          midWidth: DEFAULT_MID_WIDTH, trebleFrequency: DEFAULT_TREBLE_FREQUENCY, pan: 0,
          compressor: { ...DEFAULT_COMPRESSOR }, keyframes: [], transitionIn: { type: "none", duration: 0 },
          transitionOut: { type: "none", duration: 0 }, subtitleCue: true,
          text: { text: cue.text, x: 0.5, y: 0.9, size: Math.round(project.height * 0.045), rotation: 0,
            color: "#FFFFFF", fontWeight: "bold", italic: false, fontFamily: "Segoe UI", align: "center",
            underline: false, characterSpacing: 0, lineHeight: 1.2, outlineColor: "#000000", outlineWidth: 2,
            backgroundColor: "#000000", backgroundOpacity: 0.35, brightness: 1, shadow: 0, shadowColor: "#000000", curve: 0 },
        });
      }
    });
  },

  addEffectClip: (preset, at) => {
    const state = get();
    if (!state.project) return;
    const start = Math.max(0, at ?? state.currentTime);
    const clip: Clip = {
      id: newId(), kind: "misc", name: preset?.name ?? t("Color filter"), start, duration: 5, trimIn: 0,
      speed: 1, speedRamp: [], volume: 1, opacity: 1, fit: "contain", x: 0, y: 0, scale: 1,
      rotation: 0, mask: "none", fadeIn: 0, fadeOut: 0, pitch: 0, bass: 0, treble: 0,
      mid: 0, bassFrequency: DEFAULT_BASS_FREQUENCY, midFrequency: DEFAULT_MID_FREQUENCY,
      midWidth: DEFAULT_MID_WIDTH, trebleFrequency: DEFAULT_TREBLE_FREQUENCY, pan: 0,
      compressor: { ...DEFAULT_COMPRESSOR },
      keyframes: [], transitionIn: { type: "none", duration: 0.5 }, transitionOut: { type: "none", duration: 0.5 },
      effect: { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, blur: 0, vignette: 0, motionBlur: 0, fadeIn: 0, fadeOut: 0, mask: "none", maskX: 0.5, maskY: 0.5, maskSize: 0.5, ...preset?.effect },
    };
    get().mutate((draft) => {
      let target = findAvailableTrack(draft, "misc", start, clip.duration);
      if (!target) target = createLayer(draft, "misc");
      target.clips.push(clip);
    });
    set({ selectedClipId: clip.id, selectedClipIds: [clip.id], selectionAnchorId: clip.id, playing: false });
  },

  addTrack: (kind) => {
    get().mutate((project) => {
      createLayer(project, kind);
    });
  },

  deleteTrack: (trackId) => {
    const project = get().project;
    const track = project?.tracks.find((item) => item.id === trackId);
    if (!project || !track || track.locked) return;
    const removed = new Set(track.clips.map((clip) => clip.id));
    get().mutate((draft) => {
      const index = draft.tracks.findIndex((item) => item.id === trackId);
      if (index < 0 || draft.tracks[index].locked) return;
      draft.tracks.splice(index, 1);
    });
    const selectedClipIds = get().selectedClipIds.filter((id) => !removed.has(id));
    set({
      selectedClipIds,
      selectedClipId: selectedClipIds[selectedClipIds.length - 1] ?? null,
      selectionAnchorId: selectedClipIds[selectedClipIds.length - 1] ?? null,
    });
  },

  /**
   * Moves a track by one slot, staying inside its kind group. Because the
   * timeline draws each kind in reverse project order, a positive direction
   * moves the track towards the top of the visible stack.
   */
  moveTrack: (trackId, direction) => {
    get().mutate((project) => {
      const track = project.tracks.find((item) => item.id === trackId);
      if (!track) return;
      const group = project.tracks.filter((item) => item.kind === track.kind);
      const groupIndex = group.findIndex((item) => item.id === trackId);
      const neighbor = group[groupIndex + direction];
      if (!neighbor) return;
      const from = project.tracks.indexOf(track);
      const to = project.tracks.indexOf(neighbor);
      project.tracks.splice(from, 1);
      project.tracks.splice(to, 0, track);
    });
  },

  moveTrackUp: (trackId) => {
    get().moveTrack(trackId, 1);
  },

  moveTrackDown: (trackId) => {
    get().moveTrack(trackId, -1);
  },

  reorderTrack: (trackId, targetIndex) => {
    get().mutate((project) => {
      const from = project.tracks.findIndex((item) => item.id === trackId);
      if (from < 0) return;
      const [track] = project.tracks.splice(from, 1);
      const index = clamp(targetIndex, 0, project.tracks.length);
      project.tracks.splice(index, 0, track);
    });
  },

  moveClipToTrack: (clipId, trackId) => {
    get().moveClipsToTrack([clipId], trackId);
  },

  moveClipsToTrack: (clipIds, trackId, record = true) => {
    const project = get().project;
    const target = project?.tracks.find((track) => track.id === trackId);
    if (!project || !target || target.locked || !clipIds.length) return;
    const moving = new Set(clipIds);
    const sources = project.tracks.filter((track) => track.clips.some((clip) => moving.has(clip.id)));
    const clips = sources.flatMap((track) => track.clips.filter((clip) => moving.has(clip.id)));
    // A mixed-kind drop is refused as a whole, so the timeline never ends up
    // with a video clip on an audio track.
    if (!clips.length || clips.some((clip) => clip.kind !== target.kind)) return;
    const sourceIndex = Math.min(...sources.map((track) => project.tracks.indexOf(track)));
    const targetIndex = project.tracks.indexOf(target);
    const preferRight = targetIndex >= sourceIndex;
    get().mutate((draft) => {
      const draftTarget = draft.tracks.find((track) => track.id === target.id);
      if (!draftTarget || draftTarget.locked) return;
      for (const current of clips) {
        const draftSource = draft.tracks.find((track) => track.clips.some((clip) => clip.id === current.id));
        if (!draftSource) continue;
        const index = draftSource.clips.findIndex((clip) => clip.id === current.id);
        if (index < 0) continue;
        const [moved] = draftSource.clips.splice(index, 1);
        moved.start = findFreeStart(draftTarget, moving, moved.start, moved.duration, preferRight);
        draftTarget.clips.push(moved);
      }
    }, record);
  },

  updateClip: (clipId, patch, record = true) => {
    get().mutate((project) => {
      // The clip is located through the index, because a drag updates the
      // clip on every pointer move.
      const location = clipIndex(project.tracks).get(clipId);
      if (!location) return;
      const clip = location.clip;
      const { text: textPatch, effect: effectPatch, compressor: compressorPatch, ...rest } = patch;
      if (textPatch && clip.text) {
        clip.text = { ...clip.text, ...textPatch };
      }
      if (effectPatch && clip.effect) {
        clip.effect = { ...clip.effect, ...effectPatch };
      }
      if (compressorPatch) {
        clip.compressor = { ...DEFAULT_COMPRESSOR, ...clip.compressor, ...compressorPatch };
      }
      if (typeof rest.start === "number") {
        const desired = Math.max(0, rest.start);
        const duration = typeof rest.duration === "number" ? rest.duration : clip.duration;
        rest.start = findFreeStart(
          location.track,
          clipId,
          desired,
          duration,
          desired >= clip.start,
        );
      }
      Object.assign(clip, rest);
    }, record);
  },

  setClipStarts: (moves, record = false) => {
    if (!moves.length) return;
    const moving = new Set(moves.map((move) => move.clipId));
    get().mutate((project) => {
      const desired = moves
        .map((move) => {
          const location = clipIndex(project.tracks).get(move.clipId);
          return location ? { ...move, location } : null;
        })
        .filter((move): move is { clipId: string; start: number; location: { track: Track; clip: Clip; index: number } } => Boolean(move));
      for (const move of desired) {
        const clip = move.location.clip;
        const target = Math.max(0, move.start);
        clip.start = findFreeStart(
          move.location.track,
          moving,
          target,
          clip.duration,
          target >= clip.start,
        );
      }
    }, record);
  },

  moveSelectedClips: (delta, record = true) => {
    const state = get();
    if (!state.project || !state.selectedClipIds.length || Math.abs(delta) < 1e-6) return;
    const index = clipIndex(state.project.tracks);
    const clips = state.selectedClipIds
      .map((id) => index.get(id)?.clip)
      .filter((clip): clip is Clip => Boolean(clip));
    if (!clips.length) return;
    const minStart = Math.min(...clips.map((clip) => clip.start));
    const applied = Math.max(delta, -minStart);
    if (Math.abs(applied) < 1e-6) return;
    state.setClipStarts(clips.map((clip) => ({ clipId: clip.id, start: clip.start + applied })), record);
  },

  trimClip: (clipId, edge, time) => {
    const state = get();
    const project = state.project;
    if (!project) return;
    const found = findClip(project, clipId);
    if (!found || found.track.locked) return;
    const { clip } = found;
    const asset = clip.assetId ? project.assets.find((item) => item.id === clip.assetId) : undefined;
    const minDuration = 0.1;

    get().mutate((draft) => {
      // The draft has the same clip layout as the project, so the location
      // found above still points at the right clip.
      const location = clipIndex(draft.tracks).get(clipId);
      if (!location) return;
      const track = location.track;
      const draftClip = location.clip;
      const ripple = state.ripple;
      const originalDuration = draftClip.duration;
      const bounds = neighborBounds(track, clipId, draftClip);

      if (edge === "start") {
        const earliest = Math.max(0, draftClip.start - draftClip.trimIn / Math.max(draftClip.speed, 0.01));
        let target = clamp(time, earliest, draftClip.start + draftClip.duration - minDuration);
        if (!ripple) target = Math.max(target, bounds.previousEnd);
        target = clamp(target, earliest, draftClip.start + draftClip.duration - minDuration);
        const delta = target - draftClip.start;
        if (ripple) {
          rippleTrimStart(draft, draftClip, target, minDuration);
        } else {
          draftClip.start = target;
          draftClip.duration -= delta;
          draftClip.trimIn = Math.max(0, draftClip.trimIn + delta * draftClip.speed);
        }
        if (delta > 0.001 && draftClip.speedRamp?.length) {
          draftClip.speedRamp = sliceSpeedRamp(draftClip.speedRamp, delta, originalDuration);
        }
        return;
      }

      let maxDuration = Number.POSITIVE_INFINITY;
      if (asset && !asset.info.isImage && asset.info.duration > 0) {
        maxDuration = Math.max(minDuration, (asset.info.duration - draftClip.trimIn) / Math.max(draftClip.speed, 0.01));
      }
      let target = clamp(time, draftClip.start + minDuration, draftClip.start + maxDuration);
      if (!ripple && Number.isFinite(bounds.nextStart)) {
        target = Math.min(target, bounds.nextStart);
      }
      target = Math.max(target, draftClip.start + minDuration);
      if (ripple) {
        rippleTrimEnd(draft, draftClip, target);
      } else {
        draftClip.duration = target - draftClip.start;
      }
      if (draftClip.speedRamp?.length) {
        draftClip.speedRamp = sliceSpeedRamp(draftClip.speedRamp, 0, draftClip.duration);
      }
    }, false);
  },

  splitClip: (clipId, time) => {
    const project = get().project;
    if (!project) return;
    for (const track of project.tracks) {
      const clip = track.clips.find((item) => item.id === clipId);
      if (!clip) continue;
      const local = time - clip.start;
      if (local <= 0.05 || local >= clip.duration - 0.05) return;
      const rightId = newId();
      get().mutate((draft) => {
        const draftTrack = draft.tracks.find((item) => item.id === track.id);
        const draftClip = draftTrack?.clips.find((item) => item.id === clipId);
        if (!draftClip || !draftTrack) return;
        const originalDuration = draftClip.duration;
        const right: Clip = {
          ...draftClip,
          id: rightId,
          start: time,
          duration: originalDuration - local,
          trimIn: draftClip.trimIn + local * draftClip.speed,
          speedRamp: sliceSpeedRamp(draftClip.speedRamp, local, originalDuration),
          text: draftClip.text ? { ...draftClip.text } : undefined,
        };
        draftClip.duration = local;
        draftClip.speedRamp = sliceSpeedRamp(draftClip.speedRamp, 0, local);
        draftTrack.clips.push(right);
        compactMagneticTrack(draftTrack);
      });
      set({ selectedClipId: rightId, selectedClipIds: [rightId], selectionAnchorId: rightId });
      return;
    }
  },

  splitAtPlayhead: () => {
    const state = get();
    const project = state.project;
    if (!project) return;
    const time = state.currentTime;
    const selected = state.selectedClipIds.length ? new Set(state.selectedClipIds) : null;
    const targets: Array<{ trackId: string; clipId: string; local: number }> = [];
    for (const track of project.tracks) {
      if (track.locked) continue;
      for (const clip of track.clips) {
        if (selected && !selected.has(clip.id)) continue;
        const local = time - clip.start;
        if (local <= 0.05 || local >= clip.duration - 0.05) continue;
        targets.push({ trackId: track.id, clipId: clip.id, local });
        // Without a selection the playhead splits the first clip it crosses,
        // which keeps the old single-clip behaviour.
        if (!selected) break;
      }
      if (!selected && targets.length) break;
    }
    if (!targets.length) return;

    const rightIds: string[] = [];
    get().mutate((draft) => {
      const touched = new Set<string>();
      for (const target of targets) {
        const draftTrack = draft.tracks.find((item) => item.id === target.trackId);
        const draftClip = draftTrack?.clips.find((item) => item.id === target.clipId);
        if (!draftTrack || !draftClip) continue;
        const originalDuration = draftClip.duration;
        const rightId = newId();
        const right: Clip = {
          ...draftClip,
          id: rightId,
          start: time,
          duration: originalDuration - target.local,
          trimIn: draftClip.trimIn + target.local * draftClip.speed,
          speedRamp: sliceSpeedRamp(draftClip.speedRamp, target.local, originalDuration),
          text: draftClip.text ? { ...draftClip.text } : undefined,
        };
        draftClip.duration = target.local;
        draftClip.speedRamp = sliceSpeedRamp(draftClip.speedRamp, 0, target.local);
        draftTrack.clips.push(right);
        touched.add(draftTrack.id);
        rightIds.push(rightId);
      }
      for (const trackId of touched) {
        const track = draft.tracks.find((item) => item.id === trackId);
        if (track) compactMagneticTrack(track);
      }
    });
    if (rightIds.length) {
      set({
        selectedClipIds: rightIds,
        selectedClipId: rightIds[rightIds.length - 1],
        selectionAnchorId: rightIds[rightIds.length - 1],
      });
    }
  },

  duplicateClip: (clipId) => {
    get().setClipSelection([clipId]);
    get().duplicateSelected();
  },

  duplicateSelected: () => {
    const state = get();
    if (!state.project) return;
    const ids = state.selectedClipIds.length
      ? state.selectedClipIds
      : state.selectedClipId
        ? [state.selectedClipId]
        : [];
    if (!ids.length) return;
    const copyIds: string[] = [];
    get().mutate((project) => {
      const moving = new Set(ids);
      for (const clipId of ids) {
        const found = findClip(project, clipId);
        if (!found) continue;
        const { track, clip } = found;
        const copy: Clip = {
          ...clip,
          id: newId(),
          start: clip.start + clip.duration,
          text: clip.text ? { ...clip.text } : undefined,
        };
        if (!track.magnetic) {
          copy.start = findFreeStart(track, moving, copy.start, copy.duration, true);
        }
        track.clips.push(copy);
        copyIds.push(copy.id);
        if (track.magnetic) compactMagneticTrack(track);
      }
    });
    if (!copyIds.length) return;
    set({
      selectedClipIds: copyIds,
      selectedClipId: copyIds[copyIds.length - 1],
      selectionAnchorId: copyIds[copyIds.length - 1],
    });
  },

  deleteClip: (clipId) => {
    get().deleteClips([clipId]);
  },

  deleteClips: (clipIds) => {
    const ids = [...new Set(clipIds)];
    if (!ids.length) return;
    const state = get();
    if (state.project) {
      const known = new Set(existingClipIds(state.project, ids));
      if (!known.size) return;
      const ripple = state.ripple;
      get().mutate((project) => {
        removeClips(project, known, ripple);
      });
    }
    const remaining = get().selectedClipIds.filter((id) => !ids.includes(id));
    const primary = get().selectedClipId;
    const nextPrimary = primary && !ids.includes(primary)
      ? primary
      : remaining[remaining.length - 1] ?? null;
    set({
      selectedClipIds: remaining,
      selectedClipId: nextPrimary,
      selectionAnchorId: nextPrimary,
    });
  },

  deleteSelected: () => {
    const state = get();
    const ids = state.selectedClipIds.length
      ? state.selectedClipIds
      : state.selectedClipId
        ? [state.selectedClipId]
        : [];
    if (ids.length) state.deleteClips(ids);
  },

  selectClip: (clipId, options) => {
    const opts: SelectClipOptions = typeof options === "boolean" ? { additive: options } : options ?? {};
    if (!clipId) {
      set({ selectedClipId: null, selectedClipIds: [], selectionAnchorId: null });
      return;
    }
    if (opts.range) {
      get().selectClipRange(clipId, opts.trackId, opts.additive);
      return;
    }
    const state = get();
    if (opts.additive) {
      const exists = state.selectedClipIds.includes(clipId);
      const ids = exists
        ? state.selectedClipIds.filter((id) => id !== clipId)
        : [...state.selectedClipIds, clipId];
      set({
        selectedClipIds: ids,
        selectedClipId: exists ? ids[ids.length - 1] ?? null : clipId,
        selectionAnchorId: exists ? state.selectionAnchorId : clipId,
      });
      return;
    }
    set({ selectedClipId: clipId, selectedClipIds: [clipId], selectionAnchorId: clipId });
  },

  setClipSelection: (clipIds) => {
    const project = get().project;
    const ids = project ? existingClipIds(project, clipIds) : [];
    set({
      selectedClipIds: ids,
      selectedClipId: ids[ids.length - 1] ?? null,
      selectionAnchorId: ids[ids.length - 1] ?? null,
    });
  },

  selectClips: (clipIds) => {
    get().setClipSelection(clipIds);
  },

  toggleClipSelection: (clipId) => {
    get().selectClip(clipId, { additive: true });
  },

  selectClipRange: (clipId, trackId, additive = false) => {
    const state = get();
    const project = state.project;
    if (!project) return;
    const track = trackId
      ? project.tracks.find((item) => item.id === trackId)
      : project.tracks.find((item) => item.clips.some((clip) => clip.id === clipId));
    if (!track) return;
    const ordered = [...track.clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    const targetIndex = ordered.findIndex((clip) => clip.id === clipId);
    const anchorId = state.selectionAnchorId ?? state.selectedClipId;
    const anchorIndex = anchorId ? ordered.findIndex((clip) => clip.id === anchorId) : -1;
    if (targetIndex < 0) return;
    if (anchorIndex < 0) {
      get().selectClip(clipId);
      return;
    }
    const from = Math.min(anchorIndex, targetIndex);
    const to = Math.max(anchorIndex, targetIndex);
    const range = ordered.slice(from, to + 1).map((clip) => clip.id);
    const ids = additive
      ? existingClipIds(project, [...state.selectedClipIds, ...range])
      : range;
    set({
      selectedClipIds: ids,
      selectedClipId: clipId,
      // Keep the original anchor so Shift-click can grow the range both ways.
      selectionAnchorId: anchorId,
    });
  },

  selectAll: () => {
    const project = get().project;
    if (!project) return;
    get().setClipSelection(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  },

  updateTrack: (trackId, patch, record = true) => {
    get().mutate((project) => {
      const track = project.tracks.find((item) => item.id === trackId);
      if (track) Object.assign(track, patch);
    }, record);
  },

  setCurrentTime: (time) => {
    const project = get().project;
    // The playhead moves on every animation frame, so the duration is
    // memoized rather than recomputed over every clip.
    const duration = project ? cachedProjectDuration(project.tracks) + 4 : 0;
    set({ currentTime: clamp(time, 0, duration) });
  },

  setPlaying: (playing) => set({ playing }),

  setZoom: (zoom) => set({ zoom: clamp(zoom, 12, 320) }),

  toggleSnap: () => set((state) => ({ snap: !state.snap })),

  toggleRipple: () => set((state) => ({ ripple: !state.ripple })),

  setMagneticTrack: (trackId) => {
    get().mutate((project) => {
      for (const track of project.tracks) {
        track.magnetic = track.id === trackId;
      }
      if (trackId) {
        const track = project.tracks.find((item) => item.id === trackId);
        if (track) compactMagneticTrack(track);
      }
    });
  },

  settleMagneticTrack: (trackId) => {
    get().mutate((project) => {
      const track = project.tracks.find((item) => item.id === trackId);
      if (track) compactMagneticTrack(track);
    }, false);
  },

  recordSnapshot: () => {
    set((state) => {
      if (!state.project) return {};
      return {
        undoStack: [...state.undoStack, snapshotOf(state)].slice(-historyLimit(state.project)),
        redoStack: [],
      };
    });
  },

  undo: () => {
    const state = get();
    if (!state.project || state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    const restoredIds = existingClipIds(previous.project, previous.selectedClipIds);
    const primary = previous.selectedClipId && restoredIds.includes(previous.selectedClipId)
      ? previous.selectedClipId
      : restoredIds[restoredIds.length - 1] ?? null;
    const anchor = previous.selectionAnchorId && restoredIds.includes(previous.selectionAnchorId)
      ? previous.selectionAnchorId
      : primary;
    set({
      project: previous.project,
      selectedClipIds: restoredIds,
      selectedClipId: primary,
      selectionAnchorId: anchor,
      currentTime: previous.currentTime,
      zoom: previous.zoom,
      snap: previous.snap,
      ripple: previous.ripple,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snapshotOf(state)].slice(-historyLimit(previous.project)),
      dirty: true,
      playing: false,
    });
  },

  redo: () => {
    const state = get();
    if (!state.project || state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    const restoredIds = existingClipIds(next.project, next.selectedClipIds);
    const primary = next.selectedClipId && restoredIds.includes(next.selectedClipId)
      ? next.selectedClipId
      : restoredIds[restoredIds.length - 1] ?? null;
    const anchor = next.selectionAnchorId && restoredIds.includes(next.selectionAnchorId)
      ? next.selectionAnchorId
      : primary;
    set({
      project: next.project,
      selectedClipIds: restoredIds,
      selectedClipId: primary,
      selectionAnchorId: anchor,
      currentTime: next.currentTime,
      zoom: next.zoom,
      snap: next.snap,
      ripple: next.ripple,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, snapshotOf(state)].slice(-historyLimit(next.project)),
      dirty: true,
      playing: false,
    });
  },

  markSaved: () => set({ dirty: false, savedAt: Date.now() }),

  mutate: (fn, record = true) => {
    set((state) => {
      if (!state.project) return {};
      const next = produce(state.project, (draft) => {
        fn(draft);
        draft.updatedAt = Date.now();
      });
      const selectedClipIds = existingClipIds(next, state.selectedClipIds);
      const selectedClipId = state.selectedClipId && selectedClipIds.includes(state.selectedClipId)
        ? state.selectedClipId
        : selectedClipIds[selectedClipIds.length - 1] ?? null;
      const selectionAnchorId = state.selectionAnchorId && selectedClipIds.includes(state.selectionAnchorId)
        ? state.selectionAnchorId
        : selectedClipId;
      return {
        project: next,
        selectedClipIds,
        selectedClipId,
        selectionAnchorId,
        dirty: true,
        undoStack: record
          ? [...state.undoStack, snapshotOf(state)].slice(-historyLimit(next))
          : state.undoStack,
        redoStack: record ? [] : state.redoStack,
      };
    });
  },
}));

export function selectedClip(state: EditorState): Clip | null {
  if (!state.project) return null;
  const id = state.selectedClipId ?? state.selectedClipIds[0];
  if (!id) return null;
  return clipIndex(state.project.tracks).get(id)?.clip ?? null;
}

export function selectedTrackOfClip(state: EditorState): Track | null {
  if (!state.project) return null;
  const id = state.selectedClipId ?? state.selectedClipIds[0];
  if (!id) return null;
  return clipIndex(state.project.tracks).get(id)?.track ?? null;
}

/**
 * Looks up a clip by id.
 *
 * The index is cached per track list, so this stays cheap enough to call on
 * every keyboard edit.
 */
export function clipById(state: EditorState, clipId: string): Clip | null {
  if (!state.project) return null;
  return clipIndex(state.project.tracks).get(clipId)?.clip ?? null;
}

/**
 * Maps every clip id to its track and position.
 *
 * The selection is resolved on every store update, and scanning the whole
 * timeline for it would cost O(clips) per change.
 */
function clipIndex(tracks: Track[]): Map<string, { track: Track; clip: Clip; index: number }> {
  const cached = clipIndexCache.get(tracks);
  if (cached) return cached;
  const index = new Map<string, { track: Track; clip: Clip; index: number }>();
  for (const track of tracks) {
    for (let position = 0; position < track.clips.length; position += 1) {
      const clip = track.clips[position];
      index.set(clip.id, { track, clip, index: position });
    }
  }
  clipIndexCache.set(tracks, index);
  return index;
}

const clipIndexCache = new WeakMap<Track[], Map<string, { track: Track; clip: Clip; index: number }>>();

/**
 * Looks up the asset of a clip.
 *
 * The asset list is searched with a map, because the timeline asks for the
 * asset of every clip it renders and a linear scan would be O(clips x assets)
 * on a long timeline.
 */
export function assetForClip(project: Project, clip: Clip): Asset | undefined {
  if (!clip.assetId) return undefined;
  const cached = assetIndexCache.get(project.assets);
  if (cached) return cached.get(clip.assetId);
  const index = new Map(project.assets.map((asset) => [asset.id, asset]));
  assetIndexCache.set(project.assets, index);
  return index.get(clip.assetId);
}

const assetIndexCache = new WeakMap<Asset[], Map<string, Asset>>();
