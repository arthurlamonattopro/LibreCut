import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Film,
  FolderOpen,
  Github,
  Info,
  Download,
  Upload,
  LayoutGrid,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { Logo } from "../../components/Logo";
import { LocaleSelect } from "../../components/LocaleSelect";
import { toast } from "../../components/Toast";
import { t as translate, useT } from "../../lib/i18n";
import { createProject } from "../../stores/projects";
import {
  clearAllProjects,
  deleteProject,
  listProjects,
  loadProject as loadProjectById,
  migrateLegacyProjects,
  persistProject,
} from "../../lib/projectStore";
import { getRuntimeStatus, loadProjectFile, pickProjectToOpen, saveProjectFile } from "../../lib/media";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { hasSeenFirstRun, markFirstRunSeen } from "../../lib/firstRun";
import { normalizeProject } from "../../lib/project";
import { formatDuration, formatRelativeDate } from "../../lib/time";
import type { Project, ProjectSummary, RuntimeStatus } from "../../lib/types";
import { FirstRun } from "./FirstRun";
import { BUILT_IN_TEMPLATES, createProjectFromTemplate, parseProjectTemplate, type ProjectTemplate } from "../../lib/templates";

const TEMPLATE_STORAGE_KEY = "librecut.customTemplates.v1";
const AUTO_UPDATE_KEY = "librecut.autoUpdate.v1";
const AUTO_UPDATE_ENABLED = "enabled";
function readAutoUpdatePreference(): boolean {
  try { return localStorage.getItem(AUTO_UPDATE_KEY) === AUTO_UPDATE_ENABLED; } catch { return false; }
}
function readCustomTemplates(): ProjectTemplate[] {
  try { const value = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "[]"); return Array.isArray(value) ? value.map(parseProjectTemplate) : []; }
  catch { return []; }
}

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
  if (source === "bundled") return translate("Bundled sidecar");
  if (source === "override") return translate("Environment override");
  if (source === "path") return translate("System PATH");
  return translate("Not found");
}

function dimensions(aspect: Aspect, resolution: Resolution): { width: number; height: number } {
  const short = Number(resolution);
  const even = (value: number) => Math.round(value / 2) * 2;
  if (aspect === "9:16") return { width: short, height: even((short * 16) / 9) };
  if (aspect === "1:1") return { width: short, height: short };
  return { width: even((short * 16) / 9), height: short };
}

