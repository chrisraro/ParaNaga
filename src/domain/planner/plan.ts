// Provisional trip planner over the published snapshot (Loops A and B today). Pure: no I/O.
//
// Search (round-based, ≤ maxRides rides): access walks from the origin to every variant stop
// within maxAccessWalkM; each round rides a variant FORWARD (never a full circuit, see graph.ts),
// then either walks to the destination (≤ maxAccessWalkM) or, if rides remain, walks to a stop of
// a variant not yet used (≤ maxTransferWalkM) and starts the next round. Caps apply to the
// STRAIGHT-LINE distance; the shown walk estimate is round(straight-line × 1.3), path not verified.
//
// Filtering, in order:
//  1. reject a trip whose total ride metres exceed walking the whole way directly
//     (round(straight-line origin → destination × 1.3));
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
// a single walk option comes first, labelled "Recommended", with a note; ride options are then
// labelled only "Fewest transfers" / "Least walking".
//
// Honesty: every option is evidence "provisional"; ride legs carry boardingVerified: false
// (boarding permission unknown) and pathVerified: false, and only the ordered stops passed —
// no street geometry, times, curbs or signboards. Fares are estimate ranges (fares.ts).
//
// Complexity: with V variants of ≤ n stops, A access positions and ≤ T transfer edges per
// position, the search is O(A·n·(1 + T·n)) for 2 rides (each extra ride multiplies by T·n).
// For Loops A/B (61 positions) that is well under a million steps.
import type { NetworkSnapshot, Verification } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { isInsideNaga } from "../geo/naga";
import type { LatLng } from "../geo/types";
import { legFareEstimate, sumFares, type LegFare, type TripFare } from "./fares";
import { buildGraph, forwardRides, type GraphStop, type PlannerGraph } from "./graph";

export const PLAN_LABELS = ["Recommended", "Fewest transfers", "Least walking"] as const;
export type PlanLabel = (typeof PLAN_LABELS)[number];

export const WALK_ESTIMATE_FACTOR = 1.3;
export const RIDE_WEIGHT = 0.25;
export const TRANSFER_PENALTY_M = 600;
export const UNVERIFIED_ROUTE_BADGE = "Unverified route — confirm with the driver";

export type PlannerOptions = { maxAccessWalkM: number; maxTransferWalkM: number; maxRides: number };
export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = { maxAccessWalkM: 600, maxTransferWalkM: 400, maxRides: 2 };

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
  /** Sum of straight-line segments between the stops passed. */
  distanceMeters: number;
  approximate: true;
  /** Boarding permission is unknown in the data: allowed, but not verified. */
  boardingVerified: false;
  pathVerified: false;
  fare: LegFare;
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

export type NoCoverageReason = "outside_city" | "no_stop_near_origin" | "no_stop_near_destination" | "no_route";

export type TripPlan = {
  revisionId: string;
  coverage: "provisional" | "none";
  reason: NoCoverageReason | null;
  options: PlanOption[];
  notes: string[];
};

// ---------------------------------------------------------------- search state

type RideStep = { v: number; board: number; alight: number; meters: number };
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

  const complete = (chain: Chain, accessM: number, egressM: number) => {
    const parts = chainRides(chain);
    const rideMeters = parts.reduce((s, p) => s + p.ride.meters, 0);
    if (rideMeters > directEstimate) return;
    const transfers = parts.map((p) => p.walkBefore).slice(1);
    const walks = [accessM, ...transfers, egressM];
    const walkMeters = walks.reduce((s, m) => s + m, 0);
    const walkEstimateMeters = walks.reduce((s, m) => s + estimate(m), 0);
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

  const ride = (v: number, board: number, prev: Chain | null, walkBefore: number, used: readonly number[], accessM: number) => {
    const variant = graph.variants[v]!;
    for (const r of forwardRides(variant, board)) {
      const chain: Chain = { ride: { v, board, alight: r.position, meters: r.meters }, walkBefore, prev };
      const eg = egress[v]![r.position]!;
      if (eg <= opts.maxAccessWalkM) complete(chain, accessM, eg);
      if (used.length < opts.maxRides) {
        for (const t of graph.transfers[v]![r.position]!) {
          if (used.includes(t.variant)) continue;
          ride(t.variant, t.position, chain, t.meters, [...used, t.variant], accessM);
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
      ride(v, p, null, 0, [v], a);
    });
  });
  return { candidates: [...best.values()], anyAccess, anyEgress };
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

function toOption(c: Candidate, labels: PlanLabel[], graph: PlannerGraph, snapshot: Pick<NetworkSnapshot, "fareRules">, origin: LatLng, destination: LatLng): PlanOption {
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
    const leg: RideLeg = {
      kind: "ride", variantId: v.variantId, routeCode: v.routeCode, routeName: v.routeName, verification: v.verification,
      stops, distanceMeters: ride.meters, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFareEstimate(ride.meters, snapshot.fareRules),
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
  snapshot: Pick<NetworkSnapshot, "revision" | "stops" | "variants" | "fareRules">,
  origin: LatLng,
  destination: LatLng,
  options: Partial<PlannerOptions> = {},
): TripPlan {
  const opts: PlannerOptions = { ...DEFAULT_PLANNER_OPTIONS, ...options };
  validateOptions(opts);
  const revisionId = snapshot.revision.revisionId;
  const none = (reason: NoCoverageReason): TripPlan => ({ revisionId, coverage: "none", reason, options: [], notes: [] });
  if (!validPoint(origin) || !validPoint(destination)) return none("outside_city");

  const graph = buildGraph(snapshot, opts.maxTransferWalkM);
  const direct = haversineMeters(origin, destination);
  const { candidates, anyAccess, anyEgress } = search(graph, origin, destination, opts, estimate(direct));

  const walkOnly = direct <= opts.maxAccessWalkM;
  const rideLabels = walkOnly ? PLAN_LABELS.filter((l) => l !== "Recommended") : PLAN_LABELS;
  const picked = pickLabelled(candidates, rideLabels);
  const result: PlanOption[] = picked.map((p) => toOption(p.cand, p.labels, graph, snapshot, origin, destination));
  const notes: string[] = [UNVERIFIED_ROUTE_BADGE];

  if (walkOnly) {
    const leg = walkLeg(place("origin", origin), place("destination", destination), direct);
    result.unshift({
      id: "walk", labels: ["Recommended"], legs: [leg], rides: 0, walkMeters: direct, walkEstimateMeters: leg.estimateMeters,
      rideMeters: 0, score: leg.estimateMeters, fare: sumFares([]), evidence: "provisional",
    });
    notes.push(`The destination is about ${leg.estimateMeters} m away on foot (straight-line estimate, path not verified); walking may be simplest.`);
  }

  if (result.length === 0) {
    return none(!anyAccess ? "no_stop_near_origin" : !anyEgress ? "no_stop_near_destination" : "no_route");
  }
  return { revisionId, coverage: "provisional", reason: null, options: result.slice(0, 3), notes };
}
