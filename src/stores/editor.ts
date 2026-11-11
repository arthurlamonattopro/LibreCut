import { produce } from "immer";
import { create } from "zustand";
import type { Asset, Clip, ColorEffectOptions, Project, TextOptions, Track, TrackKind } from "../lib/types";
import { clamp, projectDuration } from "../lib/time";
import { createTrack, newId } from "./projects";

export type ClipPatch = Omit<Partial<Clip>, "text" | "effect"> & { text?: Partial<TextOptions>; effect?: Partial<ColorEffectOptions> };

interface EditorState {
  project: Project | null;
  currentTime: number;
  playing: boolean;
  selectedClipId: string | null;
  zoom: number;
  snap: boolean;
  dirty: boolean;
  savedAt: number;
  undoStack: Project[];
  redoStack: Project[];

  openProject: (project: Project) => void;
  closeProject: () => void;
  renameProject: (name: string) => void;
  addAsset: (asset: Asset) => void;
  replaceAsset: (assetId: string, patch: Partial<Asset>) => void;
  removeAsset: (assetId: string) => void;
  addClip: (assetId: string, trackId?: string, start?: number) => void;
  extractAudio: (clipId: string) => void;
  addTextClip: (text?: string, at?: number) => void;
  addEffectClip: (preset?: { name: string; effect: Partial<ColorEffectOptions> }, at?: number) => void;
  addTrack: (kind: TrackKind) => void;
  moveClipToTrack: (clipId: string, trackId: string) => void;
  updateClip: (clipId: string, patch: ClipPatch, record?: boolean) => void;
  trimClip: (clipId: string, edge: "start" | "end", time: number) => void;
  splitClip: (clipId: string, time: number) => void;
  splitAtPlayhead: () => void;
  duplicateClip: (clipId: string) => void;
  deleteClip: (clipId: string) => void;
  deleteSelected: () => void;
  selectClip: (clipId: string | null) => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;
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
  if (preferred && !preferred.locked && !overlaps(preferred)) return preferred;
  return project.tracks.find((track) => track.kind === kind && !track.locked && !overlaps(track));
}

