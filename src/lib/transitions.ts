import type { Clip, Track, TransitionType } from "./types";

/**
 * The transition catalogue.
 *
 * Every entry maps onto one of FFmpeg's `xfade` transitions, so the exporter
 * can hand the name straight to FFmpeg. The canvas preview maps the same
 * entries onto a geometric pattern, which keeps the two renderers in sync
 * without duplicating the list of supported transitions.
 */
export type TransitionGroup = "crossfade" | "wipe" | "slide" | "iris" | "slice" | "effect";

export interface TransitionDefinition {
  type: TransitionType;
  label: string;
  group: TransitionGroup;
  /** The FFmpeg `xfade` transition name used by the exporter. */
  xfade: string;
}

export const TRANSITION_GROUPS: { id: TransitionGroup; label: string }[] = [
  { id: "crossfade", label: "Cross fades" },
  { id: "wipe", label: "Wipes" },
  { id: "slide", label: "Slides" },
  { id: "iris", label: "Irises" },
  { id: "slice", label: "Slices" },
  { id: "effect", label: "Effects" },
];

export const TRANSITIONS: TransitionDefinition[] = [
  { type: "fade", label: "Crossfade", group: "crossfade", xfade: "fade" },
  { type: "fadefast", label: "Fast fade", group: "crossfade", xfade: "fadefast" },
  { type: "fadeslow", label: "Slow fade", group: "crossfade", xfade: "fadeslow" },
  { type: "fadeblack", label: "Fade to black", group: "crossfade", xfade: "fadeblack" },
  { type: "fadewhite", label: "Fade to white", group: "crossfade", xfade: "fadewhite" },
  { type: "fadegrays", label: "Fade to grey", group: "crossfade", xfade: "fadegrays" },
  { type: "dissolve", label: "Dissolve", group: "crossfade", xfade: "dissolve" },

  { type: "wipeleft", label: "Wipe left", group: "wipe", xfade: "wipeleft" },
  { type: "wiperight", label: "Wipe right", group: "wipe", xfade: "wiperight" },
  { type: "wipeup", label: "Wipe up", group: "wipe", xfade: "wipeup" },
  { type: "wipedown", label: "Wipe down", group: "wipe", xfade: "wipedown" },
  { type: "smoothleft", label: "Smooth left", group: "wipe", xfade: "smoothleft" },
  { type: "smoothright", label: "Smooth right", group: "wipe", xfade: "smoothright" },
  { type: "smoothup", label: "Smooth up", group: "wipe", xfade: "smoothup" },
  { type: "smoothdown", label: "Smooth down", group: "wipe", xfade: "smoothdown" },
  { type: "wipetl", label: "Wipe to top left", group: "wipe", xfade: "wipetl" },
  { type: "wipetr", label: "Wipe to top right", group: "wipe", xfade: "wipetr" },
  { type: "wipebl", label: "Wipe to bottom left", group: "wipe", xfade: "wipebl" },
  { type: "wipebr", label: "Wipe to bottom right", group: "wipe", xfade: "wipebr" },
  { type: "diagtl", label: "Diagonal to top left", group: "wipe", xfade: "diagtl" },
  { type: "diagtr", label: "Diagonal to top right", group: "wipe", xfade: "diagtr" },
  { type: "diagbl", label: "Diagonal to bottom left", group: "wipe", xfade: "diagbl" },
  { type: "diagbr", label: "Diagonal to bottom right", group: "wipe", xfade: "diagbr" },

  { type: "slideleft", label: "Slide left", group: "slide", xfade: "slideleft" },
  { type: "slideright", label: "Slide right", group: "slide", xfade: "slideright" },
  { type: "slideup", label: "Slide up", group: "slide", xfade: "slideup" },
  { type: "slidedown", label: "Slide down", group: "slide", xfade: "slidedown" },
  { type: "coverleft", label: "Cover left", group: "slide", xfade: "coverleft" },
  { type: "coverright", label: "Cover right", group: "slide", xfade: "coverright" },
  { type: "coverup", label: "Cover up", group: "slide", xfade: "coverup" },
  { type: "coverdown", label: "Cover down", group: "slide", xfade: "coverdown" },
  { type: "revealleft", label: "Reveal left", group: "slide", xfade: "revealleft" },
  { type: "revealright", label: "Reveal right", group: "slide", xfade: "revealright" },
  { type: "revealup", label: "Reveal up", group: "slide", xfade: "revealup" },
  { type: "revealdown", label: "Reveal down", group: "slide", xfade: "revealdown" },

  { type: "circleopen", label: "Circle open", group: "iris", xfade: "circleopen" },
  { type: "circleclose", label: "Circle close", group: "iris", xfade: "circleclose" },
  { type: "circlecrop", label: "Circle crop", group: "iris", xfade: "circlecrop" },
  { type: "rectcrop", label: "Rectangle crop", group: "iris", xfade: "rectcrop" },
  { type: "vertopen", label: "Vertical bars open", group: "iris", xfade: "vertopen" },
  { type: "vertclose", label: "Vertical bars close", group: "iris", xfade: "vertclose" },
  { type: "horzopen", label: "Horizontal bars open", group: "iris", xfade: "horzopen" },
  { type: "horzclose", label: "Horizontal bars close", group: "iris", xfade: "horzclose" },

  { type: "hlslice", label: "Slice left", group: "slice", xfade: "hlslice" },
  { type: "hrslice", label: "Slice right", group: "slice", xfade: "hrslice" },
  { type: "vuslice", label: "Slice up", group: "slice", xfade: "vuslice" },
  { type: "vdslice", label: "Slice down", group: "slice", xfade: "vdslice" },
  { type: "hlwind", label: "Wind left", group: "slice", xfade: "hlwind" },
  { type: "hrwind", label: "Wind right", group: "slice", xfade: "hrwind" },
  { type: "vuwind", label: "Wind up", group: "slice", xfade: "vuwind" },
  { type: "vdwind", label: "Wind down", group: "slice", xfade: "vdwind" },

  { type: "pixelize", label: "Pixelize", group: "effect", xfade: "pixelize" },
  { type: "hblur", label: "Blur", group: "effect", xfade: "hblur" },
  { type: "radial", label: "Radial", group: "effect", xfade: "radial" },
  { type: "distance", label: "Distance", group: "effect", xfade: "distance" },
  { type: "zoomin", label: "Zoom in", group: "effect", xfade: "zoomin" },
  { type: "squeezeh", label: "Squeeze horizontal", group: "effect", xfade: "squeezeh" },
  { type: "squeezev", label: "Squeeze vertical", group: "effect", xfade: "squeezev" },
];

