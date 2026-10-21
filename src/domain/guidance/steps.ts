// Guidance steps from a provisional plan option. Pure.
//
// The planner's legs are walk, ride, (walk, ride)*, walk; walk-only options are a single walk.
// They become the step list the Walk / Ride / Transfer screens follow:
//   walk_to_board        origin → first boarding stop
//   ride                 board → alight, the stops in the variant's (provisional) pin order
//   transfer             alighting stop → next boarding stop (a straight-line walk estimate)
//   walk_to_destination  last stop (or the origin) → destination
// A walk under NEGLIGIBLE_WALK_M (estimate) is flagged `negligible`, so the copy says
// "Start at {stop}" instead of "Walk ≈ 0 m" (audit F-20). Each step keeps the index of its planner
// leg (`legIndex`), so view.ts can estimate the time left from the snapshot's model (Task 14).
// Increment E: a ride may board and alight at free points along its path (`pinned: false`; the last
// ride's unnamed alighting point takes the destination's name), and a tricycle or padyak leg is one
// `street_ride` step to the destination (those options have no ride and no walk): never a crash.
import type { PadyakLegDto, PlanOptionDto, RideLegDto, TricycleLegDto, WalkLegDto } from "../api/plan";
import type { EtaModel } from "../api/schemas";
import { rideEnds } from "../trip/ride-ends";
import { en, type Dict } from "@/i18n/dict";
import { isNegligibleWalk, routeChipLabel, stopLabel, streetRideText, type LoopDirection } from "../trip/present";

/** What a guidance session is built from: the option plus the plan's stop codes and loop directions. */
export type GuidanceTrip = {
  option: PlanOptionDto;
  /** The plan's stops with their source codes ("A1"), for labels. */
  stops: readonly { id: string; name: string; code: string | null }[];
  /** Loop direction per ridden variant (from pin order), null when not circular or unknown. */
  variants: readonly { variantId: string; loopDirection: LoopDirection | null }[];
  /** How the person named the destination ("SM City Naga"); null → "your destination". */
  destinationLabel: string | null;
  /** The snapshot's time-estimate model at Start (null/absent: an older snapshot, no estimate). */
  etaModel?: EtaModel | null;
  /** Walk-graph path length per option leg (null: no graph path, the ×1.3 estimate is used). */
  walkLengths?: readonly (number | null)[];
  /** The Lines path per ridden variant id (encoded p5), when on this phone: pinless ride progress (progress.ts). */
  ridePaths?: Readonly<Record<string, { encoded: string; isCircuit: boolean }>>;
};

export type StopRef = { stopId: string; name: string; label: string; lat: number; lng: number };
export type RideRef = { variantId: string; routeCode: string; routeName: string; routeChip: string; loopDirection: LoopDirection | null };
/** legIndex: the walk's leg in option.legs, or null when the plan has no walk before this step. */
type WalkFields = { estimateMeters: number; distanceMeters: number; negligible: boolean; legIndex: number | null };

export type WalkToBoardStep = { kind: "walk_to_board"; index: number; target: StopRef; nextRide: RideRef } & WalkFields;
export type RideStep = {
  kind: "ride";
  index: number;
  ride: RideRef;
  /** Board first, alight last, in pin order (provisional). */
  stops: StopRef[];
  board: StopRef;
  alight: StopRef;
  /** False when the route has no marked stops: `stops` is just the free board and alight points. */
  pinned: boolean;
  /** Stops after boarding up to and including the alighting stop, by pin order. */
  stopsToRide: number;
  distanceMeters: number;
  /** The ride's leg in option.legs. */
  legIndex: number;
  mode: RideLegDto["mode"];
  distanceBasis: RideLegDto["distanceBasis"];
  /** Path measure at each of `stops` (unwrapped), or null: the time left is split by stop count. */
  stopMeasuresM: number[] | null;
};
export type TransferStep = { kind: "transfer"; index: number; from: StopRef; target: StopRef; nextRide: RideRef } & WalkFields;
export type WalkToDestinationStep = {
  kind: "walk_to_destination";
  index: number;
  /** The alighting stop, or null when the whole trip is a walk from the start. */
  from: StopRef | null;
  target: { name: string; lat: number; lng: number };
} & WalkFields;

/** A tricycle or padyak ride to the destination (the whole option). Never timed. */
export type StreetRideStep = {
  kind: "street_ride";
  index: number;
  legIndex: number;
  mode: "tricycle" | "padyak";
  target: { name: string; lat: number; lng: number };
  distanceMeters: number | null;
  basis: TricycleLegDto["basis"];
  /** "Take a tricycle to … · about 1.5 km along streets · minimum fare ₱15 · confirm with the driver". */
  text: string;
  /** The planner's notes for the leg (rules applied, fare, "… time not estimated"). */
  notes: string[];
};

export type GuidanceStep = WalkToBoardStep | RideStep | TransferStep | WalkToDestinationStep | StreetRideStep;
export type GuidanceStepKind = GuidanceStep["kind"];

