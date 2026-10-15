import { isInsideNaga } from "./naga";

export type LocationFix = {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius in metres. */
  accuracy: number;
  /** Epoch milliseconds. */
  timestamp: number;
  heading?: number | null;
  speed?: number | null;
};

export type FixQuality = "precise" | "approximate" | "coarse";

export const PRECISE_M = 30;
export const APPROXIMATE_M = 100;
export const STALE_MS = 30_000;

const NEWER_MS = 10_000;
const NEWER_ACCURACY_ALLOWANCE = 1.5;

const validAccuracy = (accuracy: number): boolean => Number.isFinite(accuracy) && accuracy >= 0;

export function fixQuality(fix: LocationFix): FixQuality {
  if (!validAccuracy(fix.accuracy)) return "coarse";
  if (fix.accuracy <= PRECISE_M) return "precise";
  if (fix.accuracy <= APPROXIMATE_M) return "approximate";
  return "coarse";
}

export function isStale(fix: LocationFix, now: number): boolean {
  return now - fix.timestamp > STALE_MS;
}

export function pickBetterFix(
  current: LocationFix | null,
  next: LocationFix,
  now: number,
): LocationFix {
  if (current === null || isStale(current, now)) return next;
  if (!validAccuracy(next.accuracy)) return current;
  if (!validAccuracy(current.accuracy)) return next;
  if (next.accuracy <= current.accuracy) return next;
  if (
    next.timestamp - current.timestamp > NEWER_MS &&
    next.accuracy <= current.accuracy * NEWER_ACCURACY_ALLOWANCE
  ) {
    return next;
  }
  return current;
}

export type FixAssessment = {
  quality: FixQuality;
  stale: boolean;
  insideCity: boolean;
  usableAsStart: boolean;
  /** How old the fix is, in ms (never negative). */
  ageMs: number;
};

export function assessFix(fix: LocationFix, now: number): FixAssessment {
  const quality = fixQuality(fix);
  const stale = isStale(fix, now);
  const insideCity = isInsideNaga({ lat: fix.lat, lng: fix.lng });
  const ageMs = Math.max(0, now - fix.timestamp);
  return { quality, stale, insideCity, usableAsStart: quality !== "coarse" && !stale && insideCity, ageMs };
}
