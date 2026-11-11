import { useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useEditor } from "../../stores/editor";
import { mediaUrl } from "../../lib/media";
import { formatDuration } from "../../lib/time";
import { EFFECT_PLUGIN_TEMPLATE, loadEffectPacks, parseEffectPack, saveEffectPacks, type EffectPackCategory, type InstalledEffectPack, type PluginEffectValues, type PluginTextValues } from "../../lib/plugins";
import { Waveform } from "../../components/Waveform";
import { toast } from "../../components/Toast";
import { useMediaImport } from "./useMediaImport";
import type { Asset } from "../../lib/types";

type Tab = "media" | "text" | "audio" | "effects" | "plugins";
type EffectCategory = "All" | EffectPackCategory | "Plugin";
type DragPreview = { asset: Asset; x: number; y: number } | null;

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

export function MediaPanel({ width = 256 }: { width?: number }) {
  const project = useEditor((state) => state.project);
  const addClip = useEditor((state) => state.addClip);
  const addEffectClip = useEditor((state) => state.addEffectClip);
  const addTextClip = useEditor((state) => state.addTextClip);
  const { importFromDialog, importing, fileDragOver } = useMediaImport();
  const [tab, setTab] = useState<Tab>("media");
  const [query, setQuery] = useState("");
  const [effectQuery, setEffectQuery] = useState("");
  const [effectCategory, setEffectCategory] = useState<EffectCategory>("All");
  const [plugins, setPlugins] = useState<InstalledEffectPack[]>(loadEffectPacks);
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const pluginFileRef = useRef<HTMLInputElement>(null);

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
      if (file.size > 256 * 1024) throw new Error("Effect pack files must be 256 KB or smaller.");
      const manifest = parseEffectPack(JSON.parse(await file.text()) as unknown);
      if (plugins.some((plugin) => plugin.manifest.id === manifest.id)) throw new Error("A plugin with this ID is already installed.");
      updatePlugins([...plugins, { manifest, enabled: true }]);
      toast(`${manifest.name} installed. Its effects are in the Effects tab.`, "success");
      setTab("effects");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not install this plugin.", "error");
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
    <aside style={{ width }} className={`relative flex shrink-0 flex-col border-r border-line-soft bg-panel ${fileDragOver ? "ring-2 ring-inset ring-accent" : ""}`}>
      {fileDragOver ? (
        <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent bg-panel/95 text-center shadow-xl">
          <Upload size={24} className="mb-3 text-accent" />
          <span className="text-sm font-semibold text-ink">Drop to import media</span>
          <span className="mt-1 text-[11px] text-muted">Video, audio, or images</span>
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
              <div className="flex h-full items-center justify-center"><Film size={15} className="text-dim" /></div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-ink">{dragPreview.asset.name}</div>
            <div className="text-[9px] uppercase tracking-wide text-accent">Adding to timeline</div>
          </div>
        </div>
      ) : null}
      <div className="flex h-11 shrink-0 items-end gap-4 overflow-x-auto border-b border-line-soft px-3">
        <TabButton active={tab === "media"} onClick={() => setTab("media")} icon={Film} label="Media" />
        <TabButton active={tab === "text"} onClick={() => setTab("text")} icon={Type} label="Text" />
        <TabButton active={tab === "audio"} onClick={() => setTab("audio")} icon={Music2} label="Audio" />
        <TabButton active={tab === "effects"} onClick={() => setTab("effects")} icon={SlidersHorizontal} label="Effects" />
        <TabButton active={tab === "plugins"} onClick={() => setTab("plugins")} icon={Puzzle} label="Plugins" />
      </div>

      {tab === "media" ? (
        <>
          <div className="space-y-2.5 px-3.5 pb-3 pt-3.5">
            <button className="btn btn-secondary w-full" onClick={() => void importFromDialog()} disabled={importing > 0}>
              {importing > 0 ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {importing > 0 ? `Importing ${importing}…` : "Import media"}
            </button>
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <input
                className="field h-8 pl-7 text-[12px]"
                placeholder="Search media"
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
                    {filtered.length} item{filtered.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-[10px] text-dim/70">Double-click to add</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((asset) => (
                    <AssetCard key={asset.id} asset={asset} onAdd={() => addClip(asset.id)} onDragPreview={setDragPreview} />
                  ))}
                </div>
                <button
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-[11.5px] text-dim transition hover:border-accent/40 hover:text-ink"
                  onClick={() => void importFromDialog()}
                >
                  <Plus size={13} /> Import more
                </button>
              </>
            )}
          </div>
        </>
      ) : null}

      {tab === "text" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
          <button className="btn btn-primary w-full" onClick={() => addTextClip("Your text")}>
            <Plus size={15} /> Add text at playhead
          </button>
          <div className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">Presets</div>
          <div className="mt-2.5 space-y-2">
            {[...TEXT_PRESETS, ...pluginTextPresets].map((preset) => (
              <button
                key={preset.label}
                className="group flex w-full items-center gap-3 rounded-xl border border-line-soft bg-surface-2/60 p-2.5 text-left transition hover:border-accent/30 hover:bg-panel-2"
                onClick={() => addTextClip(preset.sample, undefined, preset.values)}
              >
                <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-[radial-gradient(circle_at_70%_25%,#36c8d026,transparent_60%),#0e0e11] px-1.5">
                  <span className={`text-center leading-tight text-white ${preset.size}`}>{preset.sample}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{preset.label}</div>
                  <div className="mt-0.5 text-[10.5px] text-dim">{preset.pluginName ? `By ${preset.pluginName}` : "Click to add"}</div>
                </div>
                <Plus size={14} className="ml-auto text-dim transition group-hover:text-accent" />
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-line-soft bg-surface-2/40 p-3 text-[11px] leading-relaxed text-dim">
            Text clips live on their own track. Move them, resize the clip, and edit typography in the inspector.
          </div>
        </div>
      ) : null}

      {tab === "audio" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
          {audioAssets.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Music2 size={24} className="text-dim/50" />
              <p className="text-[12px] font-medium text-muted">No audio-only files</p>
              <p className="max-w-[200px] text-[11px] leading-relaxed text-dim">
                Import music or voiceovers, or use the audio from any video clip.
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
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent">
                      <Music2 size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11.5px] font-medium">{asset.name}</div>
                      <div className="text-[10px] text-dim">{formatDuration(asset.info.duration)}</div>
                    </div>
                    <Plus size={13} className="text-dim group-hover:text-accent" />
                  </div>
                  <Waveform peaks={asset.waveform} height={22} color="#36c8d099" className="mt-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "effects" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="relative mb-3">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
            <input className="field h-8 pl-7 text-[12px]" placeholder="Search effects" value={effectQuery} onChange={(event) => setEffectQuery(event.target.value)} />
          </div>
          <div className="mb-3 flex flex-wrap gap-1">
            {EFFECT_CATEGORIES.map((category) => <button key={category} className={`rounded-md px-2 py-1 text-[9.5px] transition ${effectCategory === category ? "bg-accent-soft text-accent" : "bg-surface-2 text-dim hover:text-ink"}`} onClick={() => setEffectCategory(category)}>{category}</button>)}
          </div>
          <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{filteredEffects.length} effects</div>
          {filteredEffects.length ? <div className="grid grid-cols-2 gap-2">
            {filteredEffects.map((effect) => {
              const values = { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, blur: 0, vignette: 0, ...effect.values };
              const cssFilter = `brightness(${(1 + values.brightness) * 100}%) contrast(${values.contrast * 100}%) saturate(${values.saturation * 100}%) hue-rotate(${values.hue}deg) sepia(${values.sepia * 100}%) blur(${values.blur * 2}px)`;
              return <button key={`${effect.pluginId ?? "builtin"}:${effect.name}`} className="group overflow-hidden rounded-lg border border-line-soft bg-surface-2/60 text-left transition hover:border-accent/45 hover:bg-panel-2" onClick={() => addEffectClip({ name: effect.name, effect: effect.values })} title={`Add ${effect.name} effect to the timeline`}>
                <div className="relative h-14 overflow-hidden bg-[linear-gradient(135deg,#dc8d61,#304d83_48%,#52a99a)]">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_32%,#ffe2b4_0_10%,transparent_11%),radial-gradient(ellipse_at_55%_78%,#172132_0_25%,transparent_26%),linear-gradient(140deg,transparent_35%,#13242c_36%_56%,transparent_57%)]" style={{ filter: cssFilter }} />
                  {values.vignette > 0 ? <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse, transparent 35%, rgba(0,0,0,${values.vignette}) 100%)` }} /> : null}
                  <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 text-[8px] uppercase tracking-wide text-white/80">{effect.pluginName ?? effect.category}</span>
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="truncate text-[10px] font-medium">{effect.name}</span>
                  <Plus size={12} className="shrink-0 text-dim transition group-hover:text-accent" />
                </div>
              </button>;
            })}
          </div> : <div className="rounded-lg border border-dashed border-line p-4 text-center text-[11px] text-dim">No effects match this search.</div>}
          <div className="mt-4 rounded-xl border border-line-soft bg-surface-2/40 p-3 text-[10.5px] leading-relaxed text-dim">Click an effect to add it at the playhead. Adjust its strength and mask in the Inspector.</div>
        </div>
      ) : null}

      {tab === "plugins" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <input ref={pluginFileRef} className="hidden" type="file" accept=".json,application/json" onChange={(event) => void installPluginFile(event.target.files?.[0])} />
          <div className="rounded-xl border border-line-soft bg-surface-2/50 p-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold"><Puzzle size={14} className="text-accent" /> Editor plugins</div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-dim">Versioned JSON plugins add effect presets and text styles. They never run code or receive filesystem, network, or project access.</p>
            <button className="btn btn-primary btn-sm mt-3 w-full" onClick={() => pluginFileRef.current?.click()}><PackagePlus size={13} /> Install plugin</button>
            <button className="btn btn-ghost btn-sm mt-1.5 w-full" onClick={() => downloadPlugin(EFFECT_PLUGIN_TEMPLATE, "librecut-plugin.example.json")}><Download size={13} /> Download example plugin</button>
            <p className="mt-2 text-center text-[9px] text-dim">Format guide: docs/plugins.md · API 1.0.0</p>
          </div>
          <div className="mb-2 mt-5 flex items-center justify-between px-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Installed</span>
            <span className="text-[10px] text-dim">{plugins.length}</span>
          </div>
          {plugins.length ? <div className="space-y-2">
            {plugins.map((plugin) => <div key={plugin.manifest.id} className="rounded-xl border border-line-soft bg-surface-2/50 p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium">{plugin.manifest.name}</div>
                  <div className="mt-0.5 text-[9px] text-dim">v{plugin.manifest.version} · {plugin.manifest.effects?.length ?? 0} effects · {plugin.manifest.textPresets?.length ?? 0} text styles</div>
                </div>
                <button disabled={Boolean(plugin.error)} className={`flex h-6 w-6 items-center justify-center rounded-md ${plugin.enabled ? "bg-accent-soft text-accent" : "bg-surface text-dim"} disabled:cursor-not-allowed disabled:opacity-40`} aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.manifest.name}`} title={plugin.error ? "Remove this incompatible plugin and reinstall a compatible version" : plugin.enabled ? "Disable plugin" : "Enable plugin"} onClick={() => updatePlugins(plugins.map((item) => item.manifest.id === plugin.manifest.id ? { ...item, enabled: !item.enabled } : item))}>{plugin.enabled ? <Check size={13} /> : <Power size={12} />}</button>
                <button className="flex h-6 w-6 items-center justify-center rounded-md bg-surface text-dim hover:text-error" aria-label={`Remove ${plugin.manifest.name}`} title="Remove plugin" onClick={() => updatePlugins(plugins.filter((item) => item.manifest.id !== plugin.manifest.id))}><Trash2 size={12} /></button>
              </div>
              {plugin.manifest.description ? <p className="mt-2 text-[10px] leading-relaxed text-muted">{plugin.manifest.description}</p> : null}
              {plugin.error ? <p role="alert" className="mt-2 rounded-md bg-error/10 p-2 text-[10px] leading-relaxed text-error">Plugin disabled: {plugin.error}</p> : null}
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button className="btn btn-ghost btn-sm" onClick={() => downloadPlugin(plugin.manifest, `${plugin.manifest.id}.json`)}><Download size={12} /> Export</button>
                <button className="btn btn-ghost btn-sm" disabled={!plugin.enabled || !plugin.manifest.effects?.length} onClick={() => { setTab("effects"); setEffectCategory("Plugin"); setEffectQuery(plugin.manifest.name); }}>View effects</button>
              </div>
            </div>)}
          </div> : <div className="mt-3 rounded-lg border border-dashed border-line p-4 text-center text-[10.5px] leading-relaxed text-dim">No plugins yet. Install an effect pack or download the example to get started.</div>}
        </div>
      ) : null}

      <div className="shrink-0 border-t border-line-soft px-3.5 py-2.5 text-[10px] leading-relaxed text-dim">
        Drag media onto a timeline track, or double-click to add at the playhead.
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Film;
  label: string;
}) {
  return (
    <button className="tab shrink-0 whitespace-nowrap pb-3 text-[10px]" data-active={active} onClick={onClick}>
      <Icon size={12} /> {label}
    </button>
  );
}

function AssetCard({ asset, onAdd, onDragPreview }: { asset: Asset; onAdd: () => void; onDragPreview: (preview: DragPreview) => void }) {
  const isAudio = !asset.info.hasVideo && asset.info.hasAudio;
  const thumbnail = asset.thumbnails[0];

  return (
    <div
      role="button"
      tabIndex={0}
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
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onAdd();
        }
      }}
    >
      <div className="relative aspect-video overflow-hidden bg-black/40 checker">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : isAudio ? (
          <div className="flex h-full items-center px-2">
            <Waveform peaks={asset.waveform} height={30} color="#36c8d0aa" />
          </div>
        ) : asset.info.isImage ? (
          <img src={mediaUrl(asset.previewMediaId)} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Film size={18} className="text-dim/60" />
          </div>
        )}
        <div className="absolute right-1 top-1 flex items-center gap-1">
          {asset.info.isImage ? (
            <span className="rounded bg-black/60 p-1 text-white/80 backdrop-blur-sm"><ImageIcon size={10} /></span>
          ) : null}
          {asset.proxyStatus === "generating" ? (
            <span className="rounded bg-black/60 p-1 text-accent backdrop-blur-sm"><Loader2 size={10} className="animate-spin" /></span>
          ) : null}
          {asset.proxyStatus === "ready" ? (
            <span className="rounded bg-black/60 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-mint backdrop-blur-sm">proxy</span>
          ) : null}
        </div>
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[9px] text-white/75 backdrop-blur-sm">
          {asset.info.isImage ? "image" : formatDuration(asset.info.duration)}
        </span>
        <button
          className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-accent text-[#160b08] opacity-0 shadow-lg transition group-hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onAdd();
          }}
          aria-label={`Add ${asset.name} to timeline`}
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="px-1.5 py-1.5">
        <div className="truncate text-[10.5px] font-medium leading-tight" title={asset.name}>
          {asset.name}
        </div>
        <div className="mt-0.5 truncate text-[9.5px] text-dim">
          {asset.info.isImage
            ? "Still image"
            : asset.info.hasVideo
              ? `${asset.info.width}×${asset.info.height}`
              : `${asset.info.audioChannels}ch · ${Math.round(asset.info.sampleRate / 1000)} kHz`}
        </div>
      </div>
    </div>
  );
}

function ImportDropzone({ onImport, empty }: { onImport: () => void; empty: boolean }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/30 px-4 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel-2">
        {empty ? <Film size={19} className="text-accent" /> : <Search size={18} className="text-dim" />}
      </div>
      <p className="text-[12px] font-medium">{empty ? "Your media library is empty" : "No results"}</p>
      <p className="mt-1 max-w-[190px] text-[10.5px] leading-relaxed text-dim">
        {empty ? "Drop video, audio, or images here, or choose files from your PC." : "Try a different search term."}
      </p>
      {empty ? (
        <button className="btn btn-secondary btn-sm mt-4" onClick={onImport}>
          <AudioLines size={13} /> Choose files
        </button>
      ) : null}
    </div>
  );
}
