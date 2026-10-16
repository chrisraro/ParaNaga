// What the home map draws in each scene, as pure functions (the "lines and legend always show"
// rule). The route lines and the legend must never vanish because the person moved on to another
// step: picking a point, opening a trip, or being guided.
//
//   idle / options  overview lines, tappable routes, terminals, Layers button
//   picking         overview lines stay (not tappable), no terminals / Layers
//   detail          the trip's lines (walk dotted, rides solid)
//   guiding         the trip's lines too, the current leg emphasised
//
// A trip scene whose revision lines are not loaded (low-data, offline, 404) falls back to the
// overview lines so the rides are never left undrawn; it never invents a path.

import type { VisualKey } from "@/domain/modes/modes";

export type MapScene = "idle" | "picking" | "detail" | "guiding";

export type MapSceneInput = {
  guiding: boolean;
  /** A trip option (or a saved trip) is open in the sheet. */
  tripOpen: boolean;
  /** The crosshair is up: a point is being chosen on the map. */
  picking: boolean;
};

export function mapScene({ guiding, tripOpen, picking }: MapSceneInput): MapScene {
  if (guiding) return "guiding";
  if (tripOpen) return "detail";
  if (picking) return "picking";
  return "idle";
}

export type MapLayerPolicy = {
  scene: MapScene;
  /** The trip's own lines (walk dotted + ride slices) are drawn. */
  tripLines: boolean;
  /** The overview route lines are drawn (behind the trip lines when both show). */
  overviewLines: boolean;
  /** Overview routes are tappable and the Layers button / terminals show (idle only). */
  overviewInteractive: boolean;
  /** The legend button is present. Always true. */
  legend: true;
};

export type MapLayerPolicyInput = MapSceneInput & {
  /** The trip has at least one ride leg that the lines should draw. */
  tripHasRides: boolean;
  /** The trip revision's lines are loaded (not skipped, offline, or failed). */
  tripLinesLoaded: boolean;
};

export function mapLayerPolicy(input: MapLayerPolicyInput): MapLayerPolicy {
  const scene = mapScene(input);
  const trip = scene === "detail" || scene === "guiding";
  const fallback = trip && input.tripHasRides && !input.tripLinesLoaded;
  return {
    scene,
    tripLines: trip,
    overviewLines: !trip || fallback,
    overviewInteractive: scene === "idle",
    legend: true,
  };
}

/**
 * The vehicle classes the legend lists: what the trip draws (during a trip) and what the overview
 * draws, in a stable order, then the walking entry, which is always there.
 */
export function legendVisualKeys(tripKeys: readonly VisualKey[] | null, overviewKeys: readonly VisualKey[]): VisualKey[] {
  const out: VisualKey[] = [];
  for (const key of [...(tripKeys ?? []), ...overviewKeys]) {
    if (key !== "walk" && !out.includes(key)) out.push(key);
  }
  out.push("walk");
  return out;
}
