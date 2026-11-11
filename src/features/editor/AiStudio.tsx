import { useEffect, useMemo, useState } from "react";
import { AudioLines, Captions, FolderOpen, HardDrive, Image, Loader2, RefreshCw, Sparkles, Wifi } from "lucide-react";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { generateThumbnails, generateWaveform, openFolder, readMediaForAi, registerMedia, synthesizeSpeech, transcribeAudio } from "../../lib/media";
import { removeImageBackground, saveLocalImage, synthesizeLocally, transcribeLocally, type ModelProgress } from "../../lib/localAi";
import { ensureModelsFolder, getOfflineModelStatus, isStrictOffline, setStrictOffline, type OfflineModelStatus } from "../../lib/offlineModels";
import { useEditor } from "../../stores/editor";
import type { Asset } from "../../lib/types";

type Workspace = "local" | "cloud";
type LocalTool = "captions" | "speech" | "background";
type CloudTool = "captions" | "speech";
type CaptionSource = "timeline" | "asset";
export type AiStudioTool = LocalTool;

const LANGUAGES = [
  { code: "en", whisper: "english", label: "English" },
  { code: "es", whisper: "spanish", label: "Spanish" },
  { code: "pt", whisper: "portuguese", label: "Portuguese" },
  { code: "fr", whisper: "french", label: "French" },
] as const;

const MMS_TTS_MODELS: Record<string, string> = {
  en: "Xenova/mms-tts-eng",
  es: "Xenova/mms-tts-spa",
  pt: "Xenova/mms-tts-por",
  fr: "Xenova/mms-tts-fra",
};

function progressText(progress: ModelProgress | null) {
  if (!progress) return "";
  if (progress.status === "progress_total") return `Downloading ${progress.file ?? progress.name ?? "model files"} · ${Math.round(progress.progress ?? 0)}%`;
  if (progress.status === "download") return `Downloading ${progress.file ?? "model files"}…`;
  if (progress.status === "ready") return `Loaded ${progress.file ?? "a model file"} · loading remaining files…`;
  if (progress.status === "done") return `Loaded ${progress.file ?? "a model file"}`;
  if (progress.status === "inference") return "Generating speech locally…";
  if (progress.status === "saving") return "Saving generated audio…";
  return "Preparing local model…";
}

