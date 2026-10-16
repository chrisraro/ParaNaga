// Ride/transfer graph for the provisional planner, built from a published network snapshot.
// Pure and deterministic: variants are sorted by id; nothing here invents shapes or times.
//
//  - A variant is a ring (isCircular) or a line of its ordered stops. Each segment carries the
//    straight-line metres between consecutive stops (circular: last → first as well).
//  - Riding is forward only, in the variant's stop order, and never a full circuit: from a board
//    position a ride may alight at most n − 1 stops later.
//  - Boarding/alighting is allowed at every stop of a variant: the snapshot carries no boarding
//    permission, so it is unknown — allowed, and flagged on the ride leg by the planner.
//  - A circular variant stored closed (last stop id == first) has that closing duplicate dropped;
//    a variant that repeats any other stop id is skipped (a ride could otherwise alight at its own
//    boarding stop, i.e. a full circuit).
//  - Transfers link positions of DIFFERENT variants whose stops are within the transfer cap
//    (straight-line), including a stop shared by both (0 m).
//
// D13 ride distance basis: when the variant has a published approximate path with one measure
// per stop (`measuresM`, metres along the path; a circuit's measures wrap at `pathLengthM`), a
// ride's metres are measure(alight) − measure(board), mod pathLengthM on a circuit (exactly that
// formula, so the number does not depend on summation order). The measures are used
// only when they are in ride order: non-decreasing on a line, and exactly one lap (the segments
// sum to pathLengthM) on a circuit; otherwise, and for an old cached snapshot without measures,
// the straight-line stop-to-stop sum is used. Each ride says which basis it used. The path is
// approximate (traced from the street list), never exact. Walk caps stay straight-line.
import type { NetworkSnapshot, Verification } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import type { RouteMode } from "../modes/fleet";

export type GraphStop = { id: string; name: string; lat: number; lng: number };

export type DistanceBasis = "approximate_path" | "stop_to_stop_straight_line";

export type GraphVariant = {
  variantId: string;
  routeId: string;
  mode: RouteMode;
  routeCode: string;
  routeName: string;
  verification: Verification;
  isCircular: boolean;
  stops: GraphStop[];
  /** segmentMeters[i]: stop i → stop i + 1 (circular: the last one closes the ring). Straight line. */
  segmentMeters: number[];
  /** Metres along the approximate path at each stop (D13), or null: no usable path. */
  measuresM: number[] | null;
  /** Same indexing as segmentMeters, along the approximate path; null exactly when measuresM is. */
  pathSegmentMeters: number[] | null;
  /** The approximate path's length (a circuit's measures wrap here); null exactly when measuresM is. */
  pathLengthM: number | null;
};

export type TransferEdge = { variant: number; position: number; meters: number };

export type PlannerGraph = {
  variants: GraphVariant[];
  /** transfers[variant][position] → reachable positions on other variants, nearest first. */
  transfers: TransferEdge[][][];
  /** Variants dropped because they reference a stop the snapshot does not contain. */
  skippedVariantIds: string[];
};

