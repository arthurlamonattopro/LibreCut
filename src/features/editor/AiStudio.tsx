import { useEffect, useMemo, useState } from "react";
import { AudioLines, Captions, FolderOpen, HardDrive, Image, Loader2, RefreshCw, Sparkles, Wifi } from "lucide-react";
import { Modal } from "../../components/Modal";
import { toast } from "../../components/Toast";
import { TabList, TabPanel } from "../../components/TabList";
import { generateThumbnails, generateWaveform, openFolder, readMediaForAi, registerMedia, synthesizeSpeech, transcribeAudio } from "../../lib/media";
import { removeImageBackground, saveLocalImage, synthesizeLocally, transcribeLocally, type ModelProgress } from "../../lib/localAi";
import { ensureModelsFolder, getOfflineModelStatus, isStrictOffline, setStrictOffline, type OfflineModelStatus } from "../../lib/offlineModels";
import { useEditor } from "../../stores/editor";
import { t as translate, useT } from "../../lib/i18n";
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
  const file = progress.file ?? progress.name ?? translate("model files");
  if (progress.status === "progress_total") return translate("Downloading {file} · {percent}%", { file, percent: Math.round(progress.progress ?? 0) });
  if (progress.status === "download") return translate("Downloading {file}…", { file: progress.file ?? translate("model files") });
  if (progress.status === "ready") return translate("Loaded {file} · loading remaining files…", { file: progress.file ?? translate("a model file") });
  if (progress.status === "done") return translate("Loaded {file}", { file: progress.file ?? translate("a model file") });
  if (progress.status === "inference") return translate("Generating speech locally…");
  if (progress.status === "saving") return translate("Saving generated audio…");
  return translate("Preparing local model…");
}

