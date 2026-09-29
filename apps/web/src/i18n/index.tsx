import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@lightbulb/shared";
import { DEFAULT_LOCALE, type Locale } from "@lightbulb/shared/constants";
import { api, ApiError } from "../lib/api";
import { keys, queryClient, useMe } from "../lib/queries";
import { en, type Messages, type Plural } from "./en";
import { ru } from "./ru";

const MESSAGES: Record<Locale, Messages> = { en, ru };
const STORAGE_KEY = "lb-locale";

type Params = Record<string, string | number>;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "en" || value === "ru" ? value : null;
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this visit.
  }
}

/** This device's last choice, else the browser's language. */
const initialLocale = (): Locale =>
  readStoredLocale() ?? (navigator.language?.toLowerCase().startsWith("ru") ? "ru" : DEFAULT_LOCALE);

function build(locale: Locale, setLocale: (locale: Locale) => void) {
  const m = MESSAGES[locale];
  const pluralRules = new Intl.PluralRules(locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  /** Fills {name} placeholders. */
  const fmt = (template: string, params: Params = {}) =>
    template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));

  /** Picks the plural form for n (Russian has one/few/many) and fills {n} plus any params. */
  const plural = (forms: Plural, n: number, params: Params = {}) => {
    const category = pluralRules.select(n);
    const template =
      category === "one" || category === "few" || category === "many" ? (forms[category] ?? forms.other) : forms.other;
    return fmt(template, { n, ...params });
  };

  /** Like fmt(), but placeholders become elements: rich(m.bar.enterHint, { enter: <Kbd>Enter</Kbd> }). */
  const rich = (template: string, nodes: Record<string, ReactNode>): ReactNode =>
    template.split(/(\{\w+\})/).map((part, i) => {
      const key = /^\{(\w+)\}$/.exec(part)?.[1];
      return key && key in nodes ? <Fragment key={i}>{nodes[key]}</Fragment> : part;
    });

  const timeAgo = (iso: string) => {
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    for (const [unit, size] of UNITS) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return m.time.justNow;
  };

  const fullDate = (iso: string) => dateTime.format(new Date(iso));

  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const fileSize = (bytes: number) =>
    bytes < 1024
      ? `${bytes} ${m.units.b}`
      : bytes < 1024 * 1024
        ? `${decimal.format(bytes / 1024)} ${m.units.kb}`
        : `${decimal.format(bytes / (1024 * 1024))} ${m.units.mb}`;

  /** The message to show for a failed request, in the current language. */
  const errorText = (err: unknown) => {
    if (err instanceof ApiError) return (m.errors as Record<string, string>)[err.code] ?? err.message;
    return err instanceof Error ? err.message : m.errors.internal;
  };

  return { locale, setLocale, m, fmt, plural, rich, timeAgo, fullDate, fileSize, errorText };
}

export type I18n = ReturnType<typeof build>;

const I18nContext = createContext<I18n>(build(DEFAULT_LOCALE, () => {}));

export const useI18n = () => useContext(I18nContext);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const me = useMe();

  // Signed in, the account's language wins: it was set on the sign-in page or with the switch.
  const accountLocale = me.data?.locale;
  useEffect(() => {
    if (accountLocale) {
      setLocaleState(accountLocale);
      storeLocale(accountLocale);
    }
  }, [accountLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
    const user = queryClient.getQueryData<User | null>(keys.me);
    if (user && user.locale !== next) {
      queryClient.setQueryData<User>(keys.me, { ...user, locale: next });
      // Saved to the account so the bot, emails and other devices follow. If it fails,
      // the choice still holds on this device.
      api.updateMe({ locale: next }).catch(() => {});
    }
  }, []);

  const value = useMemo(() => build(locale, setLocale), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
