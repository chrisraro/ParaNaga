// Provisional trip planner over the published snapshot (Loops A and B today). Pure: no I/O.
//
// Search (round-based, ≤ maxRides rides): access walks from the origin to every variant stop
// within maxAccessWalkM; each round rides a variant FORWARD (never a full circuit, see graph.ts),
// then either walks to the destination (≤ maxAccessWalkM) or, if rides remain, walks to a stop of
// a variant not yet used (≤ maxTransferWalkM) and starts the next round. Caps apply to the
// STRAIGHT-LINE distance; the shown walk estimate is round(straight-line × 1.3), path not verified.
//
// Distances are rounded to whole metres once (each walk leg, each ride leg) before they are
// summed, output or priced; caps are checked on the unrounded straight-line distance.
//
// Filtering, in order:
//  1. "Must save walking" (user decision): keep a ride option only if `savesWalking` holds — its
//     walk ESTIMATE (sum of per-leg round(m × 1.3)) is strictly less than the direct walk
//     ESTIMATE round(straight-line origin → destination × 1.3). Estimate is compared with
//     estimate. There is no ride-length or detour limit: a ride may go round most of a loop
//     (never more than one full circuit, graph.ts); its distance and fare range are shown.
//  2. de-duplicate by variant sequence, keeping the best by the comparator below;
//  3. keep the Pareto set on (rides, walkMeters, rideMeters) — walkMeters is straight-line;
//  4. label: "Recommended" = lowest score, "Fewest transfers" = fewest rides, "Least walking" =
//     least walkMeters (ties → score → tie-break). Each option carries `labels: string[]`, so one
//     option may hold several labels; only labelled options are returned (≤ 3), in label order.
//
// Score (lower is better, documented weighting): walkEstimateMeters + 0.25 × rideMeters
// + 600 × (rides − 1). Riding a metre is taken as a quarter of the effort of walking one, and a
// transfer as roughly a 600 m walk (waiting, uncertainty). Tie-break: rides, walkMeters,
// rideMeters, then the option id (variant ids and stop ids) — output order is deterministic.
//
// Walk-only: when the straight-line distance origin → destination is within maxAccessWalkM,
// a single walk option comes first, labelled "Recommended" and "Fewest transfers" (0 rides),
// with a note; ride options (all of which walk less, by rule 1) compete only for "Least walking".
//
// Same place: ends SAME_PLACE_M (25 m) or less apart have nothing to plan → coverage "none",
// reason same_place (checked before anything else inside the city; no walk-only option).
//
// No coverage: `reason` says why — outside_city, same_place, no_stop_near_origin, no_stop_near_destination,
// walk_shorter (stops are in reach but no ride option saves walking: some trip reached the
// destination without saving walking, or a branch was pruned because its walking alone could
// not), or no_route (stops in reach at both ends but no ride connects them).
// `directWalkEstimateMeters` is always given (null only for outside_city) so the UI can say
// honestly that walking may be simplest.
//
// Pruning: walk estimates are non-negative and rule 1 depends only on walking, so a branch whose
// access (+ transfer) walk estimate already reaches the direct estimate is not explored. Ride
// metres cannot be used to prune: there is no ride-length rule.
//
// Honesty: every option is evidence "provisional"; ride legs carry boardingVerified: false
// (boarding permission unknown) and pathVerified: false, and only the ordered stops passed —
// no street geometry, times, curbs or signboards. Fares are estimate ranges (fares.ts).
//
// Ride distance (D13, graph.ts): metres along the variant's approximate path between the board
// and alight pins when the snapshot carries stop measures, else the straight-line stop-to-stop
// sum; the leg records `distanceBasis` and the two measures, and the fare, the score and the
// Pareto set all use that one distance. The option id is variant:board:alight only, so saved
// trips stay valid. Each ride leg carries the route's mode and fleet (snapshot routes[] joined
// by routeId; no record → "Vehicle type not confirmed"), and the fare follows that fleet
// (fares.ts): traditional only → F01 alone; traditional + modern → traditional minimum to the
// modern maximum, with the route's rider reports; not confirmed → the C6 F01–F02 span.
//
// Complexity: with V variants of ≤ n stops, A access positions and ≤ T transfer edges per
// position, the search is O(A·n·(1 + T·n)) for 2 rides (each extra ride multiplies by T·n).
// For Loops A/B (61 positions) that is well under a million steps.
import type { NetworkSnapshot, Verification } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { isInsideNaga } from "../geo/naga";
import type { LatLng } from "../geo/types";
import { fleetSummary, type FleetSummary, type RouteMode } from "../modes/fleet";
import { fareClasses, legFareEstimate, sumFares, type LegFare, type TripFare } from "./fares";
import { buildGraph, forwardRides, type DistanceBasis, type GraphStop, type PlannerGraph } from "./graph";

