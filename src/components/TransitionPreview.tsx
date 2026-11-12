import { useEffect, useRef } from "react";
import { renderTransition } from "../lib/transitionPreview";
import type { TransitionType } from "../lib/types";

const LOGICAL_WIDTH = 160;
const LOGICAL_HEIGHT = 90;
const PIXEL_RATIO = 2;

function drawScene(ctx: CanvasRenderingContext2D, layer: "outgoing" | "incoming"): void {
  const width = LOGICAL_WIDTH;
  const height = LOGICAL_HEIGHT;
  const warm = layer === "outgoing";
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  if (warm) {
    gradient.addColorStop(0, "#24151d");
    gradient.addColorStop(0.52, "#9b4d38");
    gradient.addColorStop(1, "#f0be62");
  } else {
    gradient.addColorStop(0, "#0b1d24");
    gradient.addColorStop(0.55, "#1c6470");
    gradient.addColorStop(1, "#36c8d0");
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // A horizon and a few shapes give the eye something to follow while the
  // transition moves. The two scenes use mirrored compositions so a wipe or a
  // slide is obvious at thumbnail size.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = warm ? "#ffd9a8" : "#b8fbff";
  ctx.beginPath();
  ctx.arc(warm ? width * 0.24 : width * 0.76, height * 0.34, height * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let index = 1; index < 5; index += 1) {
    const y = (height / 5) * index;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = `600 ${Math.round(height * 0.42)}px "Cascadia Code", "Segoe UI", sans-serif`;
  ctx.textAlign = warm ? "left" : "right";
  ctx.textBaseline = "middle";
  ctx.fillText(warm ? "A" : "B", warm ? width * 0.12 : width * 0.88, height * 0.52);
}

/**
 * A hover preview of a transition.
 *
 * The same canvas renderer that the preview stage uses paints two synthetic
 * scenes, so a card shows the real geometry of the transition rather than a
 * decorative approximation.
 */
export function TransitionPreview({
  type,
  playing,
  className,
}: {
  type: TransitionType;
  playing: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = LOGICAL_WIDTH * PIXEL_RATIO;
    const height = LOGICAL_HEIGHT * PIXEL_RATIO;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const draw = (progress: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      renderTransition(ctx, type, progress, {
        width,
        height,
        scale: PIXEL_RATIO,
        outgoing: (target) => drawScene(target, "outgoing"),
        incoming: (target) => drawScene(target, "incoming"),
      });
    };

    if (!playing || reduced) {
      draw(0.55);
      return;
    }

    const started = performance.now();
    const duration = 1600;
    const tick = (now: number) => {
      const elapsed = (now - started) % duration;
      const linear = elapsed / duration;
      // Hold the first and last frame briefly so the change is readable.
      const eased = linear < 0.12
        ? 0
        : linear > 0.88
          ? 1
          : (linear - 0.12) / 0.76;
      draw(eased);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [type, playing]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
