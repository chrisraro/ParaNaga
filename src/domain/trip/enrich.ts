// On-device walk-path enrichment and the D14 "must save walking" re-check. Pure: no I/O.
//
// Why on the phone: the walk graph (~81 KB gzip) is fetched lazily on the device (D18) and never
// sent in the POST /api/v1/plan response. Once the plan arrives (online or offline), each walk leg
// and the direct walk (origin → destination) are routed on the walk graph via `routeWalk`:
//   - Walk legs receive `path: { kind, coords, lengthM, label, ... }`.
//   - D14 "must save walking" re-check: compare like with like — if the direct walk and every walk
//     leg of a ride option have graph paths (`kind === "path"`), compare the sum of graph walk
//     lengths against the direct graph walk length (`optionGraphM < directGraphM`). Otherwise
//     compare the × 1.3 straight-line estimates (`optionEstimateM < directEstimateM`).
//   - Failing ride options are dropped. Remaining ride options keep their labels unless the
//     "Recommended" option was dropped, in which case the remaining ride options are relabelled in
//     `PLAN_LABELS` order using the planner's deterministic `pickLabelled` rule.
//   - When no options remain, `coverage` becomes `"none"` and `reason` becomes `"walk_shorter"`.
//
// Imported by client code (`use-trip-plan.ts`), so it imports `PLAN_LABELS` from `../planner/labels`
// and never pulls in `src/domain/planner/plan.ts`.
import type { PlanOptionDto, PlanResponse, RideLegDto, WalkLegDto } from "../api/plan";
import type { NetworkSnapshot } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { WALK_PATHS_OFFLINE_NOTE } from "../pwa/offline-copy";
import type { LatLng } from "../geo/types";
import { PLAN_LABELS, type PlanLabel } from "../planner/labels";
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

export type EnrichedWalkLeg = WalkLegDto & { path: WalkLegPath };
export type EnrichedLeg = EnrichedWalkLeg | RideLegDto;
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
  const origin = opts.origin ?? (firstLeg.kind === "walk" ? { lat: firstLeg.from.lat, lng: firstLeg.from.lng } : { lat: firstLeg.stops[0]!.lat, lng: firstLeg.stops[0]!.lng });
  const destination = opts.destination ?? (lastLeg.kind === "walk" ? { lat: lastLeg.to.lat, lng: lastLeg.to.lng } : { lat: lastLeg.stops[lastLeg.stops.length - 1]!.lat, lng: lastLeg.stops[lastLeg.stops.length - 1]!.lng });
  return { origin, destination };
}

function compareOption(a: EnrichedPlanOption, b: EnrichedPlanOption): number {
  return (
    a.score - b.score ||
    a.rides - b.rides ||
    a.walkMeters - b.walkMeters ||
    a.rideMeters - b.rideMeters ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function dominatesOption(a: EnrichedPlanOption, b: EnrichedPlanOption): boolean {
  const le = a.rides <= b.rides && a.walkMeters <= b.walkMeters && a.rideMeters <= b.rideMeters;
  const lt = a.rides < b.rides || a.walkMeters < b.walkMeters || a.rideMeters < b.rideMeters;
  return le && lt;
}

/** Deterministic relabelling matching `pickLabelled` in `src/domain/planner/plan.ts`. */
function relabelOptions(cands: EnrichedPlanOption[], labels: readonly PlanLabel[]): EnrichedPlanOption[] {
  const pareto = cands.filter((a) => !cands.some((b) => b !== a && dominatesOption(b, a))).sort(compareOption);
  if (pareto.length === 0) return [];
  const winner: Record<PlanLabel, EnrichedPlanOption> = {
    Recommended: pareto[0]!,
    "Fewest transfers": [...pareto].sort((a, b) => a.rides - b.rides || compareOption(a, b))[0]!,
    "Least walking": [...pareto].sort((a, b) => a.walkMeters - b.walkMeters || compareOption(a, b))[0]!,
  };
  const out: { cand: EnrichedPlanOption; labels: PlanLabel[] }[] = [];
  for (const label of labels) {
    const c = winner[label];
    const existing = out.find((o) => o.cand.id === c.id);
    if (existing) existing.labels.push(label);
    else out.push({ cand: c, labels: [label] });
  }
  return out.map(({ cand, labels: nextLabels }) => ({ ...cand, labels: nextLabels }));
}

/**
 * Per-leg walk-graph path lengths of `option` (metres, rounded as trip options show them): the
 * path length for a walk routed on `graph`, else null (rides, no graph, no street path). Lets a
 * saved card's estimate use the same lengths as the trip options when the graph is cached.
 */
export function walkPathLengths(option: PlanOptionDto, graph: WalkGraph | null): (number | null)[] {
  return option.legs.map((leg) => {
    if (leg.kind !== "walk" || graph === null) return null;
    const path = routeOneWalk(graph, leg.from, leg.to, leg.distanceMeters, leg.estimateMeters, "ready");
    return path.kind === "path" ? path.lengthM : null;
  });
}

function savesWalkingD14(
  option: EnrichedPlanOption,
  directWalk: WalkLegPath | null,
  directEstimateM: number,
): boolean {
  // Walk-only option (0 rides) is the direct walk itself; only ride options are checked by D14.
  if (option.rides === 0) return true;
  const walkLegs = option.legs.filter((l): l is EnrichedWalkLeg => l.kind === "walk");
  const allGraphPaths =
    directWalk !== null &&
    directWalk.kind === "path" &&
    walkLegs.every((l) => l.path.kind === "path");
  if (allGraphPaths) {
    const optionGraphM = walkLegs.reduce((sum, l) => sum + l.path.lengthM, 0);
    return optionGraphM < directWalk.lengthM;
  }
  const optionEstimateM = walkLegs.reduce((sum, l) => sum + l.estimateMeters, 0);
  return optionEstimateM < directEstimateM;
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
      if (leg.kind !== "walk") return leg;
      const path = routeOneWalk(walkGraph, leg.from, leg.to, leg.distanceMeters, leg.estimateMeters, status);
      return { ...leg, path };
    }),
  }));

  // D14 compares like with like, so it waits for the walk graph to settle: while it loads every
  // option is kept (straight estimates would drop some now and the graph would drop others a
  // moment later, making options vanish and closing an opened detail).
  const kept =
    status === "loading"
      ? routedOptions
      : routedOptions.filter((option) => savesWalkingD14(option, directWalk, directEstimateM));
  if (kept.length === 0) {
    return {
      ...plan,
      coverage: "none",
      reason: "walk_shorter",
      options: [],
      directWalk,
    };
  }

  // Keep existing labels unless the "Recommended" option was dropped.
  const hasRecommended = kept.some((o) => o.labels.includes("Recommended"));
  const finalOptions = hasRecommended ? kept : relabelOptions(kept, PLAN_LABELS);

  return {
    ...plan,
    options: finalOptions,
    directWalk,
  };
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
      leg.kind !== "walk" ? leg : { ...leg, path: routeOneWalk(walkGraph, leg.from, leg.to, leg.distanceMeters, leg.estimateMeters, status) },
    ),
  };
}
