import { LOCALES, type Locale } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { cn } from "../lib/format";

// Each language is named in itself, the convention for language pickers.
const LANGUAGES: Record<Locale, { short: string; name: string }> = {
  en: { short: "EN", name: "English" },
  ru: { short: "RU", name: "Русский" },
};

/** Two-way EN/RU segmented control. */
export function LanguageToggle({
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: Locale;
  onChange: (locale: Locale) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex shrink-0 rounded-full border border-line bg-panel p-0.5", className)}
    >
      {LOCALES.map((locale) => {
        const active = locale === value;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={LANGUAGES[locale].name}
            title={LANGUAGES[locale].name}
            lang={locale}
            onClick={() => onChange(locale)}
            className={cn(
              "rounded-full font-mono font-semibold tracking-wide transition-colors duration-200",
              size === "sm" ? "h-6 px-2 text-[10px]" : "h-7 px-2.5 text-[11px]",
              active ? "bg-accent text-on-accent" : "text-ink-soft hover:text-ink",
            )}
          >
            {LANGUAGES[locale].short}
          </button>
        );
      })}
    </div>
  );
}

/** Switches the interface language (and, when signed in, the account's language). */
export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale, m } = useI18n();
  return <LanguageToggle value={locale} onChange={setLocale} label={m.nav.language} className={className} />;
}
