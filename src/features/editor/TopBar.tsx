import { Activity, ChevronLeft, Download, Loader2, Sparkles, Upload } from "lucide-react";
import { Logo } from "../../components/Logo";
import { useEditor } from "../../stores/editor";

interface TopBarProps {
  onBack: () => void;
  onExport: () => void;
  onSaveCopy: () => void;
  onAiTools: () => void;
  onShowPerformance: () => void;
  saving: boolean;
}

export function TopBar({ onBack, onExport, onSaveCopy, onAiTools, onShowPerformance, saving }: TopBarProps) {
  const project = useEditor((state) => state.project);
  const renameProject = useEditor((state) => state.renameProject);
  const recordSnapshot = useEditor((state) => state.recordSnapshot);
  const dirty = useEditor((state) => state.dirty);

  if (!project) return null;

  return (
    <header className="flex h-[50px] shrink-0 items-center justify-between gap-4 border-b border-line-soft bg-panel px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-muted transition hover:bg-white/5 hover:text-ink"
          onClick={onBack}
          title="Back to projects"
        >
          <ChevronLeft size={14} />
          <Logo size={20} />
          <span className="hidden xl:inline">Projects</span>
        </button>
        <div className="h-4 w-px bg-line" />
        <input
          className="min-w-0 max-w-[320px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[12.5px] font-semibold tracking-[-0.01em] outline-none transition hover:border-line hover:bg-surface focus:border-accent/50"
          value={project.name}
          onFocus={recordSnapshot}
          onChange={(event) => renameProject(event.target.value)}
          aria-label="Project name"
        />
        <span className="hidden items-center gap-1.5 text-[10.5px] text-dim md:flex">
          {saving ? <Loader2 size={11} className="animate-spin text-accent" /> : null}
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved locally"}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="mr-1 hidden rounded-md border border-line-soft bg-surface px-2 py-1 font-mono text-[10px] text-dim lg:inline">
          {project.width}×{project.height} · {project.fps}fps
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onSaveCopy} title="Save a .librecut copy (Ctrl+S)">
          <Download size={14} /> <span className="hidden sm:inline">Save copy</span>
        </button>
        <button
          className="btn btn-ghost btn-icon"
          onClick={onShowPerformance}
          title="Performance diagnostics"
          aria-label="Performance diagnostics"
        >
          <Activity size={14} />
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onAiTools} title="Transcription and text to speech">
          <Sparkles size={14} /> <span className="hidden sm:inline">AI tools</span>
        </button>
        <button className="btn btn-primary btn-sm px-3.5" onClick={onExport} title="Export video (Ctrl+E)">
          <Upload size={14} /> Export
        </button>
      </div>
    </header>
  );
}
