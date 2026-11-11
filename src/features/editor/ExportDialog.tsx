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
import { useEditor } from "../../stores/editor";
import {
  cancelExport,
  detectHardwareEncoder,
  exportProject,
  pickExportPath,
  revealFile,
} from "../../lib/media";
import { formatClock, formatDuration, projectDuration } from "../../lib/time";
import type {
  ExportClipRequest,
  ExportEffectRequest,
  ExportProgress,
  ExportRequest,
  ExportResult,
  Project,
} from "../../lib/types";

type Preset = "source" | "youtube" | "tiktok" | "square" | "4k";

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

function buildRequest(
  project: Project,
  output: string,
  width: number,
  height: number,
  encoder: "libx264" | "nvenc",
): ExportRequest {
  const clips: ExportClipRequest[] = [];
  for (const track of project.tracks) {
    if (track.hidden || track.kind === "text") continue;
    for (const clip of track.clips) {
      const asset = clip.assetId ? project.assets.find((item) => item.id === clip.assetId) : undefined;
      if (!asset) continue;

      if (track.kind === "video" && (asset.info.hasVideo || asset.info.isImage)) {
        clips.push({
          path: asset.path,
          start: clip.start,
          duration: clip.duration,
          trimIn: clip.trimIn,
          speed: clip.speed,
          volume: clip.volume,
          opacity: clip.opacity,
          hasAudio: asset.info.hasAudio && !track.muted,
          hasVideo: true,
          isImage: asset.info.isImage,
          fit: clip.fit,
          x: clip.x,
          y: clip.y,
          scale: clip.scale,
          rotation: clip.rotation,
          mask: clip.mask,
          chromaKey: clip.chromaKey,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          pitch: clip.pitch,
          bass: clip.bass,
          treble: clip.treble,
          keyframes: clip.keyframes,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut,
        });
      } else if (track.kind === "audio" && asset.info.hasAudio) {
        clips.push({
          path: asset.path,
          start: clip.start,
          duration: clip.duration,
          trimIn: clip.trimIn,
          speed: clip.speed,
          volume: clip.volume,
          opacity: 1,
          hasAudio: true,
          hasVideo: false,
          isImage: false,
          fit: "contain",
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          mask: "none",
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          pitch: clip.pitch,
          bass: clip.bass,
          treble: clip.treble,
          keyframes: clip.keyframes,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut,
        });
      }
    }
  }

  const scale = height / project.height;
  const effects: ExportEffectRequest[] = project.tracks
    .filter((track) => track.kind === "misc" && !track.hidden)
    .flatMap((track) => track.clips.filter((clip) => clip.effect).map((clip) => ({
      ...clip.effect!, start: clip.start, duration: clip.duration, opacity: clip.opacity,
    })));
  const texts = project.tracks
    .filter((track) => track.kind === "text" && !track.hidden)
    .flatMap((track) =>
      track.clips
        .filter((clip) => clip.text)
        .map((clip) => ({
          text: clip.text!.text,
          start: clip.start,
          duration: clip.duration,
          x: clip.text!.x,
          y: clip.text!.y,
          size: clip.text!.size * scale,
          rotation: clip.text!.rotation,
          keyframes: clip.keyframes,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut,
          color: clip.text!.color,
          fontWeight: clip.text!.fontWeight,
          align: clip.text!.align,
          underline: clip.text!.underline,
          characterSpacing: clip.text!.characterSpacing * scale,
          outlineColor: clip.text!.outlineColor,
          outlineWidth: clip.text!.outlineWidth * scale,
          brightness: clip.text!.brightness,
          shadow: clip.text!.shadow,
          curve: clip.text!.curve,
          opacity: clip.opacity,
        })),
    );

  return {
    output,
    width,
    height,
    fps: project.fps,
    duration: projectDuration(project.tracks, 0),
    clips,
    texts,
    effects,
    encoder,
  };
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((state) => state.project);
  const setPlaying = useEditor((state) => state.setPlaying);
  const [preset, setPreset] = useState<Preset>("source");
  const [encoder, setEncoder] = useState<"libx264" | "nvenc">("libx264");
  const [hasNvenc, setHasNvenc] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !project) return;
    setPreset(defaultPreset(project));
    setProgress(null);
    setResult(null);
    setError("");
    setExporting(false);
    setCancelling(false);
    setOutputPath("");
    void detectHardwareEncoder().then((available) => {
      setHasNvenc(available);
      setEncoder(available ? "nvenc" : "libx264");
    });
  }, [open, project]);

  useEffect(() => {
    if (!exporting) return;
    let dispose: (() => void) | undefined;
    void listen<ExportProgress>("export-progress", (event) => setProgress(event.payload))
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
  const duration = projectDuration(project.tracks, 0);
  const canExport = clipCount > 0 && !exporting;

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
    try {
      const request = buildRequest(project, target, dimensions.width, dimensions.height, encoder);
      const exported = await exportProject(request);
      setResult(exported);
      setProgress((current) => ({ ...(current ?? { time: duration, speed: "", fps: 0 }), percent: 100, time: duration }));
      toast("Export complete.", "success");
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : String(exportError);
      if (message.toLowerCase().includes("cancel")) {
        setError("Export cancelled.");
      } else {
        setError(message);
        toast("Export failed. Check the details in the export dialog.", "error");
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

  const footer = result ? (
    <>
      <button className="btn btn-ghost" onClick={close}>Done</button>
      <button className="btn btn-secondary" onClick={() => void revealFile(result.output)}>
        <FolderOpen size={14} /> Show in folder
      </button>
    </>
  ) : exporting ? (
    <>
      <span className="mr-auto text-[11px] text-dim">Rendering locally with FFmpeg</span>
      <button className="btn btn-secondary" onClick={() => void cancel()} disabled={cancelling}>
        {cancelling ? <Loader2 size={14} className="animate-spin" /> : null}
        {cancelling ? "Cancelling…" : "Cancel export"}
      </button>
    </>
  ) : (
    <>
      <button className="btn btn-ghost" onClick={close}>Cancel</button>
      <button className="btn btn-primary" onClick={() => void start()} disabled={!canExport}>
        <Upload size={15} /> Export video
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? "Export complete" : "Export video"}
      description={
        result
          ? "Your video was rendered on this PC. No upload, no watermark."
          : "Choose a size and render a clean H.264 MP4. Audio is mixed to AAC."
      }
      width={610}
      footer={footer}
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-mint/20 bg-mint/5 p-3.5">
            <CheckCircle2 size={20} className="text-mint" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">Video exported</div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-dim" title={result.output}>{result.output}</div>
            </div>
            <span className="chip">{formatDuration(result.elapsedMs / 1000)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Canvas", `${dimensions.width}×${dimensions.height}`],
              ["Duration", formatClock(duration, project.fps)],
              ["Encoder", encoder === "nvenc" ? "NVENC" : "x264 CPU"],
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
          <div>
            <span className="label">Size</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((item) => {
                const Icon = item.icon;
                const active = preset === item.id;
                const width = item.width(project);
                const height = item.height(project);
                return (
                  <button
                    key={item.id}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      active
                        ? "border-accent/55 bg-accent-soft"
                        : "border-line bg-surface-2/50 hover:border-line hover:bg-panel-2"
                    }`}
                    onClick={() => setPreset(item.id)}
                    disabled={exporting}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-accent/15 text-accent" : "bg-white/5 text-dim"}`}>
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium">{item.title}</span>
                      <span className="block font-mono text-[9px] text-dim">{width}×{height}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-dim">Aspect ratio is applied by fitting your canvas into the chosen size.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="label">Encoder</span>
              <select
                className="field"
                value={encoder}
                onChange={(event) => setEncoder(event.target.value as "libx264" | "nvenc")}
                disabled={exporting}
              >
                {hasNvenc ? <option value="nvenc">NVENC · GPU (fast)</option> : null}
                <option value="libx264">x264 · CPU (compatible)</option>
              </select>
              <p className="mt-1 text-[9.5px] text-dim">
                {hasNvenc ? "GPU encoding is available on this PC." : "No NVIDIA encoder detected; using CPU."}
              </p>
            </div>
            <div className="rounded-xl border border-line-soft bg-surface-2/50 px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wide text-dim">Summary</div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted">Clips</span>
                <span className="font-mono">{clipCount}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-muted">Duration</span>
                <span className="font-mono">{formatDuration(duration)}</span>
              </div>
            </div>
          </div>

          <div>
            <span className="label">Output file</span>
            <div className="flex gap-2">
              <div className="field flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[11px] text-muted">
                <HardDrive size={13} className="shrink-0 text-dim" />
                <span className={`truncate ${outputPath ? "font-mono text-[10.5px]" : "text-dim"}`} title={outputPath}>
                  {outputPath || "Choose a destination when you export"}
                </span>
              </div>
              <button className="btn btn-secondary shrink-0" onClick={() => void chooseOutput()} disabled={exporting}>
                <FolderOpen size={14} /> Choose
              </button>
            </div>
          </div>

          {exporting && progress ? (
            <div className="rounded-xl border border-line bg-surface-2/60 p-3.5">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-muted">
                  <Loader2 size={12} className="animate-spin text-accent" /> Rendering…
                </span>
                <span className="font-mono text-[10.5px] text-accent">{progress.percent.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[9.5px] text-dim">
                <span>{formatClock(progress.time, project.fps)} / {formatClock(duration, project.fps)}</span>
                <span>{progress.speed || "—"} · {progress.fps ? `${progress.fps.toFixed(0)} fps` : ""}</span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent-soft/40 p-3 text-[11px] leading-relaxed text-accent">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          ) : null}

          {clipCount === 0 ? (
            <div className="rounded-xl border border-line-soft bg-surface-2/50 p-3 text-[11px] text-dim">
              Add at least one clip to the timeline before exporting.
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
