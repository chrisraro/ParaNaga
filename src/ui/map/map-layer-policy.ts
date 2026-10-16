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

/** How the trip revision's lines fetch stands: still going, in, or ended without lines (error / saving data). */
export type TripLinesStatus = "loading" | "ready" | "failed";

export type MapLayerPolicy = {
  scene: MapScene;
  /** The trip's own lines (walk dotted + ride slices) are drawn. */
  tripLines: boolean;
  /** The overview route lines are drawn (behind the trip lines when both show). */
  overviewLines: boolean;
  /** The overview is only a stand-in for the trip's rides: clip it to them, dimmed, not tappable. */
  overviewStandIn: boolean;
  /** The trip's rides could not be drawn from their own lines (say so in the legend). */
  tripLinesMissing: boolean;
  /** Overview routes are tappable and the Layers button / terminals show (idle only). */
  overviewInteractive: boolean;
  /** The legend button is present. Always true. */
  legend: true;
};

export type MapLayerPolicyInput = MapSceneInput & {
  /** The trip has at least one ride leg that the lines should draw. */
  tripHasRides: boolean;
  tripLinesStatus: TripLinesStatus;
  /** The trip's revision is the snapshot's (so the overview is the same network as its variants). */
  sameRevisionAsOverview: boolean;
};

export function mapLayerPolicy(input: MapLayerPolicyInput): MapLayerPolicy {
  const scene = mapScene(input);
  const trip = scene === "detail" || scene === "guiding";
  // Missing only once the fetch ended without lines: never while it is still loading (no flash).
  const missing = trip && input.tripHasRides && input.tripLinesStatus === "failed";
  const standIn = missing && input.sameRevisionAsOverview;
  return {
    scene,
    tripLines: trip,
    overviewLines: !trip || standIn,
    overviewStandIn: standIn,
    tripLinesMissing: missing,
    overviewInteractive: scene === "idle",
    legend: true,
  };
}

/**
 * The vehicle classes the legend lists: what the trip draws (during a trip) and what the overview
 * draws, in a stable order, then the walking entry when a walk is drawn or no trip is open.
 */
export function legendVisualKeys(tripKeys: readonly VisualKey[] | null, overviewKeys: readonly VisualKey[]): VisualKey[] {
  const out: VisualKey[] = [];
  for (const key of [...(tripKeys ?? []), ...overviewKeys]) {
    if (key !== "walk" && !out.includes(key)) out.push(key);
  }
  if (tripKeys === null || tripKeys.includes("walk")) out.push("walk");
  return out;
}

/** The overview lines of exactly the variants the trip rides (variant id only, never the route code). */
export function overviewLinesForTrip<T extends { variantId: string }>(lines: readonly T[], rideVariantIds: readonly string[]): T[] {
  const ids = new Set(rideVariantIds);
  return lines.filter((l) => ids.has(l.variantId));
}

export const TRIP_LINES_MISSING_NOTE = "Route lines for this trip didn't load." as const;
export const TRIP_LINES_OVERVIEW_NOTE = "Route lines for this trip didn't load; showing the route overview." as const;
