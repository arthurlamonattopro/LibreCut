import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Music2,
  PackagePlus,
  Plus,
  Power,
  Puzzle,
  Search,
  SlidersHorizontal,
  Trash2,
  Type,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEditor } from "../../stores/editor";
import { mediaUrl, removeProxyCache } from "../../lib/media";
import { formatDuration } from "../../lib/time";
import { EFFECT_PLUGIN_TEMPLATE, loadEffectPacks, parseEffectPack, saveEffectPacks, type EffectPackCategory, type InstalledEffectPack, type PluginEffectValues, type PluginTextValues } from "../../lib/plugins";
import { Waveform } from "../../components/Waveform";
import { toast } from "../../components/Toast";
import { TabList, TabPanel } from "../../components/TabList";
import { announce } from "../../lib/announce";
import { t, useT } from "../../lib/i18n";
import { useMediaImport } from "./useMediaImport";
import type { Asset } from "../../lib/types";

type Tab = "media" | "text" | "audio" | "effects" | "plugins";
type EffectCategory = "All" | EffectPackCategory | "Plugin";
type DragPreview = { asset: Asset; x: number; y: number } | null;

const TABS = ["media", "text", "audio", "effects", "plugins"] as const;
const TAB_LABELS: Record<Tab, string> = {
  media: "Media",
  text: "Text",
  audio: "Audio",
  effects: "Effects",
  plugins: "Plugins",
};
const TAB_ICONS: Record<Tab, typeof Film> = {
  media: Film,
  text: Type,
  audio: Music2,
  effects: SlidersHorizontal,
  plugins: Puzzle,
};

const EFFECT_CATEGORIES: EffectCategory[] = ["All", "Color", "Vintage", "Cinematic", "Dream", "Basic", "Plugin"];
type EffectPreset = { name: string; category: Exclude<EffectCategory, "All">; values: PluginEffectValues; pluginName?: string; pluginId?: string };

const EFFECTS: EffectPreset[] = [
  { name: "Brighten", category: "Basic", values: { brightness: 0.18 } },
  { name: "Darken", category: "Basic", values: { brightness: -0.18, contrast: 1.08 } },
  { name: "Blur", category: "Basic", values: { blur: 6 } },
  { name: "Vignette", category: "Basic", values: { vignette: 0.62 } },
  { name: "Fade in", category: "Basic", values: { fadeIn: 1.2 } },
  { name: "Fade out", category: "Basic", values: { fadeOut: 1.2 } },
  { name: "Motion blur", category: "Basic", values: { motionBlur: 0.65 } },
  { name: "High contrast", category: "Basic", values: { contrast: 1.45, saturation: 1.08 } },
  { name: "Soft contrast", category: "Basic", values: { contrast: 0.82, brightness: 0.04 } },
  { name: "Soft focus", category: "Basic", values: { blur: 1.1, contrast: 0.96 } },
  { name: "Vibrant", category: "Color", values: { saturation: 1.55, contrast: 1.08 } },
  { name: "Muted", category: "Color", values: { saturation: 0.58, contrast: 0.96 } },
  { name: "Black & white", category: "Color", values: { saturation: 0, contrast: 1.05 } },
  { name: "Warm", category: "Color", values: { brightness: 0.03, saturation: 1.15, hue: -8, sepia: 0.12 } },
  { name: "Cool", category: "Color", values: { brightness: 0.02, contrast: 1.08, saturation: 0.92, hue: 14 } },
  { name: "Sunset", category: "Color", values: { brightness: 0.05, saturation: 1.32, hue: -18, sepia: 0.2 } },
  { name: "Arctic", category: "Color", values: { brightness: 0.04, contrast: 1.12, saturation: 0.82, hue: 28 } },
  { name: "Teal & orange", category: "Color", values: { contrast: 1.2, saturation: 1.18, hue: -12, sepia: 0.12 } },
  { name: "Rose", category: "Color", values: { brightness: 0.04, saturation: 1.12, hue: -24, sepia: 0.16 } },
  { name: "Purple haze", category: "Color", values: { brightness: 0.04, saturation: 1.12, hue: 48, sepia: 0.08 } },
  { name: "Vintage", category: "Vintage", values: { brightness: -0.04, contrast: 0.92, saturation: 0.78, hue: -5, sepia: 0.42, blur: 0.25 } },
  { name: "Sepia", category: "Vintage", values: { saturation: 0.82, sepia: 0.85 } },
  { name: "Film fade", category: "Vintage", values: { brightness: 0.07, contrast: 0.78, saturation: 0.8, sepia: 0.16 } },
  { name: "Noir", category: "Vintage", values: { contrast: 1.35, saturation: 0, brightness: -0.05 } },
  { name: "Bleach bypass", category: "Cinematic", values: { contrast: 1.35, saturation: 0.42, brightness: -0.03 } },
  { name: "Cinematic", category: "Cinematic", values: { contrast: 1.16, saturation: 0.84, hue: -4, sepia: 0.06 } },
  { name: "Golden hour", category: "Cinematic", values: { brightness: 0.07, contrast: 1.08, saturation: 1.22, hue: -12, sepia: 0.22 } },
  { name: "Blue hour", category: "Cinematic", values: { brightness: -0.04, contrast: 1.12, saturation: 0.9, hue: 24 } },
  { name: "Dream", category: "Dream", values: { brightness: 0.08, contrast: 0.9, saturation: 1.1, sepia: 0.08, blur: 1.2 } },
  { name: "Haze", category: "Dream", values: { brightness: 0.12, contrast: 0.76, saturation: 0.92, blur: 0.7 } },
  { name: "Pastel", category: "Dream", values: { brightness: 0.12, contrast: 0.82, saturation: 0.75 } },
  { name: "Glow", category: "Dream", values: { brightness: 0.08, contrast: 0.9, blur: 2.1 } },
];

