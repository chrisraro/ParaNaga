// Map pins from the immutable network snapshot (decision D2). Pure.
//
// The home map no longer asks the server for the pins of a view (GET /api/v1/stops?bbox= put the
// view in a query string and did not work offline): it filters the snapshot of the published
// revision in memory. A pin's routeCodes are the public codes of the variants whose published
// stop order lists it, unique and sorted (the same rule as the bbox endpoint).
import type { NetworkSnapshot, StopPin } from "../api/schemas";
import type { Bounds } from "../geo/types";

export function snapshotPins(snapshot: Pick<NetworkSnapshot, "stops" | "variants">): StopPin[] {
  const codes = new Map<string, Set<string>>();
  for (const variant of snapshot.variants) {
    for (const id of variant.stopIds) {
      let set = codes.get(id);
      if (!set) codes.set(id, (set = new Set()));
      set.add(variant.routeCode);
    }
  }
  const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return snapshot.stops.map((stop) => ({ ...stop, routeCodes: [...(codes.get(stop.id) ?? [])].sort(byCode) }));
}

/** The pins inside a (snapped) view, edges included, in snapshot order. */
export function pinsInBounds<T extends { lat: number; lng: number }>(pins: readonly T[], b: Bounds): T[] {
  return pins.filter((p) => p.lng >= b.west && p.lng <= b.east && p.lat >= b.south && p.lat <= b.north);
}
