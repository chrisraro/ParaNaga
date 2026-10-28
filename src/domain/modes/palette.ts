// Mode colour palettes (Palette L and Palette D), line-width tokens, and WCAG 2.2 AA 1.4.11
// non-text contrast calculations. Pure: no DOM, no I/O.
//
// Two palettes:
//  - Palette L (white `#FFFFFF` casing) whenever raster tiles are drawn, and in light theme.
//  - Palette D (`#0B1220` casing) only when the theme is dark AND no tiles are drawn (low-data
//    mode or no tile URL), so lines sit on dark land `#1E2633`.
//
// Every core meets ≥ 3.0 contrast against its casing and surface, and ≥ 5.0 (L) / ≥ 5.5 (D)
// against the legend sheet backgrounds.

export const PALETTE_KEYS = [
  "traditional_puj",
  "modern_puj",
  "mixed_trad_modern",
  "tricycle",
  "e_tricycle",
  "uv_express",
  "bus",
  "unconfirmed",
  "walk",
  "rail",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type MapSurface = "light" | "dark";
export type LinePattern = "solid" | "two_tone" | "dotted" | "marker_only";

export type PaletteToken = {
  core: string;
  /** Present on `mixed_trad_modern`: modern overlay segments drawn (`24 24`) over the traditional base. */
  secondaryCore: string | null;
  casing: string;
  glyph: string;
  pattern: LinePattern;
};

export const LIGHT_SURFACES = {
  casing: "#FFFFFF",
  land: "#F2EFE9",
  osmRoad: "#FCD6A4",
  sheet: "#FFFFFF",
} as const;

export const DARK_SURFACES = {
  casing: "#0B1220",
  land: "#1E2633",
  sheet: "#111A2E",
} as const;

export const PALETTE_L: Record<PaletteKey, PaletteToken> = {
  traditional_puj: { core: "#B45309", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "solid" },
  modern_puj: { core: "#1D4ED8", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "solid" },
  mixed_trad_modern: { core: "#B45309", secondaryCore: "#1D4ED8", casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "two_tone" },
  tricycle: { core: "#A21CAF", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "solid" },
  e_tricycle: { core: "#0E7490", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "solid" },
  uv_express: { core: "#BE123C", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "marker_only" },
  bus: { core: "#6D28D9", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "marker_only" },
  unconfirmed: { core: "#57534E", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "solid" },
  walk: { core: "#0F1E3D", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "dotted" },
  rail: { core: "#0F1E3D", secondaryCore: null, casing: "#FFFFFF", glyph: "#FFFFFF", pattern: "marker_only" },
};

export const PALETTE_D: Record<PaletteKey, PaletteToken> = {
  traditional_puj: { core: "#F59E0B", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "solid" },
  modern_puj: { core: "#60A5FA", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "solid" },
  mixed_trad_modern: { core: "#F59E0B", secondaryCore: "#60A5FA", casing: "#0B1220", glyph: "#0B1220", pattern: "two_tone" },
  tricycle: { core: "#E879F9", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "solid" },
  e_tricycle: { core: "#22D3EE", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "solid" },
  uv_express: { core: "#FB7185", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "marker_only" },
  bus: { core: "#A78BFA", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "marker_only" },
  unconfirmed: { core: "#D6D3D1", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "solid" },
  walk: { core: "#E2E8F0", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "dotted" },
  rail: { core: "#E2E8F0", secondaryCore: null, casing: "#0B1220", glyph: "#0B1220", pattern: "marker_only" },
};

/**
 * Chooses `[data-map-surface]` for `.pn-map`: Palette D is used only when the theme is dark and
 * no raster tiles are drawn; whenever tiles are drawn (even in dark theme), Palette L is used so
 * lines contrast against the light OSM basemap.
 */
export function mapSurface(theme: "light" | "dark", tilesDrawn: boolean): MapSurface {
  return theme === "dark" && !tilesDrawn ? "dark" : "light";
}

export function paletteForSurface(surface: MapSurface): Record<PaletteKey, PaletteToken> {
  return surface === "dark" ? PALETTE_D : PALETTE_L;
}

export const WALK_DASH_ARRAY = "1 9" as const;
/** Padyak is drawn in the tricycle colour, dashed, so colour is never the only cue (plan E, UI changes). */
export const PADYAK_DASH_ARRAY = "8 6" as const;
export const TWO_TONE_DASH_ARRAY = "24 24" as const;
export const CHEVRON_SPACING_M = 250;

export type LineWidths = {
  tripRideCorePx: number;
  walkDotPx: number;
  overviewCorePx: number;
  selectedOverviewCorePx: number;
  casingSidePx: number;
  overviewCasingSidePx: number;
};

/** Line and casing widths; in high contrast every core width gets +1 px and casing side is 3 px. */
export function lineWidths(highContrast = false): LineWidths {
  const bump = highContrast ? 1 : 0;
  return {
    tripRideCorePx: 6 + bump,
    walkDotPx: 5 + bump,
    overviewCorePx: 3 + bump,
    selectedOverviewCorePx: 5 + bump,
    casingSidePx: highContrast ? 3 : 2,
    overviewCasingSidePx: highContrast ? 3 : 1.5,
  };
}

function parseHexRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Invalid 6-digit hex colour: ${hex}`);
  }
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

function channelLinear(c8: number): number {
  const s = c8 / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a 6-digit `#RRGGBB` colour in `[0, 1]`. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex);
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

/** WCAG 2.x contrast ratio `(L1 + 0.05) / (L2 + 0.05)` in `[1, 21]`. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
