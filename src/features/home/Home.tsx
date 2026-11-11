import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Film,
  FolderOpen,
  Github,
  Info,
  LayoutGrid,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { Logo } from "../../components/Logo";
import { toast } from "../../components/Toast";
import { createProject, deleteProject, listProjects, loadProject as loadProjectById, persistProject } from "../../stores/projects";
import { getRuntimeStatus, loadProjectFile, pickProjectToOpen } from "../../lib/media";
import { hasSeenFirstRun, markFirstRunSeen } from "../../lib/firstRun";
import { normalizeProject } from "../../lib/project";
import { formatDuration, formatRelativeDate } from "../../lib/time";
import type { Project, ProjectSummary, RuntimeStatus } from "../../lib/types";
import { FirstRun } from "./FirstRun";

interface HomeProps {
  onOpenProject: (project: Project) => void;
}

type Aspect = "16:9" | "9:16" | "1:1";
type Resolution = "1080" | "1440" | "2160";

function aspectLabel(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.01) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.01) return "9:16";
  if (Math.abs(ratio - 1) < 0.01) return "1:1";
  if (Math.abs(ratio - 4 / 3) < 0.01) return "4:3";
  return `${width}×${height}`;
}

function runtimeSourceLabel(source: string): string {
  if (source === "bundled") return "Bundled sidecar";
  if (source === "override") return "Environment override";
  if (source === "path") return "System PATH";
  return "Not found";
}

function dimensions(aspect: Aspect, resolution: Resolution): { width: number; height: number } {
  const short = Number(resolution);
  const even = (value: number) => Math.round(value / 2) * 2;
  if (aspect === "9:16") return { width: short, height: even((short * 16) / 9) };
  if (aspect === "1:1") return { width: short, height: short };
  return { width: even((short * 16) / 9), height: short };
}

