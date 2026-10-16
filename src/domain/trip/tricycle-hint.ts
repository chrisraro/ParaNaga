// The tricycle terminal nearest a trip end, for the tricycle option's detail. Pure: no I/O.
// A terminal counts when it has a coordinate and lies within 600 m straight-line of the start or
// destination; waiting areas without a coordinate (T15, T16) never match. The old "Tricycle may
// serve this" card is gone: tricycle is a planned option now (Increment E).
import type { NetworkSnapshot } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";

export const TRICYCLE_TERMINAL_MAX_M = 600;

export type TricycleTerminalMatch = {
  code: string;
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
  near: "origin" | "destination";
};

export function nearestTricycleTerminal(
  origin: LatLng,
  destination: LatLng,
  terminals: readonly Pick<NetworkSnapshot["terminals"][number], "code" | "name" | "modes" | "lat" | "lng">[],
): TricycleTerminalMatch | undefined {
  let best: { code: string; name: string; dist: number; lat: number; lng: number; near: "origin" | "destination" } | null = null;
  for (const t of terminals) {
    if (!t.modes.includes("tricycle")) continue;
    if (t.lat === null || t.lng === null || !Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
    const coord = { lat: t.lat, lng: t.lng };
    const dOrigin = haversineMeters(origin, coord);
    const dDest = haversineMeters(destination, coord);
    const dist = Math.min(dOrigin, dDest);
    if (dist > TRICYCLE_TERMINAL_MAX_M) continue;
    const near: "origin" | "destination" = dOrigin <= dDest ? "origin" : "destination";
    if (best === null || dist < best.dist || (dist === best.dist && t.code < best.code)) {
      best = { code: t.code, name: t.name, dist, lat: t.lat, lng: t.lng, near };
    }
  }
  if (!best) return undefined;
  return {
    code: best.code,
    name: best.name,
    distanceM: Math.round(best.dist),
    lat: best.lat,
    lng: best.lng,
    near: best.near,
  };
}
