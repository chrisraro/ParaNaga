"use client";

// UI language for React (ADR 011). The locale is a device preference (src/client/prefs), or the
// phone's language until one is chosen. The server render and hydration are English (static
// shells for the service worker); the stored locale's dictionary loads right after. Without a
// provider (unit tests) everything reads English.
import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { readPrefs, subscribePrefs, updatePrefs } from "@/client/prefs/use-prefs";
import { en, loadDict, type Dict } from "./dict";
import { DEFAULT_LOCALE, resolveLocale, type Locale } from "./locales";

type Value = { locale: Locale; t: Dict };
const ENGLISH: Value = { locale: "en", t: en };
const LocaleContext = createContext<Value>(ENGLISH);

const readLocale = () => resolveLocale(readPrefs().locale, navigator.languages);
const readServerLocale = () => DEFAULT_LOCALE;

export function LocaleProvider({ children }: { children: ReactNode }) {
  const wanted = useSyncExternalStore(subscribePrefs, readLocale, readServerLocale);
  const [loaded, setLoaded] = useState<Value | null>(null);
  useEffect(() => {
    if (wanted === "en") return;
    let live = true;
    void loadDict(wanted).then((t) => {
      if (live) setLoaded({ locale: wanted, t });
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  const value = loaded?.locale === wanted ? loaded : ENGLISH;
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

/** The current dictionary: `const t = useT(); t.app.tagline`, or pass `t.<area>` to a domain copy function. */
export const useT = (): Dict => use(LocaleContext).t;

/** The locale whose dictionary is showing (use with formatLocale for dates). */
export const useLocale = (): Locale => use(LocaleContext).locale;

/** Saves the user's language choice; `undefined` goes back to following the phone. */
export function setLocale(locale: Locale | undefined): void {
  updatePrefs({ locale });
}
