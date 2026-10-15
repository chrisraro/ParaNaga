// Ride/transfer graph for the provisional planner, built from a published network snapshot.
// Pure and deterministic: variants are sorted by id; nothing here invents shapes or times.
//
//  - A variant is a ring (isCircular) or a line of its ordered stops. Each segment carries the
//    straight-line metres between consecutive stops (circular: last → first as well).
//  - Riding is forward only, in the variant's stop order, and never a full circuit: from a board
//    position a ride may alight at most n − 1 stops later.
//  - Boarding/alighting is allowed at every stop of a variant: the snapshot carries no boarding
//    permission, so it is unknown — allowed, and flagged on the ride leg by the planner.
//  - Transfers link positions of DIFFERENT variants whose stops are within the transfer cap
//    (straight-line), including a stop shared by both (0 m).
import type { NetworkSnapshot, Verification } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";

export type GraphStop = { id: string; name: string; lat: number; lng: number };

export type GraphVariant = {
  variantId: string;
  routeCode: string;
  routeName: string;
  verification: Verification;
  isCircular: boolean;
  stops: GraphStop[];
  /** segmentMeters[i]: stop i → stop i + 1 (circular: the last one closes the ring). */
  segmentMeters: number[];
};

export type TransferEdge = { variant: number; position: number; meters: number };

export type PlannerGraph = {
  variants: GraphVariant[];
  /** transfers[variant][position] → reachable positions on other variants, nearest first. */
  transfers: TransferEdge[][][];
  /** Variants dropped because they reference a stop the snapshot does not contain. */
  skippedVariantIds: string[];
};

export type ForwardRide = { position: number; steps: number; meters: number };

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildGraph(snapshot: Pick<NetworkSnapshot, "stops" | "variants">, maxTransferWalkM: number): PlannerGraph {
  const stopsById = new Map(snapshot.stops.map((s) => [s.id, s]));
  const variants: GraphVariant[] = [];
  const skippedVariantIds: string[] = [];

  for (const v of [...snapshot.variants].sort((a, b) => byString(a.variantId, b.variantId))) {
    const stops = v.stopIds.map((id) => stopsById.get(id));
    if (stops.some((s) => s === undefined) || stops.length < 2) {
      skippedVariantIds.push(v.variantId);
      continue;
    }
    const gs: GraphStop[] = stops.map((s) => ({ id: s!.id, name: s!.name, lat: s!.lat, lng: s!.lng }));
    const segCount = v.isCircular ? gs.length : gs.length - 1;
    const segmentMeters = Array.from({ length: segCount }, (_, i) => haversineMeters(gs[i]!, gs[(i + 1) % gs.length]!));
    variants.push({
      variantId: v.variantId, routeCode: v.routeCode, routeName: v.routeName, verification: v.verification,
      isCircular: v.isCircular, stops: gs, segmentMeters,
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

/** Every forward alighting position from `board`, in ride order, with cumulative metres. */
export function forwardRides(variant: GraphVariant, board: number): ForwardRide[] {
  const n = variant.stops.length;
  const maxSteps = variant.isCircular ? n - 1 : n - 1 - board;
  const out: ForwardRide[] = [];
  let meters = 0;
  for (let steps = 1; steps <= maxSteps; steps++) {
    meters += variant.segmentMeters[(board + steps - 1) % n]!;
    out.push({ position: (board + steps) % n, steps, meters });
  }
  return out;
}
