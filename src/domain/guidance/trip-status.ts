// How far along the whole trip the person is, and when they should arrive. Pure.
//
// Progress is distance done over the trip's distance: finished steps count in full, the current step
// by what is left of it (a walk: the straight line to its target × 1.3 like the plan's estimates, or
// the plan's own length without GPS; a ride: the metres left along its path or pins, view.ts). A tricycle
// or padyak step with no distance on file makes the total unknown: the bar then counts steps, and no
// distance is shown. Nothing here is a position: no coordinate leaves this module.
//
// The time left is the snapshot's model (src/domain/eta) for the rest of the trip. On the current
// jeepney or walking leg the model range is blended with the rider's observed pace (live-eta.ts); the
// later legs stay on the model. A leg with no speed on file (a tricycle) is not estimated: the range
// then covers only the estimated legs and says what is missing, and there is no clock time. The
// boarding wait is unknown (no published headways) and is never counted: `waitPending` says so.
// The clock time is the middle of the range, rounded to 5 minutes, in Asia/Manila time.
import { estimateOption, roundRange, type EtaMode, type EtaOptionInput } from "../eta/eta";
import { blendLeg } from "../eta/live-eta";
import { observedSpeed, type SpeedMode, type SpeedTracker } from "../eta/live-speed";
import type { LocationFix } from "../geo/location-fix";
import { usableFix, walkProgress } from "./progress";
import { ridePathProgress, type GuidanceSession } from "./session";
import type { GuidanceStep } from "./steps";
import { rideMetersLeft } from "./view";

type Leg = EtaOptionInput["legs"][number];

export type TripEta = {
  lowMin: number;
  highMin: number;
  /** The middle of the range from `now`, rounded to 5 minutes (epoch ms). Null when the range is partial. */
  arriveAtMs: number | null;
};

export type TripStatus = {
  /** "distance": metres done / metres in all; "steps": a step has no distance on file. */
  basis: "distance" | "steps";
  fraction: number;
  percent: number;
  /** Metres left (rounded to 10); null when the total is unknown. */
  remainingMeters: number | null;
  /** Null when no estimate is possible (no model, no clock yet, or only unestimated legs). */
  eta: TripEta | null;
  /** Modes left in the trip that have no time on file (a tricycle), each once. */
  unestimatedModes: EtaMode[];
  /** A boarding is still ahead: waiting for the vehicle is unknown and not in the time. */
  waitPending: boolean;
  /** The rider's observed pace is part of the current leg's range. */
  paceUsed: boolean;
};

/** The arrival clock is rounded to this. */
export const ARRIVE_ROUND_MS = 5 * 60_000;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The pace mode the tracker follows on this step (null: a street ride has no speed on file). */
export function speedModeFor(kind: GuidanceStep["kind"]): SpeedMode | null {
  return kind === "ride" ? "ride" : kind === "street_ride" ? null : "walk";
}

/** The step's length in metres (plan's walk-graph length when on file), or null when unknown. */
function stepMeters(session: GuidanceSession, step: GuidanceStep): number | null {
  switch (step.kind) {
    case "ride":
    case "street_ride":
      return step.distanceMeters;
    default:
      return step.legIndex === null ? 0 : (session.trip.walkLengths?.[step.legIndex] ?? step.estimateMeters);
  }
}

/** Metres left of the current step, never more than its length; null when unknown. */
function currentRemaining(session: GuidanceSession, step: GuidanceStep, total: number | null, fix: LocationFix | null, now: number): number | null {
  if (total === null) return null;
  if (step.kind === "ride") {
    const ride = session.ride;
    if (!ride) return total;
    const onPath = ridePathProgress(session.trip, step, fix, now, ride.pathM ?? null);
    if (onPath && !onPath.offPath) return Math.min(total, Math.max(0, onPath.remainingM));
    return Math.min(total, rideMetersLeft(step, ride.passedIndex).meters);
  }
  const progress = walkProgress(step.target, fix, now);
  if (!progress) return total;
  return Math.min(total, Math.round(progress.distanceMeters * 1.3));
}

/** The index of the first option leg that is still ahead after the current step. */
function firstLaterLeg(steps: GuidanceStep[], at: number, legCount: number): number {
  const own = steps[at]!.legIndex;
  if (own !== null) return own + 1;
  // A walk the plan does not have (legIndex null): the next step with a leg starts the rest.
  for (const s of steps.slice(at + 1)) if (s.legIndex !== null) return s.legIndex;
  return legCount;
}

