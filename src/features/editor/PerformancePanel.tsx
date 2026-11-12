import { useEffect, useState } from "react";
import { Activity, Download, RefreshCw, X } from "lucide-react";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { useT } from "../../lib/i18n";
import {
  readJsHeap,
  recordMemory,
  resetMetrics,
  summarizeMetrics,
  type MemoryReading,
  type MetricSummary,
} from "../../lib/metrics";
import { getMemorySnapshot, writeDiagnosticsReport } from "../../lib/media";
import { isTauri } from "../../lib/media";

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 10) return `${value.toFixed(0)} ms`;
  return `${value.toFixed(1)} ms`;
}

function formatMetricValue(summary: MetricSummary): string {
  if (summary.unit === "bytes") return formatBytes(summary.last);
  if (summary.unit === "count") return summary.last.toFixed(0);
  if (summary.unit === "fps") return `${summary.last.toFixed(1)} fps`;
  return formatMs(summary.last);
}

/**
 * Live performance readout for profiling a representative project.
 *
 * The targets this compares against live in `docs/performance.md`. The report
 * can be written to the app data folder so a profiling run can be shared
 * with the machine and runtime details it was captured on.
 */
export function PerformancePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [summaries, setSummaries] = useState<MetricSummary[]>([]);
  const [memory, setMemory] = useState<MemoryReading>({});
  const [environment, setEnvironment] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const sample = async () => {
      const heap = readJsHeap();
      let native: MemoryReading = {};
      if (isTauri) {
        try {
          const snapshot = await getMemorySnapshot();
          native = {
            appWorkingSetBytes: snapshot.appWorkingSetBytes,
            appPeakWorkingSetBytes: snapshot.appPeakWorkingSetBytes,
            ffmpegWorkingSetBytes: snapshot.ffmpegWorkingSetBytes,
            ffmpegPeakWorkingSetBytes: snapshot.ffmpegPeakWorkingSetBytes,
            ffmpegProcessCount: snapshot.ffmpegProcessCount,
          };
        } catch {
          native = {};
        }
      }
      if (cancelled) return;
      const reading: MemoryReading = {
        jsHeapUsedBytes: heap?.used,
        jsHeapTotalBytes: heap?.total,
        jsHeapLimitBytes: heap?.limit,
        ...native,
      };
      recordMemory(reading);
      setMemory(reading);
      setSummaries(summarizeMetrics());
    };

    setEnvironment(
      [
        navigator.userAgent.includes("Windows") ? "Windows" : navigator.platform,
        `${navigator.hardwareConcurrency ?? "?"} cores`,
        isTauri ? "Tauri" : "browser",
      ].join(" · "),
    );
    void sample();
    const timer = window.setInterval(() => void sample(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open]);

  const exportReport = async () => {
    const heap = readJsHeap();
    const report = {
      capturedAt: new Date().toISOString(),
      environment,
      userAgent: navigator.userAgent,
      memory: {
        jsHeapUsedBytes: heap?.used,
        jsHeapTotalBytes: heap?.total,
        jsHeapLimitBytes: heap?.limit,
        appWorkingSetBytes: memory.appWorkingSetBytes,
        appPeakWorkingSetBytes: memory.appPeakWorkingSetBytes,
        ffmpegWorkingSetBytes: memory.ffmpegWorkingSetBytes,
        ffmpegPeakWorkingSetBytes: memory.ffmpegPeakWorkingSetBytes,
        ffmpegProcessCount: memory.ffmpegProcessCount,
      },
      metrics: summarizeMetrics(),
    };
    const name = `librecut-profile-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      const path = isTauri
        ? await writeDiagnosticsReport(name, JSON.stringify(report, null, 2))
        : await downloadReport(name, report);
      toast(t("Profile saved to {path}", { path }), "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Could not save the profile."), "error");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Performance")}
      description={t("Live timings and memory for this session. Compare them against the targets in docs/performance.md.")}
      width={720}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => { resetMetrics(); setSummaries([]); }}>
            <RefreshCw size={13} aria-hidden="true" /> {t("Reset")}
          </button>
          <button className="btn btn-secondary" onClick={() => void exportReport()}>
            <Download size={13} aria-hidden="true" /> {t("Save profile")}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t("Close")}>
            <X size={14} aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [t("JS heap"), formatBytes(memory.jsHeapUsedBytes)],
            [t("App memory"), formatBytes(memory.appWorkingSetBytes)],
            [t("App peak"), formatBytes(memory.appPeakWorkingSetBytes)],
            ["FFmpeg", formatBytes(memory.ffmpegWorkingSetBytes)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line-soft bg-surface-2/50 px-3 py-2.5">
              <div className="text-[9.5px] uppercase tracking-wide text-dim">{label}</div>
              <div className="mt-1 font-mono text-[12px] text-ink">{value}</div>
            </div>
          ))}
        </div>

        {summaries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-8 text-center">
            <Activity size={20} className="text-dim/60" aria-hidden="true" />
            <p className="text-[12px] font-medium text-muted">{t("No timings recorded yet")}</p>
            <p className="max-w-[320px] text-[11px] leading-relaxed text-dim">
              {t("Move a clip on the timeline, scrub the preview, or edit the project to collect interaction and seek measurements.")}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-soft text-[9.5px] uppercase tracking-wide text-dim">
                <th className="pb-2 font-medium">{t("Measurement")}</th>
                <th className="pb-2 text-right font-medium">{t("Last")}</th>
                <th className="pb-2 text-right font-medium">{t("Median")}</th>
                <th className="pb-2 text-right font-medium">p95</th>
                <th className="pb-2 text-right font-medium">{t("Max")}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px]">
              {summaries.map((summary) => (
                <tr key={summary.name} className="border-b border-line-soft/60 last:border-0">
                  <td className="py-1.5 pr-2 font-sans text-[11.5px] text-ink/90">{summary.name}</td>
                  <td className="py-1.5 text-right text-ink/90">{formatMetricValue(summary)}</td>
                  <td className="py-1.5 text-right text-muted">
                    {summary.unit === "bytes" ? formatBytes(summary.p50) : formatMs(summary.p50)}
                  </td>
                  <td className="py-1.5 text-right text-muted">
                    {summary.unit === "bytes" ? formatBytes(summary.p95) : formatMs(summary.p95)}
                  </td>
                  <td className="py-1.5 text-right text-muted">
                    {summary.unit === "bytes" ? formatBytes(summary.max) : formatMs(summary.max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-[10px] leading-relaxed text-dim">
          {t("{environment} · samples are kept in memory only, and the profile is written to this app's data folder.", { environment })}
        </p>
      </div>
    </Modal>
  );
}

async function downloadReport(name: string, report: unknown): Promise<string> {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return `${name}.json`;
}
