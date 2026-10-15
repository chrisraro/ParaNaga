// Optional GPS progress for guidance. Pure.
//
// GPS only ever informs or proposes; it never confirms a step (the session needs the person's tap).
// A fix is used only when it is fresh (≤ STALE_MS old, and not stamped more than CLOCK_SKEW_MS in
// the future) and accurate to ≤ 50 m; any other fix is ignored entirely.
//
//  - Walk (polite outputs, ≤ 50 m): straight-line metres to the target (rounded to 10 m),
//    `nearTarget` within max(30 m, accuracy), and an 8-point bearing from 40 m out. No path, curb
//    or crossing exists.
//  - Ride: stops are counted strictly along the leg's provisional pin order. Per fix the passed
//    index may move only into the window passedIndex+1 … passedIndex+2 (one missed fix between
//    stops), only to a stop within 120 m of the fix, and only if that stop is (within 10 m) the
//    nearest of ALL the ride's stops: on a circuit whose return street runs beside the outbound
//    one, or a full circle whose alighting pin sits by the boarding pin, a stop further along the
//    order never wins. The index never decreases.
//  - Para (the only assertive output, decision A) needs a PRECISE fix (≤ PRECISE_M = 30 m):
//    `alightNear` when such a fix is within 300 m of the alighting pin while pin order agrees
//    (passed index ≥ alighting index − 2); `nearStopBefore` when such a fix matches, in order, a
//    stop with index ≥ max(1, alighting index − 1). Both latch once set (pin order cannot go back).
//    `paraSuggested` is the one rule the view and the session both use.
// There is no off-route detection (no shape exists) and no time estimate anywhere.
import { compass8, initialBearingDegrees, type Compass8 } from "../geo/bearing";
import { haversineMeters } from "../geo/geometry";
import { PRECISE_M, isStale, type LocationFix } from "../geo/location-fix";
import type { LatLng } from "../geo/types";

export const GUIDANCE_MAX_ACCURACY_M = 50;
/** Para (assertive) needs a fix at least this precise: the codebase's PRECISE_M. */
export const PARA_MAX_ACCURACY_M = PRECISE_M;
export const NEAR_TARGET_MIN_M = 30;
export const BEARING_MIN_DISTANCE_M = 40;
export const STOP_PASS_RADIUS_M = 120;
export const ALIGHT_NEAR_M = 300;
/** Stops the passed index may move per fix (allows one missed fix between stops). */
export const STOP_WINDOW = 2;
/** A stop counts as "the nearest" when within this much of the nearest stop (near-identical pins). */
export const NEAREST_TOLERANCE_M = 10;
/** A fix (or a stored session) stamped further than this in the future is refused. */
export const CLOCK_SKEW_MS = 5_000;

/** Fresh, finite and accurate to ≤ 50 m: the only fixes guidance looks at. */
export function usableFix(fix: LocationFix | null | undefined, now: number): boolean {
  if (!fix) return false;
  if (![fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite)) return false;
  if (fix.accuracy < 0 || fix.accuracy > GUIDANCE_MAX_ACCURACY_M) return false;
  if (fix.timestamp > now + CLOCK_SKEW_MS) return false;
  return !isStale(fix, now);
}

/** Usable and accurate to ≤ 30 m: the only fixes that can suggest Para. */
export function preciseFix(fix: LocationFix | null | undefined, now: number): boolean {
  return usableFix(fix, now) && fix!.accuracy <= PARA_MAX_ACCURACY_M;
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
  /** A precise fix was within 300 m of the alighting pin while pin order agreed. */
  alightNear: boolean;
  /** A precise fix matched, in order, the stop before the alighting stop (or the alighting stop). */
  nearStopBefore: boolean;
};

export type RideProgress = RideMemory & {
  /** Stops still to go, the alighting stop included (polite count). */
  stopsRemaining: number;
  /** This fix was usable (whether or not it moved anything). */
  fromGps: boolean;
};

export const NEW_RIDE_MEMORY: RideMemory = { passedIndex: 0, alightNear: false, nearStopBefore: false };

/** The single Para rule: the person said so, or a precise fix put them there in pin order. */
export function paraSuggested(ride: RideMemory & { stopIsNext: boolean }): boolean {
  return ride.stopIsNext || ride.alightNear || ride.nearStopBefore;
}

function summarize(stops: readonly LatLng[], memory: RideMemory, fromGps: boolean): RideProgress {
  return { ...memory, stopsRemaining: Math.max(0, stops.length - 1 - memory.passedIndex), fromGps };
}

/** `stops`: the ride's stops in pin order, boarding first and alighting last (at least 2). */
export function rideProgress(stops: readonly LatLng[], memory: RideMemory, fix: LocationFix | null, now: number): RideProgress {
  const alightIndex = stops.length - 1;
  const current: RideMemory = { ...memory, passedIndex: Math.min(Math.max(0, memory.passedIndex), alightIndex) };
  if (!fix || !usableFix(fix, now)) return summarize(stops, current, false);

  const distances = stops.map((s) => haversineMeters(fix, s));
  const nearest = Math.min(...distances);
  const matches = (i: number) => distances[i]! <= STOP_PASS_RADIUS_M && distances[i]! <= nearest + NEAREST_TOLERANCE_M;

  let passedIndex = current.passedIndex;
  let matched = matches(passedIndex) ? passedIndex : -1;
  for (let i = current.passedIndex + 1; i <= Math.min(alightIndex, current.passedIndex + STOP_WINDOW); i++) {
    if (matches(i)) {
      passedIndex = i;
      matched = i;
      break;
    }
  }

  let { alightNear, nearStopBefore } = current;
  if (preciseFix(fix, now)) {
    if (passedIndex >= alightIndex - 2 && distances[alightIndex]! <= ALIGHT_NEAR_M) alightNear = true;
    if (matched >= Math.max(1, alightIndex - 1)) nearStopBefore = true;
  }
  return summarize(stops, { passedIndex, alightNear, nearStopBefore }, true);
}
