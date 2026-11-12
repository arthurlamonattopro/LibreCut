import { Languages } from "lucide-react";
import { LOCALES, useLocale, useT } from "../lib/i18n";

/**
 * Interface-language picker. Options are always listed in their own language so
 * someone who cannot read the current UI can still find their locale.
 */
export function LocaleSelect({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const locale = useLocale((state) => state.locale);
  const setLocale = useLocale((state) => state.setLocale);

  if (compact) {
    return (
      <label
        className="flex items-center gap-1.5 rounded-md border border-line-soft bg-surface px-2 py-1 text-[10.5px] text-muted transition focus-within:border-accent hover:text-ink"
        title={t("Interface language")}
      >
        <Languages size={12} aria-hidden="true" />
        <span className="sr-only">{t("Interface language")}</span>
        <select
          className="cursor-pointer bg-transparent text-[10.5px] text-inherit outline-none"
          value={locale}
          onChange={(event) => setLocale(event.target.value as typeof locale)}
          aria-label={t("Interface language")}
        >
          {LOCALES.map((item) => (
            <option key={item.id} value={item.id} className="bg-panel text-ink">
              {item.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="label" id="interface-language-label">{t("Interface language")}</span>
      <div className="flex items-center gap-2">
        <Languages size={15} className="shrink-0 text-dim" aria-hidden="true" />
        <select
          className="field"
          value={locale}
          onChange={(event) => setLocale(event.target.value as typeof locale)}
          aria-labelledby="interface-language-label"
        >
          {LOCALES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} — {item.englishLabel}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}
