import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEffectPack, PLUGIN_API_VERSION } from "../src/lib/plugins";

/**
 * The community preset packs that ship with LibreCut.
 *
 * The editor validates a manifest when it is installed, so a pack that does
 * not parse is a pack a user cannot install. This test parses every shipped
 * pack with the editor's own parser, which keeps the repository from
 * publishing a file the app would refuse.
 */
const PRESET_DIR = fileURLToPath(new URL("../presets/community", import.meta.url));

function packFiles(): string[] {
  return readdirSync(PRESET_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readPack(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${PRESET_DIR}/${name}`, "utf8")) as Record<string, unknown>;
}

describe("community preset packs", () => {
  it("ships at least one pack", () => {
    expect(packFiles().length).toBeGreaterThan(0);
  });

  for (const file of packFiles()) {
    describe(file, () => {
      const raw = readPack(file);

      it("is accepted by the plugin parser", () => {
        const manifest = parseEffectPack(raw);
        expect(manifest.id).toBe(raw.id);
        expect(manifest.name).toBe(raw.name);
        expect(manifest.effects.length + (manifest.textPresets?.length ?? 0)).toBeGreaterThan(0);
      });

      it("asks for no permissions and targets the current API", () => {
        expect(raw.permissions).toEqual([]);
        expect(raw.apiVersion).toBe(`^${PLUGIN_API_VERSION}`);
      });

      it("is dedicated to the public domain", () => {
        expect(raw.license).toBe("CC0-1.0");
      });

      it("stays inside the size limit of the plugin format", () => {
        expect(statSync(`${PRESET_DIR}/${file}`).size).toBeLessThanOrEqual(256 * 1024);
      });

      it("names every preset uniquely", () => {
        const manifest = parseEffectPack(raw);
        const names = [
          ...manifest.effects.map((effect) => effect.name),
          ...(manifest.textPresets ?? []).map((preset) => preset.name),
        ];
        expect(new Set(names).size).toBe(names.length);
      });

      it("does not repeat a built-in filter name", () => {
        const manifest = parseEffectPack(raw);
        const builtIn = [
          "Brighten", "Darken", "Blur", "Vignette", "Fade in", "Fade out",
          "Motion blur", "High contrast", "Soft contrast", "Soft focus",
          "Vibrant", "Muted", "Black & white", "Warm", "Cool", "Sunset",
          "Arctic", "Teal & orange", "Rose", "Purple haze",
          "Vintage", "Sepia", "Film fade", "Noir",
          "Bleach bypass", "Cinematic", "Golden hour", "Blue hour",
          "Dream", "Haze", "Pastel", "Glow",
        ];
        const names = manifest.effects.map((effect) => effect.name);
        for (const name of names) {
          expect(builtIn, name).not.toContain(name);
        }
      });
    });
  }
});
