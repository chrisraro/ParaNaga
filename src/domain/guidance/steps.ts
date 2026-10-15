// Guidance steps from a provisional plan option. Pure.
//
// The planner's legs are walk, ride, (walk, ride)*, walk; walk-only options are a single walk.
// They become the step list the Walk / Ride / Transfer screens follow:
//   walk_to_board        origin → first boarding stop
//   ride                 board → alight, the stops in the variant's (provisional) pin order
//   transfer             alighting stop → next boarding stop (a straight-line walk estimate)
//   walk_to_destination  last stop (or the origin) → destination
// A walk under NEGLIGIBLE_WALK_M (estimate) is flagged `negligible`, so the copy says
// "Start at {stop}" instead of "Walk ≈ 0 m" (audit F-20). No time or duration exists anywhere.
import type { PlanOptionDto, RideLegDto, WalkLegDto } from "../api/plan";
import { isNegligibleWalk, routeChipLabel, stopLabel, type LoopDirection } from "../trip/present";

/** What a guidance session is built from: the option plus the plan's stop codes and loop directions. */
export type GuidanceTrip = {
  option: PlanOptionDto;
  /** The plan's stops with their source codes ("A1"), for labels. */
  stops: readonly { id: string; name: string; code: string | null }[];
  /** Loop direction per ridden variant (from pin order), null when not circular or unknown. */
  variants: readonly { variantId: string; loopDirection: LoopDirection | null }[];
  /** How the person named the destination ("SM City Naga"); null → "your destination". */
  destinationLabel: string | null;
};

export type StopRef = { stopId: string; name: string; label: string; lat: number; lng: number };
export type RideRef = { variantId: string; routeCode: string; routeName: string; routeChip: string; loopDirection: LoopDirection | null };
type WalkFields = { estimateMeters: number; distanceMeters: number; negligible: boolean };

export type WalkToBoardStep = { kind: "walk_to_board"; index: number; target: StopRef; nextRide: RideRef } & WalkFields;
export type RideStep = {
  kind: "ride";
  index: number;
  ride: RideRef;
  /** Board first, alight last, in pin order (provisional). */
  stops: StopRef[];
  board: StopRef;
  alight: StopRef;
  /** Stops after boarding up to and including the alighting stop, by pin order. */
  stopsToRide: number;
  distanceMeters: number;
};
export type TransferStep = { kind: "transfer"; index: number; from: StopRef; target: StopRef; nextRide: RideRef } & WalkFields;
export type WalkToDestinationStep = {
  kind: "walk_to_destination";
  index: number;
  /** The alighting stop, or null when the whole trip is a walk from the start. */
  from: StopRef | null;
  target: { name: string; lat: number; lng: number };
} & WalkFields;

export type GuidanceStep = WalkToBoardStep | RideStep | TransferStep | WalkToDestinationStep;
export type GuidanceStepKind = GuidanceStep["kind"];

export const UNNAMED_DESTINATION = "your destination";

const NO_WALK: WalkFields = { estimateMeters: 0, distanceMeters: 0, negligible: true };

function walkFields(leg: WalkLegDto | null): WalkFields {
  if (!leg) return NO_WALK;
  return { estimateMeters: leg.estimateMeters, distanceMeters: leg.distanceMeters, negligible: isNegligibleWalk(leg) };
}

export function guidanceSteps(trip: GuidanceTrip): GuidanceStep[] {
  const codes = new Map(trip.stops.map((s) => [s.id, s.code]));
  const directions = new Map(trip.variants.map((v) => [v.variantId, v.loopDirection]));
  const stopRef = (s: { id: string; name: string; lat: number; lng: number }): StopRef => ({
    stopId: s.id,
    name: s.name,
    label: stopLabel(s.name, codes.get(s.id) ?? null),
    lat: s.lat,
    lng: s.lng,
  });
  const rideRef = (leg: RideLegDto): RideRef => ({
    variantId: leg.variantId,
    routeCode: leg.routeCode,
    routeName: leg.routeName,
    routeChip: routeChipLabel(leg.routeCode, leg.routeName),
    loopDirection: directions.get(leg.variantId) ?? null,
  });

  const legs = trip.option.legs;
  const steps: GuidanceStep[] = [];
  const destinationName = trip.destinationLabel?.trim() || UNNAMED_DESTINATION;
  let pendingWalk: WalkLegDto | null = null;
  let lastAlight: StopRef | null = null;

  for (const leg of legs) {
    if (leg.kind === "walk") {
      pendingWalk = leg;
      continue;
    }
    const stops = leg.stops.map(stopRef);
    const board = stops[0]!;
    const alight = stops.at(-1)!;
    const ride = rideRef(leg);
    steps.push(
      lastAlight === null
        ? { kind: "walk_to_board", index: steps.length, target: board, nextRide: ride, ...walkFields(pendingWalk) }
        : { kind: "transfer", index: steps.length, from: lastAlight, target: board, nextRide: ride, ...walkFields(pendingWalk) },
    );
    steps.push({ kind: "ride", index: steps.length, ride, stops, board, alight, stopsToRide: stops.length - 1, distanceMeters: leg.distanceMeters });
    pendingWalk = null;
    lastAlight = alight;
  }

  const end = pendingWalk ? pendingWalk.to : lastAlight;
  steps.push({
    kind: "walk_to_destination",
    index: steps.length,
    from: lastAlight,
    target: { name: destinationName, lat: end!.lat, lng: end!.lng },
    ...walkFields(pendingWalk),
  });
  return steps;
}
