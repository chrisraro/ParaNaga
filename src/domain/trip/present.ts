// Presentation helpers for provisional trip plans. Pure: copy and formatting only.
//
// Honesty: fares are always "Estimate …" ranges in whole pesos (never "Exact"), distances are
// "≈" estimates, a loop's direction is derived from the order of its mapped pins and labelled so,
// and no-coverage copy never implies a verified route exists.
import { en, type Dict } from "@/i18n/dict";
import type { PlanResponse } from "../api/plan";
import type { LatLng } from "../geo/types";
import { modeName, type FleetSummary, type RouteMode } from "../modes/fleet";
import { MAX_ACCESS_WALK_M } from "../planner/labels";
import type { NoCoverageReason } from "../planner/plan";
import { formatRouteLabel } from "../planner/route-display";

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
export function directionText(direction: LoopDirection | null, form: "short" | "long", label?: string, copy: Dict["trip"] = en.trip): string | null {
  // A loop's display title already says its direction ("… Loop C (clockwise)"): never say it twice.
  if (!direction || label?.includes(direction)) return null;
  return form === "long" ? copy.fromPinOrder(copy.direction[direction]) : copy.direction[direction];
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


const peso = (centavos: number) => `₱${Math.round(centavos / 100)}`;

/** The peso range ("₱14–₱17") of a fare estimate, or null when there is none. */
export function fareRangeText(fare: FareLike): string | null {
  if (fare.status !== "estimate" || fare.minCentavos === null || fare.maxCentavos === null) return null;
  return pesoRange(fare.minCentavos, fare.maxCentavos);
}

/** Trip-level chip: "Estimate ₱X–₱Y", "Minimum fare ₱15" (tricycle), "₱10 per passenger" (padyak), "Fare estimate unavailable" or "No fare (walk)". */
export function fareChipText(fare: FareLike, copy: Dict["trip"] = en.trip): string {
  if (fare.status === "no_ride") return copy.fareNoRide;
  if (fare.status === "minimum" && fare.minCentavos !== null) return copy.fareMinimum(peso(fare.minCentavos));
  if (fare.status === "flat_per_passenger" && fare.minCentavos !== null) return copy.farePerPassenger(peso(fare.minCentavos));
  if (fare.status !== "estimate" || fare.minCentavos === null || fare.maxCentavos === null) return copy.fareUnavailable;
  return copy.fareEstimate(pesoRange(fare.minCentavos, fare.maxCentavos));
}

/**
 * Per ride leg, with the caveat on where the numbers come from. A traditional-only (or
 * modern-only) route names its one rate; a mixed traditional + modern fleet says "traditional
 * to modern rate", and names the riders' reports when they set the maximum; an unconfirmed
 * fleet keeps the plain rule wording.
 */
export function legFareText(fare: FareLike, copy: Dict["trip"] = en.trip): string {
  const chip = fareChipText(fare, copy);
  if (chip === copy.fareUnavailable) return chip;
  if (fare.span === "traditional_rule") return copy.legFareTraditional(chip);
  if (fare.span === "modern_rule") return copy.legFareModern(chip);
  if (fare.span === "traditional_to_modern") return copy.legFareMixed(chip, fare.basis === "fare_rules_and_reports" ? copy.legFareMixedReports : "");
  return copy.legFareDefault(chip);
}

/** D13: "≈ 3.4 km along the approximate path" or "≈ 3.1 km stop to stop (straight line)"; never exact. */
export function distanceBasisText(meters: number, basis: "approximate_path" | "stop_to_stop_straight_line", copy: Dict["trip"] = en.trip, geo: Dict["geo"] = en.geo): string {
  const d = formatDistance(meters, geo);
  return basis === "approximate_path" ? copy.distanceAlongPath(d) : copy.distanceStraightLine(d);
}

/**
 * The vehicle classes of a ride: "Jeepney · traditional and modern (air-conditioned)" on a mixed
 * fleet (aircon only when a source states it), else the route's C7 chip ("Jeepney · traditional",
 * "Jeepney · type not confirmed"). The evidence and dates stay on fleet.classes[].label.
 */
export function rideFleetText(mode: RouteMode, fleet: FleetSummary, copy: Dict["trip"] = en.trip): string {
  if (fleet.colourKey !== "mixed_trad_modern") return fleet.chip;
  const aircon = fleet.classes.some((c) => c.vehicleClass === "modern_puj" && c.aircon === true);
  return aircon ? copy.fleetMixedAircon(modeName(mode)) : copy.fleetMixed(modeName(mode));
}

type StreetLegLike = { kind: "tricycle" | "padyak"; distanceMeters: number | null; basis: "street_graph" | "straight_line" | "unavailable"; fare: FareLike };

/**
 * One tricycle or padyak leg as a step: "Take a tricycle to {destination} · about 1.5 km along streets ·
 * minimum fare ₱15 · confirm with the driver" (padyak: "₱10 per passenger"). Never a time.
 */
export function streetRideText(leg: StreetLegLike, destination: string, midTrip = false, copy: Dict["trip"] = en.trip): string {
  const km = leg.distanceMeters === null ? "" : copy.streetKm((leg.distanceMeters / 1000).toFixed(1));
  const route = leg.basis === "street_graph" ? copy.streetAlong(km)
    : leg.basis === "straight_line" ? copy.streetStraight(km)
    : copy.streetNoRoute;
  const fare = leg.fare.minCentavos === null ? copy.streetFareNone
    : leg.kind === "tricycle" ? (midTrip ? copy.streetFareTricycleMid : copy.streetFareTricycle)(peso(leg.fare.minCentavos)) : copy.streetFarePadyak(peso(leg.fare.minCentavos));
  return copy.streetRide(copy.kind[leg.kind], destination, route, fare);
}

/** Free-point alighting (plan E): the stop is not marked, the rider says "para". */
export const freeAlightText = (place: string, copy: Dict["trip"] = en.trip) => copy.freeAlight(place);

/** "≈ 230 m" (nearest 10 m) below 1 km, else "≈ 5.5 km". */
export function formatDistance(meters: number, copy: Dict["geo"] = en.geo): string {
  const tens = Math.round(meters / 10) * 10;
  if (tens < 1000) return copy.distanceM(tens);
  return copy.distanceKm((meters / 1000).toFixed(1));
}

export function transfersText(rides: number, copy: Dict["trip"] = en.trip): string {
  const transfers = Math.max(0, rides - 1);
  if (transfers === 0) return copy.noTransfers;
  return transfers === 1 ? copy.oneTransfer : copy.transfers(transfers);
}

/** What an option is called on its card and detail: "Loop A" ("Loop A + R4" with a transfer), or "Walk ≈ 230 m". */
export function optionTitle(option: { rides: number; walkEstimateMeters: number; legs: readonly { kind: string; routeCode?: string; routeName?: string; display?: RideDisplay | null }[] }, copy: Dict["trip"] = en.trip, geo: Dict["geo"] = en.geo): string {
  if (option.rides === 0) {
    // A tricycle or padyak option has no ride leg: it is named for its mode, not as a walk.
    const street = option.legs.find((l) => l.kind === "tricycle" || l.kind === "padyak");
    if (street) return street.kind === "tricycle" ? copy.kindTitle.tricycle : copy.kindTitle.padyak;
    return copy.walkTitle(formatDistance(option.walkEstimateMeters, geo));
  }
  const rides = option.legs.filter((l) => l.kind === "ride").map((l) => routeChipLabel(l.routeCode ?? "", l.routeName ?? "", l.display)).join(" + ");
  // The access option (Increment F): a tricycle to the jeep's loading point first.
  return option.legs[0]?.kind === "tricycle" ? copy.tricycleThenJeep(rides) : rides;
}

export type RideDisplay = { letter: string | null; title: string };

/** "Loop A · Centro-Magsaysay (clockwise)" or "E Centro-…" (the letter said once), or just the title when no letter is confirmed. */
export const rideDisplayText = (d: RideDisplay) => formatRouteLabel(d.letter, d.title);

/**
 * How a jeepney ride is named: its display (letter + title) when the plan carries one; otherwise "Loop A" from a
 * name like "Centro–Magsaysay Loop A", or the public route code (older plan bodies, route lists).
 */
export function routeChipLabel(routeCode: string, routeName: string, display?: RideDisplay | null): string {
  if (display) return rideDisplayText(display);
  const loop = /\bLoop\s+([A-Z])\b/.exec(routeName);
  return loop ? `Loop ${loop[1]}` : routeCode;
}

/**
 * The stop's own name, verbatim (source typos kept). A pin whose source label is empty is named
 * after its code by the import; it shows as "Unnamed pin B18", never with another pin's name.
 */
export function stopDisplayName(name: string, code: string | null, copy: Dict["trip"] = en.trip): string {
  if (code && name === code) return copy.unnamedPin(code);
  return name || (code ? copy.unnamedPin(code) : copy.unnamedStop);
}

/** "Plaza Rizal (A1)"; "Unnamed pin B18" when the pin has no separate label. */
export function stopLabel(name: string, code: string | null, copy: Dict["trip"] = en.trip): string {
  const display = stopDisplayName(name, code, copy);
  if (!code || display === copy.unnamedPin(code)) return display;
  return `${display} (${code})`;
}

/** The English wording for ends within SAME_PLACE_M of each other (planner reason, reducer, pick UI); screens use `t.trip.samePlaceTitle`. */
export const SAME_PLACE_TITLE = en.trip.samePlaceTitle;

/** A walk leg shorter than this (estimate, metres) is not a step: the point is at the stop itself. */
export const NEGLIGIBLE_WALK_M = 15;

export function isNegligibleWalk(leg: { kind: string; estimateMeters?: number }): boolean {
  return leg.kind === "walk" && typeof leg.estimateMeters === "number" && leg.estimateMeters < NEGLIGIBLE_WALK_M;
}

/** Per-reason copy: which end is out of reach, and how far the whole walk is (an estimate). */
export function noCoverageCopy(reason: NoCoverageReason | null, directWalkEstimateMeters: number | null, copy: Dict["trip"] = en.trip, geo: Dict["geo"] = en.geo): { title: string; detail: string } {
  const walk = directWalkEstimateMeters === null ? copy.onlyLoops : copy.walkDetail(formatDistance(directWalkEstimateMeters, geo));
  switch (reason) {
    case "same_place":
      return { title: copy.samePlaceTitle, detail: copy.samePlaceDetail };
    case "outside_city":
      return { title: copy.outsideCity, detail: copy.onlyLoops };
    case "no_stop_near_origin":
      return { title: copy.noStopOrigin(MAX_ACCESS_WALK_M), detail: walk };
    case "no_stop_near_destination":
      return { title: copy.noStopDestination(MAX_ACCESS_WALK_M), detail: walk };
    case "no_route":
      return { title: copy.noRoute, detail: walk };
    case "walk_shorter":
      if (directWalkEstimateMeters !== null) {
        return { title: copy.walkShorterTitle(formatDistance(directWalkEstimateMeters, geo)), detail: copy.walkShorterDetail };
      }
      return { title: copy.noRouteNearby, detail: copy.onlyLoops };
    default:
      return { title: copy.noRouteNearby, detail: copy.onlyLoops };
  }
}

/**
 * What the home live region says when a plan settles. "Route shown" only when a route is drawn
 * (options listed, not a stored trip). `alt` swaps a silent mark in so the same words twice in a
 * row still change the region's text and are spoken again.
 */
export function planAnnouncement(data: PlanResponse, stored: boolean, alt: boolean, copy: Dict["trip"] = en.trip, geo: Dict["geo"] = en.geo): string {
  const { plan } = data;
  const mark = alt ? "​" : "";
  if (plan.coverage === "none") return noCoverageCopy(plan.reason, plan.directWalkEstimateMeters, copy, geo).title + mark;
  const n = plan.options.length;
  const anyRide = plan.options.some((o) => o.rides > 0);
  const drawn = n > 0 && !stored;
  return `${copy.optionsFound(copy.optionCount(n))}${anyRide ? copy.unverifiedSentence : ""}${drawn ? copy.routeShown : ""}${mark}`;
}
