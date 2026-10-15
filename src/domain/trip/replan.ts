// When to plan a trip again. Pure.
//
// A GPS-sourced end that moves less than REPLAN_MIN_MOVE_M from the point last planned for is
// noise: no replan. Any end placed by hand or from search, a change of source, or a swap is a
// deliberate choice and always replans. A replan caused only by GPS refinements may keep the
// previous results on screen while it loads; every other replan starts fresh.
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";
import type { EndpointSource } from "./endpoints";

export const REPLAN_MIN_MOVE_M = 25;

export type PlanEnd = { point: LatLng; source: EndpointSource };
export type PlanPair = { origin: PlanEnd; destination: PlanEnd };

type EndChange = "same" | "gps_noise" | "gps_refined" | "deliberate";

function endChange(prev: PlanEnd, next: PlanEnd): EndChange {
  const samePoint = prev.point.lat === next.point.lat && prev.point.lng === next.point.lng;
  if (samePoint && prev.source === next.source) return "same";
  if (prev.source === "gps" && next.source === "gps") {
    return haversineMeters(prev.point, next.point) >= REPLAN_MIN_MOVE_M ? "gps_refined" : "gps_noise";
  }
  return "deliberate";
}

const changes = (prev: PlanPair, next: PlanPair) => [endChange(prev.origin, next.origin), endChange(prev.destination, next.destination)];

/** True when `next` should be planned for instead of `prev`. */
export function shouldReplan(prev: PlanPair | null, next: PlanPair): boolean {
  if (!prev) return true;
  return changes(prev, next).some((c) => c === "gps_refined" || c === "deliberate");
}

/** True when the replan from `prev` to `next` comes only from GPS refinements (no deliberate change). */
export function isGpsRefinement(prev: PlanPair | null, next: PlanPair): boolean {
  if (!prev) return false;
  const c = changes(prev, next);
  return c.includes("gps_refined") && !c.includes("deliberate");
}
