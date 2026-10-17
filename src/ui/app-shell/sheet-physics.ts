// Pure maths for the bottom sheet's drag: rubber band, velocity, detent choice, settle time.
// No DOM and no React, so it is unit-tested directly and runs inside the per-frame handler.

import type { Snap } from "./bottom-sheet";

/** Largest stretch (px) past the first or last detent. */
export const RUBBER_BAND_D = 120;
/** How far ahead (ms) a release's velocity carries the sheet before picking the nearest detent. */
export const FLING_MS = 200;
export const SETTLE_MIN_MS = 180;
export const SETTLE_MAX_MS = 360;

/** Resistance past an end: grows with the finger travel `x` (px) but never reaches D. */
export function rubberBand(x: number, d = RUBBER_BAND_D): number {
  return (1 - 1 / ((x * 0.55) / d + 1)) * d;
}

/** A raw sheet offset, stretched with the rubber band past full (< 0) or past the peek (> `max`). */
export function stretchedOffset(raw: number, max: number): number {
  if (raw < 0) return -rubberBand(-raw);
  if (raw > max) return max + rubberBand(raw - max);
  return raw;
}

/** Exponential moving average of the pointer velocity (px/ms): 0.8 newest, 0.2 before. */
export function smoothVelocity(sample: number, previous: number): number {
  return 0.8 * sample + 0.2 * previous;
}

/** The detent (offsets[snap]) nearest the rest point projected from `offset` and velocity `v` (px/ms). */
export function nearestDetent(offsets: readonly [number, number, number], offset: number, v: number): Snap {
  const projected = offset + v * FLING_MS;
  let best: Snap = 0;
  for (const s of [1, 2] as const) if (Math.abs(offsets[s] - projected) < Math.abs(offsets[best] - projected)) best = s;
  return best;
}

/** Settle time (ms): longer for a longer way, shorter for a faster release; clamped to 180-360. */
export function settleDuration(distance: number, v: number): number {
  return Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, Math.abs(distance) * 0.9 - Math.abs(v) * 40));
}
