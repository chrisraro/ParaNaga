// UI languages (ADR 011, docs/plans/2026-10-21-i18n-filipino-bikol.md). Pure: no React, no I/O, so
// src/domain can use it; public/theme-init.js repeats the same rules before the first paint.

export const LOCALES = ["en", "fil", "bcl"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Central Bikol stays hidden until a native Naga speaker has approved every key (guard test in
 * tests/unit/i18n-guards.test.ts). public/theme-init.js mirrors this flag.
 */
export const BIKOL_ENABLED: boolean = false;

/** Filipino stays hidden until its strings pass the draft + Jev check and the opus review (plan T10). public/theme-init.js mirrors this flag. */
export const FILIPINO_ENABLED: boolean = true;

export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

/** A locale the user may have (Bikol only once enabled). */
export function isEnabledLocale(value: unknown): value is Locale {
  return isLocale(value) && (value === "en" || (value === "fil" && FILIPINO_ENABLED) || (value === "bcl" && BIKOL_ENABLED));
}

/** First open: the first phone language we have (fil/tl → fil; bcl once enabled; en), else English. */
export function phoneLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if ((base === "fil" || base === "tl") && FILIPINO_ENABLED) return "fil";
    if (base === "en" || (base === "bcl" && BIKOL_ENABLED)) return base;
  }
  return DEFAULT_LOCALE;
}

/** The UI language: the choice saved in More wins, else the phone's languages. */
export function resolveLocale(chosen: Locale | undefined, languages: readonly string[]): Locale {
  return chosen && isEnabledLocale(chosen) ? chosen : phoneLocale(languages);
}

/** Intl locale for dates and sorting. No CLDR data exists for `bcl`; its months follow Filipino. */
export function formatLocale(locale: Locale): "en-PH" | "fil-PH" {
  return locale === "en" ? "en-PH" : "fil-PH";
}
