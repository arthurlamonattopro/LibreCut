import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  TRANSITION_GROUPS,
  cutTransition,
  clipTransitionPlan,
  isContiguous,
  isTransitionType,
  trackTransitions,
  transitionAlpha,
  transitionPattern,
  transitionProgress,
  xfadeName,
} from "../src/lib/transitions";
import { dissolveNoise } from "../src/lib/transitionPreview";
import type { Clip, Track, TransitionType } from "../src/lib/types";

/**
 * Every transition FFmpeg's `xfade` filter understands. The catalogue has to
 * cover all of them, otherwise the exporter cannot render the transition a
 * project asks for.
 */
const FFMPEG_TRANSITIONS = [
  "fade",
  "fadefast",
  "fadeslow",
  "fadeblack",
  "fadewhite",
  "fadegrays",
  "dissolve",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "smoothleft",
  "smoothright",
  "smoothup",
  "smoothdown",
  "wipetl",
  "wipetr",
  "wipebl",
  "wipebr",
  "diagtl",
  "diagtr",
  "diagbl",
  "diagbr",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "circleopen",
  "circleclose",
  "circlecrop",
  "rectcrop",
  "vertopen",
  "vertclose",
  "horzopen",
  "horzclose",
  "hlslice",
  "hrslice",
  "vuslice",
  "vdslice",
  "hblur",
  "squeezeh",
  "squeezev",
  "zoomin",
  "radial",
  "distance",
  "pixelize",
  "hlwind",
  "hrwind",
  "vuwind",
  "vdwind",
  "coverleft",
  "coverright",
  "coverup",
  "coverdown",
  "revealleft",
  "revealright",
  "revealup",
  "revealdown",
];

function clip(id: string, start: number, duration: number): Clip {
  return {
    id,
    kind: "video",
    name: id,
    start,
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
    fadeIn: 0,
    fadeOut: 0,
    pitch: 0,
    bass: 0,
    treble: 0,
    keyframes: [],
    transitionIn: { type: "none", duration: 0.5 },
    transitionOut: { type: "none", duration: 0.5 },
  };
}

function track(clips: Clip[]): Track {
  return { id: "video-1", kind: "video", name: "Video", muted: false, hidden: false, locked: false, clips };
}

describe("the transition catalogue", () => {
  it("covers every transition ffmpeg can render", () => {
    const names = TRANSITIONS.map((transition) => transition.xfade);
    for (const name of FFMPEG_TRANSITIONS) {
      expect(names, `missing transition ${name}`).toContain(name);
    }
    expect(TRANSITIONS.length).toBe(FFMPEG_TRANSITIONS.length);
  });

  it("has a unique name and label for every transition", () => {
    const types = TRANSITIONS.map((transition) => transition.type);
    const labels = TRANSITIONS.map((transition) => transition.label);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("puts every transition in a known group", () => {
    const groups = new Set(TRANSITION_GROUPS.map((group) => group.id));
    for (const transition of TRANSITIONS) {
      expect(groups.has(transition.group)).toBe(true);
    }
    for (const group of TRANSITION_GROUPS) {
      expect(TRANSITIONS.some((transition) => transition.group === group.id)).toBe(true);
    }
  });

  it("knows which transitions are supported", () => {
    for (const transition of TRANSITIONS) {
      expect(isTransitionType(transition.type)).toBe(true);
    }
    expect(isTransitionType("none")).toBe(true);
    expect(isTransitionType("wipe")).toBe(true);
    expect(isTransitionType("sparkle")).toBe(false);
    expect(isTransitionType(42)).toBe(false);
  });

  it("maps the legacy wipe name onto a wipe", () => {
    expect(xfadeName("wipe")).toBe("wiperight");
    expect(xfadeName("dissolve")).toBe("dissolve");
  });

  it("has a preview pattern for every transition", () => {
    for (const transition of TRANSITIONS) {
      expect(transitionPattern(transition.type), `no pattern for ${transition.type}`).toBeTruthy();
    }
  });
});

describe("transitions on a cut", () => {
  it("plays on the cut between two clips that touch", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    second.transitionIn = { type: "wipeup", duration: 0.5 };

    const transition = cutTransition(first, second);
    expect(transition).not.toBeNull();
    expect(transition?.type).toBe("wipeup");
    expect(transition?.duration).toBe(0.5);
    expect(transition?.to.id).toBe("b");
  });

  it("does not play when the clips do not touch", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 3, 2);
    second.transitionIn = { type: "wipeup", duration: 0.5 };

    expect(isContiguous(first, second)).toBe(false);
    expect(cutTransition(first, second)).toBeNull();
    expect(cutTransition(null, second)).toBeNull();
  });

  it("takes the type from the incoming edge", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    first.transitionOut = { type: "circleopen", duration: 0.75 };
    second.transitionIn = { type: "dissolve", duration: 0.25 };

    const transition = cutTransition(first, second);
    expect(transition?.type).toBe("dissolve");
    expect(transition?.duration).toBe(0.25);
  });

  it("falls back to the outgoing edge", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    first.transitionOut = { type: "circleopen", duration: 0.75 };

    const transition = cutTransition(first, second);
    expect(transition?.type).toBe("circleopen");
    expect(transition?.duration).toBe(0.75);
  });

  it("never lasts longer than the clip it plays into", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 0.4);
    second.transitionIn = { type: "dissolve", duration: 5 };

    expect(cutTransition(first, second)?.duration).toBe(0.4);
  });

  it("finds every transition on a track", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    const third = clip("c", 4, 2);
    second.transitionIn = { type: "dissolve", duration: 0.5 };
    third.transitionIn = { type: "circleopen", duration: 0.5 };

    const transitions = trackTransitions(track([first, second, third]));
    expect(transitions.map((transition) => transition.type)).toEqual(["dissolve", "circleopen"]);
  });

  it("reports how far a transition has come", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    second.transitionIn = { type: "dissolve", duration: 0.5 };
    const transition = cutTransition(first, second)!;

    expect(transitionProgress(transition, 2)).toBe(0);
    expect(transitionProgress(transition, 2.25)).toBe(0.5);
    expect(transitionProgress(transition, 2.5)).toBe(1);
  });
});

