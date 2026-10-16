// On-device walk-path enrichment. Pure: no I/O.
//
// The planner now routes walks on the street graph itself: a walk leg with an encoded `path`
// (basis "street_graph") is decoded here and left as planned. Only a legacy walk leg with no
// path (an older body, or a plan made without the graph) is routed on the walk graph the phone
// fetched lazily (D18, ~81 KB gzip), via `routeWalk`; without the graph it keeps the straight
// fallback. The direct walk (origin to destination) is routed the same way for the "walk"
// notices. The old D14 "must save walking" re-check and relabelling are gone: the planner decides.
//
// Imported by client code (`use-trip-plan.ts`), so it never pulls in `src/domain/planner/plan.ts`.
import type { PadyakLegDto, PlanLegDto, PlanOptionDto, PlanResponse, RideLegDto, TricycleLegDto, WalkLegDto } from "../api/plan";
import type { NetworkSnapshot } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { decodePolyline } from "../geo/polyline";
import { WALK_PATHS_OFFLINE_NOTE } from "../pwa/offline-copy";
import type { LatLng } from "../geo/types";
import { routeWalk, type WalkGraph, type WalkStraightReason } from "../walk/walk-graph";

export const WALK_PATH_LABEL = "Approximate walking path · crossings not checked" as const;
export const WALK_STRAIGHT_LABEL = "Straight line · no street path found" as const;
export const WALK_LOADING_LABEL = "Straight line · loading street paths…" as const;
/** Offline, and the walk graph was never stored on this phone (Task 15). */
export const WALK_OFFLINE_LABEL = `Straight line · ${WALK_PATHS_OFFLINE_NOTE}` as const;

export type WalkGraphStatus = "idle" | "loading" | "ready" | "error" | "skipped" | "offline";

export type WalkLegPath =
  | {
      kind: "path";
      coords: LatLng[];
      /** Walk length along the street graph (including both snap segments), rounded to whole metres. */
      lengthM: number;
      snapFromM: number;
      snapToM: number;
      label: typeof WALK_PATH_LABEL;
    }
  | {
      kind: "straight";
      reason: WalkStraightReason | "no_graph" | "loading" | "offline";
      coords: LatLng[];
      /** Fallback estimate in whole metres (`round(straightM × 1.3)`). */
      lengthM: number;
      straightM: number;
      label: typeof WALK_STRAIGHT_LABEL | typeof WALK_LOADING_LABEL | typeof WALK_OFFLINE_LABEL;
    };

export type EnrichedWalkLeg = Omit<WalkLegDto, "path"> & { path: WalkLegPath };
export type EnrichedLeg = EnrichedWalkLeg | RideLegDto | TricycleLegDto | PadyakLegDto;
export type EnrichedPlanOption = Omit<PlanOptionDto, "legs"> & { legs: EnrichedLeg[] };
export type EnrichedTripPlan = Omit<PlanResponse["plan"], "options"> & {
  options: EnrichedPlanOption[];
  directWalk?: WalkLegPath | null;
};
export type EnrichedPlanResponse = Omit<PlanResponse, "plan"> & { plan: EnrichedTripPlan };

export type EnrichOptions = {
  walkGraphStatus?: WalkGraphStatus;
  origin?: LatLng;
  destination?: LatLng;
  snapshot?: Pick<NetworkSnapshot, "stops" | "variants"> | null;
};

type SnapshotOrOptions = Pick<NetworkSnapshot, "stops" | "variants"> | EnrichOptions | null | undefined;

function normalizeOptions(arg: SnapshotOrOptions): EnrichOptions {
  if (!arg) return {};
  if ("walkGraphStatus" in arg || "origin" in arg || "destination" in arg || "snapshot" in arg) {
    return arg as EnrichOptions;
  }
  return { snapshot: arg as Pick<NetworkSnapshot, "stops" | "variants"> };
}

function routeOneWalk(
  walkGraph: WalkGraph | null,
  from: LatLng,
  to: LatLng,
  distanceMeters: number,
  estimateMeters: number,
  status: WalkGraphStatus,
): WalkLegPath {
  const start = { lat: from.lat, lng: from.lng };
  const end = { lat: to.lat, lng: to.lng };
  if (walkGraph === null) {
    const reason = status === "loading" ? "loading" : status === "offline" ? "offline" : "no_graph";
    return {
      kind: "straight",
      reason,
      coords: [start, end],
      lengthM: estimateMeters,
      straightM: distanceMeters,
      label: reason === "loading" ? WALK_LOADING_LABEL : reason === "offline" ? WALK_OFFLINE_LABEL : WALK_STRAIGHT_LABEL,
    };
  }
  // A 0 m walk (origin at the stop, or same-stop transfer) does not walk out to the road centreline and back.
  if (distanceMeters === 0 || (start.lat === end.lat && start.lng === end.lng)) {
    return {
      kind: "path",
      coords: [start, end],
      lengthM: 0,
      snapFromM: 0,
      snapToM: 0,
      label: WALK_PATH_LABEL,
    };
  }
  const routed = routeWalk(walkGraph, start, end);
  if (routed.kind === "path") {
    return {
      kind: "path",
      coords: routed.coords,
      lengthM: Math.round(routed.lengthM),
      snapFromM: routed.snapFromM,
      snapToM: routed.snapToM,
      label: WALK_PATH_LABEL,
    };
  }
  return {
    kind: "straight",
    reason: routed.reason,
    coords: routed.coords,
    lengthM: estimateMeters,
    straightM: Math.round(routed.straightM),
    label: WALK_STRAIGHT_LABEL,
  };
}

