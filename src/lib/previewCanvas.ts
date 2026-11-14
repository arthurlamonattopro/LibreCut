import { clipValue } from "./animation";
import { clipTransitionPlan, transitionAlpha, type ClipTransitionPlan } from "./transitions";
import type { TimelineIndex } from "./timelineIndex";
import type { ChromaKeyOptions, Clip, LutSettings, MaskPoint, Project, TextOptions } from "./types";

let lutPreviewCanvas: HTMLCanvasElement | undefined;

/** The clip transform, sampled at a point in time, used to place mask points. */
export interface MaskFrame {
  x: number;
  y: number;
  scale: number;
  cos: number;
  sin: number;
}

export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function applyLutToCanvas(canvas: HTMLCanvasElement, lut: LutSettings) {
  const context = canvas.getContext("2d");
  if (!context || lut.data.length !== lut.size ** 3 * 3) return;
  const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
  if (scale < 1) {
    lutPreviewCanvas ??= document.createElement("canvas");
    const preview = lutPreviewCanvas;
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    if (preview.width !== width || preview.height !== height) { preview.width = width; preview.height = height; }
    const previewContext = preview.getContext("2d");
    if (!previewContext) return;
    previewContext.drawImage(canvas, 0, 0, width, height);
    applyLutToCanvas(preview, lut);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    return;
  }
  let image: ImageData;
  try { image = context.getImageData(0, 0, canvas.width, canvas.height); } catch { return; }
  const { data } = image;
  const size = lut.size;
  const domainMin = lut.domainMin ?? [0, 0, 0];
  const domainMax = lut.domainMax ?? [1, 1, 1];
  const sample = (r: number, g: number, b: number, channel: number) => lut.data[((r * size + g) * size + b) * 3 + channel];
  const blend = Math.max(0, Math.min(1, lut.strength));
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    const coords = [0, 1, 2].map((channel) => {
      const value = data[pixel + channel] / 255;
      return Math.max(0, Math.min(size - 1, ((value - domainMin[channel]) / (domainMax[channel] - domainMin[channel])) * (size - 1)));
    });
    const lo = coords.map(Math.floor);
    const hi = coords.map((_, channel) => Math.min(size - 1, lo[channel] + 1));
    const f = coords.map((value, channel) => value - lo[channel]);
    for (let channel = 0; channel < 3; channel++) {
      let transformed = 0;
      for (let ri = 0; ri < 2; ri++) for (let gi = 0; gi < 2; gi++) for (let bi = 0; bi < 2; bi++) {
        const weight = (ri ? f[0] : 1 - f[0]) * (gi ? f[1] : 1 - f[1]) * (bi ? f[2] : 1 - f[2]);
        transformed += sample(ri ? hi[0] : lo[0], gi ? hi[1] : lo[1], bi ? hi[2] : lo[2], channel) * weight;
      }
      data[pixel + channel] = Math.round(data[pixel + channel] * (1 - blend) + Math.max(0, Math.min(1, transformed)) * 255 * blend);
    }
  }
  context.putImageData(image, 0, 0);
}

export function drawFitted(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: "contain" | "cover",
) {
  if (!sourceWidth || !sourceHeight) return;
  const scale =
    fit === "cover"
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  try {
    ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } catch {
    // A frame that is not decodable yet (or a CORS failure) should not break
    // the compositor loop; the next frame will retry.
  }
}

