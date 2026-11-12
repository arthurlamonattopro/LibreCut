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
