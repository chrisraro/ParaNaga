// Presentation helpers for provisional trip plans. Pure: copy and formatting only.
//
// Honesty: fares are always "Estimate …" ranges in whole pesos (never "Exact"), distances are
// "≈" estimates, a loop's direction is derived from the order of its mapped pins and labelled so,
// and no-coverage copy never implies a verified route exists.
import type { LatLng } from "../geo/types";
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

type FareLike = { status: string; minCentavos: number | null; maxCentavos: number | null };

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

/** Per ride leg, with the global caveat on where the numbers come from. */
export function legFareText(fare: FareLike): string {
  const chip = fareChipText(fare);
  return chip === FARE_UNAVAILABLE ? chip : `${chip} · from reported fare rules · matrix not verified`;
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

/** "Plaza Rizal (A1)"; just the code when the pin has no separate label. */
export function stopLabel(name: string, code: string | null): string {
  if (!code || name === code) return name || code || "Unnamed stop";
  return `${name} (${code})`;
}

const ONLY_LOOPS = "Loops A and B are the only routes we can suggest for now.";

export function noCoverageCopy(reason: NoCoverageReason | null, directWalkEstimateMeters: number | null): { title: string; detail: string } {
  if (reason === "walk_shorter" && directWalkEstimateMeters !== null) {
    return {
      title: `Walking (${formatDistance(directWalkEstimateMeters)}) is shorter than any ride we can suggest.`,
      detail: `Straight-line estimate; path not verified. ${ONLY_LOOPS}`,
    };
  }
  return { title: "No provisional route nearby yet", detail: ONLY_LOOPS };
}
