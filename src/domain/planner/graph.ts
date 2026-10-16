// The planning network of one revision (plan E §A): every permanent jeepney Lines path, its
// transfer points to the other paths, the snapshot's stops and the pins of variants with a stop
// order (Loops A/B, for naming free points). Pure and deterministic: variants sorted by id.
import type { NetworkSnapshot } from "../api/schemas";
import { projectOnLine } from "../geo/measure";
import { pathVariant, transferPoints, type NamedStop, type PathVariant, type PlanningLine, type TransferPoint, type VariantPin } from "./paths";

/** Ride distance basis of a ride leg; older saved bodies may carry the straight-line stop sum. */
export type DistanceBasis = "approximate_path" | "stop_to_stop_straight_line";

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export type PlanningTransfer = TransferPoint & { toVariant: number };

export type PlanningNetwork = {
  /** Permanent jeepney Lines paths (ok or flagged), by variant id. */
  variants: PathVariant[];
  /** transfers[i]: transfer points from variants[i] to every other variant, by fromM then target. */
  transfers: PlanningTransfer[][];
  /** Snapshot stops, for naming free points. */
  stops: NamedStop[];
  /** Pins of a planned variant (snapshot stop order, e.g. Loops A/B), by variant id. */
  pins: Map<string, VariantPin[]>;
};

/**
 * The planning network of one revision: every permanent jeepney Lines path, also those without a
 * stop order (R1–R7, Loops C/D). Callers memoize it by revision id; it is not cached here.
 */
export function buildPlanningNetwork(
  snapshot: Pick<NetworkSnapshot, "stops" | "variants">, lines: { lines: readonly PlanningLine[] } | null,
): PlanningNetwork {
  const variants = (lines?.lines ?? [])
    .filter((l) => l.mode === "jeepney" && l.kind === "permanent" && (l.status === "ok" || l.status === "flagged"))
    .sort((a, b) => byString(a.variantId, b.variantId))
    .map(pathVariant);
  const transfers = variants.map((a, i) =>
    variants
      .flatMap((b, j) => (i === j ? [] : transferPoints(a, b).map((t) => ({ ...t, toVariant: j }))))
      .sort((x, y) => x.fromM - y.fromM || x.toVariant - y.toVariant),
  );
  const stops = snapshot.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }));
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const pins = new Map<string, VariantPin[]>();
  for (const v of variants) {
    const sv = snapshot.variants.find((x) => x.variantId === v.variantId);
    if (!sv) continue;
    const ms = sv.measuresM?.length === sv.stopIds.length ? sv.measuresM : null;
    pins.set(v.variantId, sv.stopIds.flatMap((id, k) => {
      const s = stopById.get(id);
      return s ? [{ stopId: id, measureM: ms?.[k] ?? projectOnLine(v.points, s).measureM }] : [];
    }));
  }
  return { variants, transfers, stops, pins };
}
