// Device preferences (Increment A, Task 2; decision D3: kept in localStorage on this phone, never
// sent anywhere). localStorage rather than IndexedDB because the theme must be read synchronously
// before the first paint (public/theme-init.js reads the same key). Pure: parsing only, no I/O.
//
// No units setting (metric only, matching the data), no fare-category or language setting
// (discounts are unverified and there is no reviewed translation, decision D8).
import { z } from "zod";

export const PREFS_STORAGE_KEY = "paranaga.prefs";

export const THEMES = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEMES)[number];

export type Prefs = {
  /** "system" follows the device; "light" / "dark" override it. */
  theme: ThemePref;
  /** Stronger text and borders (`data-contrast="more"` on <html>). */
  highContrast: boolean;
  /** No map background (no tile requests); pins and trip steps still show. */
  lowData: boolean;
  /** Keep a trip history on this device. Off by default. */
  historyEnabled: boolean;
};

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  theme: "system",
  highContrast: false,
  lowData: false,
  historyEnabled: false,
});

// Each field falls back to its default on its own, so one bad value does not reset the others.
const prefsSchema = z.object({
  theme: z.enum(THEMES).catch(DEFAULT_PREFS.theme),
  highContrast: z.boolean().catch(DEFAULT_PREFS.highContrast),
  lowData: z.boolean().catch(DEFAULT_PREFS.lowData),
  historyEnabled: z.boolean().catch(DEFAULT_PREFS.historyEnabled),
});

/** Stored text → preferences. Missing, malformed or non-object data gives the defaults. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...DEFAULT_PREFS };
  const parsed = prefsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_PREFS };
}

export function serializePrefs(prefs: Prefs): string {
  const { theme, highContrast, lowData, historyEnabled } = prefs;
  return JSON.stringify({ theme, highContrast, lowData, historyEnabled });
}