export function keyedFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: ChromaKeyOptions,
  canvas: HTMLCanvasElement,
) {
  const width = Math.max(1, Math.min(1600, sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight * width / sourceWidth));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  ctx.clearRect(0, 0, width, height);
  try {
    ctx.drawImage(source, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const data = pixels.data;
    const hex = options.color.replace("#", "");
    const kr = Number.parseInt(hex.slice(0, 2), 16) || 0;
    const kg = Number.parseInt(hex.slice(2, 4), 16) || 0;
    const kb = Number.parseInt(hex.slice(4, 6), 16) || 0;
    const threshold = Math.max(0, Math.min(1, options.similarity)) * 441.67;
    const edge = Math.max(0.001, options.softness) * 441.67;
    for (let i = 0; i < data.length; i += 4) {
      const distance = Math.hypot(data[i] - kr, data[i + 1] - kg, data[i + 2] - kb);
      const t = Math.max(0, Math.min(1, (distance - threshold) / edge));
      data[i + 3] = Math.round(data[i + 3] * t * t * (3 - 2 * t));
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    return source;
  }
}

/**
 * Applies a clip mask in the clip's local frame.
 *
 * The mask travels with the clip: the caller applies the clip transform first,
 * so position and size are measured against the clip frame. The exporter uses
 * the same frame ordering.
 */
export function applyClipMask(
  target: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
) {
  const mask = clip.mask;
  if (!mask || mask === "none") return;
  const minSide = Math.min(width, height);

  if (mask === "custom") {
    const points = clip.maskPoints ?? [];
    if (points.length < 3) return;
    target.beginPath();
    points.forEach((point, index) => {
      const x = (point.x - 0.5) * width;
      const y = (point.y - 0.5) * height;
      if (index === 0) target.moveTo(x, y);
      else target.lineTo(x, y);
    });
    target.closePath();
    target.clip();
    return;
  }

  const maskWidth = Math.max(1, (clip.maskWidth ?? 0.6) * minSide);
  const maskHeight = mask === "rectangle"
    ? Math.max(1, (clip.maskHeight ?? 0.6) * minSide)
    : maskWidth;
  const centerX = ((clip.maskX ?? 0.5) - 0.5) * width;
  const centerY = ((clip.maskY ?? 0.5) - 0.5) * height;

  const matrix = target.getTransform();
  target.translate(centerX, centerY);
  const rotation = ((clip.maskRotation ?? 0) * Math.PI) / 180;
  if (rotation) target.rotate(rotation);
  target.beginPath();
  if (mask === "circle") {
    target.arc(0, 0, maskWidth / 2, 0, Math.PI * 2);
  } else {
    target.rect(-maskWidth / 2, -maskHeight / 2, maskWidth, maskHeight);
  }
  target.clip();
  target.setTransform(matrix);
}

/**
 * Keeps a freehand mask to a workable vertex count.
 *
 * Affine points are sampled evenly, which is enough for a clip mask and keeps
 * the export expression short.
 */
export function simplifyMaskPoints(points: MaskPoint[], max = 32): MaskPoint[] {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, index) =>
    points[Math.round((index * (points.length - 1)) / (max - 1))],
  );
}

/**
 * The transition plan of a clip: which transition plays into it, which plays
 * out of it, and whether its own edges fade it in or out.
 */
export function transitionPlanOf(index: TimelineIndex | null, clip: Clip): ClipTransitionPlan {
  if (!index) return clipTransitionPlan(clip, null, null);
  const location = index.clipLocations.get(clip.id);
  if (!location) return clipTransitionPlan(clip, null, null);
  const { track, index: position } = location;
  return clipTransitionPlan(
    clip,
    track.transitions[position] ?? null,
    track.transitions[position + 1] ?? null,
  );
}

/** Samples the clip transform at a point in time for the mask overlay. */
export function maskFrameOf(clip: Clip, time: number): MaskFrame {
  const localTime = Math.max(0, Math.min(clip.duration, time - clip.start));
  const rotation = (clipValue(clip, "rotation", localTime) * Math.PI) / 180;
  return {
    x: clipValue(clip, "x", localTime),
    y: clipValue(clip, "y", localTime),
    scale: Math.max(0.001, clipValue(clip, "scale", localTime)),
    cos: Math.cos(rotation),
    sin: Math.sin(rotation),
  };
}

/**
 * Maps a pointer position to a clip-local mask point.
 *
 * Undoes the clip transform so the point is stored in the clip frame, matching
 * the preview and the exporter.
 */
export function maskPointAt(
  project: Project,
  frame: MaskFrame,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): MaskPoint | null {
  if (!rect.width || !rect.height) return null;
  const offsetX = clientX - rect.left - rect.width * (0.5 + frame.x);
  const offsetY = clientY - rect.top - rect.height * (0.5 + frame.y);
  const projectX = offsetX * (project.width / rect.width);
  const projectY = offsetY * (project.height / rect.height);
  const localX = (projectX * frame.cos + projectY * frame.sin) / frame.scale;
  const localY = (-projectX * frame.sin + projectY * frame.cos) / frame.scale;
  return {
    x: Math.max(0, Math.min(1, localX / project.width + 0.5)),
    y: Math.max(0, Math.min(1, localY / project.height + 0.5)),
  };
}

/** Maps clip-local mask points to pixels on the displayed canvas. */
export function maskOverlayPoints(
  points: MaskPoint[],
  project: Project,
  frame: MaskFrame,
  box: CanvasBox,
): string {
  if (!box.width || !box.height) return "";
  const centerX = box.width * (0.5 + frame.x);
  const centerY = box.height * (0.5 + frame.y);
  return points.map((point) => {
    const localX = (point.x - 0.5) * project.width * frame.scale;
    const localY = (point.y - 0.5) * project.height * frame.scale;
    const rotatedX = localX * frame.cos - localY * frame.sin;
    const rotatedY = localX * frame.sin + localY * frame.cos;
    const x = centerX + rotatedX * (box.width / project.width);
    const y = centerY + rotatedY * (box.height / project.height);
    return `${x},${y}`;
  }).join(" ");
}

