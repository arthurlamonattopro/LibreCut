import { useEffect, useRef } from "react";

interface WaveformProps {
  peaks: number[];
  className?: string;
  color?: string;
  height?: number;
}

export function Waveform({ peaks, className, color = "#36c8d0", height = 32 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.clientWidth || 320;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bars = Math.min(160, Math.max(24, Math.floor(width / 3)));
    const middle = height / 2;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1, width / bars / 2.2);

    if (peaks.length < 4) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(0, middle);
      ctx.lineTo(width, middle);
      ctx.stroke();
      return;
    }

    const sampleCount = peaks.length / 2;
    for (let index = 0; index < bars; index += 1) {
      const from = Math.floor((index / bars) * sampleCount) * 2;
      const to = Math.max(from + 2, Math.floor(((index + 1) / bars) * sampleCount) * 2);
      let low = 0;
      let high = 0;
      for (let cursor = from; cursor < to && cursor + 1 < peaks.length; cursor += 2) {
        low = Math.min(low, peaks[cursor]);
        high = Math.max(high, peaks[cursor + 1]);
      }
      const x = (index / bars) * width + width / bars / 2;
      const y1 = middle - Math.max(0.5, high * middle * 0.92);
      const y2 = middle - Math.min(-0.5, low * middle * 0.92);
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.stroke();
    }
  }, [peaks, height, color]);

  return <canvas ref={canvasRef} className={className} style={{ height, width: "100%" }} />;
}
