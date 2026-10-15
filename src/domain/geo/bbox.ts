// The map view as a stops?bbox= query. Pure.
//
// The view is widened to a 0.005° grid (≈ 550 m) so small pans reuse the same query, then
// clipped to the Naga max bounds the API accepts. A view entirely outside them gives null.
import { NAGA_MAX_BOUNDS } from "./naga";
import type { Bounds } from "./types";

const GRID = 0.005;
// Snap with a little tolerance so 123.18500000000001 does not widen by a whole cell.
const floorTo = (v: number) => Math.floor(v / GRID + 1e-9) * GRID;
const ceilTo = (v: number) => Math.ceil(v / GRID - 1e-9) * GRID;
const fix = (v: number) => Number(v.toFixed(6));

export function viewBbox(view: Bounds, limits: Bounds = NAGA_MAX_BOUNDS): Bounds | null {
  if (![view.west, view.south, view.east, view.north].every(Number.isFinite)) return null;
  const west = Math.max(limits.west, fix(floorTo(view.west)));
  const south = Math.max(limits.south, fix(floorTo(view.south)));
  const east = Math.min(limits.east, fix(ceilTo(view.east)));
  const north = Math.min(limits.north, fix(ceilTo(view.north)));
  if (!(west < east) || !(south < north)) return null;
  return { west, south, east, north };
}

/** "w,s,e,n", the order /api/v1/stops expects. */
export function bboxParam(b: Bounds): string {
  return `${b.west},${b.south},${b.east},${b.north}`;
}
