import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogKeys,
  currentLocale,
  isLocale,
  LOCALES,
  t,
  useLocale,
} from "../src/lib/i18n";
import es from "../src/locales/es.json";
import ptBR from "../src/locales/pt-BR.json";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

afterEach(() => {
  vi.unstubAllGlobals();
  useLocale.getState().setLocale("en");
});

describe("interface localization", () => {
  it("exposes the three interface locales", () => {
    expect(LOCALES.map((locale) => locale.id)).toEqual(["en", "es", "pt-BR"]);
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale("fr")).toBe(false);
  });

  it("interpolates named values", () => {
    useLocale.getState().setLocale("en");
    expect(t("Imported {name}", { name: "clip.mp4" })).toBe("Imported clip.mp4");
    expect(t("Added {count} caption segments to the timeline.", { count: 3 }))
      .toBe("Added 3 caption segments to the timeline.");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("Imported {name} {extra}", { name: "clip.mp4" })).toBe("Imported clip.mp4 {extra}");
  });

  it("falls back to the English source for untranslated keys", () => {
    useLocale.getState().setLocale("es");
    const missing = "A string that has no translation yet.";
    expect(t(missing)).toBe(missing);
  });

  it("switches translation catalogues at runtime", () => {
    useLocale.getState().setLocale("en");
    expect(t("Timeline")).toBe("Timeline");
    useLocale.getState().setLocale("es");
    expect(t("Timeline")).toBe("Línea de tiempo");
    useLocale.getState().setLocale("pt-BR");
    expect(t("Timeline")).toBe("Linha do tempo");
    expect(currentLocale()).toBe("pt-BR");
  });

  it("keeps both catalogues in sync", () => {
    expect(catalogKeys("es")).toEqual(catalogKeys("pt-BR"));
  });

  it("keeps each translation internally consistent", () => {
    for (const [locale, catalog] of [["es", es], ["pt-BR", ptBR]] as const) {
      for (const [source, translated] of Object.entries(catalog)) {
        expect(translated.trim(), `${locale}: ${source}`).not.toBe("");
        expect(placeholders(translated), `${locale}: ${source}`).toEqual(placeholders(source));
      }
    }
  });

  it("persists the chosen locale", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    });
    useLocale.getState().setLocale("pt-BR");
    expect(data.get("librecut.locale.v1")).toBe("pt-BR");
    expect(currentLocale()).toBe("pt-BR");
  });
});