export function AiStudio({ open, onClose, initialTool, initialImageId }: { open: boolean; onClose: () => void; initialTool?: AiStudioTool; initialImageId?: string }) {
  const t = useT();
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
    toast(next ? t("Strict offline mode enabled. Missing models will not be downloaded.") : t("Strict offline mode disabled. Missing models can download on first use."), "success");
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
    if (!segments.length) { toast(t("No timed speech segments were found."), "error"); return; }
    const state = useEditor.getState();
    const duration = Math.max(0.01, clip?.speed ?? 1);
    const visible = clip ? segments.map((segment) => {
      const mediaStart = Math.max(segment.start, clip.trimIn);
      const mediaEnd = Math.min(segment.end, clip.trimIn + clip.duration * duration);
      return { ...segment, start: clip.start + (mediaStart - clip.trimIn) / duration, end: clip.start + (mediaEnd - clip.trimIn) / duration };
    }).filter((segment) => segment.end > segment.start) : segments;
    if (!visible.length) { toast(t("No speech was found in the visible part of this timeline clip."), "error"); return; }
    for (const segment of visible) {
      state.addTextClip(segment.text, segment.start);
      const id = useEditor.getState().selectedClipId;
      if (id) useEditor.getState().updateClip(id, { duration: Math.max(0.1, segment.end - segment.start) });
    }
    toast(t("Added {count} caption segments to the timeline.", { count: visible.length }), "success");
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
      id: crypto.randomUUID(), name: t("Background removed · {name}", { name: registered.info.name }), path, mediaId: registered.id, previewMediaId: registered.id,
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
    if (!source) throw new Error(t("Select a video clip on the timeline or choose imported media."));
    const selectedLanguage = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];
    if (!activeAsrModel) throw new Error(t("Enter a Hugging Face model ID."));
    const result = await transcribeLocally(source.asset.path, activeAsrModel, selectedLanguage.whisper, onModelProgress);
    addCaptions(result.segments, source.clip);
  });

  const cloudTranscribe = () => run(async () => {
    const source = getCaptionInput();
    if (!source) throw new Error(t("Select a video clip on the timeline or choose imported media."));
    const result = await transcribeAudio(baseUrl, apiKey, asrModel, source.asset.path, language);
    addCaptions(result.segments, source.clip);
  });

  const localSpeak = () => run(async () => {
    if (!speechText.trim()) throw new Error(t("Write text to turn into speech."));
    const activeTtsModel = ttsModel === "supertonic"
      ? "onnx-community/Supertonic-TTS-ONNX"
      : ttsModel === "custom" ? customTtsModel.trim() : MMS_TTS_MODELS[language];
    if (!activeTtsModel) throw new Error(t("Enter a Hugging Face model ID."));
    const path = await synthesizeLocally(speechText.trim(), activeTtsModel, voice, onModelProgress);
    await addAudioFile(path);
    setSpeechText("");
    toast(t("Local speech added to the timeline."), "success");
  });

  const cloudSpeak = () => run(async () => {
    if (!speechText.trim()) throw new Error(t("Write text to turn into speech."));
    const path = await synthesizeSpeech(baseUrl, apiKey, speechModel, cloudVoice, speechText.trim(), language);
    await addAudioFile(path);
    setSpeechText("");
    toast(t("Generated speech added to the timeline."), "success");
  });

  const removeBackground = () => run(async () => {
    const source = images.find((asset) => asset.id === imageId);
    if (!source) throw new Error(t("Choose an image first."));
    const file = await readMediaForAi(source.path);
    const bytes = Uint8Array.from(atob(file.dataBase64), (character) => character.charCodeAt(0));
    const activeModel = backgroundModel === "custom" ? customBackgroundModel.trim() : backgroundModel;
    if (!activeModel) throw new Error(t("Enter a Hugging Face model ID."));
    const cutout = await removeImageBackground(new Blob([bytes], { type: file.mimeType }), activeModel, onModelProgress);
    const path = await saveLocalImage(cutout);
    await addImageFile(path);
    toast(t("Transparent cutout added to the timeline."), "success");
  });

  return <Modal open={open} onClose={onClose} title={t("AI tools")} description={t("Local models are the default. Hugging Face downloads and caches a model automatically the first time you use it.")} width={650}>
    <div className="space-y-4">
      <TabList
        tabs={["local", "cloud"]}
        active={workspace}
        onChange={(next) => setWorkspace(next as Workspace)}
        label={t("AI provider")}
        idPrefix="ai"
        className="grid grid-cols-2 gap-1 rounded-lg border border-line-soft bg-surface-2/50 p-1"
        tabClassName={(active) => `flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[11px] ${active ? "bg-raised text-ink" : "text-muted"}`}
        renderTab={(name) => name === "local"
          ? <><Sparkles size={14} aria-hidden="true" /> {t("Local · private")}</>
          : <><Wifi size={14} aria-hidden="true" /> {t("Cloud · BYOK")}</>}
      />

      {workspace === "local" ? <TabPanel id="ai-panel-local" tabId="ai-tab-local">
        <>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Local AI tools")}>
          {([ ["captions", Captions, "Captions"], ["speech", AudioLines, "Text to speech"], ["background", Image, "Background remover"] ] as const).map(([id, Icon, title]) => <button key={id} aria-pressed={localTool === id} className={`btn btn-sm ${localTool === id ? "btn-secondary" : "btn-ghost"}`} onClick={() => setLocalTool(id)}><Icon size={13} aria-hidden="true" />{t(title)}</button>)}
        </div>
        <div className="rounded-lg border border-line-soft bg-surface-2/35 p-3 text-[10px] leading-relaxed text-muted">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-ink"><HardDrive size={13} className="text-accent" /> {t("Offline model bundles")}</div>
            <button className="btn btn-sm btn-ghost" onClick={() => void refreshOfflineModels()} disabled={checkingModels} title={t("Rescan the local model folder")}>{checkingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {t("Refresh")}</button>
          </div>
          <p className="mt-1.5">
            {offlineStatus
              ? offlineStatus.available
                ? t(offlineStatus.models.length === 1 ? "{count} model installed. Local copies load without a download." : "{count} models installed. Local copies load without a download.", { count: offlineStatus.models.length })
                : t("No models installed yet. Models download on first use, or you can copy model folders into the models directory.")
              : t("Could not read the local model folder. Models still download and cache on first use.")}
          </p>
          {offlineStatus?.models.length ? <p className="mt-1 truncate font-mono text-[9px] text-dim" title={offlineStatus.models.join("\n")}>{offlineStatus.models.slice(0, 3).join(" · ")}{offlineStatus.models.length > 3 ? t(" · +{count} more", { count: offlineStatus.models.length - 3 }) : ""}</p> : null}
          <p className="mt-1 break-all font-mono text-[9px] text-dim">{offlineStatus?.root ?? ""}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button className="btn btn-sm btn-secondary" onClick={() => void openModelsFolder()}><FolderOpen size={12} /> {t("Open models folder")}</button>
            <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted" title={t("Refuse to download models that are missing from the local folder")}>
              <input type="checkbox" checked={strictOffline} onChange={(event) => void toggleStrictOffline(event.target.checked)} /> {t("Strict offline")}
            </label>
          </div>
          {strictOffline && offlineStatus && !offlineStatus.available ? <p className="mt-1.5 text-error">{t("Strict offline is on, but no bundled models were found. Add models before using a local tool.")}</p> : null}
        </div>

        {localTool === "captions" ? <div className="space-y-3">
          <label className="block"><span className="label">{t("Transcription source")}</span><select className="field" value={activeCaptionSource} onChange={(event) => setCaptionSource(event.target.value as CaptionSource)}><option value="timeline" disabled={!timelineVideo}>{timelineVideo ? t("Selected timeline video · {name}", { name: timelineVideo.clip.name }) : t("Select a video clip on the timeline first")}</option><option value="asset">{t("Imported media")}</option></select></label>
          {activeCaptionSource === "asset" ? <label className="block"><span className="label">{t("Audio or video file")}</span><select className="field" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">{t("Choose imported media")}</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label> : null}
          <label className="block"><span className="label">{t("Language")}</span><select className="field" value={language} onChange={(event) => changeLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{t(item.label)}</option>)}</select></label>
          <label className="block"><span className="label">{t("Local transcription model")}</span><select className="field" value={asrModelChoice} onChange={(event) => setAsrModelChoice(event.target.value)}><option value="Xenova/whisper-small">{t("Whisper Small · multilingual · recommended")}</option><option value="Xenova/whisper-base">{t("Whisper Base · smaller download")}</option><option value="Xenova/whisper-tiny">{t("Whisper Tiny · fastest setup")}</option><option value="custom">{t("Custom Hugging Face model…")}</option></select></label>
          {asrModelChoice === "custom" ? <label className="block"><span className="label">{t("Hugging Face model ID")}</span><input className="field" value={customAsrModel} onChange={(event) => setCustomAsrModel(event.target.value)} placeholder="organization/model-name" /></label> : null}
          <p className="text-[10px] leading-relaxed text-dim">{t("Whisper runs on your PC using CPU/WASM. It downloads when you start transcription, returns timed segments, and places editable caption clips on the timeline.")}</p>
          <button className="btn btn-primary w-full" disabled={busy || (activeCaptionSource === "timeline" ? !timelineVideo : !assets.length || !sourceId) || !activeAsrModel} onClick={() => void localTranscribe()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Captions size={14} />} {t("Transcribe locally")}</button>
        </div> : null}

        {localTool === "speech" ? <div className="space-y-3">
          <label className="block"><span className="label">{t("Language")}</span><select className="field" value={language} onChange={(event) => changeLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{t(item.label)}</option>)}</select></label>
          <label className="block"><span className="label">{t("Local speech model")}</span><select className="field" value={ttsModel} onChange={(event) => setTtsModel(event.target.value as "mms" | "supertonic" | "custom")}><option value="mms">{t("MMS · follows selected language · recommended")}</option><option value="supertonic" disabled={language !== "en"}>{t("Supertonic · English · multiple voices")}</option><option value="custom">{t("Custom Hugging Face model…")}</option></select></label>
          {ttsModel === "custom" ? <label className="block"><span className="label">{t("Hugging Face model ID")}</span><input className="field" value={customTtsModel} onChange={(event) => setCustomTtsModel(event.target.value)} placeholder="organization/model-name" /></label> : null}
          {ttsModel === "supertonic" && language === "en" ? <label className="block"><span className="label">{t("Voice")}</span><select className="field" value={voice} onChange={(event) => setVoice(event.target.value)}>{[["F1", "Female 1"], ["F2", "Female 2"], ["M1", "Male 1"], ["M2", "Male 2"]].map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select></label> : null}
          <label className="block"><span className="label">{t("Text")}</span><textarea className="field min-h-28 resize-y" value={speechText} onChange={(event) => setSpeechText(event.target.value)} placeholder={t("Type what you want spoken…")} /></label>
          <p className="text-[10px] leading-relaxed text-dim">{t("The selected model downloads automatically the first time you generate speech. MMS provides English, Spanish, Portuguese, and French voices. Supertonic offers four English voices.")}</p>
          <button className="btn btn-primary w-full" disabled={busy || !speechText.trim() || (ttsModel === "custom" && !customTtsModel.trim())} onClick={() => void localSpeak()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <AudioLines size={14} aria-hidden="true" />} {t("Generate locally")}</button>
        </div> : null}

        {localTool === "background" ? <div className="space-y-3">
          <label className="block"><span className="label">{t("Image")}</span><select className="field" value={imageId} onChange={(event) => setImageId(event.target.value)}><option value="">{t("Choose an imported image")}</option>{images.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>
          <label className="block"><span className="label">{t("Background removal model")}</span><select className="field" value={backgroundModel} onChange={(event) => setBackgroundModel(event.target.value)}><option value="Xenova/modnet">{t("MODNet · recommended")}</option><option value="custom">{t("Custom Hugging Face model…")}</option></select></label>
          {backgroundModel === "custom" ? <label className="block"><span className="label">{t("Hugging Face model ID")}</span><input className="field" value={customBackgroundModel} onChange={(event) => setCustomBackgroundModel(event.target.value)} placeholder="organization/model-name" /></label> : null}
          <p className="text-[10px] leading-relaxed text-dim">{t("MODNet creates a transparent PNG cutout on your PC. The model downloads once on first use. For video clips, use the separate chroma key controls in Inspector → Masks.")}</p>
          <p className="text-[10px] leading-relaxed text-dim">{t("Custom models must support the Transformers.js background-removal task.")}</p>
          <button className="btn btn-primary w-full" disabled={busy || !images.length || (backgroundModel === "custom" && !customBackgroundModel.trim())} onClick={() => void removeBackground()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Image size={14} aria-hidden="true" />} {t("Remove image background")}</button>
        </div> : null}
      </>
      </TabPanel> : <TabPanel id="ai-panel-cloud" tabId="ai-tab-cloud">
        <>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-soft bg-surface-2/50 p-1" role="group" aria-label={t("Cloud AI tools")}>
          <button aria-pressed={cloudTool === "captions"} className={`rounded-md px-3 py-2 text-[11px] ${cloudTool === "captions" ? "bg-raised text-ink" : "text-muted"}`} onClick={() => setCloudTool("captions")}>{t("Transcribe captions")}</button>
          <button aria-pressed={cloudTool === "speech"} className={`rounded-md px-3 py-2 text-[11px] ${cloudTool === "speech" ? "bg-raised text-ink" : "text-muted"}`} onClick={() => setCloudTool("speech")}>{t("Text to speech")}</button>
        </div>
        <label className="block"><span className="label">{t("Provider endpoint")}</span><input className="field" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label>
        <label className="block"><span className="label">{t("API key")} <span className="font-normal normal-case text-dim">{t("(kept in memory)")}</span></span><input className="field" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("Required for cloud providers")} /></label>
        {cloudTool === "captions" ? <div className="space-y-3">
          <label className="block"><span className="label">{t("Transcription source")}</span><select className="field" value={activeCaptionSource} onChange={(event) => setCaptionSource(event.target.value as CaptionSource)}><option value="timeline" disabled={!timelineVideo}>{timelineVideo ? t("Selected timeline video · {name}", { name: timelineVideo.clip.name }) : t("Select a video clip on the timeline first")}</option><option value="asset">{t("Imported media")}</option></select></label>
          {activeCaptionSource === "asset" ? <label className="block"><span className="label">{t("Audio or video file")}</span><select className="field" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">{t("Choose imported media")}</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label> : null}
          <label className="block"><span className="label">{t("Language")}</span><select className="field" value={language} onChange={(event) => changeLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{t(item.label)}</option>)}</select></label>
          <label className="block"><span className="label">{t("Model ID")}</span><input className="field" value={asrModel} onChange={(event) => setAsrModel(event.target.value)} /></label>
          <button className="btn btn-primary w-full" disabled={busy || (activeCaptionSource === "timeline" ? !timelineVideo : !assets.length || !sourceId)} onClick={() => void cloudTranscribe()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wifi size={14} aria-hidden="true" />} {t("Transcribe with cloud")}</button>
        </div> : <div className="space-y-3">
          <label className="block"><span className="label">{t("Speech model")}</span><input className="field" value={speechModel} onChange={(event) => setSpeechModel(event.target.value)} /></label>
          <label className="block"><span className="label">{t("Voice")}</span><input className="field" value={cloudVoice} onChange={(event) => setCloudVoice(event.target.value)} /></label>
          <label className="block"><span className="label">{t("Language")}</span><select className="field" value={language} onChange={(event) => setLanguage(event.target.value)}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{t(item.label)}</option>)}</select></label>
          <label className="block"><span className="label">{t("Text")}</span><textarea className="field min-h-28 resize-y" value={speechText} onChange={(event) => setSpeechText(event.target.value)} placeholder={t("Type what you want spoken…")} /></label>
          <button className="btn btn-primary w-full" disabled={busy || !speechText.trim()} onClick={() => void cloudSpeak()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wifi size={14} aria-hidden="true" />} {t("Generate with cloud")}</button>
        </div>}
        <p className="text-[10px] leading-relaxed text-dim">{t("Cloud requests send the selected media or text to the endpoint you entered. The API key is not saved in the project.")}</p>
      </>
      </TabPanel>}

      {busy ? <div role="status" aria-live="polite" className="flex items-center justify-between gap-3 rounded-md border border-line-soft bg-surface-2/50 px-3 py-2 text-[10px] text-muted"><span className="truncate">{progressText(progress) || t("Working locally…")}</span>{typeof progress?.progress === "number" ? <span className="font-mono tabular-nums">{Math.round(progress.progress)}%</span> : <Loader2 size={12} className="animate-spin text-accent" aria-hidden="true" />}</div> : null}
    </div>
  </Modal>;
}
