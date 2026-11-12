import { produce } from "immer";
import { create } from "zustand";
import type { Asset, AudioCompressor, Clip, ColorEffectOptions, LutSettings, Project, TextOptions, Track, TrackKind } from "../lib/types";
import { clamp, cachedProjectDuration } from "../lib/time";
import { compactMagneticTrack, findClip, removeClip, rippleTrimEnd, rippleTrimStart, settleMagneticTracks } from "../lib/timeline";
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

interface EditorState {
  project: Project | null;
  currentTime: number;
  playing: boolean;
  selectedClipId: string | null;
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
  addTextClip: (text?: string, at?: number, style?: Partial<TextOptions>) => void;
  importSubtitleCues: (cues: Array<{ start: number; end: number; text: string }>) => void;
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
  updateTrack: (trackId: string, patch: Partial<Track>, record?: boolean) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;
  toggleRipple: () => void;
  setMagneticTrack: (trackId: string | null) => void;
  settleMagneticTrack: (trackId: string) => void;
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

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  currentTime: 0,
  playing: false,
  selectedClipId: null,
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
    if (!tracks.some((track) => track.magnetic)) {
      const firstVideo = tracks.find((track) => track.kind === "video");
      if (firstVideo) firstVideo.magnetic = true;
    }
    set({
      project: { ...project, tracks },
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
    set({ selectedClipId: clip.id, playing: false });
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
      settleMagneticTracks(draft, [draftSource.id, draftTarget.id]);
    });
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
      Object.assign(clip, rest);
    }, record);
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
      const ripple = state.ripple || Boolean(track.magnetic);
      const originalDuration = draftClip.duration;

      if (edge === "start") {
        const earliest = Math.max(0, draftClip.start - draftClip.trimIn / Math.max(draftClip.speed, 0.01));
        const target = clamp(time, earliest, draftClip.start + draftClip.duration - minDuration);
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
      const target = clamp(time, draftClip.start + minDuration, draftClip.start + maxDuration);
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
        const target = draft.tracks.find((item) => item.id === track.id);
        if (!target) return;
        target.clips.push(copy);
        compactMagneticTrack(target);
      });
      set({ selectedClipId: copy.id });
      return;
    }
  },

  deleteClip: (clipId) => {
    const ripple = get().ripple;
    get().mutate((project) => {
      removeClip(project, clipId, ripple);
    });
    if (get().selectedClipId === clipId) set({ selectedClipId: null });
  },

  deleteSelected: () => {
    const selected = get().selectedClipId;
    if (selected) get().deleteClip(selected);
  },

  selectClip: (clipId) => set({ selectedClipId: clipId }),

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
    const project = get().project;
    if (!project) return;
    set((state) => ({
      undoStack: [...state.undoStack, project].slice(-historyLimit(project)),
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
      redoStack: [...state.redoStack, project].slice(-historyLimit(project)),
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
      undoStack: [...state.undoStack, project].slice(-historyLimit(project)),
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
          ? [...state.undoStack, state.project].slice(-historyLimit(next))
          : state.undoStack,
        redoStack: record ? [] : state.redoStack,
      };
    });
  },
}));

export function selectedClip(state: EditorState): Clip | null {
  if (!state.project || !state.selectedClipId) return null;
  return clipIndex(state.project.tracks).get(state.selectedClipId)?.clip ?? null;
}

export function selectedTrackOfClip(state: EditorState): Track | null {
  if (!state.project || !state.selectedClipId) return null;
  return clipIndex(state.project.tracks).get(state.selectedClipId)?.track ?? null;
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
