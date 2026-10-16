// Presentation helpers for provisional trip plans. Pure: copy and formatting only.
//
// Honesty: fares are always "Estimate …" ranges in whole pesos (never "Exact"), distances are
// "≈" estimates, a loop's direction is derived from the order of its mapped pins and labelled so,
// and no-coverage copy never implies a verified route exists.
import type { LatLng } from "../geo/types";
import { modeName, type FleetSummary, type RouteMode } from "../modes/fleet";
import { MAX_ACCESS_WALK_M } from "../planner/labels";
import type { NoCoverageReason } from "../planner/plan";

export type LoopDirection = "clockwise" | "counterclockwise";

/**
 * Direction of a closed ring of stops from the sign of its area (shoelace, x = lng, y = lat,
 * north up). Null for fewer than 3 points or a ring with no area.
 */
export function ringDirection(points: readonly LatLng[]): LoopDirection | null {
  if (points.length < 3) return null;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twiceArea += a.lng * b.lat - b.lng * a.lat;
  }
  if (Math.abs(twiceArea) < 1e-12) return null;
  return twiceArea > 0 ? "counterclockwise" : "clockwise";
}

/** "clockwise" (short) or "clockwise (from pin order)" (long); never presented as verified. */
export function directionText(direction: LoopDirection | null, form: "short" | "long"): string | null {
  if (!direction) return null;
  return form === "long" ? `${direction} (from pin order)` : direction;
}

type FareLike = {
  status: string;
  minCentavos: number | null;
  maxCentavos: number | null;
  /** Ride legs: "traditional_to_modern" on a mixed-fleet route (fares.ts). */
  span?: string;
  /** Ride legs: "fare_rules_and_reports" when riders' reports set the maximum. */
  basis?: string;
};

function pesoRange(minCentavos: number, maxCentavos: number): string {
  const lo = Math.floor(minCentavos / 100);
  const hi = Math.ceil(maxCentavos / 100);
  return lo === hi ? `₱${lo}` : `₱${lo}–₱${hi}`;
}

const FARE_UNAVAILABLE = "Fare estimate unavailable";

/** Trip-level chip: "Estimate ₱X–₱Y", "Fare estimate unavailable" or "No fare (walk)". */
export function fareChipText(fare: FareLike): string {
  if (fare.status === "no_ride") return "No fare (walk)";
  if (fare.status !== "estimate" || fare.minCentavos === null || fare.maxCentavos === null) return FARE_UNAVAILABLE;
  return `Estimate ${pesoRange(fare.minCentavos, fare.maxCentavos)}`;
}

/**
 * Per ride leg, with the caveat on where the numbers come from. A mixed traditional + modern
 * fleet says "traditional to modern rate", and names the riders' reports when they set the
 * maximum; a single-class or unconfirmed fleet keeps the plain rule wording.
 */
export function legFareText(fare: FareLike): string {
  const chip = fareChipText(fare);
  if (chip === FARE_UNAVAILABLE) return chip;
  if (fare.span === "traditional_to_modern") {
    const reports = fare.basis === "fare_rules_and_reports" ? " · from the national fare rule and riders' reports" : "";
    return `${chip} · traditional to modern rate${reports} · matrix not verified`;
  }
  return `${chip} · from reported fare rules · matrix not verified`;
}

/** D13: "≈ 3.4 km along the approximate path" or "≈ 3.1 km stop to stop (straight line)"; never exact. */
export function distanceBasisText(meters: number, basis: "approximate_path" | "stop_to_stop_straight_line"): string {
  return `${formatDistance(meters)} ${basis === "approximate_path" ? "along the approximate path" : "stop to stop (straight line)"}`;
}

/**
 * The vehicle classes of a ride: "Jeepney · traditional and modern (air-conditioned)" on a mixed
 * fleet (aircon only when a source states it), else the route's C7 chip ("Jeepney · traditional",
 * "Jeepney · type not confirmed"). The evidence and dates stay on fleet.classes[].label.
 */
