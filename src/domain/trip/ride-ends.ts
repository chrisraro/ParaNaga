// Where a ride leg boards and alights. Loop A/B rides name the pins they pass; R1-R7 rides have no pins
// (`stops: []`) and board and alight at free points along the approximate path. Never invents a stop name:
// an unnamed point reads "your stop along {route}".
import type { RideLegDto } from "../api/plan";

export type RideEnd = { id: string; name: string; lat: number; lng: number };
export type RideEnds = {
  board: RideEnd;
  alight: RideEnd;
  /** Board first, alight last: the pins when the leg passes any, else just the two points. */
  stops: RideEnd[];
  /** True when `stops` are the leg's named pins; false when only the free board/alight points exist. */
  pinned: boolean;
};

type EndLeg = Pick<RideLegDto, "variantId" | "routeCode" | "stops" | "board" | "alight">;

const freeEnd = (leg: EndLeg, p: NonNullable<RideLegDto["board"]>): RideEnd => ({
  id: p.stopId ?? `pt:${leg.variantId}:${Math.round(p.measureM)}`,
  name: p.name ?? `your stop along ${leg.routeCode}`,
  lat: p.lat,
  lng: p.lng,
});

/**
 * The ride's ends, or null for a malformed leg that has neither pins nor free points. `alightName` names an
 * unnamed free alighting point (plan E §A: the last ride's "Get off near {destination}").
 */
export function rideEnds(leg: EndLeg, alightName?: string): RideEnds | null {
  if (leg.stops.length >= 2) {
    return { board: leg.stops[0]!, alight: leg.stops[leg.stops.length - 1]!, stops: leg.stops, pinned: true };
  }
  if (!leg.board || !leg.alight) return null;
  const board = freeEnd(leg, leg.board);
  const alight = freeEnd(leg, { ...leg.alight, name: leg.alight.name ?? alightName ?? null });
  return { board, alight, stops: [board, alight], pinned: false };
}