/** The transition names FFmpeg understands. */
const XFADE_NAMES = new Set(TRANSITIONS.map((transition) => transition.xfade));

/** True when the value is a transition the catalogue knows about. */
export function isTransitionType(value: unknown): value is TransitionType {
  return typeof value === "string" && (XFADE_NAMES.has(value) || value === "none" || value === "wipe");
}

/**
 * The FFmpeg `xfade` name for a transition.
 *
 * `wipe` is the name older projects used for a left-to-right wipe; it maps
 * onto FFmpeg's `wiperight`, which moves the new clip in from the left.
 */
export function xfadeName(type: TransitionType): string {
  if (type === "wipe") return "wiperight";
  if (type === "none") return "fade";
  return type;
}

/**
 * How a transition looks in the canvas preview.
 *
 * The exporter renders the real thing with FFmpeg's `xfade`. The preview
 * reproduces the same geometry with canvas operations, which keeps the
 * timeline readable without decoding two streams at once.
 */
export type TransitionPattern =
  | { kind: "crossfade"; curve: "linear" | "fast" | "slow" }
  | { kind: "colorFade"; color: "black" | "white" | "gray" }
  | { kind: "dissolve" }
  | { kind: "pixelize" }
  | { kind: "blur" }
  | { kind: "wipe"; axis: "x" | "y"; from: "left" | "right" | "top" | "bottom"; soft?: number }
  | { kind: "diagonal"; origin: "tl" | "tr" | "bl" | "br" }
  | { kind: "corner"; origin: "tl" | "tr" | "bl" | "br" }
  | { kind: "iris"; shape: "circle" | "rect" | "vert" | "horz"; mode: "open" | "close" }
  | { kind: "radial" }
  | { kind: "distance" }
  | { kind: "slice"; axis: "x" | "y"; direction: 1 | -1 }
  | { kind: "wind"; axis: "x" | "y"; direction: 1 | -1 }
  | { kind: "slide"; axis: "x" | "y"; travel: 1 | -1; push: boolean }
  | { kind: "reveal"; axis: "x" | "y"; travel: 1 | -1 }
  | { kind: "squeeze"; compress: "x" | "y" }
  | { kind: "zoom" };