import { MAX_ACCESS_WALK_M, PLAN_LABELS, SAME_PLACE_M, UNVERIFIED_ROUTE_BADGE, type PlanLabel } from "./labels";

export { MAX_ACCESS_WALK_M, PLAN_LABELS, SAME_PLACE_M, UNVERIFIED_ROUTE_BADGE, type PlanLabel };

export const WALK_ESTIMATE_FACTOR = 1.3;
export const RIDE_WEIGHT = 0.25;
export const TRANSFER_PENALTY_M = 600;
/** Global caps (straight-line metres; MAX_ACCESS_WALK_M lives in labels.ts); callers may only tighten them. */
export const MAX_TRANSFER_WALK_M = 400;

export type PlannerOptions = { maxAccessWalkM: number; maxTransferWalkM: number; maxRides: number };
export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  maxAccessWalkM: MAX_ACCESS_WALK_M, maxTransferWalkM: MAX_TRANSFER_WALK_M, maxRides: 2,
};

/**
 * "Must save walking": a ride option is kept only when its total walk estimate is strictly less
 * than the estimate for walking the whole way directly (both round(straight-line × 1.3)).
 */
export function savesWalking(optionWalkEstimateMeters: number, directWalkEstimateMeters: number): boolean {
  return optionWalkEstimateMeters < directWalkEstimateMeters;
}

export type Place = { kind: "origin" | "destination" | "stop"; lat: number; lng: number; stopId: string | null; name: string | null };

export type WalkLeg = {
  kind: "walk";
  from: Place;
  to: Place;
  /** Straight-line metres (the caps apply to this). */
  distanceMeters: number;
  /** round(distanceMeters × 1.3): an estimate, the path is not verified. */
  estimateMeters: number;
  pathVerified: false;
};

export type RideLeg = {
  kind: "ride";
  variantId: string;
  routeCode: string;
  routeName: string;
  verification: Verification;
  /** Stops passed, board → alight inclusive, in ride order. The only geometry given. */
  stops: GraphStop[];
  /** D13: whole metres along the approximate path, or the straight-line stop-to-stop sum (distanceBasis). */
  distanceMeters: number;
  approximate: true;
  /** Boarding permission is unknown in the data: allowed, but not verified. */
  boardingVerified: false;
  pathVerified: false;
  /** Priced on distanceMeters. */
  fare: LegFare;
  mode: RouteMode;
  /** The route's vehicle classes with their evidence (snapshot routes[] by routeId). */
  fleet: FleetSummary;
  distanceBasis: DistanceBasis;
  /** Metres along the approximate path at the board and alight pins; null without a path. */
  boardMeasureM: number | null;
  alightMeasureM: number | null;
};

export type PlanLeg = WalkLeg | RideLeg;

export type PlanOption = {
  id: string;
  labels: PlanLabel[];
  legs: PlanLeg[];
  rides: number;
  /** Straight-line walking metres, summed. */
  walkMeters: number;
  walkEstimateMeters: number;
  rideMeters: number;
  score: number;
  fare: TripFare;
  evidence: "provisional";
};

export type NoCoverageReason =
  | "outside_city" | "same_place" | "no_stop_near_origin" | "no_stop_near_destination" | "walk_shorter" | "no_route";

export type TripPlan = {
  revisionId: string;
  coverage: "provisional" | "none";
  reason: NoCoverageReason | null;
  /**
   * The direct walk's estimate, round(D × 1.3) with D the straight-line metres rounded to whole
   * metres (same rule as every walk leg); null only when a point is outside the city.
   */
  directWalkEstimateMeters: number | null;
  options: PlanOption[];
  notes: string[];
};

