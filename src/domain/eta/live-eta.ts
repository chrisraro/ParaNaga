// Blends the model's time for the rest of the current leg with the rider's observed pace. Pure.
//
// The model range (src/domain/eta, from typical speeds) stays the anchor. The observed pace turns
// the metres left into minutes (an observed range: a little faster to a little slower, wider for a
// ride, where stops and traffic are not in the moving average). The result is a weighted mix of the
// two ranges: the weight grows with the number of samples and is capped, so a short burst of
// speed never replaces the model. The observed minutes are bounded against the model range so one
// odd average cannot give a silly number. No observed pace: the model range, untouched.
import { SPEED_MIN_SAMPLES, type SpeedMode } from "./live-speed";

export type RawRange = { lowMin: number; highMin: number };

/** Highest weight the observed pace may have, per mode. */
export const MAX_OBSERVED_WEIGHT: Record<SpeedMode, number> = { walk: 0.7, ride: 0.5 };
/** The cap is reached this many samples after the minimum. */
export const SAMPLES_TO_FULL_WEIGHT = 8;
/** The observed range around the observed minutes. */
const OBSERVED_SPREAD: Record<SpeedMode, { low: number; high: number }> = { walk: { low: 0.85, high: 1.2 }, ride: { low: 0.85, high: 1.35 } };
/** The observed minutes stay within these multiples of the model range. */
const BOUND_LOW = 0.5;
const BOUND_HIGH = 2.5;

export type BlendedLeg = RawRange & {
  /** 0 = the model alone; up to the cap = how much of the observed pace is in the range. */
  weight: number;
};

export function blendLeg(model: RawRange, meters: number, observed: { mps: number; samples: number } | null, mode: SpeedMode): BlendedLeg {
  if (!observed || !(observed.mps > 0) || !(meters > 0) || !(model.highMin > 0)) return { ...model, weight: 0 };
  const cap = MAX_OBSERVED_WEIGHT[mode];
  const weight = Math.min(cap, Math.max(0, ((observed.samples - SPEED_MIN_SAMPLES + 1) / SAMPLES_TO_FULL_WEIGHT) * cap));
  if (weight === 0) return { ...model, weight: 0 };
  const rawMin = meters / observed.mps / 60;
  const obsMin = Math.min(Math.max(rawMin, model.lowMin * BOUND_LOW), model.highMin * BOUND_HIGH);
  const spread = OBSERVED_SPREAD[mode];
  const lowMin = (1 - weight) * model.lowMin + weight * obsMin * spread.low;
  const highMin = (1 - weight) * model.highMin + weight * obsMin * spread.high;
  return { lowMin, highMin: Math.max(highMin, lowMin), weight };
}
