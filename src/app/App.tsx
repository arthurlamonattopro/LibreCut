import { useState } from "react";
import { Home } from "../features/home/Home";
import { Editor } from "../features/editor/Editor";
import { ToastViewport, toast } from "../components/Toast";
import { LiveRegion } from "../components/LiveRegion";
import { persistProject } from "../lib/projectStore";
import { t } from "../lib/i18n";
import { useEditor } from "../stores/editor";
import { hydrateProject, rebuildProxies } from "../lib/hydrate";
import type { Project } from "../lib/types";

export default function App() {
  const [view, setView] = useState<"home" | "editor">("home");
  const [homeKey, setHomeKey] = useState(0);

  const openProject = async (project: Project) => {
    try {
      const hydrated = await hydrateProject(project);
      useEditor.getState().openProject(hydrated.project);
      setView("editor");
      if (hydrated.missing.length > 0) {
        toast(
          t(hydrated.missing.length === 1 ? "{count} media file could not be found." : "{count} media files could not be found.", { count: hydrated.missing.length }),
          "error",
        );
      }
      void rebuildProxies(hydrated.project, useEditor.getState().replaceAsset);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Could not load the project."), "error");
    }
  };

  const goHome = async () => {
    const project = useEditor.getState().project;
    if (project) await persistProject(project);
    useEditor.getState().closeProject();
    setView("home");
    setHomeKey((value) => value + 1);
  };

  return (
    <>
      {view === "home" ? (
        <Home key={homeKey} onOpenProject={openProject} />
      ) : (
        <Editor onBack={goHome} />
      )}
      <ToastViewport />
      <LiveRegion />
    </>
  );
}
