import {
  CheckCircle2,
  CircleAlert,
  Film,
  FolderOpen,
  Loader2,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { Logo } from "../../components/Logo";
import { t, useT } from "../../lib/i18n";
import type { RuntimeStatus } from "../../lib/types";

interface FirstRunProps {
  open: boolean;
  runtime: RuntimeStatus | null;
  checking: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onCreate: () => void;
}

const STEPS = [
  {
    icon: FolderOpen,
    title: "Create a project",
    body: "Pick landscape, vertical, or square. You can change the export size later without rebuilding the edit.",
  },
  {
    icon: Film,
    title: "Bring in footage",
    body: "Import video, audio, and images from the media panel. Drag a clip onto the timeline to start cutting.",
  },
  {
    icon: Scissors,
    title: "Trim, layer, and export",
    body: "Move, trim, split, add text and effects, then render a clean H.264 MP4 locally.",
  },
];

function sourceLabel(source: string): string {
  if (source === "bundled") return t("Bundled");
  if (source === "override") return t("Environment override");
  if (source === "path") return t("System PATH");
  return t("Not found");
}

export function FirstRun({ open, runtime, checking, onRefresh, onClose, onCreate }: FirstRunProps) {
  const translate = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={translate("Welcome to LibreCut")}
      description={translate("A short path from footage to a finished MP4. Everything runs on this PC.")}
      width={620}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{translate("Skip for now")}</button>
          <button className="btn btn-primary" onClick={onCreate}>
            <FolderOpen size={15} aria-hidden="true" /> {translate("Create a project")}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2/60 p-3.5">
          <Logo size={42} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{translate("Free, open-source, local-first")}</div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-dim">
              {translate("No account, watermark, or telemetry. Media never leaves your machine.")}
            </div>
          </div>
          <ShieldCheck size={18} className="ml-auto shrink-0 text-mint" aria-hidden="true" />
        </div>

        <ol className="space-y-2.5">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex gap-3 rounded-xl border border-line-soft bg-surface-2/40 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-accent">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-dim">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[12.5px] font-medium">{translate(step.title)}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{translate(step.body)}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="rounded-xl border border-line-soft bg-surface-2/50 p-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">
              {checking ? (
                <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
              ) : runtime?.ready ? (
                <CheckCircle2 size={16} className="text-mint" aria-hidden="true" />
              ) : (
                <CircleAlert size={16} className="text-accent" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium">{translate("FFmpeg runtime")}</span>
                <span className={`chip ${runtime?.ready ? "text-mint" : runtime ? "text-accent" : ""}`}>
                  {checking ? translate("Checking…") : runtime?.ready ? translate("Ready") : runtime ? translate("Missing") : translate("Unknown")}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                {checking
                  ? translate("Looking for the bundled FFmpeg and ffprobe sidecars.")
                  : runtime?.ready
                    ? `${sourceLabel(runtime.ffmpeg.source)} · ${runtime.ffmpeg.version?.split(" Copyright")[0] ?? "FFmpeg"}`
                    : translate("FFmpeg was not found. Reinstall LibreCut, or set LIBRECUT_FFMPEG and LIBRECUT_FFPROBE to the tools.")}
              </p>
              {runtime?.ready ? (
                <div className="mt-1 truncate font-mono text-[9.5px] text-dim" title={runtime.ffmpeg.path}>
                  {runtime.ffmpeg.path}
                </div>
              ) : null}
            </div>
            <button className="btn btn-ghost btn-sm shrink-0" onClick={onRefresh} disabled={checking}>
              <RefreshCw size={12} aria-hidden="true" /> {translate("Recheck")}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10.5px] text-dim">
          <Upload size={12} className="shrink-0" aria-hidden="true" />
          <span>{translate("Tip: import several files at once, then drag them to the timeline in the order you want.")}</span>
        </div>
      </div>
    </Modal>
  );
}