const PATTERNS: Record<TransitionType, TransitionPattern> = {
  none: { kind: "crossfade", curve: "linear" },
  wipe: { kind: "wipe", axis: "x", from: "left" },

  fade: { kind: "crossfade", curve: "linear" },
  fadefast: { kind: "crossfade", curve: "fast" },
  fadeslow: { kind: "crossfade", curve: "slow" },
  fadeblack: { kind: "colorFade", color: "black" },
  fadewhite: { kind: "colorFade", color: "white" },
  fadegrays: { kind: "colorFade", color: "gray" },
  dissolve: { kind: "dissolve" },

  wipeleft: { kind: "wipe", axis: "x", from: "right" },
  wiperight: { kind: "wipe", axis: "x", from: "left" },
  wipeup: { kind: "wipe", axis: "y", from: "bottom" },
  wipedown: { kind: "wipe", axis: "y", from: "top" },
  smoothleft: { kind: "wipe", axis: "x", from: "right", soft: 0.28 },
  smoothright: { kind: "wipe", axis: "x", from: "left", soft: 0.28 },
  smoothup: { kind: "wipe", axis: "y", from: "bottom", soft: 0.28 },
  smoothdown: { kind: "wipe", axis: "y", from: "top", soft: 0.28 },
  wipetl: { kind: "corner", origin: "br" },
  wipetr: { kind: "corner", origin: "tl" },
  wipebl: { kind: "corner", origin: "tr" },
  wipebr: { kind: "corner", origin: "bl" },
  diagtl: { kind: "diagonal", origin: "br" },
  diagtr: { kind: "diagonal", origin: "bl" },
  diagbl: { kind: "diagonal", origin: "tl" },
  diagbr: { kind: "diagonal", origin: "tr" },

  slideleft: { kind: "slide", axis: "x", travel: -1, push: false },
  slideright: { kind: "slide", axis: "x", travel: 1, push: false },
  slideup: { kind: "slide", axis: "y", travel: -1, push: false },
  slidedown: { kind: "slide", axis: "y", travel: 1, push: false },
  coverleft: { kind: "slide", axis: "x", travel: -1, push: true },
  coverright: { kind: "slide", axis: "x", travel: 1, push: true },
  coverup: { kind: "slide", axis: "y", travel: -1, push: true },
  coverdown: { kind: "slide", axis: "y", travel: 1, push: true },
  revealleft: { kind: "reveal", axis: "x", travel: -1 },
  revealright: { kind: "reveal", axis: "x", travel: 1 },
  revealup: { kind: "reveal", axis: "y", travel: -1 },
  revealdown: { kind: "reveal", axis: "y", travel: 1 },

  circleopen: { kind: "iris", shape: "circle", mode: "open" },
  circleclose: { kind: "iris", shape: "circle", mode: "close" },
  circlecrop: { kind: "iris", shape: "circle", mode: "open" },
  rectcrop: { kind: "iris", shape: "rect", mode: "open" },
  vertopen: { kind: "iris", shape: "vert", mode: "open" },
  vertclose: { kind: "iris", shape: "vert", mode: "close" },
  horzopen: { kind: "iris", shape: "horz", mode: "open" },
  horzclose: { kind: "iris", shape: "horz", mode: "close" },

  hlslice: { kind: "slice", axis: "x", direction: -1 },
  hrslice: { kind: "slice", axis: "x", direction: 1 },
  vuslice: { kind: "slice", axis: "y", direction: -1 },
  vdslice: { kind: "slice", axis: "y", direction: 1 },
  hlwind: { kind: "wind", axis: "x", direction: -1 },
  hrwind: { kind: "wind", axis: "x", direction: 1 },
  vuwind: { kind: "wind", axis: "y", direction: -1 },
  vdwind: { kind: "wind", axis: "y", direction: 1 },

  pixelize: { kind: "pixelize" },
  hblur: { kind: "blur" },
  radial: { kind: "radial" },
  distance: { kind: "distance" },
  zoomin: { kind: "zoom" },
  squeezeh: { kind: "squeeze", compress: "y" },
  squeezev: { kind: "squeeze", compress: "x" },
};

