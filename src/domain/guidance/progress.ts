// Optional GPS progress for guidance. Pure.
//
// GPS only ever informs or proposes; it never confirms a step (the session needs the person's tap).
// A fix is used only when it is fresh (≤ STALE_MS old, and not stamped more than CLOCK_SKEW_MS in
// the future) and accurate to ≤ 50 m; any other fix is ignored entirely.
//
//  - Walk (polite outputs, ≤ 50 m): straight-line metres to the target (rounded to 10 m),
//    `nearTarget` within max(30 m, accuracy), and an 8-point bearing from 40 m out. No path, curb
//    or crossing exists.
//  - Ride: stops are counted strictly along the leg's provisional pin order. Index 0 is the pin the
//    rider boards at (the planner keeps the pin its board point is named after, even when that pin sits
//    a little before the board point; field test 2026-10-21), so the first stop passed counts. Per fix the passed
//    index may move only into the window passedIndex+1 … passedIndex+2 (one missed fix between
//    stops), only to a stop within 120 m of the fix, and only if that stop is (within 10 m) the
//    nearest of ALL the ride's stops: on a circuit whose return street runs beside the outbound
//    one, or a full circle whose alighting pin sits by the boarding pin, a stop further along the
//    order never wins. It must also be far enough from the last counted stop p: p+1 counts once the
//    fix is further from p than (p → p+1) − 60 m, and p+2 (skipping p+1) once further than p → p+1, so an
//    out-and-back spur (Loop B: STI → S&R → ALDP, ALDP on the spur road) never counts ALDP on the way
//    out. The index never decreases.
//  - After a GPS gap the jeepney may be past the window. A usable fix whose nearest stop lies
//    beyond the window while it is more than 120 m from every window stop sets `countLost`: the
//    view then drops to the no-GPS copy and there is no Para. The count resyncs (jumps ahead,
//    clearing `countLost`) only when two CONSECUTIVE usable fixes match stops beyond the window in
//    strictly increasing pin order, each the nearest of all stops (tie tolerance) and none within
//    120 m of a stop at or before the window (so a parallel return street, which runs beside
//    earlier stops, is never a resync target). Any in-window or current-stop match also clears it.
//  - Para (the only assertive output, decision A) needs a PRECISE fix (≤ PRECISE_M = 30 m):
//    `alightNear` when such a fix is within 300 m of the alighting pin while pin order agrees
//    (passed index ≥ alighting index − 1: a parallel return street brings the pin within 300 m with
//    stops still to go, Loops A/B on Magsaysay); `nearStopBefore` when such a fix matches, in order, a
//    stop with index ≥ max(1, alighting index − 1). Both latch once set (pin order cannot go back).
//    `paraSuggested` is the one rule the view and the session both use ("I got off" needs it).
// The stop count has no off-route detection (pins are not a shape) and no time estimate anywhere.
//  - A ride with a Lines path (pinless rides boarding/alighting at free points, plan E): `pathRideProgress`
//    projects the fix onto the ride's slice of the path, [board, alight] in path order (wrapping across
//    the start on a circuit): remaining = alight − current. More than PATH_OFF_M from the slice reads
//    "off path" (the jeepney may use another street), never progress. Where an out-and-back slice passes the same
//    place twice, the last measure (kept by the session) picks the pass at or after it.
import { compass8, initialBearingDegrees, type Compass8 } from "../geo/bearing";
import { haversineMeters } from "../geo/geometry";
import { projectOnLine } from "../geo/measure";
import { PRECISE_M, isStale, type LocationFix } from "../geo/location-fix";
import type { LatLng } from "../geo/types";

export const GUIDANCE_MAX_ACCURACY_M = 50;
/** Para (assertive) needs a fix at least this precise: the codebase's PRECISE_M. */
export const PARA_MAX_ACCURACY_M = PRECISE_M;
export const NEAR_TARGET_MIN_M = 30;
export const BEARING_MIN_DISTANCE_M = 40;
export const STOP_PASS_RADIUS_M = 120;
export const ALIGHT_NEAR_M = 300;
/** "I've arrived" needs a usable fix this close (straight line) to the destination (owner, 2026-10-22). */
export const ARRIVE_NEAR_M = 100;
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
  /** GPS says the jeepney is past the window: the count is not shown until it resyncs. */
  countLost: boolean;
  /** The previous usable fix's beyond-window match (first half of a resync), else null. */
  pendingIndex: number | null;
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

export const NEW_RIDE_MEMORY: RideMemory = { passedIndex: 0, countLost: false, pendingIndex: null, alightNear: false, nearStopBefore: false };