const TEXT_PRESETS: Array<{ label: string; sample: string; size: string; values?: PluginTextValues; pluginName?: string }> = [
  { label: "Title", sample: "YOUR STORY", size: "text-[17px] font-black tracking-[-0.03em]" },
  { label: "Subtitle", sample: "A new perspective", size: "text-[13px] font-semibold" },
  { label: "Caption", sample: "Add a caption", size: "text-[12px] font-medium text-white/80" },
];

export function MediaPanel({ width = 256, onOpenAi }: { width?: number; onOpenAi: (tool: "speech" | "background", imageId?: string) => void }) {
  const t = useT();
  const project = useEditor((state) => state.project);
  const addClip = useEditor((state) => state.addClip);
  const addEffectClip = useEditor((state) => state.addEffectClip);
  const addTextClip = useEditor((state) => state.addTextClip);
  const importSubtitleCues = useEditor((state) => state.importSubtitleCues);
  const { importFromDialog, importing, fileDragOver, retryProxy } = useMediaImport();
  const [tab, setTab] = useState<Tab>("media");
  const [query, setQuery] = useState("");
  const [effectQuery, setEffectQuery] = useState("");
  const [effectCategory, setEffectCategory] = useState<EffectCategory>("All");
  const [plugins, setPlugins] = useState<InstalledEffectPack[]>(loadEffectPacks);
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const pluginFileRef = useRef<HTMLInputElement>(null);
  const subtitleFileRef = useRef<HTMLInputElement>(null);
  // The import counter rises and falls as the files are probed, so the
  // screen reader is told when the work starts and when it is done.
  const importWasRunning = useRef(false);

  useEffect(() => {
    if (importing > 0) {
      importWasRunning.current = true;
      announce(t(importing === 1 ? "Importing {count} file." : "Importing {count} files.", { count: importing }));
    } else if (importWasRunning.current) {
      importWasRunning.current = false;
      announce(t("Import finished."));
    }
  }, [importing, t]);

  const assets = project?.assets ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => !needle || asset.name.toLowerCase().includes(needle));
  }, [assets, query]);

  const audioAssets = filtered.filter((asset) => asset.info.hasAudio && !asset.info.hasVideo);
  const pluginEffects: EffectPreset[] = plugins.filter((plugin) => plugin.enabled).flatMap((plugin) =>
    plugin.manifest.effects.map((effect) => ({ ...effect, category: "Plugin", pluginName: plugin.manifest.name, pluginId: plugin.manifest.id })),
  );
  const pluginTextPresets = plugins.filter((plugin) => plugin.enabled).flatMap((plugin) =>
    (plugin.manifest.textPresets ?? []).map((preset) => ({ label: preset.name, sample: preset.text || preset.name, size: "text-[15px] font-bold", values: preset.values, pluginName: plugin.manifest.name })),
  );
  const allEffects = [...EFFECTS, ...pluginEffects];
  const filteredEffects = allEffects.filter((effect) =>
    (effectCategory === "All" || effect.category === effectCategory) &&
    `${effect.name} ${effect.pluginName ?? ""}`.toLowerCase().includes(effectQuery.trim().toLowerCase()),
  );

  const updatePlugins = (next: InstalledEffectPack[]) => {
    setPlugins(next);
    saveEffectPacks(next);
  };

  const installPluginFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error(t("Effect pack files must be 256 KB or smaller."));
      const manifest = parseEffectPack(JSON.parse(await file.text()) as unknown);
      if (plugins.some((plugin) => plugin.manifest.id === manifest.id)) throw new Error(t("A plugin with this ID is already installed."));
      updatePlugins([...plugins, { manifest, enabled: true }]);
      toast(t("{name} installed. Its effects are in the Effects tab.", { name: manifest.name }), "success");
      setTab("effects");
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Could not install this plugin."), "error");
    } finally {
      if (pluginFileRef.current) pluginFileRef.current.value = "";
    }
  };

  const downloadPlugin = (manifest: object, filename: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <aside style={{ width }} aria-label={t("Media library")} className={`relative flex shrink-0 flex-col border-r border-line-soft bg-panel ${fileDragOver ? "ring-2 ring-inset ring-accent" : ""}`}>
      {fileDragOver ? (
        <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent bg-panel/95 text-center shadow-xl">
          <Upload size={24} className="mb-3 text-accent" aria-hidden="true" />
          <span className="text-sm font-semibold text-ink">{t("Drop to import media")}</span>
          <span className="mt-1 text-[11px] text-muted">{t("Video, audio, or images")}</span>
        </div>
      ) : null}
      {dragPreview ? (
        <div
          className="pointer-events-none fixed z-[100] flex w-48 items-center gap-2 rounded-lg border border-accent/50 bg-panel/95 p-2 shadow-2xl shadow-black/50"
          style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }}
        >
          <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-black/50">
            {dragPreview.asset.thumbnails[0] ? (
              <img src={dragPreview.asset.thumbnails[0]} alt="" className="h-full w-full object-cover" />
            ) : dragPreview.asset.info.isImage ? (
              <img src={mediaUrl(dragPreview.asset.previewMediaId)} alt="" className="h-full w-full object-cover" />
            ) : dragPreview.asset.info.hasAudio && !dragPreview.asset.info.hasVideo ? (
              <Waveform peaks={dragPreview.asset.waveform} height={30} color="#36c8d0aa" />
            ) : (
              <div className="flex h-full items-center justify-center"><Film size={15} className="text-dim" aria-hidden="true" /></div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-ink">{dragPreview.asset.name}</div>
            <div className="text-[9px] uppercase tracking-wide text-accent">{t("Adding to timeline")}</div>
          </div>
        </div>
      ) : null}
      <TabList
        tabs={TABS}
        active={tab}
        onChange={(next) => setTab(next as Tab)}
        label={t("Media library")}
        idPrefix="media"
        className="flex h-11 shrink-0 items-end gap-4 overflow-x-auto border-b border-line-soft px-3"
        tabClassName={() => "tab shrink-0 whitespace-nowrap pb-3 text-[10px]"}
        renderTab={(name) => {
          const Icon = TAB_ICONS[name as Tab];
          return (
            <>
              <Icon size={12} aria-hidden="true" /> {t(TAB_LABELS[name as Tab])}
            </>
          );
        }}
      />

      {tab === "media" ? (
        <TabPanel id="media-panel-media" tabId="media-tab-media">
          <>
            <div className="space-y-2.5 px-3.5 pb-3 pt-3.5">
              <button className="btn btn-secondary w-full" onClick={() => void importFromDialog()} disabled={importing > 0}>
                {importing > 0 ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
                {importing > 0 ? t("Importing {count}…", { count: importing }) : t("Import media")}
              </button>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" aria-hidden="true" />
                <input
                  className="field h-8 pl-7 text-[12px]"
                  placeholder={t("Search media")}
                  aria-label={t("Search media")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4">
              {filtered.length === 0 ? (
                <ImportDropzone onImport={() => void importFromDialog()} empty={assets.length === 0} />
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
                      {t(filtered.length === 1 ? "{count} item" : "{count} items", { count: filtered.length })}
                    </span>
                    <span className="text-[10px] text-dim">{t("Press the add button to place one at the playhead")}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {filtered.map((asset) => (
                      <AssetCard key={asset.id} asset={asset} onAdd={() => addClip(asset.id)} onDragPreview={setDragPreview} onRetryProxy={() => retryProxy(asset)} onRemoveBackground={() => onOpenAi("background", asset.id)} onUseOriginal={() => useEditor.getState().replaceAsset(asset.id, { previewMediaId: asset.mediaId })} onCleanupProxy={async () => {
                        if (!asset.proxyId) return;
                        try { await removeProxyCache(asset.proxyId); useEditor.getState().replaceAsset(asset.id, { proxyId: undefined, previewMediaId: asset.mediaId, proxyStatus: "none" }); toast(t("Cached proxy removed. The original is used for preview."), "success"); }
                        catch (error) { toast(error instanceof Error ? error.message : t("Could not remove the cached proxy."), "error"); }
                      }} />
                    ))}
                  </div>
                  <button
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-[11.5px] text-dim transition hover:border-accent/40 hover:text-ink"
                    onClick={() => void importFromDialog()}
                  >
                    <Plus size={13} aria-hidden="true" /> {t("Import more")}
                  </button>
                </>
              )}
            </div>
          </>
        </TabPanel>
      ) : null}

      {tab === "text" ? (
        <TabPanel id="media-panel-text" tabId="media-tab-text">
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
            <button className="btn btn-secondary mb-3 w-full" onClick={() => onOpenAi("speech")}><AudioLines size={14} aria-hidden="true" /> {t("Text to speech")}</button>
            <input ref={subtitleFileRef} className="hidden" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" aria-label={t("Subtitle file")} onChange={async (event) => {
              const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
              try { const cues = parseSubtitle(await file.text()); if (!cues.length) throw new Error(t("No valid subtitle cues were found.")); importSubtitleCues(cues); toast(t("Imported {count} editable subtitle cues.", { count: cues.length }), "success"); }
              catch (error) { toast(error instanceof Error ? error.message : t("Could not read subtitles."), "error"); }
            }} />
            <div className="mb-3 flex gap-2">
              <button className="btn btn-secondary flex-1" onClick={() => subtitleFileRef.current?.click()}>{t("Import .srt / .vtt")}</button>
              <button className="btn btn-secondary flex-1" onClick={() => downloadSubtitles(project?.tracks.flatMap((track) => track.clips).filter((clip) => clip.subtitleCue && clip.text).map((clip) => ({ start: clip.start, end: clip.start + clip.duration, text: clip.text!.text })) ?? [])}>{t("Export .srt")}</button>
            </div>
            <p className="mb-4 text-[9.5px] leading-relaxed text-dim">{t("Imported cues become text clips on the timeline. Edit their wording, timing, and style like any other text clip.")}</p>
            <button className="btn btn-primary w-full" onClick={() => addTextClip(t("Your text"))}>
              <Plus size={15} aria-hidden="true" /> {t("Add text at playhead")}
            </button>
            <div className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">{t("Presets")}</div>
            <div className="mt-2.5 space-y-2">
              {[...TEXT_PRESETS, ...pluginTextPresets].map((preset) => (
                <button
                  key={preset.label}
                  className="group flex w-full items-center gap-3 rounded-xl border border-line-soft bg-surface-2/60 p-2.5 text-left transition hover:border-accent/30 hover:bg-panel-2"
                  onClick={() => addTextClip(t(preset.sample), undefined, preset.values)}
                >
                  <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-[radial-gradient(circle_at_70%_25%,#36c8d026,transparent_60%),#0e0e11] px-1.5" aria-hidden="true">
                    <span className={`text-center leading-tight text-white ${preset.size}`}>{t(preset.sample)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium">{t(preset.label)}</div>
                    <div className="mt-0.5 text-[10.5px] text-dim">{preset.pluginName ? t("By {name}", { name: preset.pluginName }) : t("Click to add")}</div>
                  </div>
                  <Plus size={14} className="ml-auto text-dim transition group-hover:text-accent" aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-line-soft bg-surface-2/40 p-3 text-[11px] leading-relaxed text-dim">
              {t("Text clips live on their own track. Move them, resize the clip, and edit typography in the inspector.")}
            </div>
          </div>
        </TabPanel>
      ) : null}

      {tab === "audio" ? (
        <TabPanel id="media-panel-audio" tabId="media-tab-audio">
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
            {audioAssets.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Music2 size={24} className="text-dim/70" aria-hidden="true" />
                <p className="text-[12px] font-medium text-muted">{t("No audio-only files")}</p>
                <p className="max-w-[200px] text-[11px] leading-relaxed text-dim">
                  {t("Import music or voiceovers, or use the audio from any video clip.")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {audioAssets.map((asset) => (
                  <button
                    key={asset.id}
                    className="group w-full rounded-xl border border-line-soft bg-surface-2/60 p-2.5 text-left transition hover:border-accent/30 hover:bg-panel-2"
                    onClick={() => addClip(asset.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden="true">
                        <Music2 size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11.5px] font-medium">{asset.name}</div>
                        <div className="text-[10px] text-dim">{formatDuration(asset.info.duration)}</div>
                      </div>
                      <Plus size={13} className="text-dim group-hover:text-accent" aria-hidden="true" />
                    </div>
                    <Waveform peaks={asset.waveform} height={22} color="#36c8d099" className="mt-1.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </TabPanel>
      ) : null}

      {tab === "effects" ? (
        <TabPanel id="media-panel-effects" tabId="media-tab-effects">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="relative mb-3">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" aria-hidden="true" />
              <input className="field h-8 pl-7 text-[12px]" placeholder={t("Search effects")} aria-label={t("Search effects")} value={effectQuery} onChange={(event) => setEffectQuery(event.target.value)} />
            </div>
            <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={t("Effect category")}>
              {EFFECT_CATEGORIES.map((category) => <button key={category} aria-pressed={effectCategory === category} className={`rounded-md px-2 py-1 text-[9.5px] transition ${effectCategory === category ? "bg-accent-soft text-accent" : "bg-surface-2 text-dim hover:text-ink"}`} onClick={() => setEffectCategory(category)}>{t(category)}</button>)}
            </div>
            <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{t(filteredEffects.length === 1 ? "{count} effect" : "{count} effects", { count: filteredEffects.length })}</div>
            {filteredEffects.length ? <div className="grid grid-cols-2 gap-2">
              {filteredEffects.map((effect) => {
                const values = { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, blur: 0, vignette: 0, ...effect.values };
                const cssFilter = `brightness(${(1 + values.brightness) * 100}%) contrast(${values.contrast * 100}%) saturate(${values.saturation * 100}%) hue-rotate(${values.hue}deg) sepia(${values.sepia * 100}%) blur(${values.blur * 2}px)`;
                return <button key={`${effect.pluginId ?? "builtin"}:${effect.name}`} className="group overflow-hidden rounded-lg border border-line-soft bg-surface-2/60 text-left transition hover:border-accent/45 hover:bg-panel-2" onClick={() => addEffectClip({ name: effect.name, effect: effect.values })} title={t("Add {name} effect to the timeline", { name: t(effect.name) })} aria-label={t("Add {name} effect to the timeline", { name: t(effect.name) })}>
                  <div className="relative h-14 overflow-hidden bg-[linear-gradient(135deg,#dc8d61,#304d83_48%,#52a99a)]" aria-hidden="true">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_32%,#ffe2b4_0_10%,transparent_11%),radial-gradient(ellipse_at_55%_78%,#172132_0_25%,transparent_26%),linear-gradient(140deg,transparent_35%,#13242c_36%_56%,transparent_57%)]" style={{ filter: cssFilter }} />
                    {values.vignette > 0 ? <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse, transparent 35%, rgba(0,0,0,${values.vignette}) 100%)` }} /> : null}
                    <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 text-[8px] uppercase tracking-wide text-white/80">{effect.pluginName ?? t(effect.category)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                    <span className="truncate text-[10px] font-medium">{t(effect.name)}</span>
                    <Plus size={12} className="shrink-0 text-dim transition group-hover:text-accent" aria-hidden="true" />
                  </div>
                </button>;
              })}
            </div> : <div className="rounded-lg border border-dashed border-line p-4 text-center text-[11px] text-dim">{t("No effects match this search.")}</div>}
            <div className="mt-4 rounded-xl border border-line-soft bg-surface-2/40 p-3 text-[10.5px] leading-relaxed text-dim">{t("Click an effect to add it at the playhead. Adjust its strength and mask in the Inspector.")}</div>
          </div>
        </TabPanel>
      ) : null}

      {tab === "plugins" ? (
        <TabPanel id="media-panel-plugins" tabId="media-tab-plugins">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <input ref={pluginFileRef} className="hidden" type="file" accept=".json,application/json" aria-label={t("Plugin file")} onChange={(event) => void installPluginFile(event.target.files?.[0])} />
            <div className="rounded-xl border border-line-soft bg-surface-2/50 p-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold"><Puzzle size={14} className="text-accent" aria-hidden="true" /> {t("Editor plugins")}</div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-dim">{t("Versioned JSON plugins add effect presets and text styles. They never run code or receive filesystem, network, or project access.")}</p>
              <button className="btn btn-primary btn-sm mt-3 w-full" onClick={() => pluginFileRef.current?.click()}><PackagePlus size={13} aria-hidden="true" /> {t("Install plugin")}</button>
              <button className="btn btn-ghost btn-sm mt-1.5 w-full" onClick={() => downloadPlugin(EFFECT_PLUGIN_TEMPLATE, "librecut-plugin.example.json")}><Download size={13} aria-hidden="true" /> {t("Download example plugin")}</button>
              <p className="mt-2 text-center text-[9px] text-dim">{t("Format guide: docs/plugins.md · API 1.0.0")}</p>
            </div>
            <div className="mb-2 mt-5 flex items-center justify-between px-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{t("Installed")}</span>
              <span className="text-[10px] text-dim">{plugins.length}</span>
            </div>
            {plugins.length ? <div className="space-y-2">
              {plugins.map((plugin) => <div key={plugin.manifest.id} className="rounded-xl border border-line-soft bg-surface-2/50 p-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">{plugin.manifest.name}</div>
                    <div className="mt-0.5 text-[9px] text-dim">{t("v{version} · {effects} effects · {styles} text styles", { version: plugin.manifest.version, effects: plugin.manifest.effects?.length ?? 0, styles: plugin.manifest.textPresets?.length ?? 0 })}</div>
                  </div>
                  <button disabled={Boolean(plugin.error)} className={`flex h-6 w-6 items-center justify-center rounded-md ${plugin.enabled ? "bg-accent-soft text-accent" : "bg-surface text-dim"} disabled:cursor-not-allowed disabled:opacity-40`} aria-label={t(plugin.enabled ? "Disable {name}" : "Enable {name}", { name: plugin.manifest.name })} aria-pressed={plugin.enabled} title={plugin.error ? t("Remove this incompatible plugin and reinstall a compatible version") : plugin.enabled ? t("Disable plugin") : t("Enable plugin")} onClick={() => updatePlugins(plugins.map((item) => item.manifest.id === plugin.manifest.id ? { ...item, enabled: !item.enabled } : item))}>{plugin.enabled ? <Check size={13} aria-hidden="true" /> : <Power size={12} aria-hidden="true" />}</button>
                  <button className="flex h-6 w-6 items-center justify-center rounded-md bg-surface text-dim hover:text-error" aria-label={t("Remove {name}", { name: plugin.manifest.name })} title={t("Remove plugin")} onClick={() => updatePlugins(plugins.filter((item) => item.manifest.id !== plugin.manifest.id))}><Trash2 size={12} aria-hidden="true" /></button>
                </div>
                {plugin.manifest.description ? <p className="mt-2 text-[10px] leading-relaxed text-muted">{plugin.manifest.description}</p> : null}
                {plugin.error ? <p role="alert" className="mt-2 rounded-md bg-error/10 p-2 text-[10px] leading-relaxed text-error">{t("Plugin disabled: {error}", { error: plugin.error })}</p> : null}
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <button className="btn btn-ghost btn-sm" onClick={() => downloadPlugin(plugin.manifest, `${plugin.manifest.id}.json`)}><Download size={12} aria-hidden="true" /> {t("Export")}</button>
                  <button className="btn btn-ghost btn-sm" disabled={!plugin.enabled || !plugin.manifest.effects?.length} onClick={() => { setTab("effects"); setEffectCategory("Plugin"); setEffectQuery(plugin.manifest.name); }}>{t("View effects")}</button>
                </div>
              </div>)}
            </div> : <div className="mt-3 rounded-lg border border-dashed border-line p-4 text-center text-[10.5px] leading-relaxed text-dim">{t("No plugins yet. Install an effect pack or download the example to get started.")}</div>}
          </div>
        </TabPanel>
      ) : null}

      <div className="shrink-0 border-t border-line-soft px-3.5 py-2.5 text-[10px] leading-relaxed text-dim">
        {t("Drag media onto a timeline track, or use the add button to place it at the playhead.")}
      </div>
    </aside>
  );
}

function parseSubtitle(contents: string): Array<{ start: number; end: number; text: string }> {
  const parseTime = (value: string) => {
    const match = value.trim().match(/^(\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}$|^\d{2}:\d{2}[,.]\d{3}$/);
    if (!match) return NaN;
    const [clock, milliseconds] = value.trim().split(/[,.]/);
    const parts = clock.split(":").map(Number);
    const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    return seconds + Number(milliseconds) / 1000;
  };
  return contents.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return [];
    const [left, right] = lines[timingIndex].split("-->");
    const start = parseTime(left); const end = parseTime(right.split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    return Number.isFinite(start) && Number.isFinite(end) && end > start && text ? [{ start, end, text: text.replace(/<[^>]*>/g, "") }] : [];
  });
}

function downloadSubtitles(cues: Array<{ start: number; end: number; text: string }>) {
  if (!cues.length) { toast(t("There are no imported subtitle cues to export."), "info"); return; }
  const timestamp = (time: number) => { const ms = Math.max(0, Math.round(time * 1000)); const h = Math.floor(ms / 3_600_000); const m = Math.floor(ms / 60_000) % 60; const s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  const body = cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`).join("\n\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "subtitles.srt"; link.click(); URL.revokeObjectURL(url);
}

function AssetCard({ asset, onAdd, onDragPreview, onRetryProxy, onRemoveBackground, onUseOriginal, onCleanupProxy }: { asset: Asset; onAdd: () => void; onDragPreview: (preview: DragPreview) => void; onRetryProxy: () => void; onRemoveBackground: () => void; onUseOriginal: () => void; onCleanupProxy: () => Promise<void> }) {
  const t = useT();
  const isAudio = !asset.info.hasVideo && asset.info.hasAudio;
  const thumbnail = asset.thumbnails[0];

  return (
    <div
      className="group relative cursor-grab overflow-hidden rounded-lg border border-line-soft bg-surface-2/70 transition hover:border-line hover:bg-panel-2 active:cursor-grabbing"
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        let moved = false;

        const onMove = (moveEvent: PointerEvent) => {
          if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
          moved = true;
          document.body.style.cursor = "grabbing";
          onDragPreview({ asset, x: moveEvent.clientX, y: moveEvent.clientY });
        };
        const onUp = (upEvent: PointerEvent) => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          document.body.style.cursor = "";
          if (!moved) return;
          onDragPreview(null);

          const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
            ?.closest<HTMLElement>("[data-timeline-track]");
          const trackId = target?.dataset.timelineTrack;
          if (trackId) {
            window.dispatchEvent(new CustomEvent("librecut:asset-drop", {
              detail: { assetId: asset.id, trackId, clientX: upEvent.clientX },
            }));
          }
        };
        const onCancel = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          document.body.style.cursor = "";
          onDragPreview(null);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
      }}
      onDoubleClick={onAdd}
    >
      <div className="relative aspect-video overflow-hidden bg-black/40 checker">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : isAudio ? (
          <div className="flex h-full items-center px-2" aria-hidden="true">
            <Waveform peaks={asset.waveform} height={30} color="#36c8d0aa" />
          </div>
        ) : asset.info.isImage ? (
          <img src={mediaUrl(asset.previewMediaId)} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center" aria-hidden="true">
            <Film size={18} className="text-dim/70" />
          </div>
        )}
        <div className="absolute right-1 top-1 flex items-center gap-1">
          {asset.info.isImage ? (
            <span className="rounded bg-black/60 p-1 text-white/80 backdrop-blur-sm"><ImageIcon size={10} aria-hidden="true" /></span>
          ) : null}
          {asset.proxyStatus === "generating" ? (
            <span className="rounded bg-black/60 p-1 text-accent backdrop-blur-sm" title={t("Building a preview proxy")}><Loader2 size={10} className="animate-spin" aria-hidden="true" /></span>
          ) : null}
          {asset.proxyStatus === "ready" ? (
            <span className="rounded bg-black/60 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-mint backdrop-blur-sm">{t("proxy")}</span>
          ) : null}
        </div>
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[9px] text-white/75 backdrop-blur-sm">
          {asset.info.isImage ? t("image") : formatDuration(asset.info.duration)}
        </span>
        <button
          className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-accent text-[#160b08] opacity-0 shadow-lg transition group-hover:opacity-100 focus-visible:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onAdd();
          }}
          aria-label={t("Add {name} to the timeline at the playhead", { name: asset.name })}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="px-1.5 py-1.5">
        <div className="truncate text-[10.5px] font-medium leading-tight" title={asset.name}>
          {asset.name}
        </div>
        {asset.info.isImage ? <button className="mt-1 flex items-center gap-1 text-[9px] text-accent hover:text-ink" onClick={(event) => { event.stopPropagation(); onRemoveBackground(); }}><WandSparkles size={10} aria-hidden="true" /> {t("Remove background")}</button> : null}
        <div className="mt-0.5 truncate text-[9.5px] text-dim">
          {asset.info.isImage
            ? t("Still image")
            : asset.info.hasVideo
              ? `${asset.info.width}×${asset.info.height}`
              : `${asset.info.audioChannels}ch · ${Math.round(asset.info.sampleRate / 1000)} kHz`}
        </div>
        {asset.info.isVfr ? <div className="mt-1 text-[9px] text-amber" title={t("Variable frame rate may affect seeking or audio sync")}>{t("Possible variable frame rate · export normalizes")}</div> : null}
        {asset.proxyStatus === "failed" ? <button className="mt-1 text-[9px] text-amber hover:text-ink" onClick={(event) => { event.stopPropagation(); onRetryProxy(); }}>{t("Proxy failed · Retry")}</button> : null}
        {asset.proxyStatus === "ready" && asset.previewMediaId === asset.proxyId ? <button className="mt-1 text-[9px] text-dim hover:text-ink" onClick={(event) => { event.stopPropagation(); onUseOriginal(); }}>{t("Preview original")}</button> : null}
        {asset.proxyStatus === "ready" ? <button className="mt-1 block text-[9px] text-dim hover:text-error" onClick={(event) => { event.stopPropagation(); void onCleanupProxy(); }}>{t("Remove cached proxy")}</button> : null}
      </div>
    </div>
  );
}

function ImportDropzone({ onImport, empty }: { onImport: () => void; empty: boolean }) {
  const t = useT();
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/30 px-4 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel-2">
        {empty ? <Film size={19} className="text-accent" aria-hidden="true" /> : <Search size={18} className="text-dim" aria-hidden="true" />}
      </div>
      <p className="text-[12px] font-medium">{empty ? t("Your media library is empty") : t("No results")}</p>
      <p className="mt-1 max-w-[190px] text-[10.5px] leading-relaxed text-dim">
        {empty ? t("Drop video, audio, or images here, or choose files from your PC.") : t("Try a different search term.")}
      </p>
      {empty ? (
        <button className="btn btn-secondary btn-sm mt-4" onClick={onImport}>
          <AudioLines size={13} aria-hidden="true" /> {t("Choose files")}
        </button>
      ) : null}
    </div>
  );
}