/** The preview pattern for a transition. */
export function transitionPattern(type: TransitionType): TransitionPattern {
  return PATTERNS[type] ?? PATTERNS.none;
}

/** Two clips are neighbours when one starts where the other ends. */
export function isContiguous(previous: Clip | null | undefined, clip: Clip): boolean {
  if (!previous) return false;
  return Math.abs(previous.start + previous.duration - clip.start) < 0.05;
}

/**
 * A transition that plays where one clip hands over to the next.
 *
 * The transition belongs to the cut, not to a single clip: either edge can
 * describe it and the incoming edge wins when both do. The window sits at the
 * start of the incoming clip, so the clip that is going away is held on its
 * last frame while the new one moves in.
 */
export interface CutTransition {
  /** The clip that hands over. */
  from: Clip;
  /** The clip that takes over. */
  to: Clip;
  type: TransitionType;
  duration: number;
}

/**
 * The transition that plays on the cut between two neighbouring clips.
 *
 * Returns `null` when the cut has no transition.
 */
export function cutTransition(previous: Clip | null | undefined, clip: Clip): CutTransition | null {
  if (!isContiguous(previous, clip)) return null;
  const incoming = clip.transitionIn;
  const outgoing = previous?.transitionOut;
  const type = incoming.type !== "none" ? incoming.type : outgoing?.type ?? "none";
  if (type === "none") return null;
  const source = incoming.type !== "none" ? incoming : outgoing!;
  const duration = Math.max(0.04, Math.min(source.duration, clip.duration, 5));
  return { from: previous!, to: clip, type, duration };
}

/**
 * Every transition on a track, in timeline order.
 */
export function trackTransitions(track: Track): CutTransition[] {
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  const transitions: CutTransition[] = [];
  for (let index = 1; index < clips.length; index += 1) {
    const transition = cutTransition(clips[index - 1], clips[index]);
    if (transition) transitions.push(transition);
  }
  return transitions;
}

/**
 * The transition that is running at `time` on the cut into `clip`.
 */
export function transitionAt(previous: Clip | null | undefined, clip: Clip, time: number): CutTransition | null {
  const transition = cutTransition(previous, clip);
  if (!transition) return null;
  if (time < clip.start || time >= clip.start + transition.duration) return null;
  return transition;
}

/** How far the transition has progressed, from 0 to 1. */
export function transitionProgress(transition: CutTransition, time: number): number {
  const progress = (time - transition.to.start) / transition.duration;
  return Math.max(0, Math.min(1, progress));
}

/**
 * What a clip does with its own transition edges.
 *
 * A transition that belongs to a cut is drawn by the compositor, so the clip
 * keeps its opacity and the two clips are blended together. An edge without a
 * neighbour fades against the background instead.
 */
export interface ClipTransitionPlan {
  /** The transition that plays into the clip. */
  incoming: CutTransition | null;
  /** The transition that plays out of the clip. */
  outgoing: CutTransition | null;
  /** The clip fades in on its own because no neighbour hands over to it. */
  selfFadeIn: boolean;
  /** The clip fades out on its own because no neighbour takes over. */
  selfFadeOut: boolean;
}

/**
 * The transition plan of a clip, given the transitions of its neighbours.
 */
export function clipTransitionPlan(
  clip: Clip,
  incoming: CutTransition | null,
  outgoing: CutTransition | null,
): ClipTransitionPlan {
  return {
    incoming,
    outgoing,
    selfFadeIn: !incoming && clip.transitionIn.type !== "none",
    selfFadeOut: !outgoing && clip.transitionOut.type !== "none",
  };
}

/**
 * The opacity a clip gets from its transition edges.
 *
 * The fade is the dip to black an edge without a neighbour falls back to.
 */
export function transitionAlpha(clip: Clip, time: number, plan: ClipTransitionPlan): number {
  let alpha = 1;
  if (plan.selfFadeIn) {
    const duration = Math.min(clip.duration, clip.transitionIn.duration);
    if (duration > 0 && time < clip.start + duration) {
      alpha *= Math.max(0, (time - clip.start) / duration);
    }
  }
  if (plan.selfFadeOut) {
    const duration = Math.min(clip.duration, clip.transitionOut.duration);
    if (duration > 0 && time > clip.start + clip.duration - duration) {
      alpha *= Math.max(0, (clip.start + clip.duration - time) / duration);
    }
  }
  return alpha;
}

