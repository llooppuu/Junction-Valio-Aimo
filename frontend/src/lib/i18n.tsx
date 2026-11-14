import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, fi, type MessageKey } from "./messages";

export type Language = "en" | "fi";

export const LANGUAGES: { code: Language; short: string; name: string }[] = [
  { code: "en", short: "EN", name: "English" },
  { code: "fi", short: "FI", name: "Suomi" },
];

const STORAGE_KEY = "tta-language";
const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, fi };

function initialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fi") return saved;
  } catch {
    // Storage can be blocked. The browser's language decides instead.
  }
  return navigator.language.toLowerCase().startsWith("fi") ? "fi" : "en";
}

/**
 * The language in use, for helpers outside React such as the formatters. The
 * provider sets it before it re-renders, so every render reads the new value.
 */
let current: Language = initialLanguage();

export function getLanguage(): Language {
  return current;
}

export type Params = Record<string, string | number>;

export function translate(language: Language, key: MessageKey, params?: Params): string {
  const template = DICTIONARIES[language][key] ?? en[key];
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}

/** Translates in the current language, for helpers outside components. */
export function tr(key: MessageKey, params?: Params): string {
  return translate(current, key, params);
}

export interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, params?: Params) => string;
  /** Picks the singular or plural message for a count, and passes the count as {count}. */
  tn: (key: MessageKey, count: number, params?: Params) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(current);

  const setLanguage = useCallback((next: Language) => {
    current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
    setState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18n>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
      tn: (key, count, params) => {
        const base = String(key).replace(/\.(one|other)$/, "");
        return translate(language, `${base}.${count === 1 ? "one" : "other"}` as MessageKey, { count, ...params });
      },
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n needs a LanguageProvider.");
  return value;
}