export function AiStudio({ open, onClose, initialTool, initialImageId }: { open: boolean; onClose: () => void; initialTool?: AiStudioTool; initialImageId?: string }) {
  const project = useEditor((state) => state.project);
  const selectedClipId = useEditor((state) => state.selectedClipId);
  const timelineVideo = useMemo(() => {
    const clip = project?.tracks.flatMap((track) => track.clips).find((item) => item.id === selectedClipId && item.kind === "video");
    const asset = clip?.assetId ? project?.assets.find((item) => item.id === clip.assetId) : undefined;
    return clip && asset?.info.hasAudio ? { clip, asset } : null;
  }, [project, selectedClipId]);
  const assets = useMemo(() => project?.assets.filter((asset) => asset.info.hasAudio) ?? [], [project]);
  const images = useMemo(() => project?.assets.filter((asset) => asset.info.isImage) ?? [], [project]);
  const [workspace, setWorkspace] = useState<Workspace>("local");
  const [localTool, setLocalTool] = useState<LocalTool>("captions");
  const [cloudTool, setCloudTool] = useState<CloudTool>("captions");
  const [asrModelChoice, setAsrModelChoice] = useState("Xenova/whisper-small");
  const [customAsrModel, setCustomAsrModel] = useState("");
  const [ttsModel, setTtsModel] = useState<"mms" | "supertonic" | "custom">("mms");
  const [customTtsModel, setCustomTtsModel] = useState("");
  const [backgroundModel, setBackgroundModel] = useState("Xenova/modnet");
  const [customBackgroundModel, setCustomBackgroundModel] = useState("");
  const [language, setLanguage] = useState("en");
  const [captionSource, setCaptionSource] = useState<CaptionSource>("timeline");
  const [voice, setVoice] = useState("F1");
  const [sourceId, setSourceId] = useState(assets[0]?.id ?? "");
  const [imageId, setImageId] = useState(images[0]?.id ?? "");
  const [speechText, setSpeechText] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [asrModel, setAsrModel] = useState("whisper-1");
  const [speechModel, setSpeechModel] = useState("gpt-4o-mini-tts");
  const [cloudVoice, setCloudVoice] = useState("alloy");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<OfflineModelStatus | null>(null);
  const [strictOffline, setStrictOfflineState] = useState(() => isStrictOffline());
  const [checkingModels, setCheckingModels] = useState(false);
  const addAsset = useEditor((state) => state.addAsset);

  useEffect(() => {
    if (!open || !initialTool) return;
    setWorkspace("local");
    setLocalTool(initialTool);
    if (initialImageId) setImageId(initialImageId);
  }, [open, initialTool, initialImageId]);

  const refreshOfflineModels = async () => {
    setCheckingModels(true);
    try {
      setOfflineStatus(await getOfflineModelStatus());
    } catch {
      setOfflineStatus(null);
    } finally {
      setCheckingModels(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCheckingModels(true);
    getOfflineModelStatus()
      .then((status) => { if (!cancelled) setOfflineStatus(status); })
      .catch(() => { if (!cancelled) setOfflineStatus(null); })
      .finally(() => { if (!cancelled) setCheckingModels(false); });
    return () => { cancelled = true; };
  }, [open]);

  const toggleStrictOffline = async (next: boolean) => {
    await setStrictOffline(next);
    setStrictOfflineState(next);
    toast(next ? "Strict offline mode enabled. Missing models will not be downloaded." : "Strict offline mode disabled. Missing models can download on first use.", "success");
  };

  const openModelsFolder = async () => {
    try {
      const path = await ensureModelsFolder();
      await openFolder(path);
      await refreshOfflineModels();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };
  const activeCaptionSource = captionSource === "timeline" && timelineVideo ? "timeline" : "asset";
  const activeAsrModel = asrModelChoice === "custom" ? customAsrModel.trim() : asrModelChoice;
  const changeLanguage = (value: string) => {
    setLanguage(value);
    if (value !== "en" && ttsModel === "supertonic") setTtsModel("mms");
  };

  const onModelProgress = (info: ModelProgress) => setProgress(info);

  const addCaptions = (segments: Array<{ start: number; end: number; text: string }>, clip?: { start: number; duration: number; trimIn: number; speed: number }) => {
    if (!segments.length) { toast("No timed speech segments were found.", "error"); return; }
    const state = useEditor.getState();
    const duration = Math.max(0.01, clip?.speed ?? 1);
    const visible = clip ? segments.map((segment) => {
      const mediaStart = Math.max(segment.start, clip.trimIn);
      const mediaEnd = Math.min(segment.end, clip.trimIn + clip.duration * duration);
      return { ...segment, start: clip.start + (mediaStart - clip.trimIn) / duration, end: clip.start + (mediaEnd - clip.trimIn) / duration };
    }).filter((segment) => segment.end > segment.start) : segments;
    if (!visible.length) { toast("No speech was found in the visible part of this timeline clip.", "error"); return; }
    for (const segment of visible) {
      state.addTextClip(segment.text, segment.start);
      const id = useEditor.getState().selectedClipId;
      if (id) useEditor.getState().updateClip(id, { duration: Math.max(0.1, segment.end - segment.start) });
    }
    toast(`Added ${visible.length} caption segments to the timeline.`, "success");
  };

  const getCaptionInput = () => {
    if (captionSource === "timeline" && timelineVideo) return { asset: timelineVideo.asset, clip: timelineVideo.clip };
    const asset = assets.find((item) => item.id === sourceId);
    return asset ? { asset } : null;
  };

  const addAudioFile = async (path: string) => {
    const registered = await registerMedia(path);
    const asset: Asset = {
      id: crypto.randomUUID(), name: registered.info.name, path, mediaId: registered.id, previewMediaId: registered.id,
      proxyStatus: "none", info: registered.info,
      thumbnails: await generateThumbnails(path).catch(() => []),
      waveform: await generateWaveform(path).catch(() => []), importedAt: Date.now(),
    };
    addAsset(asset);
    useEditor.getState().addClip(asset.id);
  };

  const addImageFile = async (path: string) => {
    const registered = await registerMedia(path);
    const asset: Asset = {
      id: crypto.randomUUID(), name: `Background removed · ${registered.info.name}`, path, mediaId: registered.id, previewMediaId: registered.id,
      proxyStatus: "none", info: registered.info,
      thumbnails: await generateThumbnails(path).catch(() => []), waveform: [], importedAt: Date.now(),
    };
    addAsset(asset);
    useEditor.getState().addClip(asset.id);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProgress(null);
    try { await action(); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
    finally { setBusy(false); setProgress(null); }
  };

  const localTranscribe = () => run(async () => {
    const source = getCaptionInput();
    if (!source) throw new Error("Select a video clip on the timeline or choose imported media.");
    const selectedLanguage = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];
    if (!activeAsrModel) throw new Error("Enter a Hugging Face model ID.");
    const result = await transcribeLocally(source.asset.path, activeAsrModel, selectedLanguage.whisper, onModelProgress);
    addCaptions(result.segments, source.clip);
  });

  const cloudTranscribe = () => run(async () => {
    const source = getCaptionInput();
    if (!source) throw new Error("Select a video clip on the timeline or choose imported media.");
    const result = await transcribeAudio(baseUrl, apiKey, asrModel, source.asset.path, language);
    addCaptions(result.segments, source.clip);
  });

  const localSpeak = () => run(async () => {
    if (!speechText.trim()) throw new Error("Write text to turn into speech.");
    const activeTtsModel = ttsModel === "supertonic"
      ? "onnx-community/Supertonic-TTS-ONNX"
      : ttsModel === "custom" ? customTtsModel.trim() : MMS_TTS_MODELS[language];
    if (!activeTtsModel) throw new Error("Enter a Hugging Face model ID.");
    const path = await synthesizeLocally(speechText.trim(), activeTtsModel, voice, onModelProgress);
    await addAudioFile(path);
    setSpeechText("");
    toast("Local speech added to the timeline.", "success");
  });

  const cloudSpeak = () => run(async () => {
    if (!speechText.trim()) throw new Error("Write text to turn into speech.");
    const path = await synthesizeSpeech(baseUrl, apiKey, speechModel, cloudVoice, speechText.trim(), language);
    await addAudioFile(path);
    setSpeechText("");
    toast("Generated speech added to the timeline.", "success");
  });

  const removeBackground = () => run(async () => {
    const source = images.find((asset) => asset.id === imageId);
    if (!source) throw new Error("Choose an image first.");
    const file = await readMediaForAi(source.path);
    const bytes = Uint8Array.from(atob(file.dataBase64), (character) => character.charCodeAt(0));
    const activeModel = backgroundModel === "custom" ? customBackgroundModel.trim() : backgroundModel;
    if (!activeModel) throw new Error("Enter a Hugging Face model ID.");
    const cutout = await removeImageBackground(new Blob([bytes], { type: file.mimeType }), activeModel, onModelProgress);
    const path = await saveLocalImage(cutout);
    await addImageFile(path);
    toast("Transparent cutout added to the timeline.", "success");
  });

  return <Modal open={open} onClose={onClose} title="AI tools" description="Local models are the default. Hugging Face downloads and caches a model automatically the first time you use it." width={650}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-soft bg-surface-2/50 p-1" role="tablist" aria-label="AI provider">
        <button role="tab" aria-selected={workspace === "local"} className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[11px] ${workspace === "local" ? "bg-raised text-ink" : "text-muted"}`} onClick={() => setWorkspace("local")}><Sparkles size={14} /> Local · private</button>
        <button role="tab" aria-selected={workspace === "cloud"} className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[11px] ${workspace === "cloud" ? "bg-raised text-ink" : "text-muted"}`} onClick={() => setWorkspace("cloud")}><Wifi size={14} /> Cloud · BYOK</button>
      </div>

      {workspace === "local" ? <>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Local AI tools">
          {([ ["captions", Captions, "Captions"], ["speech", AudioLines, "Text to speech"], ["background", Image, "Background remover"] ] as const).map(([id, Icon, title]) => <button key={id} role="tab" aria-selected={localTool === id} className={`btn btn-sm ${localTool === id ? "btn-secondary" : "btn-ghost"}`} onClick={() => setLocalTool(id)}><Icon size={13} />{title}</button>)}
        </div>
        <div className="rounded-lg border border-line-soft bg-surface-2/35 p-3 text-[10px] leading-relaxed text-muted">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-ink"><HardDrive size={13} className="text-accent" /> Offline model bundles</div>
            <button className="btn btn-sm btn-ghost" onClick={() => void refreshOfflineModels()} disabled={checkingModels} title="Rescan the local model folder">{checkingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh</button>
          </div>
          <p className="mt-1.5">
            {offlineStatus
              ? offlineStatus.available
                ? `${offlineStatus.models.length} model${offlineStatus.models.length === 1 ? "" : "s"} installed. Local copies load without a download.`
                : "No models installed yet. Models download on first use, or you can copy model folders into the models directory."
              : "Could not read the local model folder. Models still download and cache on first use."}
          </p>
          {offlineStatus?.models.length ? <p className="mt-1 truncate font-mono text-[9px] text-dim" title={offlineStatus.models.join("\n")}>{offlineStatus.models.slice(0, 3).join(" · ")}{offlineStatus.models.length > 3 ? ` · +${offlineStatus.models.length - 3} more` : ""}</p> : null}
          <p className="mt-1 break-all font-mono text-[9px] text-dim">{offlineStatus?.root ?? ""}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button className="btn btn-sm btn-secondary" onClick={() => void openModelsFolder()}><FolderOpen size={12} /> Open models folder</button>
            <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted" title="Refuse to download models that are missing from the local folder">
              <input type="checkbox" checked={strictOffline} onChange={(event) => void toggleStrictOffline(event.target.checked)} /> Strict offline
            </label>
          </div>
          {strictOffline && offlineStatus && !offlineStatus.available ? <p className="mt-1.5 text-error">Strict offline is on, but no bundled models were found. Add models before using a local tool.</p> : null}
        </div>

        {localTool === "captions" ? <div className="space-y-3">
          <label className="block"><span className="label">Transcription source</span><select className="field" value={activeCaptionSource} onChange={(event) => setCaptionSource(event.target.value as CaptionSource)}><option value="timeline" disabled={!timelineVideo}>{timelineVideo ? `Selected timeline video · ${timelineVideo.clip.name}` : "Select a video clip on the timeline first"}</option><option value="asset">Imported media</option></select></label>
          {activeCaptionSource === "asset" ? <label className="block"><span className="label">Audio or video file</span><select className="field" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose imported media</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label> : null}
          <label className="block"><span className="label">Language</span><select className="field" value={language} onChange={(event) => changeLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label className="block"><span className="label">Local transcription model</span><select className="field" value={asrModelChoice} onChange={(event) => setAsrModelChoice(event.target.value)}><option value="Xenova/whisper-small">Whisper Small · multilingual · recommended</option><option value="Xenova/whisper-base">Whisper Base · smaller download</option><option value="Xenova/whisper-tiny">Whisper Tiny · fastest setup</option><option value="custom">Custom Hugging Face model…</option></select></label>
          {asrModelChoice === "custom" ? <label className="block"><span className="label">Hugging Face model ID</span><input className="field" value={customAsrModel} onChange={(event) => setCustomAsrModel(event.target.value)} placeholder="organization/model-name" /></label> : null}
          <p className="text-[10px] leading-relaxed text-dim">Whisper runs on your PC using CPU/WASM. It downloads when you start transcription, returns timed segments, and places editable caption clips on the timeline.</p>
          <button className="btn btn-primary w-full" disabled={busy || (activeCaptionSource === "timeline" ? !timelineVideo : !assets.length || !sourceId) || !activeAsrModel} onClick={() => void localTranscribe()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Captions size={14} />} Transcribe locally</button>
        </div> : null}

        {localTool === "speech" ? <div className="space-y-3">
          <label className="block"><span className="label">Language</span><select className="field" value={language} onChange={(event) => changeLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label className="block"><span className="label">Local speech model</span><select className="field" value={ttsModel} onChange={(event) => setTtsModel(event.target.value as "mms" | "supertonic" | "custom")}><option value="mms">MMS · follows selected language · recommended</option><option value="supertonic" disabled={language !== "en"}>Supertonic · English · multiple voices</option><option value="custom">Custom Hugging Face model…</option></select></label>
          {ttsModel === "custom" ? <label className="block"><span className="label">Hugging Face model ID</span><input className="field" value={customTtsModel} onChange={(event) => setCustomTtsModel(event.target.value)} placeholder="organization/model-name" /></label> : null}
          {ttsModel === "supertonic" && language === "en" ? <label className="block"><span className="label">Voice</span><select className="field" value={voice} onChange={(event) => setVoice(event.target.value)}>{[["F1", "Female 1"], ["F2", "Female 2"], ["M1", "Male 1"], ["M2", "Male 2"]].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label> : null}
          <label className="block"><span className="label">Text</span><textarea className="field min-h-28 resize-y" value={speechText} onChange={(event) => setSpeechText(event.target.value)} placeholder="Type what you want spoken…" /></label>
          <p className="text-[10px] leading-relaxed text-dim">The selected model downloads automatically the first time you generate speech. MMS provides English, Spanish, Portuguese, and French voices. Supertonic offers four English voices.</p>
          <button className="btn btn-primary w-full" disabled={busy || !speechText.trim() || (ttsModel === "custom" && !customTtsModel.trim())} onClick={() => void localSpeak()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <AudioLines size={14} />} Generate locally</button>
        </div> : null}

        {localTool === "background" ? <div className="space-y-3">
          <label className="block"><span className="label">Image</span><select className="field" value={imageId} onChange={(event) => setImageId(event.target.value)}><option value="">Choose an imported image</option>{images.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>
          <label className="block"><span className="label">Background removal model</span><select className="field" value={backgroundModel} onChange={(event) => setBackgroundModel(event.target.value)}><option value="Xenova/modnet">MODNet · recommended</option><option value="custom">Custom Hugging Face model…</option></select></label>
          {backgroundModel === "custom" ? <label className="block"><span className="label">Hugging Face model ID</span><input className="field" value={customBackgroundModel} onChange={(event) => setCustomBackgroundModel(event.target.value)} placeholder="organization/model-name" /></label> : null}
          <p className="text-[10px] leading-relaxed text-dim">MODNet creates a transparent PNG cutout on your PC. The model downloads once on first use. For video clips, use the separate chroma key controls in Inspector → Masks.</p>
          <p className="text-[10px] leading-relaxed text-dim">Custom models must support the Transformers.js background-removal task.</p>
          <button className="btn btn-primary w-full" disabled={busy || !images.length || (backgroundModel === "custom" && !customBackgroundModel.trim())} onClick={() => void removeBackground()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />} Remove image background</button>
        </div> : null}
      </> : <>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-soft bg-surface-2/50 p-1" role="tablist" aria-label="Cloud AI tools">
          <button role="tab" aria-selected={cloudTool === "captions"} className={`rounded-md px-3 py-2 text-[11px] ${cloudTool === "captions" ? "bg-raised text-ink" : "text-muted"}`} onClick={() => setCloudTool("captions")}>Transcribe captions</button>
          <button role="tab" aria-selected={cloudTool === "speech"} className={`rounded-md px-3 py-2 text-[11px] ${cloudTool === "speech" ? "bg-raised text-ink" : "text-muted"}`} onClick={() => setCloudTool("speech")}>Text to speech</button>
        </div>
        <label className="block"><span className="label">Provider endpoint</span><input className="field" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label>
        <label className="block"><span className="label">API key <span className="font-normal normal-case text-dim">(kept in memory)</span></span><input className="field" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Required for cloud providers" /></label>
        {cloudTool === "captions" ? <div className="space-y-3">
          <label className="block"><span className="label">Transcription source</span><select className="field" value={activeCaptionSource} onChange={(event) => setCaptionSource(event.target.value as CaptionSource)}><option value="timeline" disabled={!timelineVideo}>{timelineVideo ? `Selected timeline video · ${timelineVideo.clip.name}` : "Select a video clip on the timeline first"}</option><option value="asset">Imported media</option></select></label>
          {activeCaptionSource === "asset" ? <label className="block"><span className="label">Audio or video file</span><select className="field" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose imported media</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label> : null}
          <label className="block"><span className="label">Language</span><select className="field" value={language} onChange={(event) => changeLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label className="block"><span className="label">Model ID</span><input className="field" value={asrModel} onChange={(event) => setAsrModel(event.target.value)} /></label>
          <button className="btn btn-primary w-full" disabled={busy || (activeCaptionSource === "timeline" ? !timelineVideo : !assets.length || !sourceId)} onClick={() => void cloudTranscribe()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} Transcribe with cloud</button>
        </div> : <div className="space-y-3">
          <label className="block"><span className="label">Speech model</span><input className="field" value={speechModel} onChange={(event) => setSpeechModel(event.target.value)} /></label>
          <label className="block"><span className="label">Voice</span><input className="field" value={cloudVoice} onChange={(event) => setCloudVoice(event.target.value)} /></label>
          <label className="block"><span className="label">Language</span><select className="field" value={language} onChange={(event) => setLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label className="block"><span className="label">Text</span><textarea className="field min-h-28 resize-y" value={speechText} onChange={(event) => setSpeechText(event.target.value)} placeholder="Type what you want spoken…" /></label>
          <button className="btn btn-primary w-full" disabled={busy || !speechText.trim()} onClick={() => void cloudSpeak()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} Generate with cloud</button>
        </div>}
        <p className="text-[10px] leading-relaxed text-dim">Cloud requests send the selected media or text to the endpoint you entered. The API key is not saved in the project.</p>
      </>}

      {busy ? <div className="flex items-center justify-between gap-3 rounded-md border border-line-soft bg-surface-2/50 px-3 py-2 text-[10px] text-muted"><span className="truncate">{progressText(progress) || "Working locally…"}</span>{typeof progress?.progress === "number" ? <span className="font-mono tabular-nums">{Math.round(progress.progress)}%</span> : <Loader2 size={12} className="animate-spin text-accent" />}</div> : null}
    </div>
  </Modal>;
}