export function Home({ onOpenProject }: HomeProps) {
  const t = useT();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [firstRunOpen, setFirstRunOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(readAutoUpdatePreference);
  const [appVersion, setAppVersion] = useState("0.3.0");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [customTemplates, setCustomTemplates] = useState<ProjectTemplate[]>(readCustomTemplates);

  const refresh = () => {
    void listProjects().then(setProjects).catch(() => setProjects([]));
  };

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
    // Projects saved by an earlier build live in local storage. Move them
    // into the file-backed library before the list is shown.
    void migrateLegacyProjects()
      .catch(() => 0)
      .then(() => listProjects())
      .then((existing) => {
        setProjects(existing);
        // Existing users should not see onboarding just because this flag is new.
        if (existing.length === 0 && !hasSeenFirstRun()) {
          setFirstRunOpen(true);
        }
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  const checkForUpdates = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateStatus("");
    try {
      const update = await check();
      setAvailableUpdate(update);
      setUpdateStatus(update ? t("An update is ready to review.") : t("You're up to date."));
    } catch (error) {
      setUpdateStatus(t("Update check failed: {error}", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (autoUpdate) void checkForUpdates();
    // The preference is the only trigger; checking is protected in the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpdate]);

  const toggleAutoUpdate = (enabled: boolean) => {
    setAutoUpdate(enabled);
    try {
      if (enabled) localStorage.setItem(AUTO_UPDATE_KEY, AUTO_UPDATE_ENABLED);
      else localStorage.removeItem(AUTO_UPDATE_KEY);
    } catch { /* Keep this preference best-effort if storage is unavailable. */ }
    if (!enabled) {
      setAvailableUpdate(null);
      setUpdateStatus(t("Automatic update checks are off."));
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate || installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateProgress(t("Preparing update…"));
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") setUpdateProgress(t("Downloading update…"));
        if (event.event === "Progress") setUpdateProgress(t("Downloading and verifying update…"));
        if (event.event === "Finished") setUpdateProgress(t("Update installed. Restarting…"));
      });
      await relaunch();
    } catch (error) {
      setUpdateProgress(t("Update failed: {error}. Your current installation is unchanged.", { error: error instanceof Error ? error.message : String(error) }));
      setInstallingUpdate(false);
    }
  };

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

  const openProject = async (id: string) => {
    const project = await loadProjectById(id);
    if (!project) {
      toast(t("That project could not be found in the project library."), "error");
      return;
    }
    onOpenProject(project);
  };

  const handleCreate = async (name: string, aspect: Aspect, resolution: Resolution, fps: number, template?: ProjectTemplate) => {
    const { width, height } = dimensions(aspect, resolution);
    const project = template ? createProjectFromTemplate(template, name) : createProject(name, width, height, fps);
    await persistProject(project);
    setNewOpen(false);
    onOpenProject(project);
  };

  const importTemplate = async () => {
    try {
      const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "LibreCut template", extensions: ["librectemplate", "json"] }] });
      if (typeof path !== "string") return;
      const item = parseProjectTemplate(JSON.parse(await loadProjectFile(path)));
      const next = [...customTemplates.filter((t) => t.name !== item.name), item];
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next)); setCustomTemplates(next); toast(t("Imported template “{name}”.", { name: item.name }), "success");
    } catch (error) { toast(error instanceof Error ? error.message : t("Could not import template."), "error"); }
  };
  const exportTemplate = async (template: ProjectTemplate) => {
    try {
      const path = await saveDialog({ defaultPath: `${template.name.replace(/[\\/:*?"<>|]/g, "-")}.librectemplate`, filters: [{ name: "LibreCut template", extensions: ["librectemplate"] }] });
      if (path) { await saveProjectFile(path, JSON.stringify(template, null, 2)); toast(t("Template exported."), "success"); }
    } catch (error) { toast(error instanceof Error ? error.message : t("Could not export template."), "error"); }
  };
  const saveCustomTemplate = (template: ProjectTemplate) => { const next = [...customTemplates.filter((t) => t.name !== template.name), template]; localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next)); setCustomTemplates(next); toast(t("Custom template saved."), "success"); };

  const handleOpenFile = async () => {
    try {
      const path = await pickProjectToOpen();
      if (!path) return;
      const raw = await loadProjectFile(path);
      const project = JSON.parse(raw) as Project;
      if (project.schemaVersion !== 1 || !Array.isArray(project.tracks)) {
        throw new Error(t("Unsupported project file"));
      }
      normalizeProject(project);
      await persistProject(project);
      onOpenProject(project);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Could not open that project."), "error");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteProject(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
    toast(t("Project deleted."), "success");
  };

  const confirmClear = async () => {
    await clearAllProjects();
    setProjects([]);
    setClearOpen(false);
    toast(t("Local project data cleared."), "success");
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="flex w-[190px] shrink-0 flex-col border-r border-line-soft bg-surface-2 px-3 py-3">
        <div className="px-2 pb-6 pt-1">
          <Logo size={30} withWordmark />
        </div>

        <nav className="space-y-1">
          <NavItem icon={LayoutGrid} label={t("Projects")} active />
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] font-medium text-muted transition hover:bg-white/[0.04] hover:text-ink"
            onClick={() => setFirstRunOpen(true)}
          >
            <BookOpen size={14} aria-hidden="true" />
            <span className="flex-1 text-left">{t("Getting started")}</span>
          </button>
        </nav>

        <div className="mt-auto border-t border-line-soft pt-3">
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-muted transition hover:bg-white/5 hover:text-ink" onClick={() => setAboutOpen(true)}>
            <Info size={14} aria-hidden="true" /> {t("About")}
          </button>
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-muted transition hover:bg-white/5 hover:text-ink" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} aria-hidden="true" /> {t("Settings")}
          </button>
          <div className="px-2.5 pb-1 pt-2 text-[10px] text-dim">v{appVersion}</div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center justify-between gap-6 border-b border-line-soft px-7">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[14px] font-semibold text-ink">{t("Projects")}</h1>
            <span className="font-mono text-[10px] tabular-nums text-dim">{projects.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost btn-icon md:w-auto md:px-[13px]" onClick={handleOpenFile} title={t("Open project")} aria-label={t("Open project")}>
              <FolderOpen size={14} aria-hidden="true" /> <span className="hidden md:inline">{t("Open project")}</span>
            </button>
            <button className="btn btn-primary" onClick={() => setNewOpen(true)} title={t("New project")} aria-label={t("New project")}>
              <Plus size={15} aria-hidden="true" /> <span className="hidden sm:inline">{t("New project")}</span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
          {projects.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <h2 className="mb-2 text-[12px] font-semibold text-muted">{t("All projects")}</h2>
              <div className="divide-y divide-line-soft">
                {projects.map((project) => (
                  <article key={project.id} className="group flex items-center gap-4 py-3">
                    <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => openProject(project.id)}>
                      <div className="flex h-[68px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-sm bg-panel-2">
                        {project.thumbnail ? (
                          <img src={project.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Film size={19} className="text-dim" aria-hidden="true" />
                        )}
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink group-hover:text-accent">{project.name}</span>
                        <span className="mt-1 block text-[11px] text-muted">{t("Edited {date}", { date: formatRelativeDate(project.updatedAt) })}</span>
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
                      aria-label={t("Delete {name}", { name: project.name })}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line-soft px-7 py-2 text-[10px] text-dim">
          <span className="flex items-center gap-1.5">
            <Github size={11} aria-hidden="true" /> {t("Open source · GPL-3.0")}
          </span>
          <span>{t("Projects stay on this PC.")}</span>
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

      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} onCreate={handleCreate} customTemplates={customTemplates} onImportTemplate={importTemplate} onExportTemplate={exportTemplate} onSaveCustomTemplate={saveCustomTemplate} />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t("Delete project?")}
        description={t("“{name}” will be removed from this PC. This cannot be undone.", { name: deleteTarget?.name ?? "" })}
        width={430}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t("Cancel")}</button>
            <button className="btn btn-danger" onClick={confirmDelete}>{t("Delete project")}</button>
          </>
        }
      >
        <div className="rounded-xl border border-line-soft bg-surface-2/60 p-3 text-[12px] leading-relaxed text-muted">
          {t("Exported videos are not affected. Only the editable project stored in LibreCut is removed.")}
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t("Settings")}
        description={t("LibreCut is local-first by design. These settings apply to this installation.")}
        width={520}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <LocaleSelect />
            <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
              {t("Choose the language used for menus, dialogs, and labels. AI captions and speech keep their own language setting.")}
            </p>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[12.5px] font-medium">{t("Local project storage")}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                  {t("Projects are saved in this app's local storage. Export a copy to keep a file backup.")}
                </p>
              </div>
              <span className="chip">{t(projects.length === 1 ? "{count} project" : "{count} projects", { count: projects.length })}</span>
            </div>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium">{t("FFmpeg runtime")}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                  {t("Import, proxies, and export use the FFmpeg sidecar bundled with LibreCut.")}
                </p>
                <div className="mt-1.5 break-all font-mono text-[9.5px] text-dim">
                  {checkingRuntime
                    ? t("Checking…")
                    : runtime
                      ? `${runtimeSourceLabel(runtime.ffmpeg.source)} · ${runtime.ffmpeg.version?.split(" Copyright")[0] ?? "FFmpeg"}`
                      : t("Runtime status unavailable")}
                </div>
              </div>
              <span className={`chip shrink-0 ${runtime?.ready ? "text-mint" : runtime ? "text-accent" : ""}`}>
                {checkingRuntime ? t("Checking…") : runtime?.ready ? t("Ready") : runtime ? t("Missing") : t("Unknown")}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm mt-2" onClick={() => void refreshRuntime()} disabled={checkingRuntime}>
              <RefreshCw size={12} className={checkingRuntime ? "animate-spin" : ""} aria-hidden="true" /> {t("Recheck runtime")}
            </button>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="text-[12.5px] font-medium">{t("Privacy")}</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              {t("No accounts, analytics, or cloud uploads. Media is processed by the bundled FFmpeg runtime on your machine. Update checks only contact GitHub when enabled.")}
            </p>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[12.5px] font-medium">{t("Application updates")}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{t("Current version:")} <span className="font-mono">{appVersion}</span>. {t("Stable releases are checked from GitHub only when enabled.")}</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
                <input type="checkbox" checked={autoUpdate} onChange={(event) => toggleAutoUpdate(event.target.checked)} aria-label={t("Enable automatic update checks")} />
                {t("Check automatically")}
              </label>
            </div>
            {availableUpdate ? (
              <div className="mt-3 rounded-lg border border-line-soft bg-panel/70 p-3">
                <div className="text-[12px] font-medium">{t("Version {version} is available", { version: availableUpdate.version })}</div>
                <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted">{availableUpdate.body?.trim() || t("No release notes were provided.")}</div>
                <button className="btn btn-primary btn-sm mt-3" onClick={() => void installUpdate()} disabled={installingUpdate}>
                  <Download size={12} aria-hidden="true" /> {installingUpdate ? updateProgress || t("Installing…") : t("Download and install")}
                </button>
              </div>
            ) : null}
            {updateStatus || updateProgress ? <p className="mt-2 text-[10.5px] leading-relaxed text-dim" role="status">{updateProgress || updateStatus}</p> : null}
            <button className="btn btn-ghost btn-sm mt-2" onClick={() => void checkForUpdates()} disabled={checkingUpdate || installingUpdate}>
              <RefreshCw size={12} className={checkingUpdate ? "animate-spin" : ""} aria-hidden="true" /> {checkingUpdate ? t("Checking…") : t("Check for updates")}
            </button>
          </div>
          <button className="btn btn-danger w-full" onClick={() => setClearOpen(true)}>
            <Trash2 size={14} aria-hidden="true" /> {t("Clear all local projects")}
          </button>
        </div>
      </Modal>

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t("Clear all local projects?")}
        description={t("Every editable project stored by LibreCut on this PC will be deleted. Exported videos are untouched.")}
        width={430}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setClearOpen(false)}>{t("Cancel")}</button>
            <button className="btn btn-danger" onClick={confirmClear}>{t("Clear everything")}</button>
          </>
        }
      >
        <div className="rounded-xl border border-accent/20 bg-accent-soft/40 p-3 text-[12px] leading-relaxed text-accent">
          {t("This action cannot be undone.")}
        </div>
      </Modal>

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="LibreCut" width={470}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Logo size={44} />
            <div>
              <div className="text-[15px] font-semibold">LibreCut {appVersion}</div>
              <div className="text-[11.5px] text-dim">{t("A local-first video editor for Windows")}</div>
            </div>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {t("LibreCut is free and open-source software. It is not affiliated with CapCut or ByteDance. Built with Tauri, Rust, React, and FFmpeg.")}
          </p>
          <div className="rounded-xl border border-line-soft bg-surface-2/60 p-3 text-[11.5px] leading-relaxed text-dim">
            {t("Licensed under GPL-3.0. FFmpeg is distributed under its own license. See THIRD_PARTY_LICENSES.md in the repository.")}
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
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] font-medium transition ${
        active
          ? "bg-white/[0.06] text-ink"
          : "text-muted hover:bg-white/[0.04] hover:text-ink"
      }`}
    >
      <Icon size={14} className={active ? "text-accent" : ""} aria-hidden="true" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="flex min-h-[280px] items-center">
      <div className="max-w-[380px]">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{t("No projects yet")}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          {t("Create a project to choose a frame size and start editing. Your files stay on this PC.")}
        </p>
      </div>
    </div>
  );
}

function NewProjectModal({
  open,
  onClose,
  onCreate,
  customTemplates,
  onImportTemplate,
  onExportTemplate,
  onSaveCustomTemplate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, aspect: Aspect, resolution: Resolution, fps: number, template?: ProjectTemplate) => void;
  customTemplates: ProjectTemplate[];
  onImportTemplate: () => void;
  onExportTemplate: (template: ProjectTemplate) => void;
  onSaveCustomTemplate: (template: ProjectTemplate) => void;
}) {
  const t = useT();
  const [name, setName] = useState(() => t("Untitled project"));
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [resolution, setResolution] = useState<Resolution>("1080");
  const [fps, setFps] = useState(30);
  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [customName, setCustomName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(t("Untitled project"));
      setAspect("16:9");
      setResolution("1080");
      setFps(30);
      setTemplate(null);
      window.setTimeout(() => inputRef.current?.select(), 80);
    }
    // Reset the defaults only when the dialog opens; a locale change while it is
    // closed is picked up by the next open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preview = dimensions(aspect, resolution);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("New project")}
      description={t("Choose a canvas. You can change the export size later without changing the edit.")}
      width={560}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn btn-primary" onClick={() => onCreate(name, aspect, resolution, fps, template ?? undefined)}>
            <Plus size={15} aria-hidden="true" /> {t("Create project")}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <span className="label">{t("Start from template")}</span>
          <div className="mb-2 flex gap-2"><button className="btn btn-ghost" type="button" onClick={onImportTemplate}><Upload size={13} aria-hidden="true"/> {t("Import")}</button><input className="field min-w-0 flex-1" placeholder={t("Custom template name")} aria-label={t("Custom template name")} value={customName} onChange={(e) => setCustomName(e.target.value)} /><button className="btn btn-ghost" type="button" disabled={!customName.trim()} onClick={() => { const d = dimensions(aspect, resolution); const item = parseProjectTemplate({ formatVersion: 1, name: customName.trim(), description: `${aspect} canvas · ${resolution}p · ${fps} fps`, ...d, fps, tracks: [] }); onSaveCustomTemplate(item); setTemplate(item); setCustomName(""); }}>{t("Save")}</button></div>
          <div className="grid grid-cols-3 gap-2">
            {[...BUILT_IN_TEMPLATES, ...customTemplates].map((item) => (
              <div key={item.name} className={`relative rounded-lg border p-2 text-left text-[10px] ${template?.name === item.name ? "border-accent bg-accent-soft" : "border-line bg-surface-2/50"}`}>
                <button
                  type="button"
                  aria-pressed={template?.name === item.name}
                  className="block w-full text-left"
                  onClick={() => {
                    setTemplate(item);
                    setAspect(item.width > item.height ? "16:9" : item.width === item.height ? "1:1" : "9:16");
                    setResolution((item.height >= 2000 || item.width >= 2000 ? "2160" : item.height >= 1400 || item.width >= 1400 ? "1440" : "1080"));
                    setFps(item.fps);
                  }}
                >
                  <span className="flex items-center justify-between font-medium">{item.name}</span>
                  <span className="mt-1 block text-dim">{item.description}</span>
                  <span className="mt-2 flex h-9 items-center justify-center rounded bg-black/20" aria-hidden="true"><span className="block border border-accent/60 bg-accent/10" style={{ width: `${Math.max(12, 60 * item.width / Math.max(item.width, item.height))}px`, height: `${Math.max(12, 34 * item.height / Math.max(item.width, item.height))}px` }}/></span>
                  <span className="mt-1 block text-dim">{item.width} × {item.height} · {item.fps} fps</span>
                </button>
                {customTemplates.includes(item) ? (
                  <button
                    type="button"
                    aria-label={t("Export the {name} template", { name: item.name })}
                    title={t("Export template")}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md text-dim transition hover:bg-white/10 hover:text-ink"
                    onClick={() => onExportTemplate(item)}
                  >
                    <Download size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="project-name">{t("Project name")}</label>
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
          <span className="label">{t("Aspect ratio")}</span>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["16:9", t("Landscape"), t("YouTube, desktop")],
              ["9:16", t("Vertical"), t("TikTok, Reels, Shorts")],
              ["1:1", t("Square"), t("Feed posts")],
            ] as const).map(([value, title, hint]) => (
              <button
                key={value}
                aria-pressed={aspect === value}
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
            <label className="label" htmlFor="resolution">{t("Resolution")}</label>
            <select id="resolution" className="field" value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)}>
              <option value="1080">1080p · {aspect === "9:16" ? "1080×1920" : aspect === "1:1" ? "1080×1080" : "1920×1080"}</option>
              <option value="1440">1440p · {aspect === "9:16" ? "1440×2560" : aspect === "1:1" ? "1440×1440" : "2560×1440"}</option>
              <option value="2160">{t("4K")} · {aspect === "9:16" ? "2160×3840" : aspect === "1:1" ? "2160×2160" : "3840×2160"}</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fps">{t("Frame rate")}</label>
            <select id="fps" className="field" value={fps} onChange={(event) => setFps(Number(event.target.value))}>
              <option value={24}>24 fps · {t("cinematic")}</option>
              <option value={30}>30 fps · {t("standard")}</option>
              <option value={60}>60 fps · {t("smooth")}</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line-soft bg-surface-2/50 px-3.5 py-2.5 text-[11.5px] text-dim">
          <span>{t("Canvas")}</span>
          <span className="font-mono text-[11px] text-muted">{preview.width} × {preview.height} · {fps} fps</span>
        </div>
      </div>
    </Modal>
  );
}
