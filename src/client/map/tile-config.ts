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
  const attribution = clean(env.NEXT_PUBLIC_TILE_ATTRIBUTION) ?? OSM_ATTRIBUTION;
  if (url) return { url, attribution };
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
