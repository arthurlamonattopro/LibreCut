import { transitionPattern, type TransitionPattern } from "./transitions";
import type { TransitionType } from "./types";

/**
 * The canvas side of the transition renderer.
 *
 * The exporter hands the transition to FFmpeg's `xfade` filter, which does
 * the real work. The preview has to draw the same motion with canvas
 * operations, so every transition is described once as a
 * {@link TransitionPattern} and painted here.
 */

export interface TransitionLayers {
  /** The canvas width in device pixels. */
  width: number;
  /** The canvas height in device pixels. */
  height: number;
  /** The factor that maps project pixels onto canvas pixels. */
  scale: number;
  /** Draws the clip that is going away. */
  outgoing: (ctx: CanvasRenderingContext2D) => void;
  /** Draws the clip that comes in. */
  incoming: (ctx: CanvasRenderingContext2D) => void;
}

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const surfaces = new Map<string, Surface>();

function surface(key: string, width: number, height: number): Surface {
  let entry = surfaces.get(key);
  if (!entry) {
    const canvas = document.createElement("canvas");
    entry = { canvas, ctx: canvas.getContext("2d")! };
    surfaces.set(key, entry);
  }
  if (entry.canvas.width !== width || entry.canvas.height !== height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  return entry;
}

/** Resets a surface so it can be painted from scratch. */
function prepare(entry: Surface, layers: TransitionLayers): void {
  const { ctx, canvas } = entry;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(layers.scale, 0, 0, layers.scale, 0, 0);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The blend factor of a crossfade, from the outgoing clip to the incoming. */
function crossfadeFactor(pattern: TransitionPattern, progress: number): number {
  if (pattern.kind !== "crossfade") return progress;
  if (pattern.curve === "fast") return Math.pow(progress, 0.6);
  if (pattern.curve === "slow") return Math.pow(progress, 1.5);
  return progress;
}

/**
 * Paints the region that shows the incoming clip.
 *
 * The mask is white where the incoming clip is visible and transparent
 * everywhere else. It is applied to the incoming layer with
 * `destination-in`, which keeps the preview cheap: only the transition
 * frames pay for the extra compositing.
 */
function paintMask(ctx: CanvasRenderingContext2D, pattern: TransitionPattern, progress: number, width: number, height: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";

  switch (pattern.kind) {
    case "wipe": {
      const soft = pattern.soft ?? 0;
      const horizontal = pattern.axis === "x";
      const size = horizontal ? width : height;
      const fromStart = pattern.from === "left" || pattern.from === "top";
      // The edge travels from the source side towards the far side.
      const edge = fromStart ? size * progress : size * (1 - progress);
      const band = soft * size;
      if (band <= 0.5) {
        if (fromStart) {
          if (horizontal) ctx.fillRect(0, 0, edge, height);
          else ctx.fillRect(0, 0, width, edge);
        } else {
          if (horizontal) ctx.fillRect(edge, 0, width - edge, height);
          else ctx.fillRect(0, edge, width, height - edge);
        }
        break;
      }
      const half = band / 2;
      const start = Math.max(0, Math.min(size, edge - half));
      const end = Math.max(0, Math.min(size, edge + half));
      const gradient = horizontal
        ? ctx.createLinearGradient(start, 0, end, 0)
        : ctx.createLinearGradient(0, start, 0, end);
      gradient.addColorStop(0, fromStart ? "rgba(255,255,255,0)" : "rgba(255,255,255,1)");
      gradient.addColorStop(1, fromStart ? "rgba(255,255,255,1)" : "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "diagonal": {
      // The reveal travels along the diagonal that points at the origin.
      const corners: Record<string, [number, number]> = {
        tl: [0, 0],
        tr: [width, 0],
        bl: [0, height],
        br: [width, height],
      };
      const [ox, oy] = corners[pattern.origin];
      const farX = ox === 0 ? width : 0;
      const farY = oy === 0 ? height : 0;
      const gradient = ctx.createLinearGradient(ox, oy, farX, farY);
      const stop = clamp01(1 - progress);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(Math.max(0, stop - 0.001), "rgba(255,255,255,1)");
      gradient.addColorStop(Math.min(1, stop + 0.001), "rgba(255,255,255,0)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "corner": {
      // An L shaped reveal: the corner opens up along both edges.
      const x = pattern.origin === "tl" || pattern.origin === "bl" ? width * progress : width * (1 - progress);
      const y = pattern.origin === "tl" || pattern.origin === "tr" ? height * progress : height * (1 - progress);
      const left = pattern.origin === "tl" || pattern.origin === "bl";
      const top = pattern.origin === "tl" || pattern.origin === "tr";
      ctx.fillRect(left ? 0 : x, 0, left ? x : width - x, height);
      ctx.fillRect(0, top ? 0 : y, width, top ? y : height - y);
      break;
    }
    case "iris": {
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.hypot(width, height) / 2;
      ctx.beginPath();
      if (pattern.shape === "circle") {
        const radius = pattern.mode === "open" ? maxRadius * progress : maxRadius * (1 - progress);
        ctx.arc(centerX, centerY, Math.max(0, radius), 0, Math.PI * 2);
        if (pattern.mode === "close") {
          ctx.rect(0, 0, width, height);
          ctx.fill("evenodd");
          break;
        }
        ctx.fill();
        break;
      }
      if (pattern.shape === "rect") {
        const halfWidth = (width / 2) * progress;
        const halfHeight = (height / 2) * progress;
        ctx.rect(centerX - halfWidth, centerY - halfHeight, halfWidth * 2, halfHeight * 2);
        ctx.fill();
        break;
      }
      // Bars opening from the centre.
      if (pattern.shape === "vert") {
        const half = (width / 2) * progress;
        ctx.rect(centerX - half, 0, half * 2, height);
        ctx.fill();
        break;
      }
      const half = (height / 2) * progress;
      ctx.rect(0, centerY - half, width, half * 2);
      ctx.fill();
      break;
    }
    case "radial": {
      // A sweep around the centre, starting at the top and running clockwise.
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.hypot(width, height);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "distance": {
      // The centre of the frame changes first.
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.hypot(width, height) / 2;
      const radius = maxRadius * clamp01((progress - 0.05) * 2.4);
      const gradient = ctx.createRadialGradient(centerX, centerY, Math.max(0, radius - maxRadius * 0.25), centerX, centerY, radius + maxRadius * 0.25);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "slice": {
      // The reveal advances in slices instead of in one straight edge.
      const horizontal = pattern.axis === "x";
      const size = horizontal ? width : height;
      const slices = 12;
      const slice = size / slices;
      for (let index = 0; index < slices; index += 1) {
        const local = (index + 0.5) / slices;
        const threshold = clamp01(progress * (1 + (index % 3) * 0.12));
        if (local > threshold) continue;
        const fromStart = pattern.direction === 1;
        if (horizontal) {
          ctx.fillRect(fromStart ? index * slice : 0, 0, slice, height);
        } else {
          ctx.fillRect(0, fromStart ? index * slice : 0, width, slice);
        }
      }
      break;
    }
    case "wind": {
      // A ragged edge, like the new clip is blown in.
      const horizontal = pattern.axis === "x";
      const size = horizontal ? width : height;
      const steps = 24;
      for (let index = 0; index < steps; index += 1) {
        const wobble = Math.sin(index * 2.3 + progress * 6) * 0.16;
        const local = clamp01(progress + wobble);
        const fromStart = pattern.direction === 1;
        const start = fromStart ? 0 : size * (1 - local);
        const length = size * local;
        if (horizontal) ctx.fillRect(start, (index / steps) * height, length, height / steps + 1);
        else ctx.fillRect((index / steps) * width, start, width / steps + 1, length);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * A stable pseudo random value for a pixel, between 0 and 1.
 *
 * The same pixel always gets the same value, so a dissolve keeps its pattern
 * while it runs instead of flickering.
 */
export function dissolveNoise(x: number, y: number): number {
  const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return hash - Math.floor(hash);
}

/** A noise field, so a dissolve keeps the same pattern while it runs. */
function noiseMask(width: number, height: number, progress: number): HTMLCanvasElement {
  const key = "noise";
  const entry = surface(key, width, height);
  const { ctx, canvas } = entry;
  const image = ctx.createImageData(width, height);
  const { data } = image;
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const on = dissolveNoise(x, y) < progress ? 255 : 0;
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = on;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Draws a layer through a pixelation filter. */
function pixelate(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, width: number, height: number): void {
  const block = 14;
  const small = surface("pixel", Math.max(2, Math.round(width / block)), Math.max(2, Math.round(height / block)));
  small.ctx.setTransform(1, 0, 0, 1, 0, 0);
  small.ctx.clearRect(0, 0, small.canvas.width, small.canvas.height);
  small.ctx.drawImage(source, 0, 0, small.canvas.width, small.canvas.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small.canvas, 0, 0, width, height);
  ctx.restore();
}

/**
 * Draws a transition between two clips.
 *
 * The outgoing clip is drawn first and the incoming clip is painted over it
 * through a mask, which is how every transition in the catalogue is built.
 */
export function renderTransition(
  ctx: CanvasRenderingContext2D,
  type: TransitionType,
  progress: number,
  layers: TransitionLayers,
): void {
  const pattern = transitionPattern(type);
  const { width, height } = layers;
  const clamped = clamp01(progress);

  const outgoing = surface("outgoing", width, height);
  const incoming = surface("incoming", width, height);
  prepare(outgoing, layers);
  prepare(incoming, layers);
  layers.outgoing(outgoing.ctx);
  layers.incoming(incoming.ctx);

  const veil = pattern.kind === "colorFade" ? pattern.color : null;

  if (pattern.kind === "crossfade" || pattern.kind === "pixelize" || pattern.kind === "blur" || pattern.kind === "zoom") {
    const factor = crossfadeFactor(pattern, clamped);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (pattern.kind === "pixelize") {
      pixelate(ctx, outgoing.canvas, width, height);
      ctx.globalAlpha = factor;
      pixelate(ctx, incoming.canvas, width, height);
    } else if (pattern.kind === "blur") {
      const amount = Math.sin(Math.PI * clamped) * Math.max(2, width * 0.02);
      ctx.filter = `blur(${amount.toFixed(2)}px)`;
      ctx.drawImage(outgoing.canvas, 0, 0);
      ctx.globalAlpha = factor;
      ctx.drawImage(incoming.canvas, 0, 0);
      ctx.filter = "none";
    } else if (pattern.kind === "zoom") {
      ctx.drawImage(outgoing.canvas, 0, 0);
      ctx.globalAlpha = factor;
      const zoom = 0.2 + 0.8 * clamped;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.drawImage(incoming.canvas, -width / 2, -height / 2);
      ctx.restore();
    } else {
      ctx.drawImage(outgoing.canvas, 0, 0);
      ctx.globalAlpha = factor;
      ctx.drawImage(incoming.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  if (veil) {
    // The outgoing clip fades into a colour, then the incoming clip comes
    // back out of it.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(outgoing.canvas, 0, 0);
    const fadeOut = clamp01(1 - clamped / 0.25);
    if (fadeOut > 0) {
      ctx.globalAlpha = fadeOut;
      ctx.fillStyle = veil === "black" ? "#000000" : veil === "white" ? "#ffffff" : "#808080";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = clamp01((clamped - 0.25) / 0.75);
    ctx.drawImage(incoming.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  if (pattern.kind === "dissolve") {
    // A noise field decides which pixels have already changed over.
    const mask = surface("dissolve", Math.max(2, Math.round(width / 3)), Math.max(2, Math.round(height / 3)));
    const noise = noiseMask(mask.canvas.width, mask.canvas.height, clamped);
    const cut = surface("dissolveCut", width, height);
    prepare(cut, layers);
    cut.ctx.setTransform(1, 0, 0, 1, 0, 0);
    cut.ctx.drawImage(incoming.canvas, 0, 0);
    cut.ctx.globalCompositeOperation = "destination-in";
    cut.ctx.imageSmoothingEnabled = false;
    cut.ctx.drawImage(noise, 0, 0, width, height);
    cut.ctx.globalCompositeOperation = "source-over";
    cut.ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(outgoing.canvas, 0, 0);
    ctx.drawImage(cut.canvas, 0, 0);
    ctx.restore();
    return;
  }

  if (pattern.kind === "slide") {
    // The incoming clip moves in, optionally pushing the outgoing clip away.
    const horizontal = pattern.axis === "x";
    const size = horizontal ? width : height;
    const offset = -pattern.travel * (1 - clamped) * size;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(outgoing.canvas, 0, 0);
    if (pattern.push) {
      const push = pattern.travel * clamped * size;
      ctx.drawImage(outgoing.canvas, horizontal ? push : 0, horizontal ? 0 : push);
    }
    ctx.drawImage(incoming.canvas, horizontal ? offset : 0, horizontal ? 0 : offset);
    ctx.restore();
    return;
  }

  if (pattern.kind === "reveal") {
    // The outgoing clip moves away and uncovers the incoming clip.
    const horizontal = pattern.axis === "x";
    const size = horizontal ? width : height;
    const offset = pattern.travel * clamped * size;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(incoming.canvas, 0, 0);
    ctx.drawImage(outgoing.canvas, horizontal ? offset : 0, horizontal ? 0 : offset);
    ctx.restore();
    return;
  }

  if (pattern.kind === "squeeze") {
    // The outgoing clip is squeezed into a band in the middle.
    const squeeze = 1 - clamped * 0.85;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(incoming.canvas, 0, 0);
    ctx.translate(width / 2, height / 2);
    ctx.scale(pattern.compress === "x" ? squeeze : 1, pattern.compress === "y" ? squeeze : 1);
    ctx.drawImage(outgoing.canvas, -width / 2, -height / 2);
    ctx.restore();
    return;
  }

  // Everything else is a masked reveal of the incoming clip.
  const mask = surface("mask", width, height);
  paintMask(mask.ctx, pattern, clamped, width, height);
  const cut = surface("cut", width, height);
  prepare(cut, layers);
  cut.ctx.setTransform(1, 0, 0, 1, 0, 0);
  cut.ctx.drawImage(incoming.canvas, 0, 0);
  cut.ctx.globalCompositeOperation = "destination-in";
  cut.ctx.drawImage(mask.canvas, 0, 0);
  cut.ctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(outgoing.canvas, 0, 0);
  ctx.drawImage(cut.canvas, 0, 0);
  ctx.restore();
}