function currentLeg(step: GuidanceStep, remaining: number | null): Leg | null {
  switch (step.kind) {
    case "ride":
      return { kind: "ride", mode: step.mode, distanceMeters: remaining ?? step.distanceMeters, distanceBasis: step.distanceBasis };
    case "street_ride":
      return { kind: step.mode, distanceMeters: remaining };
    default:
      return step.legIndex === null ? null : { kind: "walk", estimateMeters: remaining ?? 0 };
  }
}

/** Where the person is in the trip; null unless the session is active. */
export function tripStatus(session: GuidanceSession, steps: GuidanceStep[], fix: LocationFix | null, now: number, tracker: SpeedTracker | null): TripStatus | null {
  if (session.status !== "active") return null;
  const step = steps[session.stepIndex];
  if (!step) return null;
  const usable = usableFix(fix, now) ? fix : null;

  // ---- progress
  const lengths = steps.map((s) => stepMeters(session, s));
  const known = lengths.every((m): m is number => m !== null);
  const total = lengths[session.stepIndex] ?? null;
  const left = currentRemaining(session, step, total, usable, now);
  let fraction: number;
  let remainingMeters: number | null = null;
  if (known) {
    const all = (lengths as number[]).reduce((a, b) => a + b, 0);
    const before = (lengths as number[]).slice(0, session.stepIndex).reduce((a, b) => a + b, 0);
    const doneInStep = (total ?? 0) - (left ?? 0);
    fraction = all > 0 ? clamp01((before + doneInStep) / all) : 0;
    remainingMeters = Math.round(Math.max(0, all - before - doneInStep) / 10) * 10;
  } else {
    const within = total !== null && total > 0 && left !== null ? 1 - left / total : 0;
    fraction = clamp01((session.stepIndex + within) / steps.length);
  }

  // ---- time
  const legs = session.trip.option.legs;
  const laterFrom = firstLaterLeg(steps, session.stepIndex, legs.length);
  const later = legs.slice(laterFrom);
  const cur = currentLeg(step, left);
  const optionLegs: Leg[] = [...(cur ? [cur] : []), ...later];
  const walkLengths = [...(cur ? [null] : []), ...later.map((_, i) => session.trip.walkLengths?.[laterFrom + i] ?? null)];
  const waitPending = steps.slice(session.stepIndex).some((s) => s.kind === "walk_to_board" || s.kind === "transfer");

  let eta: TripEta | null = null;
  let unestimatedModes: EtaMode[] = [];
  let paceUsed = false;
  const res = optionLegs.length > 0 && now > 0 ? estimateOption({ legs: optionLegs }, walkLengths, session.trip.etaModel, new Date(now)) : null;
  if (res?.ok) {
    const est = res.estimate;
    unestimatedModes = est.total.unestimatedModes;
    let lowMin = est.total.lowMin;
    let highMin = est.total.highMin;
    const first = cur ? est.legs[0]! : null;
    const mode = speedModeFor(step.kind);
    const observed = tracker && mode && first?.estimated ? observedSpeed(tracker) : null;
    if (cur && first && mode && observed && first.rawLowMin !== null && first.rawHighMin !== null && left !== null && lowMin !== null && highMin !== null) {
      const blended = blendLeg({ lowMin: first.rawLowMin, highMin: first.rawHighMin }, left, observed, mode);
      if (blended.weight > 0) {
        const rounded = roundRange(blended.lowMin, blended.highMin);
        lowMin = lowMin - first.lowMin! + rounded.lowMin;
        highMin = highMin - first.highMin! + rounded.highMin;
        paceUsed = true;
      }
    }
    if (lowMin !== null && highMin !== null) {
      const partial = est.total.partial;
      const mid = now + ((lowMin + highMin) / 2) * 60_000;
      eta = { lowMin, highMin, arriveAtMs: partial ? null : Math.round(mid / ARRIVE_ROUND_MS) * ARRIVE_ROUND_MS };
    }
  } else if (optionLegs.length > 0) {
    // No estimate (no model or no clock): name only what has no time on file by nature.
    unestimatedModes = [...new Set(optionLegs.flatMap((l) => (l.kind === "tricycle" || l.kind === "padyak" ? [l.kind] : l.kind === "ride" && l.mode !== "jeepney" ? [l.mode] : [])))];
  }

  return { basis: known ? "distance" : "steps", fraction, percent: Math.round(fraction * 100), remainingMeters, eta, unestimatedModes, waitPending, paceUsed };
}
