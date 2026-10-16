// Pure maths for fitting a whole route into the part of the map the bottom sheet leaves visible.
import type { LatLng } from "@/domain/geo/types";

/** Never zoom tighter than this when fitting a route (street level, both ends stay in view). */
export const ROUTE_FIT_MAX_ZOOM = 17;
/** Top padding clears the map controls; right padding clears the zoom and locate buttons. */
export const ROUTE_FIT_PAD_TOP = 80;
export const ROUTE_FIT_PAD_SIDE = 40;
export const ROUTE_FIT_PAD_RIGHT = 84;
/** Gap kept between the sheet's top edge and a pin's centre (marker radius 15 + 24 px clearance + corner radius). */
export const ROUTE_FIT_SHEET_GAP = 64;
/** Smallest strip of map (px) that must stay free of padding, however tall the sheet is. */
export const ROUTE_FIT_MIN_VISIBLE = 120;

export type RouteFitPadding = { top: number; left: number; right: number; bottom: number };

/**
 * Padding for a route fit. `hiddenBottom` is the part of the map under the sheet; the gap is
 * added here. At the peek and half snaps the route sits at least 24 px above the sheet. At the
 * full snap the rider expanded the sheet on purpose and the map may be (almost) hidden: the
 * padding is clamped to keep ROUTE_FIT_MIN_VISIBLE px usable, so the fit never fails or zooms
 * out to the minimum, and the clearance is not guaranteed there.
 */
export function routeFitPadding(hiddenBottom: number, mapHeight: number): RouteFitPadding {
  const top = ROUTE_FIT_PAD_TOP;
  const wanted = Math.max(40, Math.round(hiddenBottom) + ROUTE_FIT_SHEET_GAP);
  const room = Math.max(40, mapHeight - top - ROUTE_FIT_MIN_VISIBLE);
  return { top, left: ROUTE_FIT_PAD_SIDE, right: ROUTE_FIT_PAD_RIGHT, bottom: Math.min(wanted, room) };
}

/** Points that must all be visible: both ends, then the recommended option's stops / path. */
export function routeFitPoints(
  start: LatLng,
  destination: LatLng,
  extra: readonly LatLng[] = [],
): LatLng[] {
  return [start, destination, ...extra].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** Stable identity of a route fit: changes when the ends or the option's points change. */
export function routeFitKey(points: readonly LatLng[]): string {
  if (points.length < 2) return "";
  const f = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  return `${points.length}:${f(points[0]!)}:${f(points[1]!)}:${f(points[points.length - 1]!)}`;
}
