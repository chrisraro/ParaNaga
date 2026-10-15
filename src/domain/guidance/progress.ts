// Optional GPS progress for guidance. Pure.
//
// GPS only ever informs or proposes; it never confirms a step (the session needs the person's tap).
// A fix is used only when it is fresh (≤ STALE_MS old) and its accuracy is ≤ 50 m; any other fix
// is ignored entirely, so it can neither move progress nor make anything appear.
//
//  - Walk: straight-line metres to the target (rounded to 10 m), `nearTarget` within
//    max(30 m, accuracy), and an 8-point bearing from 40 m out. No path, curb or crossing exists.
//  - Ride: stops are counted along the leg's provisional pin order. The passed index never
//    decreases and moves only to a later stop within 120 m of the fix (the earliest such stop, so a
//    loop that runs close to itself never skips ahead). `nextIsAlight` once the stop before
//    alighting is passed or a fix comes within 300 m of the alighting stop (latched).
// There is no off-route detection (no shape exists) and no time estimate anywhere: these types have
// no time fields.
import { compass8, initialBearingDegrees, type Compass8 } from "../geo/bearing";
import { haversineMeters } from "../geo/geometry";
import { isStale, type LocationFix } from "../geo/location-fix";
import type { LatLng } from "../geo/types";

export const GUIDANCE_MAX_ACCURACY_M = 50;
export const NEAR_TARGET_MIN_M = 30;
export const BEARING_MIN_DISTANCE_M = 40;
export const STOP_PASS_RADIUS_M = 120;
export const ALIGHT_NEAR_M = 300;

/** Fresh, finite and accurate to ≤ 50 m: the only fixes guidance looks at. */
export function usableFix(fix: LocationFix | null | undefined, now: number): boolean {
  if (!fix) return false;
  if (![fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite)) return false;
  if (fix.accuracy < 0 || fix.accuracy > GUIDANCE_MAX_ACCURACY_M) return false;
  return !isStale(fix, now);
}

export type WalkProgress = {
  /** Straight-line metres from the fix to the target, rounded to 10 m. */
  distanceMeters: number;
  nearTarget: boolean;
  /** Where the target lies from the fix; null closer than 40 m. */
  bearing: Compass8 | null;
};

export function walkProgress(target: LatLng, fix: LocationFix | null, now: number): WalkProgress | null {
  if (!fix || !usableFix(fix, now)) return null;
  const meters = haversineMeters(fix, target);
  return {
    distanceMeters: Math.round(meters / 10) * 10,
    nearTarget: meters <= Math.max(NEAR_TARGET_MIN_M, fix.accuracy),
    bearing: meters >= BEARING_MIN_DISTANCE_M ? compass8(initialBearingDegrees(fix, target)) : null,
  };
}

/** What a ride remembers between fixes (kept in the session). */
export type RideMemory = {
  /** Index into the ride's stops of the last stop passed; 0 = the boarding stop. */
  passedIndex: number;
  /** A usable fix has been within 300 m of the alighting stop. */
  alightNear: boolean;
};

export type RideProgress = RideMemory & {
  /** Stops still to go, the alighting stop included. */
  stopsRemaining: number;
  nextIsAlight: boolean;
  /** This fix was usable (whether or not it moved anything). */
  fromGps: boolean;
};

function summarize(stops: readonly LatLng[], memory: RideMemory, fromGps: boolean): RideProgress {
  const alightIndex = stops.length - 1;
  return {
    passedIndex: memory.passedIndex,
    alightNear: memory.alightNear,
    stopsRemaining: Math.max(0, alightIndex - memory.passedIndex),
    nextIsAlight: memory.passedIndex >= alightIndex - 1 || memory.alightNear,
    fromGps,
  };
}

/** `stops`: the ride's stops in pin order, boarding first and alighting last (at least 2). */
export function rideProgress(stops: readonly LatLng[], memory: RideMemory, fix: LocationFix | null, now: number): RideProgress {
  const alightIndex = stops.length - 1;
  const current: RideMemory = { passedIndex: Math.min(Math.max(0, memory.passedIndex), alightIndex), alightNear: memory.alightNear };
  if (!fix || !usableFix(fix, now)) return summarize(stops, current, false);
  let passedIndex = current.passedIndex;
  for (let i = current.passedIndex + 1; i <= alightIndex; i++) {
    if (haversineMeters(fix, stops[i]!) <= STOP_PASS_RADIUS_M) {
      passedIndex = i;
      break;
    }
  }
  const alightNear = current.alightNear || haversineMeters(fix, stops[alightIndex]!) <= ALIGHT_NEAR_M;
  return summarize(stops, { passedIndex, alightNear }, true);
}
