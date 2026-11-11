import type { ColorEffectOptions, TextOptions } from "./types";

const STORAGE_KEY = "librecut:effect-plugins";
export const PLUGIN_API_VERSION = "1.0.0";

export type EffectPackCategory = "Basic" | "Color" | "Vintage" | "Cinematic" | "Dream";
export type PluginEffectValues = Partial<Pick<ColorEffectOptions,
  "brightness" | "contrast" | "saturation" | "hue" | "sepia" | "blur" | "vignette" | "motionBlur" | "fadeIn" | "fadeOut"
>>;
export type PluginTextValues = Partial<Pick<TextOptions,
  "size" | "color" | "fontWeight" | "italic" | "fontFamily" | "align" | "underline" | "characterSpacing" | "lineHeight" | "outlineColor" | "outlineWidth" | "backgroundColor" | "backgroundOpacity" | "brightness" | "shadow" | "shadowColor" | "curve"
>>;

export interface EffectPackManifest {
  manifestVersion: 1 | 2;
  id: string;
  name: string;
  version: string;
  description: string;
  /** Semver range for the stable LibreCut plugin API. */
  apiVersion?: string;
  /** Requested capabilities. Version 1 currently supports no privileged capabilities. */
  permissions?: string[];
  effects: Array<{ name: string; category: EffectPackCategory; values: PluginEffectValues }>;
  textPresets?: Array<{ name: string; text: string; values: PluginTextValues }>;
}

export interface InstalledEffectPack {
  manifest: EffectPackManifest;
  enabled: boolean;
  error?: string;
}

const ranges: Record<keyof PluginEffectValues, [number, number]> = {
  brightness: [-1, 1], contrast: [0, 2], saturation: [0, 2], hue: [-180, 180], sepia: [0, 1],
  blur: [0, 20], vignette: [0, 1], motionBlur: [0, 1], fadeIn: [0, 120], fadeOut: [0, 120],
};
const textRanges: Partial<Record<keyof PluginTextValues, [number, number]>> = {
  size: [8, 1000], characterSpacing: [-20, 100], lineHeight: [0.5, 4], outlineWidth: [0, 30],
  backgroundOpacity: [0, 1], brightness: [0, 2], shadow: [0, 1], curve: [-180, 180],
};
const categories: EffectPackCategory[] = ["Basic", "Color", "Vintage", "Cinematic", "Dream"];
const color = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const semver = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(value);

function supportsApi(range: string) {
  const current = semver(PLUGIN_API_VERSION)!;
  const match = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!match) return false;
  const [, operator, major, minor, patch] = match;
  if (operator === "^") return Number(major) === Number(current[1]) && Number(minor) * 1000 + Number(patch) <= Number(current[2]) * 1000 + Number(current[3]);
  if (operator === "~") return Number(major) === Number(current[1]) && Number(minor) === Number(current[2]) && Number(patch) <= Number(current[3]);
  return range === PLUGIN_API_VERSION;
}

function parseValues(input: unknown, kind: "effect" | "text", index: number) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${kind === "effect" ? "Effect" : "Text preset"} ${index + 1} needs a values object.`);
  const values = input as Record<string, unknown>;
  const allowed = kind === "effect" ? ranges : { ...textRanges, color: null, outlineColor: null, backgroundColor: null, shadowColor: null, fontWeight: null, italic: null, fontFamily: null, align: null, underline: null };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!(key in allowed)) throw new Error(`${kind === "effect" ? "Effect" : "Text preset"} ${index + 1} contains unsupported setting “${key}”.`);
    if (key.endsWith("Color") || key === "color") {
      if (!color(value)) throw new Error(`${key} in text preset ${index + 1} must be a six-digit hex colour.`);
    } else if (key === "fontWeight") {
      if (value !== "normal" && value !== "bold") throw new Error(`Text preset ${index + 1} has an invalid font weight.`);
    } else if (key === "align") {
      if (!["left", "center", "right"].includes(String(value))) throw new Error(`Text preset ${index + 1} has an invalid alignment.`);
    } else if (["italic", "underline"].includes(key)) {
      if (typeof value !== "boolean") throw new Error(`${key} in text preset ${index + 1} must be a boolean.`);
    } else if (key === "fontFamily") {
      if (typeof value !== "string" || !/^[\w ,'-]{1,64}$/.test(value)) throw new Error(`Text preset ${index + 1} has an invalid font family.`);
    } else {
      const [min, max] = (allowed as Record<string, [number, number] | null>)[key] ?? [];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} in ${kind} ${index + 1} must be between ${min} and ${max}.`);
    }
    result[key] = value;
  }
  if (!Object.keys(result).length) throw new Error(`${kind === "effect" ? "Effect" : "Text preset"} ${index + 1} needs at least one setting.`);
  return result;
}