export function rideFleetText(mode: RouteMode, fleet: FleetSummary): string {
  if (fleet.colourKey !== "mixed_trad_modern") return fleet.chip;
  const aircon = fleet.classes.some((c) => c.vehicleClass === "modern_puj" && c.aircon === true);
  return `${modeName(mode)} · traditional and modern${aircon ? " (air-conditioned)" : ""}`;
}

/** "≈ 230 m" (nearest 10 m) below 1 km, else "≈ 5.5 km". */
export function formatDistance(meters: number): string {
  const tens = Math.round(meters / 10) * 10;
  if (tens < 1000) return `≈ ${tens} m`;
  return `≈ ${(meters / 1000).toFixed(1)} km`;
}

export function transfersText(rides: number): string {
  const transfers = Math.max(0, rides - 1);
  if (transfers === 0) return "No transfers";
  return transfers === 1 ? "1 transfer" : `${transfers} transfers`;
}

/** "Loop A" from a name like "Centro–Magsaysay Loop A"; otherwise the public route code. */
export function routeChipLabel(routeCode: string, routeName: string): string {
  const loop = /\bLoop\s+([A-Z])\b/.exec(routeName);
  return loop ? `Loop ${loop[1]}` : routeCode;
}

/**
 * The stop's own name, verbatim (source typos kept). A pin whose source label is empty is named
 * after its code by the import; it shows as "Unnamed pin B18", never with another pin's name.
 */
export function stopDisplayName(name: string, code: string | null): string {
  if (code && name === code) return `Unnamed pin ${code}`;
  return name || (code ? `Unnamed pin ${code}` : "Unnamed stop");
}

/** "Plaza Rizal (A1)"; "Unnamed pin B18" when the pin has no separate label. */
export function stopLabel(name: string, code: string | null): string {
  const display = stopDisplayName(name, code);
  if (!code || display === `Unnamed pin ${code}`) return display;
  return `${display} (${code})`;
}

const ONLY_LOOPS = "Loops A and B are the only routes we can suggest for now.";

/** The one wording for ends within SAME_PLACE_M of each other (planner reason, reducer, pick UI). */
export const SAME_PLACE_TITLE = "Start and destination are the same place";

/** A walk leg shorter than this (estimate, metres) is not a step: the point is at the stop itself. */
export const NEGLIGIBLE_WALK_M = 15;

export function isNegligibleWalk(leg: { kind: string; estimateMeters?: number }): boolean {
  return leg.kind === "walk" && typeof leg.estimateMeters === "number" && leg.estimateMeters < NEGLIGIBLE_WALK_M;
}

/** Per-reason copy: which end is out of reach, and how far the whole walk is (an estimate). */
export function noCoverageCopy(reason: NoCoverageReason | null, directWalkEstimateMeters: number | null): { title: string; detail: string } {
  const walk = directWalkEstimateMeters === null
    ? ONLY_LOOPS
    : `Walking the whole way: ${formatDistance(directWalkEstimateMeters)} (straight-line estimate; path not verified). ${ONLY_LOOPS}`;
  switch (reason) {
    case "same_place":
      return { title: SAME_PLACE_TITLE, detail: "Move the destination pin away from your start to plan a trip." };
    case "outside_city":
      return { title: "Both points need to be inside Naga City", detail: ONLY_LOOPS };
    case "no_stop_near_origin":
      return { title: `No mapped stop within ${MAX_ACCESS_WALK_M} m of your start`, detail: walk };
    case "no_stop_near_destination":
      return { title: `No mapped stop within ${MAX_ACCESS_WALK_M} m of your destination`, detail: walk };
    case "no_route":
      return { title: "No provisional route connects these points yet", detail: walk };
    case "walk_shorter":
      if (directWalkEstimateMeters !== null) {
        return {
          title: `Walking (${formatDistance(directWalkEstimateMeters)}) is shorter than any ride we can suggest.`,
          detail: `Straight-line estimate; path not verified. ${ONLY_LOOPS}`,
        };
      }
      return { title: "No provisional route nearby yet", detail: ONLY_LOOPS };
    default:
      return { title: "No provisional route nearby yet", detail: ONLY_LOOPS };
  }
}
