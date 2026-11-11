import type { ColorEffectOptions } from "./types";

const STORAGE_KEY = "librecut:effect-plugins";

export type EffectPackCategory = "Basic" | "Color" | "Vintage" | "Cinematic" | "Dream";
export type PluginEffectValues = Partial<Pick<ColorEffectOptions,
  "brightness" | "contrast" | "saturation" | "hue" | "sepia" | "blur" | "vignette" | "motionBlur" | "fadeIn" | "fadeOut"
>>;

export interface EffectPackManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  effects: Array<{ name: string; category: EffectPackCategory; values: PluginEffectValues }>;
}

export interface InstalledEffectPack {
  manifest: EffectPackManifest;
  enabled: boolean;
}

const ranges: Record<keyof PluginEffectValues, [number, number]> = {
  brightness: [-1, 1], contrast: [0, 2], saturation: [0, 2], hue: [-180, 180], sepia: [0, 1],
  blur: [0, 20], vignette: [0, 1], motionBlur: [0, 1], fadeIn: [0, 120], fadeOut: [0, 120],
};
const categories: EffectPackCategory[] = ["Basic", "Color", "Vintage", "Cinematic", "Dream"];

export function parseEffectPack(input: unknown): EffectPackManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The plugin file must contain a JSON object.");
  const raw = input as Record<string, unknown>;
  if (raw.manifestVersion !== 1) throw new Error("This plugin format version is not supported.");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(raw.id)) throw new Error("Plugin ID must be 3–64 lowercase letters, numbers, dots, underscores, or hyphens.");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) throw new Error("Plugin name must be between 1 and 80 characters.");
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(raw.version)) throw new Error("Plugin version must use a format such as 1.0.0.");
  if (typeof raw.description !== "string" || raw.description.length > 240) throw new Error("Plugin description must be 240 characters or fewer.");
  if (!Array.isArray(raw.effects) || raw.effects.length < 1 || raw.effects.length > 100) throw new Error("An effect pack must contain between 1 and 100 effects.");

  const effects = raw.effects.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Effect ${index + 1} must be an object.`);
    const effect = item as Record<string, unknown>;
    if (typeof effect.name !== "string" || !effect.name.trim() || effect.name.length > 64) throw new Error(`Effect ${index + 1} needs a name up to 64 characters.`);
    if (typeof effect.category !== "string" || !categories.includes(effect.category as EffectPackCategory)) throw new Error(`Effect ${index + 1} has an unsupported category.`);
    if (!effect.values || typeof effect.values !== "object" || Array.isArray(effect.values)) throw new Error(`Effect ${index + 1} needs a values object.`);
    const values = effect.values as Record<string, unknown>;
    const safeValues: PluginEffectValues = {};
    for (const [key, value] of Object.entries(values)) {
      if (!(key in ranges) || typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Effect ${index + 1} contains an unsupported setting.`);
      const [min, max] = ranges[key as keyof PluginEffectValues];
      if (value < min || value > max) throw new Error(`${key} in effect ${index + 1} must be between ${min} and ${max}.`);
      safeValues[key as keyof PluginEffectValues] = value;
    }
    if (!Object.keys(safeValues).length) throw new Error(`Effect ${index + 1} needs at least one setting.`);
    return { name: effect.name.trim(), category: effect.category as EffectPackCategory, values: safeValues };
  });

  return {
    manifestVersion: 1,
    id: raw.id,
    name: raw.name.trim(),
    version: raw.version,
    description: raw.description,
    effects,
  };
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
      try {
        return [{ manifest: parseEffectPack(item.manifest), enabled: item.enabled === true }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveEffectPacks(packs: InstalledEffectPack[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
}

export const EFFECT_PLUGIN_TEMPLATE: EffectPackManifest = {
  manifestVersion: 1,
  id: "example.my-effects",
  name: "My Effects Pack",
  version: "1.0.0",
  description: "A small set of custom looks for LibreCut.",
  effects: [
    { name: "Soft teal", category: "Color", values: { saturation: 1.1, hue: 12, contrast: 1.06 } },
    { name: "Dark vignette", category: "Cinematic", values: { vignette: 0.55, contrast: 1.12 } },
  ],
};
