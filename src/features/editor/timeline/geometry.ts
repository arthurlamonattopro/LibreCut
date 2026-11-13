import { Film, Music2, SlidersHorizontal, Type } from "lucide-react";
import type { TrackKind } from "../../../lib/types";

export const LABEL_WIDTH = 154;
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 320;

/** Extra seconds rendered on each side of the viewport. */
export const VISIBLE_MARGIN_SECONDS = 4;

export type DragMode = "move" | "trim-start" | "trim-end";

export interface DragMember {
  clipId: string;
  trackId: string;
  originalStart: number;
}

export interface DragState {
  mode: DragMode;
  clipId: string;
  trackId: string;
  startX: number;
  originalStart: number;
  originalDuration: number;
  /** Every clip that moves with the dragged clip. */
  members: DragMember[];
  /** The snapshot is only taken once the pointer has actually moved. */
  snapshotTaken: boolean;
}

export function trackHeight(kind: TrackKind): number {
  if (kind === "misc") return 60;
  if (kind === "video") return 82;
  if (kind === "audio") return 68;
  return 60;
}

export function trackIcon(kind: TrackKind) {
  return kind === "video" ? Film : kind === "audio" ? Music2 : kind === "misc" ? SlidersHorizontal : Type;
}

export function rulerStep(zoom: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step * zoom >= 64) ?? 1200;
}

export function rulerLabel(seconds: number, step: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (step < 1) return `${m}:${s.toFixed(2).padStart(5, "0")}`;
  return `${m}:${Math.floor(s).toString().padStart(2, "0")}`;
}
