import type { Clip, KeyframeProperty } from "./types";

export function clipValue(clip: Clip, property: KeyframeProperty, localTime: number, base = clip[property]): number {
  const frames = clip.keyframes.filter((frame) => frame.property === property).sort((a, b) => a.time - b.time);
  if (!frames.length || localTime <= frames[0].time) return frames[0] && localTime === frames[0].time ? frames[0].value : base;
  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (localTime <= to.time) {
      const progress = (localTime - from.time) / Math.max(0.001, to.time - from.time);
      return from.value + (to.value - from.value) * progress;
    }
  }
  return frames[frames.length - 1].value;
}

export function transitionState(clip: Clip, time: number, allowWipe = true) {
  const localTime = time - clip.start;
  let alpha = 1;
  let wipeIn = 1;
  let wipeOut = 1;
  const inDuration = Math.min(clip.duration, clip.transitionIn.duration);
  const outDuration = Math.min(clip.duration, clip.transitionOut.duration);
  if (clip.transitionIn.type !== "none" && inDuration > 0 && localTime < inDuration) {
    const progress = Math.max(0, Math.min(1, localTime / inDuration));
    if (clip.transitionIn.type === "fade" || !allowWipe) alpha *= progress;
    else wipeIn = progress;
  }
  const remaining = clip.duration - localTime;
  if (clip.transitionOut.type !== "none" && outDuration > 0 && remaining < outDuration) {
    const progress = Math.max(0, Math.min(1, remaining / outDuration));
    if (clip.transitionOut.type === "fade" || !allowWipe) alpha *= progress;
    else wipeOut = progress;
  }
  return { alpha, wipeIn, wipeOut };
}