export function parseEffectPack(input: unknown): EffectPackManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The plugin file must contain a JSON object.");
  const raw = input as Record<string, unknown>;
  if (raw.manifestVersion !== 1 && raw.manifestVersion !== 2) throw new Error("This plugin manifest version is not supported. Supported versions are 1 and 2.");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(raw.id)) throw new Error("Plugin ID must be 3–64 lowercase letters, numbers, dots, underscores, or hyphens.");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) throw new Error("Plugin name must be between 1 and 80 characters.");
  if (typeof raw.version !== "string" || !semver(raw.version)) throw new Error("Plugin version must use a format such as 1.0.0.");
  if (typeof raw.description !== "string" || raw.description.length > 240) throw new Error("Plugin description must be 240 characters or fewer.");
  const apiVersion = raw.manifestVersion === 1 ? "^1.0.0" : raw.apiVersion;
  if (typeof apiVersion !== "string" || !supportsApi(apiVersion)) throw new Error(`Plugin API “${String(apiVersion)}” is incompatible with LibreCut API ${PLUGIN_API_VERSION}.`);
  const permissions = raw.manifestVersion === 1 ? [] : raw.permissions;
  if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string") || permissions.length) throw new Error("This LibreCut version grants no plugin permissions. Remove requested permissions from the manifest.");
  const effectsRaw = raw.effects ?? [];
  const textRaw = raw.textPresets ?? [];
  if (!Array.isArray(effectsRaw) || !Array.isArray(textRaw) || effectsRaw.length > 100 || textRaw.length > 100 || effectsRaw.length + textRaw.length === 0) throw new Error("A plugin must provide 1–100 effects and/or text presets in total.");
  const effects = effectsRaw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Effect ${index + 1} must be an object.`);
    const effect = item as Record<string, unknown>;
    if (typeof effect.name !== "string" || !effect.name.trim() || effect.name.length > 64) throw new Error(`Effect ${index + 1} needs a name up to 64 characters.`);
    if (typeof effect.category !== "string" || !categories.includes(effect.category as EffectPackCategory)) throw new Error(`Effect ${index + 1} has an unsupported category.`);
    return { name: effect.name.trim(), category: effect.category as EffectPackCategory, values: parseValues(effect.values, "effect", index) as PluginEffectValues };
  });
  const textPresets = textRaw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Text preset ${index + 1} must be an object.`);
    const preset = item as Record<string, unknown>;
    if (typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 64 || typeof preset.text !== "string" || preset.text.length > 240) throw new Error(`Text preset ${index + 1} needs a name and sample text (up to 240 characters).`);
    return { name: preset.name.trim(), text: preset.text, values: parseValues(preset.values, "text", index) as PluginTextValues };
  });
  return { manifestVersion: 2, id: raw.id, name: raw.name.trim(), version: raw.version, description: raw.description, apiVersion, permissions: [], effects, textPresets };
}

export function loadEffectPacks(): InstalledEffectPack[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      try { return [{ manifest: parseEffectPack(item.manifest), enabled: item.enabled === true }]; }
      catch (error) {
        const manifest = item.manifest as Record<string, unknown> | undefined;
        if (typeof manifest?.id !== "string" || typeof manifest.name !== "string") return [];
        return [{ manifest: { ...manifest, id: manifest.id, name: manifest.name } as EffectPackManifest, enabled: false, error: error instanceof Error ? error.message : "Plugin data could not be loaded." }];
      }
    });
  } catch { return []; }
}

export function saveEffectPacks(packs: InstalledEffectPack[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
}

export const EFFECT_PLUGIN_TEMPLATE: EffectPackManifest = {
  manifestVersion: 2, apiVersion: "^1.0.0", permissions: [],
  id: "example.my-effects", name: "My Editor Pack", version: "1.0.0",
  description: "An example plugin with effect and text preset extensions.",
  effects: [
    { name: "Soft teal", category: "Color", values: { saturation: 1.1, hue: 12, contrast: 1.06 } },
    { name: "Dark vignette", category: "Cinematic", values: { vignette: 0.55, contrast: 1.12 } },
  ],
  textPresets: [{ name: "Studio title", text: "YOUR STORY", values: { size: 96, color: "#FFFFFF", fontWeight: "bold", align: "center", outlineColor: "#172132", outlineWidth: 2 } }],
};
