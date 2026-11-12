import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogKeys,
  currentLocale,
  isLocale,
  LOCALES,
  t,
  useLocale,
} from "../src/lib/i18n";

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
