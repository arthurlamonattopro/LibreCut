import { beforeEach, describe, expect, it } from "vitest";
import {
  recordMetric,
  recordMemory,
  recentSamples,
  resetMetrics,
  summarizeMetrics,
  timeMetric,
  timeMetricAsync,
} from "../src/lib/metrics";

describe("metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("summarizes a recorded metric", () => {
    recordMetric("save", 10);
    recordMetric("save", 20);
    recordMetric("save", 30);

    const [summary] = summarizeMetrics();
    expect(summary.name).toBe("save");
    expect(summary.count).toBe(3);
    expect(summary.last).toBe(30);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(30);
    expect(summary.mean).toBe(20);
    expect(summary.p50).toBe(20);
    expect(summary.p95).toBe(30);
  });

  it("ignores values that are not finite", () => {
    recordMetric("save", Number.NaN);
    recordMetric("save", Number.POSITIVE_INFINITY);
    expect(summarizeMetrics()).toHaveLength(0);
  });

  it("times a synchronous operation", () => {
    const result = timeMetric("sync", () => 42);
    expect(result).toBe(42);
    expect(summarizeMetrics()[0].name).toBe("sync");
    expect(summarizeMetrics()[0].count).toBe(1);
  });

  it("times an asynchronous operation", async () => {
    const result = await timeMetricAsync("async", async () => "done");
    expect(result).toBe("done");
    expect(summarizeMetrics()[0].name).toBe("async");
  });

  it("records a failed operation as well", async () => {
    await expect(
      timeMetricAsync("async", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(summarizeMetrics()[0].count).toBe(1);
  });

  it("keeps the most recent samples for a metric", () => {
    recordMetric("save", 1, "ms", { clips: 10 });
    recordMetric("save", 2, "ms", { clips: 20 });
    const samples = recentSamples("save");
    expect(samples).toHaveLength(2);
    expect(samples[1].detail?.clips).toBe(20);
  });

  it("records the working set as a byte metric", () => {
    recordMemory({ appWorkingSetBytes: 1024, ffmpegWorkingSetBytes: 512 });
    const names = summarizeMetrics().map((summary) => summary.name);
    expect(names).toContain("memory.working-set");
    expect(names).toContain("memory.app-working-set");
    expect(names).toContain("memory.ffmpeg-working-set");
  });

  it("sorts summaries by name", () => {
    recordMetric("zebra", 1);
    recordMetric("alpha", 1);
    expect(summarizeMetrics().map((summary) => summary.name)).toEqual(["alpha", "zebra"]);
  });
});
