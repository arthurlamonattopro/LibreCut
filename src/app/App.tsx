import { useState } from "react";
import { Home } from "../features/home/Home";
import { Editor } from "../features/editor/Editor";
import { ToastViewport, toast } from "../components/Toast";
import { persistProject } from "../stores/projects";
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
          `${hydrated.missing.length} media file${hydrated.missing.length === 1 ? "" : "s"} could not be found.`,
          "error",
        );
      }
      void rebuildProxies(hydrated.project, useEditor.getState().replaceAsset);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load the project.", "error");
    }
  };

  const goHome = () => {
    const project = useEditor.getState().project;
    if (project) persistProject(project);
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
    </>
  );
}