export function Home({ onOpenProject }: HomeProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [firstRunOpen, setFirstRunOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [checkingRuntime, setCheckingRuntime] = useState(false);

  const refresh = () => setProjects(listProjects());

  const refreshRuntime = async () => {
    setCheckingRuntime(true);
    try {
      setRuntime(await getRuntimeStatus());
    } catch {
      setRuntime(null);
    } finally {
      setCheckingRuntime(false);
    }
  };

  useEffect(() => {
    const existing = listProjects();
    setProjects(existing);
    // Existing users should not see onboarding just because this flag is new.
    if (existing.length === 0 && !hasSeenFirstRun()) {
      setFirstRunOpen(true);
    }
  }, []);

  useEffect(() => {
    if (firstRunOpen || settingsOpen) void refreshRuntime();
    // Runtime checks are only needed when a guidance surface is visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRunOpen, settingsOpen]);

  const closeFirstRun = () => {
    markFirstRunSeen();
    setFirstRunOpen(false);
  };

  const startFromFirstRun = () => {
    closeFirstRun();
    setNewOpen(true);
  };

  const openProject = (id: string) => {
    const project = loadProjectById(id);
    if (!project) {
      toast("That project could not be found in local storage.", "error");
      return;
    }
    onOpenProject(project);
  };

  const handleCreate = (name: string, aspect: Aspect, resolution: Resolution, fps: number) => {
    const { width, height } = dimensions(aspect, resolution);
    const project = createProject(name, width, height, fps);
    persistProject(project);
    setNewOpen(false);
    onOpenProject(project);
  };

  const handleOpenFile = async () => {
    try {
      const path = await pickProjectToOpen();
      if (!path) return;
      const raw = await loadProjectFile(path);
      const project = JSON.parse(raw) as Project;
      if (project.schemaVersion !== 1 || !Array.isArray(project.tracks)) {
        throw new Error("Unsupported project file");
      }
      normalizeProject(project);
      persistProject(project);
      onOpenProject(project);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not open that project.", "error");
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteProject(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
    toast("Project deleted.", "success");
  };

  const confirmClear = () => {
    for (const project of projects) deleteProject(project.id);
    setProjects([]);
    setClearOpen(false);
    toast("Local project data cleared.", "success");
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="flex w-[190px] shrink-0 flex-col border-r border-line-soft bg-surface-2 px-3 py-3">
        <div className="px-2 pb-6 pt-1">
          <Logo size={30} withWordmark />
        </div>

        <nav className="space-y-1">
          <NavItem icon={LayoutGrid} label="Projects" active />
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] font-medium text-muted transition hover:bg-white/[0.04] hover:text-ink"
            onClick={() => setFirstRunOpen(true)}
          >
            <BookOpen size={14} />
            <span className="flex-1 text-left">Getting started</span>
          </button>
        </nav>

        <div className="mt-auto border-t border-line-soft pt-3">
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-muted transition hover:bg-white/5 hover:text-ink" onClick={() => setAboutOpen(true)}>
            <Info size={14} /> About
          </button>
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-muted transition hover:bg-white/5 hover:text-ink" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} /> Settings
          </button>
          <div className="px-2.5 pb-1 pt-2 text-[10px] text-dim">v0.1.0</div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center justify-between gap-6 border-b border-line-soft px-7">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[14px] font-semibold text-ink">Projects</h1>
            <span className="font-mono text-[10px] tabular-nums text-dim">{projects.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost btn-icon md:w-auto md:px-[13px]" onClick={handleOpenFile} title="Open project" aria-label="Open project">
              <FolderOpen size={14} /> <span className="hidden md:inline">Open project</span>
            </button>
            <button className="btn btn-primary" onClick={() => setNewOpen(true)} title="New project" aria-label="New project">
              <Plus size={15} /> <span className="hidden sm:inline">New project</span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
          {projects.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <h2 className="mb-2 text-[12px] font-semibold text-muted">All projects</h2>
              <div className="divide-y divide-line-soft">
                {projects.map((project) => (
                  <article key={project.id} className="group flex items-center gap-4 py-3">
                    <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => openProject(project.id)}>
                      <div className="flex h-[68px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-sm bg-panel-2">
                        {project.thumbnail ? (
                          <img src={project.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Film size={19} className="text-dim" />
                        )}
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink group-hover:text-accent">{project.name}</span>
                        <span className="mt-1 block text-[11px] text-muted">Edited {formatRelativeDate(project.updatedAt)}</span>
                      </span>
                      <span className="hidden w-[170px] shrink-0 text-[11px] text-muted xl:block">
                        {aspectLabel(project.width, project.height)} <span className="text-dim">·</span> {project.fps} fps
                      </span>
                      <span className="w-[58px] shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
                        {formatDuration(project.duration)}
                      </span>
                    </button>
                    <button
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim opacity-0 transition hover:bg-white/5 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => setDeleteTarget(project)}
                      aria-label={`Delete ${project.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line-soft px-7 py-2 text-[10px] text-dim">
          <span className="flex items-center gap-1.5">
            <Github size={11} /> Open source · GPL-3.0
          </span>
          <span>Projects stay on this PC.</span>
        </footer>
      </main>

      <FirstRun
        open={firstRunOpen}
        runtime={runtime}
        checking={checkingRuntime}
        onRefresh={() => void refreshRuntime()}
        onClose={closeFirstRun}
        onCreate={startFromFirstRun}
      />

      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} onCreate={handleCreate} />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete project?"
        description={`“${deleteTarget?.name ?? ""}” will be removed from this PC. This cannot be undone.`}
        width={430}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDelete}>Delete project</button>
          </>
        }
      >
        <div className="rounded-xl border border-line-soft bg-surface-2/60 p-3 text-[12px] leading-relaxed text-muted">
          Exported videos are not affected. Only the editable project stored in LibreCut is removed.
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
        description="LibreCut is local-first by design. These settings apply to this installation."
        width={520}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[12.5px] font-medium">Local project storage</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                  Projects are saved in this app's local storage. Export a copy to keep a file backup.
                </p>
              </div>
              <span className="chip">{projects.length} projects</span>
            </div>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium">FFmpeg runtime</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                  Import, proxies, and export use the FFmpeg sidecar bundled with LibreCut.
                </p>
                <div className="mt-1.5 break-all font-mono text-[9.5px] text-dim">
                  {checkingRuntime
                    ? "Checking…"
                    : runtime
                      ? `${runtimeSourceLabel(runtime.ffmpeg.source)} · ${runtime.ffmpeg.version?.split(" Copyright")[0] ?? "FFmpeg"}`
                      : "Runtime status unavailable"}
                </div>
              </div>
              <span className={`chip shrink-0 ${runtime?.ready ? "text-mint" : runtime ? "text-accent" : ""}`}>
                {checkingRuntime ? "Checking…" : runtime?.ready ? "Ready" : runtime ? "Missing" : "Unknown"}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm mt-2" onClick={() => void refreshRuntime()} disabled={checkingRuntime}>
              <RefreshCw size={12} className={checkingRuntime ? "animate-spin" : ""} /> Recheck runtime
            </button>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="text-[12.5px] font-medium">Privacy</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              No accounts, analytics, cloud uploads, or network requests. Media is processed by the bundled FFmpeg runtime on your machine.
            </p>
          </div>
          <button className="btn btn-danger w-full" onClick={() => setClearOpen(true)}>
            <Trash2 size={14} /> Clear all local projects
          </button>
        </div>
      </Modal>

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear all local projects?"
        description="Every editable project stored by LibreCut on this PC will be deleted. Exported videos are untouched."
        width={430}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setClearOpen(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmClear}>Clear everything</button>
          </>
        }
      >
        <div className="rounded-xl border border-accent/20 bg-accent-soft/40 p-3 text-[12px] leading-relaxed text-accent">
          This action cannot be undone.
        </div>
      </Modal>

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="LibreCut" width={470}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Logo size={44} />
            <div>
              <div className="text-[15px] font-semibold">LibreCut 0.1.0</div>
              <div className="text-[11.5px] text-dim">A local-first video editor for Windows</div>
            </div>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            LibreCut is free and open-source software. It is not affiliated with CapCut or ByteDance. Built with Tauri, Rust, React, and FFmpeg.
          </p>
          <div className="rounded-xl border border-line-soft bg-surface-2/60 p-3 text-[11.5px] leading-relaxed text-dim">
            Licensed under GPL-3.0. FFmpeg is distributed under its own license. See THIRD_PARTY_LICENSES.md in the repository.
          </div>
        </div>
      </Modal>
    </div>
  );
}

function NavItem({ icon: Icon, label, active }: {
  icon: typeof LayoutGrid;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] font-medium transition ${
        active
          ? "bg-white/[0.06] text-ink"
          : "text-muted hover:bg-white/[0.04] hover:text-ink"
      }`}
    >
      <Icon size={14} className={active ? "text-accent" : ""} />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[280px] items-center">
      <div className="max-w-[380px]">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em]">No projects yet</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          Create a project to choose a frame size and start editing. Your files stay on this PC.
        </p>
      </div>
    </div>
  );
}

function NewProjectModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, aspect: Aspect, resolution: Resolution, fps: number) => void;
}) {
  const [name, setName] = useState("Untitled project");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [resolution, setResolution] = useState<Resolution>("1080");
  const [fps, setFps] = useState(30);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("Untitled project");
      setAspect("16:9");
      setResolution("1080");
      setFps(30);
      window.setTimeout(() => inputRef.current?.select(), 80);
    }
  }, [open]);

  const preview = dimensions(aspect, resolution);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="Choose a canvas. You can change the export size later without changing the edit."
      width={560}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onCreate(name, aspect, resolution, fps)}>
            <Plus size={15} /> Create project
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            ref={inputRef}
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreate(name, aspect, resolution, fps);
            }}
          />
        </div>

        <div>
          <span className="label">Aspect ratio</span>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["16:9", "Landscape", "YouTube, desktop"],
              ["9:16", "Vertical", "TikTok, Reels, Shorts"],
              ["1:1", "Square", "Feed posts"],
            ] as const).map(([value, title, hint]) => (
              <button
                key={value}
                className={`rounded-xl border p-3 text-left transition ${
                  aspect === value
                    ? "border-accent/60 bg-accent-soft shadow-[0_0_0_1px_#36c8d030]"
                    : "border-line bg-surface-2/50 hover:border-line hover:bg-panel-2"
                }`}
                onClick={() => setAspect(value)}
                type="button"
              >
                <div className="flex h-9 items-center justify-center">
                  <div
                    className={`rounded-[3px] border ${aspect === value ? "border-accent bg-accent/20" : "border-dim bg-white/5"}`}
                    style={{
                      width: value === "9:16" ? 16 : value === "1:1" ? 26 : 38,
                      height: value === "9:16" ? 30 : value === "1:1" ? 26 : 22,
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[12px] font-medium">{title}</div>
                <div className="text-[10.5px] text-dim">{hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="resolution">Resolution</label>
            <select id="resolution" className="field" value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)}>
              <option value="1080">1080p · {aspect === "9:16" ? "1080×1920" : aspect === "1:1" ? "1080×1080" : "1920×1080"}</option>
              <option value="1440">1440p · {aspect === "9:16" ? "1440×2560" : aspect === "1:1" ? "1440×1440" : "2560×1440"}</option>
              <option value="2160">4K · {aspect === "9:16" ? "2160×3840" : aspect === "1:1" ? "2160×2160" : "3840×2160"}</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fps">Frame rate</label>
            <select id="fps" className="field" value={fps} onChange={(event) => setFps(Number(event.target.value))}>
              <option value={24}>24 fps · cinematic</option>
              <option value={30}>30 fps · standard</option>
              <option value={60}>60 fps · smooth</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line-soft bg-surface-2/50 px-3.5 py-2.5 text-[11.5px] text-dim">
          <span>Canvas</span>
          <span className="font-mono text-[11px] text-muted">{preview.width} × {preview.height} · {fps} fps</span>
        </div>
      </div>
    </Modal>
  );
}
