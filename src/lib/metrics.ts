/**
 * Runtime metrics used to profile long timelines and 4K sources.
 *
 * The counters here back the targets in `docs/performance.md`: project-save
 * time, timeline interaction latency, preview decode latency, and memory
 * usage. Everything is collected in the renderer so a profiling session can
 * be captured without attaching a debugger.
 */

export type MetricUnit = "ms" | "bytes" | "count" | "fps";

export interface MetricSample {
  /** Milliseconds since the epoch. */
  at: number;
  value: number;
  detail?: Record<string, number | string | boolean | undefined>;
}

export interface MetricSummary {
  name: string;
  unit: MetricUnit;
  count: number;
  last: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  /** Samples retained for the percentiles. */
  samples: number;
}

interface MetricState {
  unit: MetricUnit;
  window: number[];
  last: number;
  min: number;
  max: number;
  total: number;
  count: number;
  recent: MetricSample[];
}

const WINDOW_SIZE = 240;
const RECENT_SIZE = 20;

const metrics = new Map<string, MetricState>();

function stateFor(name: string, unit: MetricUnit): MetricState {
  let state = metrics.get(name);
  if (!state) {
    state = { unit, window: [], last: 0, min: 0, max: 0, total: 0, count: 0, recent: [] };
    metrics.set(name, state);
  }
  return state;
}

/** Records a measurement for a named metric. */
export function recordMetric(
  name: string,
  value: number,
  unit: MetricUnit = "ms",
  detail?: Record<string, number | string | boolean | undefined>,
): void {
  if (!Number.isFinite(value)) return;
  const state = stateFor(name, unit);
  state.last = value;
  state.count += 1;
  state.total += value;
  if (state.count === 1) {
    state.min = value;
    state.max = value;
  } else {
    state.min = Math.min(state.min, value);
    state.max = Math.max(state.max, value);
  }
  state.window.push(value);
  if (state.window.length > WINDOW_SIZE) state.window.shift();
  state.recent.push({ at: Date.now(), value, detail });
  if (state.recent.length > RECENT_SIZE) state.recent.shift();
}

/** Times a synchronous operation and records it. */
export function timeMetric<T>(
  name: string,
  operation: () => T,
  unit: MetricUnit = "ms",
  detail?: Record<string, number | string | boolean | undefined>,
): T {
  const started = performance.now();
  try {
    return operation();
  } finally {
    recordMetric(name, performance.now() - started, unit, detail);
  }
}

/** Times an asynchronous operation and records it once it settles. */
export async function timeMetricAsync<T>(
  name: string,
  operation: () => Promise<T>,
  unit: MetricUnit = "ms",
  detail?: Record<string, number | string | boolean | undefined>,
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    recordMetric(name, performance.now() - started, unit, detail);
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/** Summarizes every recorded metric. */
export function summarizeMetrics(): MetricSummary[] {
  const summaries: MetricSummary[] = [];
  for (const [name, state] of metrics) {
    const sorted = [...state.window].sort((a, b) => a - b);
    summaries.push({
      name,
      unit: state.unit,
      count: state.count,
      last: state.last,
      min: state.min,
      max: state.max,
      mean: state.count ? state.total / state.count : 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      samples: state.window.length,
    });
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns the most recent samples of a single metric. */
export function recentSamples(name: string): MetricSample[] {
  return [...(metrics.get(name)?.recent ?? [])];
}

/** Clears every recorded metric. */
export function resetMetrics(): void {
  metrics.clear();
}

export interface MemoryReading {
  /** JavaScript heap in use, when the webview exposes it. */
  jsHeapUsedBytes?: number;
  jsHeapTotalBytes?: number;
  jsHeapLimitBytes?: number;
  /** Resident memory of the LibreCut process. */
  appWorkingSetBytes?: number;
  appPeakWorkingSetBytes?: number;
  /** Resident memory of the FFmpeg children LibreCut spawned. */
  ffmpegWorkingSetBytes?: number;
  ffmpegPeakWorkingSetBytes?: number;
  ffmpegProcessCount?: number;
}

interface ChromiumMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** Reads the JavaScript heap size, when the webview exposes it. */
export function readJsHeap(): { used: number; total: number; limit: number } | null {
  const memory = (performance as Performance & { memory?: ChromiumMemory }).memory;
  if (!memory) return null;
  return { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit };
}

/** Records the current memory footprint under the `memory` metric. */
export function recordMemory(reading: MemoryReading): void {
  const used = reading.jsHeapUsedBytes ?? reading.appWorkingSetBytes;
  if (typeof used === "number") {
    recordMetric("memory.working-set", used, "bytes", {
      jsHeapUsedBytes: reading.jsHeapUsedBytes,
      appWorkingSetBytes: reading.appWorkingSetBytes,
      ffmpegWorkingSetBytes: reading.ffmpegWorkingSetBytes,
    });
  }
  if (typeof reading.appWorkingSetBytes === "number") {
    recordMetric("memory.app-working-set", reading.appWorkingSetBytes, "bytes");
  }
  if (typeof reading.ffmpegWorkingSetBytes === "number") {
    recordMetric("memory.ffmpeg-working-set", reading.ffmpegWorkingSetBytes, "bytes", {
      processes: reading.ffmpegProcessCount,
    });
  }
}