function createLayer(project: Project, kind: TrackKind): Track {
  const count = project.tracks.filter((track) => track.kind === kind).length + 1;
  const label = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text";
  const layerLabel = kind === "misc" ? "Misc" : label;
  const track = createTrack(kind, `${layerLabel} ${count}`);
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

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  currentTime: 0,
  playing: false,
  selectedClipId: null,
  zoom: 70,
  snap: true,
  dirty: false,
  savedAt: Date.now(),
  undoStack: [],
  redoStack: [],

  openProject: (project) => {
    set({
      project,
      currentTime: 0,
      playing: false,
      selectedClipId: null,
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
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
  },

  renameProject: (name) => {
    set((state) => {
      if (!state.project) return {};
      return {
        project: { ...state.project, name: name.trim() || "Untitled project", updatedAt: Date.now() },
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
  },

  replaceAsset: (assetId, patch) => {
    get().mutate((project) => {
      const asset = project.assets.find((item) => item.id === assetId);
      if (asset) Object.assign(asset, patch);
    }, false);
  },

  removeAsset: (assetId) => {
    get().mutate((project) => {
      project.assets = project.assets.filter((asset) => asset.id !== assetId);
      for (const track of project.tracks) {
        track.clips = track.clips.filter((clip) => clip.assetId !== assetId);
      }
    });
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
      volume: 1,
      opacity: 1,
      fit: "contain",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      mask: "none",
      chromaKey: { enabled: false, color: "#00ff00", similarity: 0.22, softness: 0.08 },
      fadeIn: 0,
      fadeOut: 0,
      keyframes: [],
      transitionIn: { type: "none", duration: 0.5 },
      transitionOut: { type: "none", duration: 0.5 },
      pitch: 0,
      bass: 0,
      treble: 0,
    };

    get().mutate((draft) => {
      let target = findAvailableTrack(draft, kind, clipStart, duration, trackId);
      if (!target) target = createLayer(draft, kind);
      target.clips.push(clip);
    });
    set({ selectedClipId: clip.id, playing: false });
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
    set({ selectedClipId: clip.id, playing: false });
  },

  addTextClip: (text, at) => {
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
      text: {
        text: text?.trim() || "Your text",
        x: 0.5,
        y: 0.5,
        size: Math.round(state.project.height * 0.075),
        rotation: 0,
        color: "#FFFFFF",
        fontWeight: "bold",
        align: "center",
        underline: false,
        characterSpacing: 0,
        outlineColor: "#000000",
        outlineWidth: 0,
        brightness: 1,
        shadow: 0.5,
        curve: 0,
      },
    };

    get().mutate((draft) => {
      let track = findAvailableTrack(draft, "text", start, clip.duration);
      if (!track) track = createLayer(draft, "text");
      track.clips.push(clip);
    });
    set({ selectedClipId: clip.id, playing: false });
  },

  addEffectClip: (preset, at) => {
    const state = get();
    if (!state.project) return;
    const start = Math.max(0, at ?? state.currentTime);
    const clip: Clip = {
      id: newId(), kind: "misc", name: preset?.name ?? "Color filter", start, duration: 5, trimIn: 0,
      speed: 1, volume: 1, opacity: 1, fit: "contain", x: 0, y: 0, scale: 1,
      rotation: 0, mask: "none", fadeIn: 0, fadeOut: 0, pitch: 0, bass: 0, treble: 0,
      keyframes: [], transitionIn: { type: "none", duration: 0.5 }, transitionOut: { type: "none", duration: 0.5 },
      effect: { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, blur: 0, vignette: 0, motionBlur: 0, fadeIn: 0, fadeOut: 0, mask: "none", maskX: 0.5, maskY: 0.5, maskSize: 0.5, ...preset?.effect },
    };
    get().mutate((draft) => {
      let target = findAvailableTrack(draft, "misc", start, clip.duration);
      if (!target) target = createLayer(draft, "misc");
      target.clips.push(clip);
    });
    set({ selectedClipId: clip.id, playing: false });
  },

  addTrack: (kind) => {
    get().mutate((project) => {
      createLayer(project, kind);
    });
  },

  moveClipToTrack: (clipId, trackId) => {
    const project = get().project;
    const target = project?.tracks.find((track) => track.id === trackId);
    if (!project || !target || target.locked) return;
    const source = project.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    const clip = source?.clips.find((item) => item.id === clipId);
    if (!source || !clip || source.id === target.id || clip.kind !== target.kind) return;
    get().mutate((draft) => {
      const draftSource = draft.tracks.find((track) => track.id === source.id);
      const draftTarget = draft.tracks.find((track) => track.id === target.id);
      const index = draftSource?.clips.findIndex((item) => item.id === clipId) ?? -1;
      if (!draftSource || !draftTarget || index < 0 || draftTarget.locked) return;
      const [moved] = draftSource.clips.splice(index, 1);
      draftTarget.clips.push(moved);
    });
  },

  updateClip: (clipId, patch, record = true) => {
    get().mutate((project) => {
      for (const track of project.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (!clip) continue;
        const { text: textPatch, effect: effectPatch, ...rest } = patch;
        if (textPatch && clip.text) {
          clip.text = { ...clip.text, ...textPatch };
        }
        if (effectPatch && clip.effect) {
          clip.effect = { ...clip.effect, ...effectPatch };
        }
        Object.assign(clip, rest);
        return;
      }
    }, record);
  },

  trimClip: (clipId, edge, time) => {
    const project = get().project;
    if (!project) return;
    const clip = project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!clip) return;
    const asset = clip.assetId ? project.assets.find((item) => item.id === clip.assetId) : undefined;
    const minDuration = 0.1;

    if (edge === "start") {
      const earliest = Math.max(0, clip.start - clip.trimIn / Math.max(clip.speed, 0.01));
      const target = clamp(time, earliest, clip.start + clip.duration - minDuration);
      const delta = target - clip.start;
      get().updateClip(
        clipId,
        {
          start: target,
          duration: clip.duration - delta,
          trimIn: Math.max(0, clip.trimIn + delta * clip.speed),
        },
        false,
      );
      return;
    }

    let maxDuration = Number.POSITIVE_INFINITY;
    if (asset && !asset.info.isImage && asset.info.duration > 0) {
      maxDuration = Math.max(minDuration, (asset.info.duration - clip.trimIn) / Math.max(clip.speed, 0.01));
    }
    const target = clamp(time, clip.start + minDuration, clip.start + maxDuration);
    get().updateClip(clipId, { duration: target - clip.start }, false);
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
        if (!draftClip) return;
        const right: Clip = {
          ...draftClip,
          id: rightId,
          start: time,
          duration: draftClip.duration - local,
          trimIn: draftClip.trimIn + local * draftClip.speed,
          text: draftClip.text ? { ...draftClip.text } : undefined,
        };
        draftClip.duration = local;
        draftTrack?.clips.push(right);
      });
      set({ selectedClipId: rightId });
      return;
    }
  },

  splitAtPlayhead: () => {
    const selected = get().selectedClipId;
    if (selected) {
      get().splitClip(selected, get().currentTime);
      return;
    }
    const project = get().project;
    if (!project) return;
    const time = get().currentTime;
    for (const track of project.tracks) {
      const clip = track.clips.find((item) => time > item.start && time < item.start + item.duration);
      if (clip) {
        get().splitClip(clip.id, time);
        return;
      }
    }
  },

  duplicateClip: (clipId) => {
    const project = get().project;
    if (!project) return;
    for (const track of project.tracks) {
      const clip = track.clips.find((item) => item.id === clipId);
      if (!clip) continue;
      const copy: Clip = {
        ...clip,
        id: newId(),
        start: clip.start + clip.duration,
        text: clip.text ? { ...clip.text } : undefined,
      };
      get().mutate((draft) => {
        draft.tracks.find((item) => item.id === track.id)?.clips.push(copy);
      });
      set({ selectedClipId: copy.id });
      return;
    }
  },

  deleteClip: (clipId) => {
    get().mutate((project) => {
      for (const track of project.tracks) {
        track.clips = track.clips.filter((clip) => clip.id !== clipId);
      }
    });
    if (get().selectedClipId === clipId) set({ selectedClipId: null });
  },

  deleteSelected: () => {
    const selected = get().selectedClipId;
    if (selected) get().deleteClip(selected);
  },

  selectClip: (clipId) => set({ selectedClipId: clipId }),

  updateTrack: (trackId, patch) => {
    get().mutate((project) => {
      const track = project.tracks.find((item) => item.id === trackId);
      if (track) Object.assign(track, patch);
    });
  },

  setCurrentTime: (time) => {
    const project = get().project;
    const duration = project ? projectDuration(project.tracks) + 4 : 0;
    set({ currentTime: clamp(time, 0, duration) });
  },

  setPlaying: (playing) => set({ playing }),

  setZoom: (zoom) => set({ zoom: clamp(zoom, 12, 320) }),

  toggleSnap: () => set((state) => ({ snap: !state.snap })),

  recordSnapshot: () => {
    const project = get().project;
    if (!project) return;
    set((state) => ({
      undoStack: [...state.undoStack, project].slice(-100),
      redoStack: [],
    }));
  },

  undo: () => {
    const { undoStack, project } = get();
    if (!project || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    set((state) => ({
      project: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, project].slice(-100),
      dirty: true,
      selectedClipId: null,
      playing: false,
    }));
  },

  redo: () => {
    const { redoStack, project } = get();
    if (!project || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set((state) => ({
      project: next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, project].slice(-100),
      dirty: true,
      selectedClipId: null,
      playing: false,
    }));
  },

  markSaved: () => set({ dirty: false, savedAt: Date.now() }),

  mutate: (fn, record = true) => {
    set((state) => {
      if (!state.project) return {};
      const next = produce(state.project, (draft) => {
        fn(draft);
        draft.updatedAt = Date.now();
      });
      return {
        project: next,
        dirty: true,
        undoStack: record
          ? [...state.undoStack, state.project].slice(-100)
          : state.undoStack,
        redoStack: record ? [] : state.redoStack,
      };
    });
  },
}));

export function selectedClip(state: EditorState): Clip | null {
  if (!state.project || !state.selectedClipId) return null;
  for (const track of state.project.tracks) {
    const clip = track.clips.find((item) => item.id === state.selectedClipId);
    if (clip) return clip;
  }
  return null;
}

export function selectedTrackOfClip(state: EditorState): Track | null {
  if (!state.project || !state.selectedClipId) return null;
  return state.project.tracks.find((track) => track.clips.some((clip) => clip.id === state.selectedClipId)) ?? null;
}

export function assetForClip(project: Project, clip: Clip): Asset | undefined {
  return clip.assetId ? project.assets.find((asset) => asset.id === clip.assetId) : undefined;
}
