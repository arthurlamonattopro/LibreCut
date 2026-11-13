import { useCallback } from "react";
import { create } from "zustand";
import esCatalog from "../locales/es.json";
import ptBRCatalog from "../locales/pt-BR.json";

/**
 * Interface localization for LibreCut.
 *
 * English source copy is used as the message key so a missing translation always
 * falls back to readable English instead of a raw identifier. Interpolate values
 * with `{name}` placeholders. AI transcription/speech languages are intentionally
 * separate from interface locales — see `LANGUAGES` in the AI studio.
 */
export type Locale = "en" | "es" | "pt-BR";

export interface LocaleOption {
  id: Locale;
  /** Label in the locale's own language, as language pickers conventionally do. */
  label: string;
  /** English name, useful for screen-reader context and diagnostics. */
  englishLabel: string;
  /** BCP 47 tag passed to Intl. */
  intl: string;
}

export const LOCALES: readonly LocaleOption[] = [
  { id: "en", label: "English", englishLabel: "English", intl: "en" },
  { id: "es", label: "Español", englishLabel: "Spanish", intl: "es" },
  { id: "pt-BR", label: "Português (Brasil)", englishLabel: "Portuguese (Brazil)", intl: "pt-BR" },
] as const;

const STORAGE_KEY = "librecut.locale.v1";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "es" || value === "pt-BR";
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* Storage can be unavailable in hardened webviews; fall back to the OS. */
  }
  const navigatorLanguage = typeof navigator === "undefined" ? "en" : navigator.language;
  const normalized = navigatorLanguage.toLowerCase();
  if (normalized.startsWith("pt")) return "pt-BR";
  if (normalized.startsWith("es")) return "es";
  return "en";
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocale = create<LocaleState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* Keep the choice for this session if storage is unavailable. */
    }
    applyDocumentLocale(locale);
    set({ locale });
  },
}));

function applyDocumentLocale(locale: Locale) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function currentLocale(): Locale {
  return useLocale.getState().locale;
}

export function localeIntl(locale: Locale = currentLocale()): string {
  return LOCALES.find((item) => item.id === locale)?.intl ?? "en";
}

/**
 * English source copy -> translated copy.
 *
 * Catalogs live in `src/locales/<locale>.json` as flat objects. English is the
 * source language, so it has no catalog: an untranslated key falls back to its
 * own English text. See `docs/architecture.md` before adding a locale.
 */
type Catalog = Record<string, string>;

const CATALOGS: Record<Locale, Catalog> = {
  en: {},
  es: esCatalog,
  "pt-BR": ptBRCatalog,
};

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * Translate an English source string for the active locale.
 *
 * Safe to call outside React (toasts, error handlers): it reads the current
 * store value rather than subscribing. Components that must re-render when the
 * locale changes should use `useT()` instead.
 */
export function t(source: string, values?: Record<string, string | number>): string {
  const locale = currentLocale();
  const translated = CATALOGS[locale][source] ?? source;
  return interpolate(translated, values);
}

/** Component hook that re-renders when the interface language changes. */
export function useT() {
  const locale = useLocale((state) => state.locale);
  return useCallback(
    (source: string, values?: Record<string, string | number>) => {
      const translated = CATALOGS[locale][source] ?? source;
      return interpolate(translated, values);
    },
    [locale],
  );
}

export function useLocaleOption(): LocaleOption {
  const locale = useLocale((state) => state.locale);
  return LOCALES.find((item) => item.id === locale) ?? LOCALES[0];
}

export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  locale: Locale = currentLocale(),
): string {
  return new Intl.DateTimeFormat(localeIntl(locale), options).format(value);
}

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: Locale = currentLocale(),
): string {
  return new Intl.NumberFormat(localeIntl(locale), options).format(value);
}

/** Shorter "Updated …" labels used by the project library. */
export function relativeDate(timestamp: number, locale: Locale = currentLocale()): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return translateFor(locale, "just now");
  if (diff < hour) return translateFor(locale, "{count}m ago", { count: Math.floor(diff / minute) });
  if (diff < day) return translateFor(locale, "{count}h ago", { count: Math.floor(diff / hour) });
  if (diff < 7 * day) return translateFor(locale, "{count}d ago", { count: Math.floor(diff / day) });
  return formatDate(timestamp, { dateStyle: "medium" }, locale);
}

function translateFor(locale: Locale, source: string, values?: Record<string, string | number>): string {
  return interpolate(CATALOGS[locale][source] ?? source, values);
}

/** Applies the saved locale to <html lang> as soon as the module loads. */
applyDocumentLocale(useLocale.getState().locale);

/**
 * Catalog completeness guard for tests: every key translated in one locale must
 * have a counterpart in every other locale.
 */
export function catalogKeys(locale: Exclude<Locale, "en">): string[] {
  return Object.keys(CATALOGS[locale]).sort();
}
