import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  CircleAlert,
  Film,
  FolderOpen,
  HardDrive,
  Loader2,
  MonitorPlay,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Upload,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { announce } from "../../lib/announce";
import { useEditor } from "../../stores/editor";
import {
  cancelExport,
  detectHardwareEncoder,
  exportProject,
  getRuntimeStatus,
  pickExportPath,
  revealFile,
} from "../../lib/media";
import { cachedProjectDuration, formatClock, formatDuration } from "../../lib/time";
import { useT } from "../../lib/i18n";
import { buildExportRequest } from "../../lib/exportRequest";
import type {
  ExportProgress,
  ExportResult,
  Project,
  RuntimeStatus,
} from "../../lib/types";

type Preset = "source" | "youtube" | "tiktok" | "square" | "4k";
type Quality = "draft" | "balanced" | "high";
type SavedPreset = { name: string; preset: Preset; fps: number; quality: Quality; encoder: "libx264" | "nvenc" };
const SAVED_PRESETS_KEY = "librecut:export-presets";
function loadSavedPresets(): SavedPreset[] {
  try { return JSON.parse(localStorage.getItem(SAVED_PRESETS_KEY) ?? "[]") as SavedPreset[]; } catch { return []; }
}
function estimateSizeMb(duration: number, width: number, height: number, quality: Quality): number {
  const megapixels = width * height / 1_000_000;
  const videoMbps = Math.max(1.5, megapixels * ({ draft: 3, balanced: 5, high: 8 }[quality]));
  return (videoMbps + 0.192) * duration / 8;
}

const PRESETS: Array<{
  id: Preset;
  title: string;
  hint: string;
  icon: typeof MonitorPlay;
  width: (project: Project) => number;
  height: (project: Project) => number;
}> = [
  {
    id: "source",
    title: "Match project",
    hint: "Native canvas",
    icon: MonitorPlay,
    width: (project) => project.width,
    height: (project) => project.height,
  },
  {
    id: "youtube",
    title: "YouTube",
    hint: "1920×1080",
    icon: RectangleHorizontal,
    width: () => 1920,
    height: () => 1080,
  },
  {
    id: "tiktok",
    title: "TikTok / Reels",
    hint: "1080×1920",
    icon: RectangleVertical,
    width: () => 1080,
    height: () => 1920,
  },
  {
    id: "square",
    title: "Square",
    hint: "1080×1080",
    icon: Square,
    width: () => 1080,
    height: () => 1080,
  },
  {
    id: "4k",
    title: "4K UHD",
    hint: "3840×2160",
    icon: Film,
    width: () => 3840,
    height: () => 2160,
  },
];