describe("transition opacity", () => {
  it("keeps the clip opaque while a cut transition runs", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    second.transitionIn = { type: "dissolve", duration: 0.5 };
    const transition = cutTransition(first, second);

    const plan = clipTransitionPlan(second, transition, null);
    expect(plan.selfFadeIn).toBe(false);
    expect(transitionAlpha(second, 2, plan)).toBe(1);
  });

  it("fades an edge that has no neighbour", () => {
    const only = clip("a", 0, 2);
    only.transitionIn = { type: "dissolve", duration: 0.5 };

    const plan = clipTransitionPlan(only, null, null);
    expect(plan.selfFadeIn).toBe(true);
    expect(transitionAlpha(only, 0, plan)).toBe(0);
    expect(transitionAlpha(only, 0.25, plan)).toBe(0.5);
    expect(transitionAlpha(only, 1, plan)).toBe(1);
  });

  it("fades the outgoing edge of the last clip on a track", () => {
    const last = clip("a", 0, 2);
    last.transitionOut = { type: "dissolve", duration: 0.5 };

    const plan = clipTransitionPlan(last, null, null);
    expect(plan.selfFadeOut).toBe(true);
    expect(transitionAlpha(last, 1.75, plan)).toBe(0.5);
    expect(transitionAlpha(last, 1.5, plan)).toBe(1);
  });

  it("does not fade an edge that belongs to a cut", () => {
    const first = clip("a", 0, 2);
    const second = clip("b", 2, 2);
    first.transitionOut = { type: "dissolve", duration: 0.5 };
    const transition = cutTransition(first, second);

    const plan = clipTransitionPlan(first, null, transition);
    expect(plan.selfFadeOut).toBe(false);
    expect(transitionAlpha(first, 1.9, plan)).toBe(1);
  });
});

describe("the dissolve noise", () => {
  it("gives the same pixel the same value", () => {
    expect(dissolveNoise(12, 34)).toBe(dissolveNoise(12, 34));
  });

  it("keeps every value between zero and one", () => {
    for (let x = 0; x < 40; x += 1) {
      for (let y = 0; y < 40; y += 1) {
        const value = dissolveNoise(x, y);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it("changes roughly half of the pixels halfway through", () => {
    let changed = 0;
    const total = 60 * 60;
    for (let x = 0; x < 60; x += 1) {
      for (let y = 0; y < 60; y += 1) {
        if (dissolveNoise(x, y) < 0.5) changed += 1;
      }
    }
    expect(changed / total).toBeGreaterThan(0.4);
    expect(changed / total).toBeLessThan(0.6);
  });
});

describe("the transition type union", () => {
  it("accepts every catalogue entry", () => {
    const types: TransitionType[] = TRANSITIONS.map((transition) => transition.type);
    expect(types.length).toBeGreaterThan(50);
  });
});
