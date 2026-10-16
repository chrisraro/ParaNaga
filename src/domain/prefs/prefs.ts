// Device preferences (Increment A, Task 2; decision D3: kept in localStorage on this phone, never
// sent anywhere). localStorage rather than IndexedDB because the theme must be read synchronously
// before the first paint (public/theme-init.js reads the same key). Pure: parsing only, no I/O.
//
// No units setting (metric only, matching the data), no fare-category or language setting
// (discounts are unverified and there is no reviewed translation, decision D8).
// Increment D, Task 12 (decision D16): adds `layers` for the map overview and mode filter. D16's
// "Show historical routes" switch was removed with the e-jeepney route (ruling 2026-10-16): no
// historical route is published; a stored `historical` key is dropped on parse.
import { z } from "zod";
import { ROUTE_MODES, type RouteMode } from "../modes/fleet";

export const PREFS_STORAGE_KEY = "paranaga.prefs";

export const THEMES = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEMES)[number];

export type LayersPref = {
  /** Routes overview on the home map when no trip is shown (D16: on by default). */
  routes: boolean;
  /** Terminals layer on the home map (D16: on by default). */
  terminals: boolean;
  /** Selected mode filter chips; empty array means "All" modes are shown. */
  modes: RouteMode[];
};

export const DEFAULT_LAYERS_PREF: Readonly<LayersPref> = Object.freeze({
  routes: true,
  terminals: true,
  modes: [],
});

export type Prefs = {
  /** "system" follows the device; "light" / "dark" override it. */
  theme: ThemePref;
  /** Stronger text and borders (`data-contrast="more"` on <html>). */
  highContrast: boolean;
  /** No map background (no tile requests); pins and trip steps still show. */
  lowData: boolean;
  /** Keep a trip history on this device. Off by default. */
  historyEnabled: boolean;
  /** Map layers and mode filter (D16). */
  layers: LayersPref;
};

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  theme: "system",
  highContrast: false,
  lowData: false,
  historyEnabled: false,
  layers: DEFAULT_LAYERS_PREF,
});

const modeEnum = z.enum(ROUTE_MODES);

const layersSchema = z
  .object({
    routes: z.boolean().catch(DEFAULT_LAYERS_PREF.routes),
    terminals: z.boolean().catch(DEFAULT_LAYERS_PREF.terminals),
    modes: z
      .array(z.unknown())
      .transform((arr) => {
        const out: RouteMode[] = [];
        for (const item of arr) {
          const parsed = modeEnum.safeParse(item);
          if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data);
        }
        return out;
      })
      .catch([]),
  })
  .catch({ ...DEFAULT_LAYERS_PREF, modes: [] });

// Each field falls back to its default on its own, so one bad value does not reset the others.
const prefsSchema = z.object({
  theme: z.enum(THEMES).catch(DEFAULT_PREFS.theme),
  highContrast: z.boolean().catch(DEFAULT_PREFS.highContrast),
  lowData: z.boolean().catch(DEFAULT_PREFS.lowData),
  historyEnabled: z.boolean().catch(DEFAULT_PREFS.historyEnabled),
  layers: layersSchema,
});

function cloneDefaultPrefs(): Prefs {
  return {
    ...DEFAULT_PREFS,
    layers: { ...DEFAULT_LAYERS_PREF, modes: [] },
  };
}

/** Stored text → preferences. Missing, malformed or non-object data gives the defaults. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return cloneDefaultPrefs();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return cloneDefaultPrefs();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return cloneDefaultPrefs();
  const parsed = prefsSchema.safeParse(value);
  return parsed.success ? parsed.data : cloneDefaultPrefs();
}

export function serializePrefs(prefs: Prefs): string {
  const { theme, highContrast, lowData, historyEnabled, layers = DEFAULT_LAYERS_PREF } = prefs;
  return JSON.stringify({
    theme,
    highContrast,
    lowData,
    historyEnabled,
    layers: {
      routes: layers.routes,
      terminals: layers.terminals,
      modes: [...layers.modes],
    },
  });
}