// ---------------------------------------------------------------- search state

type RideStep = {
  v: number; board: number; alight: number; meters: number;
  basis: DistanceBasis; boardMeasureM: number | null; alightMeasureM: number | null;
};
/** Immutable chain of (transfer walk metres, ride) pairs, newest first. */
type Chain = { ride: RideStep; walkBefore: number; prev: Chain | null };

type Candidate = {
  chain: Chain;
  accessM: number;
  egressM: number;
  rides: number;
  walkMeters: number;
  walkEstimateMeters: number;
  rideMeters: number;
  score: number;
  id: string;
};

const estimate = (m: number) => Math.round(m * WALK_ESTIMATE_FACTOR);

function validateOptions(o: PlannerOptions): void {
  const okDist = (x: number) => Number.isFinite(x) && x >= 0;
  if (!okDist(o.maxAccessWalkM) || !okDist(o.maxTransferWalkM)) throw new RangeError("walk caps must be finite and ≥ 0");
  if (o.maxAccessWalkM > MAX_ACCESS_WALK_M) throw new RangeError(`maxAccessWalkM must be ≤ ${MAX_ACCESS_WALK_M} m`);
  if (o.maxTransferWalkM > MAX_TRANSFER_WALK_M) throw new RangeError(`maxTransferWalkM must be ≤ ${MAX_TRANSFER_WALK_M} m`);
  if (!Number.isInteger(o.maxRides) || o.maxRides < 1 || o.maxRides > 3) throw new RangeError("maxRides must be 1, 2 or 3");
}

const validPoint = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && isInsideNaga(p);

function chainRides(c: Chain): { ride: RideStep; walkBefore: number }[] {
  const out: { ride: RideStep; walkBefore: number }[] = [];
  for (let x: Chain | null = c; x; x = x.prev) out.push({ ride: x.ride, walkBefore: x.walkBefore });
  return out.reverse();
}