const NO_WALK: WalkFields = { estimateMeters: 0, distanceMeters: 0, negligible: true, legIndex: null };

function walkFields(walk: { leg: WalkLegDto; index: number } | null): WalkFields {
  if (!walk) return NO_WALK;
  const { leg, index } = walk;
  return { estimateMeters: leg.estimateMeters, distanceMeters: leg.distanceMeters, negligible: isNegligibleWalk(leg), legIndex: index };
}

/** `copy` names an unnamed destination or tricycle end (English by default). */
export function guidanceSteps(trip: GuidanceTrip, copy: Dict["guidance"] = en.guidance, shared: Pick<Dict, "trip" | "geo"> = en): GuidanceStep[] {
  const codes = new Map(trip.stops.map((s) => [s.id, s.code]));
  const directions = new Map(trip.variants.map((v) => [v.variantId, v.loopDirection]));
  const stopRef = (s: { id: string; name: string; lat: number; lng: number }): StopRef => ({
    stopId: s.id,
    name: s.name,
    label: stopLabel(s.name, codes.get(s.id) ?? null, shared.trip),
    lat: s.lat,
    lng: s.lng,
  });
  const rideRef = (leg: RideLegDto): RideRef => ({
    variantId: leg.variantId,
    routeCode: leg.routeCode,
    routeName: leg.routeName,
    routeChip: routeChipLabel(leg.routeCode, leg.routeName, leg.display),
    loopDirection: directions.get(leg.variantId) ?? null,
  });

  const legs = trip.option.legs;
  const steps: GuidanceStep[] = [];
  const destinationName = trip.destinationLabel?.trim() || copy.unnamedDestination;
  let pendingWalk: { leg: WalkLegDto; index: number } | null = null;
  let lastAlight: StopRef | null = null;
  let street: StreetRideStep | null = null;
  const lastRide = legs.reduce((last, l, i) => (l.kind === "ride" ? i : last), -1);

  for (const [legIndex, leg] of legs.entries()) {
    if (leg.kind === "walk") {
      pendingWalk = { leg, index: legIndex };
      continue;
    }
    if (leg.kind === "tricycle" || leg.kind === "padyak") {
      // Not the last leg (the access option): the tricycle ends at its named loading point, not at the destination.
      street = streetStep(leg, legIndex, steps.length, legIndex === legs.length - 1 ? destinationName : leg.to.name ?? copy.theJeepney, legIndex < legs.length - 1, shared.trip);
      steps.push(street);
      pendingWalk = null;
      continue;
    }
    const ends = rideEnds(leg, legIndex === lastRide ? destinationName : undefined);
    if (!ends) continue;
    const stops = ends.stops.map(stopRef);
    const board = stops[0]!;
    const alight = stops.at(-1)!;
    const ride = rideRef(leg);
    steps.push(
      lastAlight === null
        ? { kind: "walk_to_board", index: steps.length, target: board, nextRide: ride, ...walkFields(pendingWalk) }
        : { kind: "transfer", index: steps.length, from: lastAlight, target: board, nextRide: ride, ...walkFields(pendingWalk) },
    );
    steps.push({
      kind: "ride",
      index: steps.length,
      ride,
      stops,
      board,
      alight,
      stopsToRide: stops.length - 1,
      pinned: ends.pinned,
      distanceMeters: leg.distanceMeters,
      legIndex,
      mode: leg.mode ?? "jeepney",
      distanceBasis: leg.distanceBasis ?? "stop_to_stop_straight_line",
      stopMeasuresM: ends.pinned
        ? (leg.stopMeasuresM?.length === stops.length ? leg.stopMeasuresM : null)
        : leg.boardMeasureM === null ? null : [leg.boardMeasureM, leg.boardMeasureM + leg.distanceMeters],
    });
    pendingWalk = null;
    lastAlight = alight;
  }

  // A street ride already ends at the destination.
  if (street && steps.at(-1) === street) return steps;
  const end = pendingWalk ? pendingWalk.leg.to : lastAlight;
  if (!end) return steps; // malformed: no ride, street leg or walk to end on
  steps.push({
    kind: "walk_to_destination",
    index: steps.length,
    from: lastAlight,
    target: { name: destinationName, lat: end.lat, lng: end.lng },
    ...walkFields(pendingWalk),
  });
  return steps;
}

function streetStep(leg: TricycleLegDto | PadyakLegDto, legIndex: number, index: number, destinationName: string, midTrip: boolean, copy: Dict["trip"]): StreetRideStep {
  return {
    kind: "street_ride",
    index,
    legIndex,
    mode: leg.kind,
    target: { name: destinationName, lat: leg.to.lat, lng: leg.to.lng },
    distanceMeters: leg.distanceMeters,
    basis: leg.basis,
    text: streetRideText(leg, destinationName, midTrip, copy),
    notes: [...leg.notes],
  };
}