/** The single Para rule: a precise fix put them there in pin order (count not lost). GPS only: no manual advance. */
export function paraSuggested(ride: RideMemory): boolean {
  return !ride.countLost && (ride.alightNear || ride.nearStopBefore);
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
  const windowEnd = Math.min(alightIndex, current.passedIndex + STOP_WINDOW);

  let passedIndex = current.passedIndex;
  let countLost = current.countLost;
  let pendingIndex: number | null = null;
  let matched = -1;
  // Order needs distance from the last counted stop p (an out-and-back spur passes the same pins twice: Loop B
  // STI → S&R → ALDP, ALDP on the spur road 230 m from STI): p+1 counts only once the fix is within 60 m of p's
  // distance to it, and skipping p+1 only once the fix is further from p than p+1 is.
  const p = current.passedIndex;
  const toNext = haversineMeters(stops[p]!, stops[Math.min(p + 1, alightIndex)]!);
  const leftP = (i: number) => distances[p]! > toNext - (i === p + 1 ? STOP_PASS_RADIUS_M / 2 : 0);
  for (let i = current.passedIndex + 1; i <= windowEnd; i++) {
    if (matches(i) && leftP(i)) {
      passedIndex = i;
      matched = i;
      break;
    }
  }
  if (matched < 0 && matches(current.passedIndex)) matched = current.passedIndex;

  if (matched >= 0) {
    countLost = false;
  } else {
    // Beyond the window: the nearest stop is further along than the window, and no window stop is near.
    const nearestIndex = distances.indexOf(nearest);
    const farFromWindow = distances.slice(current.passedIndex + 1, windowEnd + 1).every((d) => d > STOP_PASS_RADIUS_M);
    if (nearestIndex > windowEnd && farFromWindow) countLost = true;
    // A resync candidate: the first beyond-window match, not beside any stop at or before the window.
    let candidate = -1;
    for (let k = windowEnd + 1; k <= alightIndex; k++) {
      if (matches(k)) {
        candidate = k;
        break;
      }
    }
    if (candidate >= 0) {
      const besideEarlier = stops.slice(0, windowEnd + 1).some((st) => haversineMeters(st, stops[candidate]!) <= STOP_PASS_RADIUS_M);
      if (besideEarlier) candidate = -1;
    }
    if (candidate >= 0 && current.pendingIndex !== null && candidate > current.pendingIndex) {
      passedIndex = candidate;
      matched = candidate;
      countLost = false;
    } else if (candidate >= 0) {
      pendingIndex = candidate;
    }
  }

  let { alightNear, nearStopBefore } = current;
  if (preciseFix(fix, now) && !countLost) {
    // Only once the stop before alighting is counted: a loop's parallel return street brings the alighting pin
    // within 300 m in a straight line while stops are still to go (Loops A/B on Magsaysay).
    if (passedIndex >= alightIndex - 1 && distances[alightIndex]! <= ALIGHT_NEAR_M) alightNear = true;
    if (matched >= Math.max(1, alightIndex - 1)) nearStopBefore = true;
  }
  return summarize(stops, { passedIndex, countLost, pendingIndex, alightNear, nearStopBefore }, true);
}

// ---------------------------------------------------------------- along the Lines path (plan E)

/** A fix further than this from the ride's slice of the path is "off path" (GPS ≤ 50 m + an approximate path). */
export const PATH_OFF_M = 100;
/** "Get ready" once this little riding is left. */
export const GET_READY_M = 300;
/** Projections within this much of the nearest one count as the same place (the earliest pass at or after the last measure wins). */
export const SAME_PLACE_M = 25;

export type PathRideProgress = { offPath: true; distM: number } | { offPath: false; remainingM: number; getReady: boolean; measureM: number };

/**
 * Progress of a ride along `path` from measure `boardM` to `alightM` (path order; on a circuit the ride may
 * cross the path's start, and an alight measure past the length is read modulo it). Null without a usable fix.
 * `lastM`: the measure of the previous on-path fix (null at first), so a later pass is not read as the earlier one.
 */
export function pathRideProgress(
  path: readonly LatLng[],
  isCircuit: boolean,
  boardM: number,
  alightM: number,
  fix: LocationFix | null,
  now: number,
  lastM: number | null = null,
): PathRideProgress | null {
  if (!fix || !usableFix(fix, now) || path.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + haversineMeters(path[i - 1]!, path[i]!));
  const length = cum.at(-1)!;
  const end = isCircuit && length > 0 ? boardM + ((((alightM - boardM) % length) + length) % length) : alightM;
  const candidates: { distM: number; m: number }[] = [];
  for (const offset of isCircuit ? [0, length] : [0]) {
    for (let i = 1; i < path.length; i++) {
      const m0 = cum[i - 1]! + offset;
      const m1 = cum[i]! + offset;
      const lo = Math.max(m0, boardM);
      const hi = Math.min(m1, end);
      if (hi < lo || m1 === m0) continue;
      const a = path[i - 1]!;
      const b = path[i]!;
      const at = (m: number) => ({ lat: a.lat + ((m - m0) / (m1 - m0)) * (b.lat - a.lat), lng: a.lng + ((m - m0) / (m1 - m0)) * (b.lng - a.lng) });
      const pr = projectOnLine([at(lo), at(hi)], fix);
      candidates.push({ distM: pr.distM, m: lo + pr.measureM });
    }
  }
  if (candidates.length === 0) return null;
  // An out-and-back slice passes the same place twice: GPS noise must not jump to the later pass, so
  // among projections about as near as the nearest, the earliest measure (least progress) at or after the
  // last measure wins (the ride never goes back), else the earliest.
  const nearest = Math.min(...candidates.map((x) => x.distM));
  const near = candidates.filter((x) => x.distM <= nearest + SAME_PLACE_M);
  const ahead = lastM === null ? [] : near.filter((x) => x.m >= lastM - SAME_PLACE_M);
  const best = (ahead.length > 0 ? ahead : near).reduce((a, b) => (b.m < a.m ? b : a));
  if (best.distM > PATH_OFF_M) return { offPath: true, distM: Math.round(best.distM) };
  const remainingM = Math.max(0, Math.round(end - best.m));
  return { offPath: false, remainingM, getReady: remainingM <= GET_READY_M, measureM: best.m };
}
