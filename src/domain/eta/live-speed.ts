// The rider's own pace on the current leg, from the location watch. Pure; the state lives in the
// guidance hook's memory only (never stored, never sent: coordinates are personal data).
//
// One speed sample per usable fix: the device's own `speed` when it gives one, else the distance
// between two consecutive fixes over the time between them. A sample is ignored when the fix is
// imprecise (> SPEED_MAX_ACCURACY_M), when the person is stationary (a red light, waiting at a stop:
// that is not the pace of the leg), when the gap between fixes is too short or too long to trust, or
// when the movement is within the fix's own noise. Samples are clamped to what a walker or a jeepney
// can do, then folded into an exponential moving average (SPEED_ALPHA). The tracker restarts on
// every step.
import { haversineMeters } from "../geo/geometry";
import type { LocationFix } from "../geo/location-fix";

export type SpeedMode = "walk" | "ride";

/** Fixes worse than this say nothing about speed. */
export const SPEED_MAX_ACCURACY_M = 50;
/** Weight of the newest sample in the moving average. */
export const SPEED_ALPHA = 0.3;
/** Samples needed before the observed pace is used at all. */
export const SPEED_MIN_SAMPLES = 3;
/** Gap between two fixes that may give a derived speed. */
export const SPEED_MIN_DT_S = 2;
export const SPEED_MAX_DT_S = 30;
/** Below `still` m/s the person is stationary (ignored); above `max` the sample is clamped (a GPS spike). */
export const SPEED_LIMITS: Record<SpeedMode, { still: number; max: number }> = {
  walk: { still: 0.4, max: 2.5 },
  ride: { still: 1.0, max: 20 },
};

export type SpeedTracker = {
  /** What the average belongs to ("<session>:<step>:<mode>"); a different key starts over. */
  key: string;
  emaMps: number | null;
  samples: number;
  last: { lat: number; lng: number; timestamp: number } | null;
};

export const NO_SPEED: SpeedTracker = { key: "", emaMps: null, samples: 0, last: null };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

const goodFix = (fix: LocationFix) =>
  finite(fix.lat) && finite(fix.lng) && finite(fix.timestamp) && finite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= SPEED_MAX_ACCURACY_M;

/** One speed sample in m/s, or null when the fix gives none that can be trusted. */
export function speedSample(last: SpeedTracker["last"], fix: LocationFix): number | null {
  if (!goodFix(fix)) return null;
  if (finite(fix.speed) && fix.speed >= 0) return fix.speed;
  if (!last) return null;
  const dt = (fix.timestamp - last.timestamp) / 1000;
  if (dt < SPEED_MIN_DT_S || dt > SPEED_MAX_DT_S) return null;
  const meters = haversineMeters(last, fix);
  if (meters <= fix.accuracy) return null; // within the fix's own noise
  return meters / dt;
}

/** The tracker after `fix` (unchanged when the fix is unusable). */
export function updateSpeed(prev: SpeedTracker, key: string, mode: SpeedMode, fix: LocationFix): SpeedTracker {
  const base = prev.key === key ? prev : { ...NO_SPEED, key };
  if (!goodFix(fix)) return base;
  if (base.last && fix.timestamp <= base.last.timestamp) return base; // out of order
  const sample = speedSample(base.last, fix);
  const last = { lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp };
  const limits = SPEED_LIMITS[mode];
  if (sample === null || sample < limits.still) return { ...base, last };
  const clamped = Math.min(sample, limits.max);
  const emaMps = base.emaMps === null ? clamped : base.emaMps + SPEED_ALPHA * (clamped - base.emaMps);
  return { ...base, emaMps, samples: base.samples + 1, last };
}

/** The pace to use, or null while there are too few samples. */
export function observedSpeed(tracker: SpeedTracker): { mps: number; samples: number } | null {
  if (tracker.emaMps === null || tracker.samples < SPEED_MIN_SAMPLES) return null;
  return { mps: tracker.emaMps, samples: tracker.samples };
}
