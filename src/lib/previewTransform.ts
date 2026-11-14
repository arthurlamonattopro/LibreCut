import { clipValue } from "./animation";
import { textFontOf } from "./previewCanvas";
import type { Asset, Clip, Project } from "./types";

/**
 * The rectangle a clip occupies on the preview canvas.
 *
 * All values are in project pixels, before the canvas is scaled to fit the
 * stage. The overlay uses the same geometry the compositor uses, so a handle
 * sits exactly on the edge of the pixels it will move.
 */
export interface PreviewFrame {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  /** Rotation around the frame center, in degrees. */
  rotation: number;
}

/** Measures one rendered line of text, in project pixels. */
export type TextLineMeasure = (text: string, font: string, characterSpacing: number) => number;

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * Measures text with the canvas the preview draws with.
 *
 * Falls back to an estimate where there is no DOM (tests, SSR), so the
 * geometry helpers stay usable outside the renderer.
 */
export const measureTextLine: TextLineMeasure = (text, font, characterSpacing) => {
  if (typeof document === "undefined") {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]) || 16;
    return text.length * size * 0.55 + Math.max(0, text.length - 1) * characterSpacing;
  }
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * 8;
  context.font = font;
  context.letterSpacing = `${characterSpacing}px`;
  return context.measureText(text).width;
};

/**
 * Returns the on-screen frame of a clip at a point in time.
 *
 * Text is measured from its font settings because it has no source rectangle;
 * media uses the same contain/cover fitting and transform the compositor
 * applies. Clips without a picture (audio, effects) return `null`.
 */
export function visualFrameOf(
  clip: Clip,
  project: Project,
  asset: Asset | undefined,
  time: number,
  measure: TextLineMeasure = measureTextLine,
): PreviewFrame | null {
  const localTime = Math.max(0, Math.min(clip.duration, time - clip.start));

  if (clip.kind === "text") {
    const text = clip.text;
    if (!text) return null;
    const rotation = clipValue(clip, "rotation", localTime, text.rotation);
    const anchorX = clipValue(clip, "x", localTime, text.x) * project.width;
    const anchorY = clipValue(clip, "y", localTime, text.y) * project.height;
    const font = textFontOf(text);
    const lines = text.text.split("\n");
    const lineHeight = text.size * Math.max(0.8, text.lineHeight);
    const padding = text.backgroundOpacity > 0 ? text.size * 0.2 : 0;
    let textWidth = Math.max(
      1,
      ...lines.map((line) => measure(line, font, text.characterSpacing)),
    );
    if (lines.length === 1 && Math.abs(text.curve) >= 1) {
      const arc = Math.abs(text.curve) * Math.PI / 180;
      textWidth = Math.max(textWidth, arc * text.size * 1.15);
    }
    const width = textWidth + padding * 2;
    const height = Math.max(1, lines.length * lineHeight + padding * 2);
    // Canvas text is anchored at `x`/`y`, with `textAlign` only shifting the
    // glyphs inside that anchor. The frame center is therefore offset along the
    // clip's local x axis, which then rotates with the text.
    const offsetX = text.align === "left" ? width / 2 : text.align === "right" ? -width / 2 : 0;
    const radians = (rotation * Math.PI) / 180;
    return {
      centerX: anchorX + offsetX * Math.cos(radians),
      centerY: anchorY + offsetX * Math.sin(radians),
      width,
      height,
      rotation,
    };
  }

  const info = asset?.info;
  if (!info || (!info.hasVideo && !info.isImage) || !info.width || !info.height) return null;
  // Rotated phone footage is displayed upright by the decoder, so the frame is
  // measured with the rotated source dimensions.
  const sideways = Math.abs(Math.round(info.rotation / 90) % 2) === 1;
  const sourceWidth = sideways ? info.height : info.width;
  const sourceHeight = sideways ? info.width : info.height;
  const fitScale = clip.fit === "cover"
    ? Math.max(project.width / sourceWidth, project.height / sourceHeight)
    : Math.min(project.width / sourceWidth, project.height / sourceHeight);
  const clipScale = Math.max(0.001, clipValue(clip, "scale", localTime));
  return {
    centerX: project.width * (0.5 + clipValue(clip, "x", localTime)),
    centerY: project.height * (0.5 + clipValue(clip, "y", localTime)),
    width: sourceWidth * fitScale * clipScale,
    height: sourceHeight * fitScale * clipScale,
    rotation: clipValue(clip, "rotation", localTime),
  };
}

/** The four corners of a frame, clockwise from the top-left, in project pixels. */
export function frameCorners(frame: PreviewFrame): Array<{ x: number; y: number }> {
  const radians = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => ({
    x: frame.centerX + x * cos - y * sin,
    y: frame.centerY + x * sin + y * cos,
  }));
}

/** True when a project-space point falls inside the rotated frame. */
export function frameContainsPoint(frame: PreviewFrame, x: number, y: number): boolean {
  const radians = (frame.rotation * Math.PI) / 180;
  const dx = x - frame.centerX;
  const dy = y - frame.centerY;
  const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
  const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
  return Math.abs(localX) <= frame.width / 2 && Math.abs(localY) <= frame.height / 2;
}