/** The canvas font of a text clip, shared with the preview transform overlay. */
export function textFontOf(text: TextOptions): string {
  return `${text.italic ? "italic " : ""}${text.fontWeight} ${text.size}px "${text.fontFamily}", "Segoe UI", sans-serif`;
}

/** Paints a text clip, including its outline, background, curve, and underline. */
export function drawTextClip(ctx: CanvasRenderingContext2D, clip: Clip, project: Project, time: number) {
  const text = clip.text;
  if (!text) return;
  const plan = clipTransitionPlan(clip, null, null);
  const transition = transitionAlpha(clip, time, plan);
  const localTime = time - clip.start;
  const x = clipValue(clip, "x", localTime, text.x) * project.width;
  const y = clipValue(clip, "y", localTime, text.y) * project.height;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((clipValue(clip, "rotation", localTime, text.rotation) * Math.PI) / 180);
  ctx.globalAlpha = clipValue(clip, "opacity", localTime) * transition;
  const brightness = Math.max(0, Math.min(2, text.brightness));
  const brightColor = /^#[0-9a-f]{6}$/i.test(text.color)
    ? `#${[1, 3, 5].map((at) => Math.min(255, Math.round(parseInt(text.color.slice(at, at + 2), 16) * brightness)).toString(16).padStart(2, "0")).join("")}`
    : text.color;
  const lines = text.text.split("\n");
  const lineHeight = text.size * Math.max(0.8, text.lineHeight);
  ctx.fillStyle = brightColor;
  ctx.strokeStyle = text.outlineColor;
  ctx.lineWidth = text.outlineWidth * 2;
  ctx.lineJoin = "round";
  ctx.font = textFontOf(text);
  ctx.textAlign = text.align;
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${text.characterSpacing}px`;
  ctx.shadowColor = colorWithAlpha(text.shadowColor, Math.max(0, Math.min(1, text.shadow)));
  ctx.shadowBlur = Math.max(0, text.size * 0.14 * text.shadow);
  ctx.shadowOffsetY = Math.max(0, text.size * 0.05 * text.shadow);
  if (text.backgroundOpacity > 0) {
    const maxWidth = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
    const padding = text.size * 0.2;
    const left = text.align === "left" ? -padding : text.align === "right" ? -maxWidth - padding : -maxWidth / 2 - padding;
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.globalAlpha *= Math.max(0, Math.min(1, text.backgroundOpacity));
    ctx.fillStyle = text.backgroundColor;
    ctx.fillRect(left, -(lines.length * lineHeight) / 2 - padding, maxWidth + padding * 2, lines.length * lineHeight + padding * 2);
    ctx.restore();
  }
  if (lines.length === 1 && Math.abs(text.curve) >= 1) {
    const chars = Array.from(text.text);
    const widths = chars.map((char) => ctx.measureText(char).width + text.characterSpacing);
    const glyphWidth = widths.reduce((sum, width) => sum + width, 0);
    const arc = Math.abs(text.curve) * Math.PI / 180;
    const totalWidth = Math.max(glyphWidth, arc * text.size * 1.15);
    const extraGap = chars.length > 1 ? (totalWidth - glyphWidth) / (chars.length - 1) : 0;
    const left = text.align === "left" ? 0 : text.align === "right" ? -totalWidth : -totalWidth / 2;
    let cursor = left;
    const radius = totalWidth / Math.max(0.01, arc);
    chars.forEach((char, index) => {
      const advance = widths[index] + (index < chars.length - 1 ? extraGap : 0);
      const angle = ((cursor + advance / 2 - (left + totalWidth / 2)) / totalWidth) * arc;
      const curveX = Math.sign(text.curve) * radius * Math.sin(angle);
      const curveY = Math.sign(text.curve) * radius * (1 - Math.cos(angle));
      ctx.save();
      ctx.translate(left + totalWidth / 2 + curveX, curveY);
      ctx.rotate(Math.sign(text.curve) * angle);
      if (text.outlineWidth > 0) ctx.strokeText(char, 0, 0);
      ctx.fillText(char, 0, 0);
      if (text.underline) ctx.fillRect(-widths[index] / 2, text.size * 0.55, widths[index], Math.max(1, text.size * 0.045));
      ctx.restore();
      cursor += advance;
    });
  } else {
    lines.forEach((line, index) => {
      const lineY = (index - (lines.length - 1) / 2) * lineHeight;
      if (text.outlineWidth > 0) ctx.strokeText(line, 0, lineY);
      ctx.fillText(line, 0, lineY);
      if (text.underline) {
        const width = ctx.measureText(line).width;
        const left = text.align === "left" ? 0 : text.align === "right" ? -width : -width / 2;
        ctx.fillRect(left, lineY + text.size * 0.55, width, Math.max(1, text.size * 0.045));
      }
    });
  }
  ctx.restore();
}