function inferEnds(options: readonly PlanOptionDto[], opts: EnrichOptions): { origin: LatLng; destination: LatLng } | null {
  if (opts.origin && opts.destination) return { origin: opts.origin, destination: opts.destination };
  const first = options[0];
  if (!first || first.legs.length === 0) return null;
  const firstLeg = first.legs[0]!;
  const lastLeg = first.legs[first.legs.length - 1]!;
  const startOf = (l: PlanLegDto): LatLng | undefined => (l.kind === "ride" ? (l.board ?? l.stops[0]) : l.from);
  const endOf = (l: PlanLegDto): LatLng | undefined => (l.kind === "ride" ? (l.alight ?? l.stops.at(-1)) : l.to);
  const origin = opts.origin ?? startOf(firstLeg);
  const destination = opts.destination ?? endOf(lastLeg);
  if (!origin || !destination) return null;
  return { origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng } };
}

/** A walk leg's path: the planner's own street path as it is, else routed on the phone's walk graph. */
function legPath(leg: WalkLegDto, walkGraph: WalkGraph | null, status: WalkGraphStatus): WalkLegPath {
  if (typeof leg.path === "string") {
    return { kind: "path", coords: decodePolyline(leg.path), lengthM: leg.estimateMeters, snapFromM: 0, snapToM: 0, label: WALK_PATH_LABEL };
  }
  return routeOneWalk(walkGraph, leg.from, leg.to, leg.distanceMeters, leg.estimateMeters, status);
}

/**
 * Per-leg walk-graph path lengths of `option` (metres, rounded as trip options show them): the
 * path length for a walk routed on `graph`, else null (rides, no graph, no street path). Lets a
 * saved card's estimate use the same lengths as the trip options when the graph is cached.
 */
export function walkPathLengths(option: PlanOptionDto, graph: WalkGraph | null): (number | null)[] {
  return option.legs.map((leg) => {
    if (leg.kind !== "walk") return null;
    const path = legPath(leg, graph, "ready");
    return path.kind === "path" ? path.lengthM : null;
  });
}

function enrichTripPlan(
  plan: PlanResponse["plan"],
  walkGraph: WalkGraph | null,
  rawOpts?: SnapshotOrOptions,
): EnrichedTripPlan {
  const opts = normalizeOptions(rawOpts);
  const status: WalkGraphStatus = opts.walkGraphStatus ?? (walkGraph ? "ready" : "idle");
  const ends = inferEnds(plan.options, opts);
  const directStraightM = ends ? Math.round(haversineMeters(ends.origin, ends.destination)) : 0;
  const directEstimateM = plan.directWalkEstimateMeters ?? Math.round(directStraightM * 1.3);
  const directWalk = ends
    ? routeOneWalk(walkGraph, ends.origin, ends.destination, directStraightM, directEstimateM, status)
    : null;

  if (plan.coverage === "none" || plan.options.length === 0) {
    return { ...plan, options: [], directWalk };
  }

  const routedOptions: EnrichedPlanOption[] = plan.options.map((option) => ({
    ...option,
    legs: option.legs.map((leg): EnrichedLeg => {
      return leg.kind === "walk" ? { ...leg, path: legPath(leg, walkGraph, status) } : leg;
    }),
  }));

  return { ...plan, options: routedOptions, directWalk };
}

export function enrichPlan(
  response: PlanResponse,
  walkGraph: WalkGraph | null,
  options?: SnapshotOrOptions,
): EnrichedPlanResponse;
export function enrichPlan(
  plan: PlanResponse["plan"],
  walkGraph: WalkGraph | null,
  options?: SnapshotOrOptions,
): EnrichedTripPlan;
export function enrichPlan(
  input: PlanResponse | PlanResponse["plan"],
  walkGraph: WalkGraph | null,
  options?: SnapshotOrOptions,
): EnrichedPlanResponse | EnrichedTripPlan {
  if ("plan" in input) {
    const plan = enrichTripPlan(input.plan, walkGraph, options);
    return { ...input, plan };
  }
  return enrichTripPlan(input, walkGraph, options);
}

/**
 * One option's walk legs routed on the walk graph already on the phone (the guidance session keeps
 * the plain option). Without a graph every walk keeps the straight fallback; nothing is invented.
 */
export function enrichOptionWalks(option: PlanOptionDto, walkGraph: WalkGraph | null): EnrichedPlanOption {
  const status: WalkGraphStatus = walkGraph ? "ready" : "idle";
  return {
    ...option,
    legs: option.legs.map((leg): EnrichedLeg =>
      leg.kind !== "walk" ? leg : { ...leg, path: legPath(leg, walkGraph, status) },
    ),
  };
}