export type ForwardRide = {
  position: number;
  steps: number;
  /** Along the approximate path when the variant has one, else the straight-line sum (see basis). */
  meters: number;
  basis: DistanceBasis;
  /** Path measures at the board and alight stops; null without a path. */
  boardMeasureM: number | null;
  alightMeasureM: number | null;
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Path segment metres from stop measures, or null when the measures cannot be used (see above). */
function pathSegments(measures: readonly number[] | null, pathLengthM: number | null, stopCount: number, isCircular: boolean): number[] | null {
  if (measures === null || pathLengthM === null || !(pathLengthM > 0) || measures.length !== stopCount) return null;
  if (!measures.every((m) => Number.isFinite(m) && m >= 0 && m <= pathLengthM)) return null;
  if (!isCircular) {
    const segs = measures.slice(1).map((m, i) => m - measures[i]!);
    return segs.every((d) => d >= 0) ? segs : null;
  }
  const segs = measures.map((m, i) => {
    const d = measures[(i + 1) % stopCount]! - m;
    return d < 0 ? d + pathLengthM : d;
  });
  const lap = segs.reduce((a, b) => a + b, 0);
  return Math.abs(lap - pathLengthM) < 0.5 ? segs : null; // exactly one lap, else not in ride order
}

export function buildGraph(snapshot: Pick<NetworkSnapshot, "stops" | "variants">, maxTransferWalkM: number): PlannerGraph {
  const stopsById = new Map(snapshot.stops.map((s) => [s.id, s]));
  const variants: GraphVariant[] = [];
  const skippedVariantIds: string[] = [];

  for (const v of [...snapshot.variants].sort((a, b) => byString(a.variantId, b.variantId))) {
    let ids = v.stopIds;
    let measures = v.measuresM ?? null;
    if (v.isCircular && ids.length > 1 && ids[ids.length - 1] === ids[0]) {
      ids = ids.slice(0, -1);
      measures = measures && measures.length === v.stopIds.length ? measures.slice(0, -1) : measures;
    }
    const stops = ids.map((id) => stopsById.get(id));
    if (stops.some((s) => s === undefined) || stops.length < 2 || new Set(ids).size !== ids.length) {
      skippedVariantIds.push(v.variantId);
      continue;
    }
    const gs: GraphStop[] = stops.map((s) => ({ id: s!.id, name: s!.name, lat: s!.lat, lng: s!.lng }));
    const segCount = v.isCircular ? gs.length : gs.length - 1;
    const segmentMeters = Array.from({ length: segCount }, (_, i) => haversineMeters(gs[i]!, gs[(i + 1) % gs.length]!));
    const pathSegmentMeters = pathSegments(measures, v.pathLengthM ?? null, gs.length, v.isCircular);
    variants.push({
      variantId: v.variantId, routeId: v.routeId, mode: v.mode ?? "jeepney", routeCode: v.routeCode, routeName: v.routeName,
      verification: v.verification, isCircular: v.isCircular, stops: gs, segmentMeters,
      measuresM: pathSegmentMeters ? [...measures!] : null, pathSegmentMeters,
      pathLengthM: pathSegmentMeters ? v.pathLengthM! : null,
    });
  }

  const transfers: TransferEdge[][][] = variants.map((v, vi) =>
    v.stops.map((from) => {
      const edges: TransferEdge[] = [];
      variants.forEach((w, wi) => {
        if (wi === vi) return;
        w.stops.forEach((to, pi) => {
          const meters = from.id === to.id ? 0 : haversineMeters(from, to);
          if (meters <= maxTransferWalkM) edges.push({ variant: wi, position: pi, meters });
        });
      });
      return edges.sort((a, b) => a.meters - b.meters || a.variant - b.variant || a.position - b.position);
    }),
  );

  return { variants, transfers, skippedVariantIds };
}

/** Every forward alighting position from `board`, in ride order, with cumulative metres (D13 basis). */
export function forwardRides(variant: GraphVariant, board: number): ForwardRide[] {
  const n = variant.stops.length;
  const maxSteps = variant.isCircular ? n - 1 : n - 1 - board;
  const path = variant.pathSegmentMeters;
  const measures = path ? variant.measuresM : null;
  const lap = variant.pathLengthM ?? 0;
  const out: ForwardRide[] = [];
  let straight = 0;
  let along = 0;
  for (let steps = 1; steps <= maxSteps; steps++) {
    const position = (board + steps) % n;
    straight += variant.segmentMeters[(board + steps - 1) % n]!;
    if (!measures) {
      out.push({ position, steps, meters: straight, basis: "stop_to_stop_straight_line", boardMeasureM: null, alightMeasureM: null });
      continue;
    }
    along += path![(board + steps - 1) % n]!;
    let meters = measures[position]! - measures[board]!;
    // A circuit wraps at the path length (also when a ride ends where the path's zero-length tail began).
    if (variant.isCircular && (meters < 0 || (meters === 0 && along > lap / 2))) meters += lap;
    out.push({ position, steps, meters, basis: "approximate_path", boardMeasureM: measures[board]!, alightMeasureM: measures[position]! });
  }
  return out;
}
