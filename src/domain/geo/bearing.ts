// Direction from one point to another, as an 8-point compass octant. Pure.
//
// Used by guidance to say which way a stop lies in a straight line (no path or street is known).
import { en } from "@/i18n/dict";
import type { LatLng } from "./types";

export type Compass8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

const OCTANTS: readonly Compass8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** English compass words; screens use `t.geo.compass`. */
export const COMPASS_WORDS: Readonly<Record<Compass8, string>> = en.geo.compass;

/** Initial great-circle bearing from `from` to `to`, degrees clockwise from north, in [0, 360). */
export function initialBearingDegrees(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const φ1 = from.lat * rad;
  const φ2 = to.lat * rad;
  const Δλ = (to.lng - from.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = Math.atan2(y, x) / rad;
  const normalized = ((deg % 360) + 360) % 360;
  return normalized >= 360 ? 0 : normalized;
}

/** Octant of a bearing: each spans 45° centred on its direction (N = [337.5°, 22.5°)). */
export function compass8(degrees: number): Compass8 {
  const normalized = ((degrees % 360) + 360) % 360;
  return OCTANTS[Math.floor(normalized / 45 + 0.5) % 8]!;
}
