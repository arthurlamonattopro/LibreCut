/** Development-only timing helpers for profiling representative projects. */
export function logSlowOperation(
  operation: string,
  startedAt: number,
  details: Record<string, number | string | boolean | undefined> = {},
  thresholdMs = 100,
): void {
  if (!import.meta.env.DEV) return;
  const elapsedMs = performance.now() - startedAt;
  if (elapsedMs < thresholdMs) return;
  console.warn(`LibreCut slow ${operation}`, {
    elapsedMs: Math.round(elapsedMs),
    ...details,
  });
}

export function projectProfile(project: {
  assets: Array<{ thumbnails: string[]; waveform: number[] }>;
  tracks: Array<{ clips: unknown[] }>;
}) {
  return {
    assets: project.assets.length,
    clips: project.tracks.reduce((count, track) => count + track.clips.length, 0),
    cachedThumbnails: project.assets.reduce((count, asset) => count + asset.thumbnails.length, 0),
    waveformSamples: project.assets.reduce((count, asset) => count + asset.waveform.length, 0),
  };
}

/** Install once at startup; supported browsers report main-thread stalls >= 50 ms. */
export function observeLongTasks(): void {
  if (!import.meta.env.DEV || typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.warn("LibreCut slow main-thread task", {
          elapsedMs: Math.round(entry.duration),
          startTimeMs: Math.round(entry.startTime),
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // PerformanceObserver entry types vary by webview; other diagnostics remain available.
  }
}
