// Basemap tile source (Global Constraints → Tiles). Pure: callers pass the env so the
// NEXT_PUBLIC_* values are inlined at build time where they are read (see `currentTileConfig`).

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export type TileEnv = {
  NEXT_PUBLIC_TILE_URL?: string | undefined;
  NEXT_PUBLIC_TILE_ATTRIBUTION?: string | undefined;
  NODE_ENV?: string | undefined;
};

export type TileConfig = {
  /** Raster tile URL template, or null to render no basemap. */
  url: string | null;
  attribution: string;
};

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function tileConfig(env: TileEnv): TileConfig {
  const url = clean(env.NEXT_PUBLIC_TILE_URL);
  let attribution = clean(env.NEXT_PUBLIC_TILE_ATTRIBUTION);
  if (url) {
    let host = "";
    try { host = new URL(url).hostname; } catch { return { url: null, attribution: OSM_ATTRIBUTION }; }
    if (host === "api.maptiler.com") {
      attribution ??= "© MapTiler © OpenStreetMap contributors";
      if (!attribution.includes("© MapTiler")) attribution += " © MapTiler";
    } else if (!attribution && host !== "tile.openstreetmap.org" && env.NODE_ENV === "production") {
      // Unknown providers have their own terms: missing credits must not silently become OSM-only.
      return { url: null, attribution: OSM_ATTRIBUTION };
    }
    attribution ??= OSM_ATTRIBUTION;
    if (!attribution.includes(OSM_ATTRIBUTION)) attribution += ` ${OSM_ATTRIBUTION}`;
    return { url, attribution };
  }
  // The public OSM tile server is for development and tests only (OSM tile usage policy).
  if (env.NODE_ENV === "production") return { url: null, attribution: OSM_ATTRIBUTION };
  return { url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
}

/** The app's tile config. Each variable is read literally so Next inlines it into the bundle. */
export function currentTileConfig(): TileConfig {
  return tileConfig({
    NEXT_PUBLIC_TILE_URL: process.env.NEXT_PUBLIC_TILE_URL,
    NEXT_PUBLIC_TILE_ATTRIBUTION: process.env.NEXT_PUBLIC_TILE_ATTRIBUTION,
    NODE_ENV: process.env.NODE_ENV,
  });
}

/** One segment of the attribution: plain text, or a link to a known copyright page. */
export type AttributionPart = { text: string; href?: string };

const ATTRIBUTION_LINKS: Record<string, string> = {
  "© MapTiler": "https://www.maptiler.com/copyright/",
  "© OpenStreetMap contributors": "https://www.openstreetmap.org/copyright",
};
const ATTRIBUTION_LINK_RE = /© MapTiler|© OpenStreetMap contributors/g;

/** Splits configured attribution text into text and link parts. Env text is never treated as HTML. */
export function attributionParts(text: string): AttributionPart[] {
  const parts: AttributionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(ATTRIBUTION_LINK_RE)) {
    const start = match.index;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: match[0], href: ATTRIBUTION_LINKS[match[0]] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