function compare(a: Candidate, b: Candidate): number {
  return a.score - b.score || a.rides - b.rides || a.walkMeters - b.walkMeters || a.rideMeters - b.rideMeters || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function dominates(a: Candidate, b: Candidate): boolean {
  const le = a.rides <= b.rides && a.walkMeters <= b.walkMeters && a.rideMeters <= b.rideMeters;
  const lt = a.rides < b.rides || a.walkMeters < b.walkMeters || a.rideMeters < b.rideMeters;
  return le && lt;
}

function search(graph: PlannerGraph, origin: LatLng, destination: LatLng, opts: PlannerOptions, directEstimate: number) {
  const access = graph.variants.map((v) => v.stops.map((s) => haversineMeters(origin, s)));
  const egress = graph.variants.map((v) => v.stops.map((s) => haversineMeters(s, destination)));
  const best = new Map<string, Candidate>();
  let walkShorter = false;

  const complete = (chain: Chain, accessM: number, egressM: number) => {
    const parts = chainRides(chain);
    const transfers = parts.map((p) => p.walkBefore).slice(1);
    const walks = [accessM, ...transfers, egressM];
    const walkEstimateMeters = walks.reduce((s, m) => s + estimate(m), 0);
    if (!savesWalking(walkEstimateMeters, directEstimate)) {
      walkShorter = true;
      return;
    }
    const rideMeters = parts.reduce((s, p) => s + p.ride.meters, 0);
    const walkMeters = walks.reduce((s, m) => s + m, 0);
    const rides = parts.length;
    const score = walkEstimateMeters + RIDE_WEIGHT * rideMeters + TRANSFER_PENALTY_M * (rides - 1);
    const seq = parts.map((p) => graph.variants[p.ride.v]!.variantId).join(">");
    const id = parts
      .map((p) => {
        const v = graph.variants[p.ride.v]!;
        return `${v.variantId}:${v.stops[p.ride.board]!.id}:${v.stops[p.ride.alight]!.id}`;
      })
      .join(">");
    const cand: Candidate = { chain, accessM, egressM, rides, walkMeters, walkEstimateMeters, rideMeters, score, id };
    const prior = best.get(seq);
    if (!prior || compare(cand, prior) < 0) best.set(seq, cand);
  };

  /** walkEstSoFar: walk estimate of the access walk and transfers before this ride (pruning). */
  const ride = (
    v: number, board: number, prev: Chain | null, walkBefore: number, used: readonly number[], accessM: number, walkEstSoFar: number,
  ) => {
    const variant = graph.variants[v]!;
    for (const r of forwardRides(variant, board)) {
      const chain: Chain = {
        ride: { v, board, alight: r.position, meters: Math.round(r.meters), basis: r.basis, boardMeasureM: r.boardMeasureM, alightMeasureM: r.alightMeasureM },
        walkBefore, prev,
      };
      const eg = egress[v]![r.position]!;
      if (eg <= opts.maxAccessWalkM) complete(chain, accessM, Math.round(eg));
      if (used.length < opts.maxRides) {
        for (const t of graph.transfers[v]![r.position]!) {
          if (used.includes(t.variant)) continue;
          const tm = Math.round(t.meters);
          const est = walkEstSoFar + estimate(tm);
          if (!savesWalking(est, directEstimate)) {
            walkShorter = true; // walking so far already reaches the direct estimate
            continue;
          }
          ride(t.variant, t.position, chain, tm, [...used, t.variant], accessM, est);
        }
      }
    }
  };

  let anyAccess = false;
  let anyEgress = false;
  graph.variants.forEach((variant, v) => {
    variant.stops.forEach((_, p) => {
      if (egress[v]![p]! <= opts.maxAccessWalkM) anyEgress = true;
      const a = access[v]![p]!;
      if (a > opts.maxAccessWalkM) return;
      anyAccess = true;
      const am = Math.round(a);
      if (!savesWalking(estimate(am), directEstimate)) {
        walkShorter = true;
        return;
      }
      ride(v, p, null, 0, [v], am, estimate(am));
    });
  });
  return { candidates: [...best.values()], anyAccess, anyEgress, walkShorter };
}

// ---------------------------------------------------------------- output

function place(kind: Place["kind"], p: LatLng, stop?: GraphStop): Place {
  return stop
    ? { kind, lat: stop.lat, lng: stop.lng, stopId: stop.id, name: stop.name }
    : { kind, lat: p.lat, lng: p.lng, stopId: null, name: null };
}

function walkLeg(from: Place, to: Place, meters: number): WalkLeg {
  return { kind: "walk", from, to, distanceMeters: meters, estimateMeters: estimate(meters), pathVerified: false };
}

type RouteInfo = NetworkSnapshot["routes"][number];

function toOption(
  c: Candidate, labels: PlanLabel[], graph: PlannerGraph, snapshot: Pick<NetworkSnapshot, "fareRules">,
  routes: ReadonlyMap<string, RouteInfo>, origin: LatLng, destination: LatLng,
): PlanOption {
  const legs: PlanLeg[] = [];
  const rideLegs: RideLeg[] = [];
  let prevStop: GraphStop | null = null;
  for (const { ride, walkBefore } of chainRides(c.chain)) {
    const v = graph.variants[ride.v]!;
    const n = v.stops.length;
    const steps = (ride.alight - ride.board + n) % n;
    const stops = Array.from({ length: steps + 1 }, (_, i) => v.stops[(ride.board + i) % n]!);
    const board = stops[0]!;
    legs.push(
      prevStop === null
        ? walkLeg(place("origin", origin), place("stop", board, board), c.accessM)
        : walkLeg(place("stop", prevStop, prevStop), place("stop", board, board), walkBefore),
    );
    const route = routes.get(v.routeId);
    const fleet = route ? route.fleet : fleetSummary([], v.mode);
    const leg: RideLeg = {
      kind: "ride", variantId: v.variantId, routeCode: v.routeCode, routeName: v.routeName, verification: v.verification,
      stops, distanceMeters: ride.meters, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFareEstimate(ride.meters, snapshot.fareRules, {
        classes: fareClasses(fleet.colourKey), reports: route?.fareReports ?? [],
      }),
      mode: v.mode, fleet, distanceBasis: ride.basis, boardMeasureM: ride.boardMeasureM, alightMeasureM: ride.alightMeasureM,
    };
    legs.push(leg);
    rideLegs.push(leg);
    prevStop = stops.at(-1)!;
  }
  legs.push(walkLeg(place("stop", prevStop!, prevStop!), place("destination", destination), c.egressM));
  return {
    id: c.id, labels, legs, rides: c.rides, walkMeters: c.walkMeters, walkEstimateMeters: c.walkEstimateMeters,
    rideMeters: c.rideMeters, score: c.score, fare: sumFares(rideLegs.map((l) => l.fare)), evidence: "provisional",
  };
}

function pickLabelled(cands: Candidate[], labels: readonly PlanLabel[]): { cand: Candidate; labels: PlanLabel[] }[] {
  const pareto = cands.filter((a) => !cands.some((b) => b !== a && dominates(b, a))).sort(compare);
  if (pareto.length === 0) return [];
  const winner: Record<PlanLabel, Candidate> = {
    Recommended: pareto[0]!,
    "Fewest transfers": [...pareto].sort((a, b) => a.rides - b.rides || compare(a, b))[0]!,
    "Least walking": [...pareto].sort((a, b) => a.walkMeters - b.walkMeters || compare(a, b))[0]!,
  };
  const out: { cand: Candidate; labels: PlanLabel[] }[] = [];
  for (const label of labels) {
    const c = winner[label];
    const existing = out.find((o) => o.cand === c);
    if (existing) existing.labels.push(label);
    else out.push({ cand: c, labels: [label] });
  }
  return out;
}

export function planTrip(
  snapshot: Pick<NetworkSnapshot, "revision" | "stops" | "variants" | "fareRules"> & Partial<Pick<NetworkSnapshot, "routes">>,
  origin: LatLng,
  destination: LatLng,
  options: Partial<PlannerOptions> = {},
): TripPlan {
  const opts: PlannerOptions = { ...DEFAULT_PLANNER_OPTIONS, ...options };
  validateOptions(opts);
  const revisionId = snapshot.revision.revisionId;
  const none = (reason: NoCoverageReason, directWalkEstimateMeters: number | null): TripPlan => ({
    revisionId, coverage: "none", reason, directWalkEstimateMeters, options: [], notes: [],
  });
  if (!validPoint(origin) || !validPoint(destination)) return none("outside_city", null);

  const rawDirect = haversineMeters(origin, destination);
  const direct = Math.round(rawDirect);
  const directEstimate = estimate(direct);
  if (rawDirect <= SAME_PLACE_M) return none("same_place", directEstimate);

  const graph = buildGraph(snapshot, opts.maxTransferWalkM);
  const { candidates, anyAccess, anyEgress, walkShorter } = search(graph, origin, destination, opts, directEstimate);

  const walkOnly = rawDirect <= opts.maxAccessWalkM;
  const rideLabels: readonly PlanLabel[] = walkOnly ? ["Least walking"] : PLAN_LABELS;
  const picked = pickLabelled(candidates, rideLabels);
  const routes = new Map((snapshot.routes ?? []).map((r) => [r.routeId, r]));
  const result: PlanOption[] = picked.map((p) => toOption(p.cand, p.labels, graph, snapshot, routes, origin, destination));
  const notes: string[] = [UNVERIFIED_ROUTE_BADGE];

  if (walkOnly) {
    const leg = walkLeg(place("origin", origin), place("destination", destination), direct);
    result.unshift({
      id: "walk", labels: ["Recommended", "Fewest transfers"], legs: [leg], rides: 0, walkMeters: direct, walkEstimateMeters: leg.estimateMeters,
      rideMeters: 0, score: leg.estimateMeters, fare: sumFares([]), evidence: "provisional",
    });
    notes.push(`The destination is about ${leg.estimateMeters} m away on foot (straight-line estimate, path not verified); walking may be simplest.`);
  }

  if (result.length === 0) {
    const reason = !anyAccess ? "no_stop_near_origin" : !anyEgress ? "no_stop_near_destination" : walkShorter ? "walk_shorter" : "no_route";
    return none(reason, directEstimate);
  }
  return { revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: directEstimate, options: result.slice(0, 3), notes };
}