function defaultPreset(project: Project): Preset {
  if (project.height > project.width) return "tiktok";
  if (project.height === project.width) return "square";
  return "source";
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const project = useEditor((state) => state.project);
  const setPlaying = useEditor((state) => state.setPlaying);
  const [preset, setPreset] = useState<Preset>("source");
  const [encoder, setEncoder] = useState<"libx264" | "nvenc">("libx264");
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>(loadSavedPresets);
  const [presetName, setPresetName] = useState("");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [hasNvenc, setHasNvenc] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    setPreset(defaultPreset(project));
    setFps(project.fps);
    setResult(null);
    setExporting(false);
    setCancelling(false);
    setOutputPath("");
    setRuntime(null);
    void detectHardwareEncoder().then((available) => {
      setHasNvenc(available);
      setEncoder(available ? "nvenc" : "libx264");
    });
    void getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null));
  }, [open, project]);

  useEffect(() => {
    if (!exporting) return;
    let dispose: (() => void) | undefined;
    // The render reports progress many times a second, so the screen reader
    // is told about it in quarters rather than on every frame.
    let announcedStep = -1;
    void listen<ExportProgress>("export-progress", (event) => {
      setProgress(event.payload);
      const step = Math.floor(event.payload.percent / 25);
      if (step > announcedStep) {
        announcedStep = step;
        announce(`Export ${Math.round(event.payload.percent)} percent.`);
      }
    })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => undefined);
    return () => dispose?.();
  }, [exporting]);

  const dimensions = useMemo(() => {
    if (!project) return { width: 1920, height: 1080 };
    const selected = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
    return { width: selected.width(project), height: selected.height(project) };
  }, [preset, project]);

  if (!project) return null;

  const clipCount = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  const duration = cachedProjectDuration(project.tracks, 0);
  const canExport = clipCount > 0 && !exporting && runtime?.ready !== false;

  const chooseOutput = async () => {
    const path = await pickExportPath(project.name);
    if (path) setOutputPath(path);
    return path;
  };

  const start = async () => {
    setError("");
    setResult(null);
    setProgress({ percent: 0, time: 0, speed: "", fps: 0 });
    let target = outputPath;
    if (!target) {
      target = (await chooseOutput()) ?? "";
      if (!target) return;
    }
    setPlaying(false);
    setExporting(true);
    setCancelling(false);
    announce(t("Export started."));
    try {
      const request = buildExportRequest(project, target, dimensions.width, dimensions.height, encoder);
      request.fps = fps;
      request.quality = quality;
      const exported = await exportProject(request);
      setResult(exported);
      setProgress((current) => ({ ...(current ?? { time: duration, speed: "", fps: 0 }), percent: 100, time: duration }));
      toast(t("Export complete."), "success");
      announce(t("Export complete."), { assertive: true });
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : String(exportError);
      if (message.toLowerCase().includes("cancel")) {
        setError(t("Export cancelled."));
        announce(t("Export cancelled."));
      } else {
        setError(message);
        toast(t("Export failed. Check the details in the export dialog."), "error");
        announce(t("Export failed. {message}", { message }), { assertive: true });
      }
    } finally {
      setExporting(false);
      setCancelling(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    await cancelExport();
  };

  const close = () => {
    if (exporting) return;
    onClose();
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const next = [...savedPresets.filter((item) => item.name !== name), { name, preset, fps, quality, encoder }];
    setSavedPresets(next);
    localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next));
    setPresetName("");
  };
  const loadPreset = (saved: SavedPreset) => {
    setPreset(saved.preset); setFps(saved.fps); setQuality(saved.quality); setEncoder(saved.encoder);
  };

  const footer = result ? (
    <>
      <button className="btn btn-ghost" onClick={close}>{t("Done")}</button>
      <button className="btn btn-secondary" onClick={() => void revealFile(result.output)}>
        <FolderOpen size={14} /> {t("Show in folder")}
      </button>
    </>
  ) : exporting ? (
    <>
      <span className="mr-auto text-[11px] text-dim">{t("Rendering locally with FFmpeg")}</span>
      <button className="btn btn-secondary" onClick={() => void cancel()} disabled={cancelling}>
        {cancelling ? <Loader2 size={14} className="animate-spin" /> : null}
        {cancelling ? t("Cancelling…") : t("Cancel export")}
      </button>
    </>
  ) : (
    <>
      <button className="btn btn-ghost" onClick={close}>{t("Cancel")}</button>
      <button className="btn btn-primary" onClick={() => void start()} disabled={!canExport}>
        <Upload size={15} /> {t("Export video")}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? t("Export complete") : t("Export video")}
      description={
        result
          ? t("Your video was rendered on this PC. No upload, no watermark.")
          : t("Choose a size and render a clean H.264 MP4. Audio is mixed to AAC.")
      }
      width={610}
      footer={footer}
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-mint/20 bg-mint/5 p-3.5">
            <CheckCircle2 size={20} className="text-mint" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">{t("Video exported")}</div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-dim" title={result.output}>{result.output}</div>
            </div>
            <span className="chip">{formatDuration(result.elapsedMs / 1000)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              [t("Canvas"), `${dimensions.width}×${dimensions.height}`],
              [t("Duration"), formatClock(duration, fps)],
              [t("Encoder"), encoder === "nvenc" ? "NVENC" : "x264 CPU"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line-soft bg-surface-2/50 px-3 py-2.5">
                <div className="text-[9.5px] uppercase tracking-wide text-dim">{label}</div>
                <div className="mt-1 font-mono text-[11px]">{value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {savedPresets.length ? <div className="flex flex-wrap items-center gap-1.5" aria-label={t("Saved export presets")}>
            {savedPresets.map((saved) => <button key={saved.name} className="chip" onClick={() => loadPreset(saved)} disabled={exporting}>{saved.name}</button>)}
          </div> : null}
          <div>
            <span className="label" id="export-size-label">{t("Size")}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-labelledby="export-size-label">
              {PRESETS.map((item) => {
                const Icon = item.icon;
                const active = preset === item.id;
                const width = item.width(project);
                const height = item.height(project);
                return (
                  <button
                    key={item.id}
                    aria-pressed={active}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      active
                        ? "border-accent/55 bg-accent-soft"
                        : "border-line bg-surface-2/50 hover:border-line hover:bg-panel-2"
                    }`}
                    onClick={() => setPreset(item.id)}
                    disabled={exporting}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-accent/15 text-accent" : "bg-white/5 text-dim"}`} aria-hidden="true">
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium">{t(item.title)}</span>
                      <span className="block font-mono text-[9px] text-dim">{width}×{height}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-dim">{t("Aspect ratio is applied by fitting your canvas into the chosen size.")}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div><label className="label" htmlFor="export-fps">{t("Frame rate")}</label><select id="export-fps" className="field" value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={exporting}>
              {[...new Set([project.fps, 24, 25, 30, 50, 60])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{t("{value} fps", { value })}{value === project.fps ? ` · ${t("project")}` : ""}</option>)}
            </select></div>
            <div><label className="label" htmlFor="export-quality">{t("Quality")}</label><select id="export-quality" className="field" value={quality} onChange={(event) => setQuality(event.target.value as Quality)} disabled={exporting}>
              <option value="draft">{t("Draft · smaller")}</option><option value="balanced">{t("Balanced")}</option><option value="high">{t("High · larger")}</option>
            </select></div>
            <div className="rounded-lg border border-line-soft bg-surface-2/50 px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wide text-dim">{t("Estimated size")}</div>
              <div className="mt-1 font-mono text-[11px]">{t("~{size} MB", { size: estimateSizeMb(duration, dimensions.width, dimensions.height, quality).toFixed(0) })}</div>
            </div>
          </div>
          <p className="-mt-3 text-[9.5px] text-dim">{t("Estimate uses frame size and quality. Motion, detail, and audio can change the final size.")}</p>

          <div className="flex items-center gap-2">
            <input className="field min-w-0 flex-1" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder={t("Name these settings")} disabled={exporting} aria-label={t("Export preset name")} />
            <button className="btn btn-secondary shrink-0" onClick={savePreset} disabled={!presetName.trim() || exporting}>{t("Save preset")}</button>
            {savedPresets.length ? <button className="btn btn-ghost shrink-0" onClick={() => setSavedPresets((items) => { const next = items.filter((item) => item.name !== presetName); localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next)); return next; })} disabled={exporting || !presetName.trim()}>{t("Remove")}</button> : null}
          </div>
          <p className="-mt-3 text-[9.5px] text-dim">{t("Saved on this PC: resolution, frame rate, quality, and encoder.")}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="export-encoder">{t("Encoder")}</label>
              <select
                id="export-encoder"
                className="field"
                value={encoder}
                onChange={(event) => setEncoder(event.target.value as "libx264" | "nvenc")}
                disabled={exporting}
              >
                {hasNvenc ? <option value="nvenc">{t("NVENC · GPU (fast)")}</option> : null}
                <option value="libx264">{t("x264 · CPU (compatible)")}</option>
              </select>
              <p className="mt-1 text-[9.5px] text-dim">
                {hasNvenc ? t("FFmpeg reports NVENC. It needs a compatible NVIDIA GPU and driver; x264 remains the fallback.") : t("NVENC was not reported by this FFmpeg build or PC. x264 uses the CPU and is the compatible fallback.")}
              </p>
            </div>
            <div className="rounded-xl border border-line-soft bg-surface-2/50 px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wide text-dim">{t("Summary")}</div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted">{t("Clips")}</span>
                <span className="font-mono">{clipCount}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-muted">{t("Duration")}</span>
                <span className="font-mono">{formatDuration(duration)}</span>
              </div>
            </div>
          </div>

          <div>
            <span className="label" id="export-output-label">{t("Output file")}</span>
            <div className="flex gap-2">
              <div className="field flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[11px] text-muted" role="status" aria-labelledby="export-output-label">
                <HardDrive size={13} className="shrink-0 text-dim" aria-hidden="true" />
                <span className={`truncate ${outputPath ? "font-mono text-[10.5px]" : "text-dim"}`} title={outputPath}>
                  {outputPath || t("Choose a destination when you export")}
                </span>
              </div>
              <button className="btn btn-secondary shrink-0" onClick={() => void chooseOutput()} disabled={exporting}>
                <FolderOpen size={14} aria-hidden="true" /> {t("Choose")}
              </button>
            </div>
          </div>

          {progress ? (
            <div className="rounded-xl border border-line bg-surface-2/60 p-3.5">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-muted">
                  {exporting ? <Loader2 size={12} className="animate-spin text-accent" aria-hidden="true" /> : <CheckCircle2 size={12} className={result ? "text-mint" : "text-dim"} aria-hidden="true" />}
                  {exporting ? t("Rendering…") : result ? t("Render finished") : error.toLowerCase().includes("cancel") ? t("Render cancelled") : error ? t("Render stopped") : t("Last render progress")}
                </span>
                <span className="font-mono text-[10.5px] text-accent">{progress.percent.toFixed(1)}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={t("Export progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Number(progress.percent.toFixed(1))}
                aria-valuetext={t("{percent} percent, {time} of {duration}", {
                  percent: progress.percent.toFixed(0),
                  time: formatClock(progress.time, project.fps),
                  duration: formatClock(duration, project.fps),
                })}
                className="h-1.5 overflow-hidden rounded-full bg-white/8"
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[9.5px] text-dim">
                <span>{formatClock(progress.time, project.fps)} / {formatClock(duration, project.fps)}</span>
                <span>{progress.speed || "—"} · {progress.fps ? `${progress.fps.toFixed(0)} fps` : ""}</span>
              </div>
            </div>
          ) : null}

          {runtime && !runtime.ready ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent-soft/40 p-3 text-[11px] leading-relaxed text-accent">
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t("FFmpeg was not found, so export is unavailable. Reinstall LibreCut or set LIBRECUT_FFMPEG and LIBRECUT_FFPROBE, then reopen this dialog.")}
              </span>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent-soft/40 p-3 text-[11px] leading-relaxed text-accent">
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          ) : null}

          <div className="rounded-lg border border-line-soft bg-surface-2/40 p-3">
            <button className="flex w-full items-center justify-between text-left text-[11px] font-medium" onClick={() => setDiagnosticsOpen((value) => !value)} aria-expanded={diagnosticsOpen} aria-controls="export-diagnostics">
              <span>{t("Render diagnostics")}</span><span className="text-dim">{diagnosticsOpen ? t("Hide") : t("View")}</span>
            </button>
            {diagnosticsOpen ? <div id="export-diagnostics" className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-dim">
              <p>{t("{sources} sources report a frame rate different from the project; {vfr} are flagged as possibly variable frame rate. Export resamples them to {fps} fps; small seek or sync differences may remain.", {
                sources: project.assets.filter((asset) => asset.info.fps > 0 && Math.abs(asset.info.fps - project.fps) > 0.05).length,
                vfr: project.assets.filter((asset) => asset.info.isVfr).length,
                fps,
              })}</p>
              <p>{t("Project features queued for this render: {keyframes} clips with keyframes, {transitions} clips with transitions, and {effects} color-effect clips.", {
                keyframes: project.tracks.reduce((sum, track) => sum + track.clips.filter((clip) => clip.keyframes.length > 0).length, 0),
                transitions: project.tracks.reduce((sum, track) => sum + track.clips.filter((clip) => clip.transitionIn.type !== "none" || clip.transitionOut.type !== "none").length, 0),
                effects: project.tracks.reduce((sum, track) => sum + track.clips.filter((clip) => clip.effect).length, 0),
              })}</p>
              <p>{t("Preview uses browser video decoding while export uses FFmpeg, so scaling, color processing, and font rasterization may differ slightly.")}</p>
              {project.assets.filter((asset) => asset.info.videoCodec && !["h264", "vp8", "vp9", "av1", "hevc", "mpeg4"].includes(asset.info.videoCodec.toLowerCase())).map((asset) => <p key={asset.id}>{t("{name}: {codec} may depend on the installed FFmpeg build.", { name: asset.name, codec: asset.info.videoCodec ?? "" })}</p>)}
            </div> : null}
          </div>

          {clipCount === 0 ? (
            <div className="rounded-xl border border-line-soft bg-surface-2/50 p-3 text-[11px] text-dim">
              {t("Add at least one clip to the timeline before exporting.")}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
