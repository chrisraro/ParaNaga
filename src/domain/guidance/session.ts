// The guidance session: where the person is in the step list, as a reducer. Pure.
//
// Every change that matters is a confirmation by the person: "I'm at the stop" (atStop),
// "I boarded …" (boarded), "My stop is next" (nextStopIsMine, the manual advance), "I said Para"
// (paraAcknowledged, only once Para is suggested), "I got off" (gotOff), "I missed my stop"
// (missedStop), "I've arrived" (arrived), "End guidance" / "Done" (end) and "Back" (back: undoes
// the last confirmation, for a mis-tap on a moving jeepney). A location fix only moves the ride's stop count
// (progress.ts) and is ignored when imprecise or stale; it never changes the step or the status.
// An event that does not apply to the current step or status is ignored: the same object comes
// back, so callers can compare by reference.
//
// The session is kept in sessionStorage (state survives a reload, not a new tab), validated with
// Zod on the way back in, and dropped after GUIDANCE_SESSION_MAX_AGE_MS. It has no time estimate:
// `startedAt` is only for that expiry.
import { z } from "zod";
import { planOptionSchema, toWireOption } from "../api/plan";
import { etaModelSchema } from "../api/schemas";
import type { LocationFix } from "../geo/location-fix";
import { CLOCK_SKEW_MS, NEW_RIDE_MEMORY, paraSuggested, rideProgress, usableFix, type RideMemory } from "./progress";
import { guidanceSteps, type GuidanceStep, type GuidanceTrip } from "./steps";

/** 2: street rides and `trip.ridePaths` (Increment E). Format-1 sessions still read (migrated to 2 on parse);
 *  format-1 code (rollback) discards a format-2 session, as it does any unreadable one. */
export const GUIDANCE_SESSION_FORMAT = 2;
/** A restored session older than this (a forgotten tab) is not resumed. */
export const GUIDANCE_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** sessionStorage key (same "paranaga." prefix as the other device keys). */
export const GUIDANCE_SESSION_KEY = "paranaga.guidance";

export type GuidanceStatus = "active" | "missed_stop" | "arrived" | "ended";

export type RideState = RideMemory & {
  /** A usable fix arrived during this ride (so the stop count is from GPS, not just the plan). */
  gpsSeen: boolean;
  /** The person said their stop is next (manual advance). */
  stopIsNext: boolean;
  paraAcknowledged: boolean;
};

export type GuidanceSession = {
  v: typeof GUIDANCE_SESSION_FORMAT;
  trip: GuidanceTrip;
  startedAt: number;
  status: GuidanceStatus;
  stepIndex: number;
  /** walk_to_board / transfer: the person confirmed being at the boarding stop. */
  atStop: boolean;
  /** Present exactly while an active session is on a ride step. */
  ride: RideState | null;
  /**
   * The ride just left by "I got off" / "I missed my stop", kept so `back` restores it exactly
   * (a mis-tap one stop early must not restart the count); cleared on the next boarding.
   */
  lastRide: RideState | null;
};

export type GuidanceEvent =
  | { type: "atStop" }
  | { type: "boarded" }
  | { type: "nextStopIsMine" }
  | { type: "paraAcknowledged" }
  | { type: "gotOff" }
  | { type: "missedStop" }
  | { type: "arrived" }
  | { type: "end" }
  | { type: "back" }
  | { type: "fix"; fix: LocationFix; now: number };

const NEW_RIDE: RideState = { ...NEW_RIDE_MEMORY, gpsSeen: false, stopIsNext: false, paraAcknowledged: false };

/** The first step is walk_to_board, walk_to_destination or a street_ride (guidanceSteps), never a ride. */
export function startSession(trip: GuidanceTrip, now: number): GuidanceSession {
  return { v: GUIDANCE_SESSION_FORMAT, trip: { ...trip, option: toWireOption(trip.option) }, startedAt: now, status: "active", stepIndex: 0, atStop: false, ride: null, lastRide: null };
}

export function sessionSteps(session: GuidanceSession): GuidanceStep[] {
  return guidanceSteps(session.trip);
}

export function currentStep(session: GuidanceSession): GuidanceStep {
  return sessionSteps(session)[session.stepIndex]!;
}

/** Moves to the next step (boarded / got off), with that step's fresh state. */
function nextStep(session: GuidanceSession, steps: GuidanceStep[]): GuidanceSession {
  const stepIndex = session.stepIndex + 1;
  const step = steps[stepIndex];
  if (!step) return session;
  return { ...session, stepIndex, atStop: false, ride: step.kind === "ride" ? NEW_RIDE : null };
}

/**
 * Undo the last confirmation: arrived → back on the last walk; missed stop → back on the ride;
 * at the stop → not yet; Para said → not yet; "my stop is next" → not yet; boarded → back at the
 * boarding stop; got off → back on the ride. A ride re-entered this way gets its memory back
 * exactly as it was left (`lastRide`). Nothing to undo on the first step before any tap, or once
 * ended.
 */
function back(session: GuidanceSession, steps: GuidanceStep[]): GuidanceSession {
  if (session.status === "ended") return session;
  if (session.status === "arrived") return { ...session, status: "active" };
  if (session.status === "missed_stop") return { ...session, status: "active", ride: session.lastRide ?? NEW_RIDE, lastRide: null };
  const step = steps[session.stepIndex]!;
  if (session.atStop) return { ...session, atStop: false };
  if (step.kind === "ride" && session.ride) {
    if (session.ride.paraAcknowledged) return { ...session, ride: { ...session.ride, paraAcknowledged: false } };
    if (session.ride.stopIsNext) return { ...session, ride: { ...session.ride, stopIsNext: false } };
    return { ...session, stepIndex: session.stepIndex - 1, atStop: true, ride: null };
  }
  if (session.stepIndex === 0) return session;
  // The step before may be a tricycle ride (the access option): only a ride step carries ride memory.
  const ride = steps[session.stepIndex - 1]?.kind === "ride" ? session.lastRide ?? NEW_RIDE : null;
  return { ...session, stepIndex: session.stepIndex - 1, atStop: false, ride, lastRide: null };
}

/** The steps that end at the destination: "I've arrived" applies there. */
const endsTrip = (step: GuidanceStep) => step.kind === "walk_to_destination" || step.kind === "street_ride";

export function reduceSession(session: GuidanceSession, event: GuidanceEvent): GuidanceSession {
  if (event.type === "end") return session.status === "ended" ? session : { ...session, status: "ended", ride: null, lastRide: null };
  if (event.type === "back") return back(session, sessionSteps(session));
  if (session.status !== "active") return session;

  const steps = sessionSteps(session);
  const step = steps[session.stepIndex]!;
  const boarding = step.kind === "walk_to_board" || step.kind === "transfer";
  const ride = step.kind === "ride" ? session.ride : null;

  switch (event.type) {
    case "atStop":
      return boarding && !session.atStop ? { ...session, atStop: true } : session;
    case "boarded":
      return boarding ? { ...nextStep(session, steps), lastRide: null } : session;
    case "nextStopIsMine":
      return ride && !paraSuggested(ride) && !ride.paraAcknowledged ? { ...session, ride: { ...ride, stopIsNext: true } } : session;
    case "paraAcknowledged":
      return ride && paraSuggested(ride) && !ride.paraAcknowledged ? { ...session, ride: { ...ride, paraAcknowledged: true } } : session;
    case "gotOff":
      return ride ? { ...nextStep(session, steps), lastRide: ride } : session;
    case "missedStop":
      return ride ? { ...session, status: "missed_stop", ride: null, lastRide: ride } : session;
    case "arrived":
      // A tricycle that is not the last step (the access option) ends at its loading point: on to the walk.
      if (step.kind === "street_ride" && session.stepIndex < steps.length - 1) return nextStep(session, steps);
      return endsTrip(step) ? { ...session, status: "arrived" } : session;
    case "fix": {
      if (!ride || step.kind !== "ride" || !usableFix(event.fix, event.now)) return session;
      const p = rideProgress(step.stops, ride, event.fix, event.now);
      const memory: RideMemory = {
        passedIndex: p.passedIndex,
        countLost: p.countLost,
        pendingIndex: p.pendingIndex,
        alightNear: p.alightNear,
        nearStopBefore: p.nearStopBefore,
      };
      const same = (Object.keys(memory) as (keyof RideMemory)[]).every((k) => memory[k] === ride[k]);
      if (same && ride.gpsSeen) return session;
      return { ...session, ride: { ...ride, ...memory, gpsSeen: true } };
    }
  }
}

// ---------------------------------------------------------------- sessionStorage

const tripSchema = z.strictObject({
  option: planOptionSchema,
  stops: z.array(z.strictObject({ id: z.string().max(64), name: z.string().max(200), code: z.string().max(32).nullable() })).max(500),
  variants: z.array(z.strictObject({ variantId: z.string().max(64), loopDirection: z.enum(["clockwise", "counterclockwise"]).nullable() })).max(20),
  destinationLabel: z.string().max(200).nullable(),
  etaModel: etaModelSchema.nullable().optional(),
  walkLengths: z.array(z.number().min(0).nullable()).max(50).optional(),
  ridePaths: z.record(z.string().max(64), z.strictObject({ encoded: z.string().max(200_000), isCircuit: z.boolean() })).optional(),
});

const rideSchema = z.strictObject({
  passedIndex: z.number().int().nonnegative(),
  countLost: z.boolean(),
  pendingIndex: z.number().int().nonnegative().nullable(),
  alightNear: z.boolean(),
  nearStopBefore: z.boolean(),
  gpsSeen: z.boolean(),
  stopIsNext: z.boolean(),
  paraAcknowledged: z.boolean(),
});

const sessionSchema = z.strictObject({
  v: z.union([z.literal(1), z.literal(GUIDANCE_SESSION_FORMAT)]),
  trip: tripSchema,
  startedAt: z.number().int().nonnegative(),
  status: z.enum(["active", "missed_stop", "arrived", "ended"]),
  stepIndex: z.number().int().nonnegative(),
  atStop: z.boolean(),
  ride: rideSchema.nullable(),
  lastRide: rideSchema.nullable(),
});

/** The session's own invariants (a hand-edited or stale record must not crash the screens). */
function consistent(s: GuidanceSession): boolean {
  let steps: GuidanceStep[];
  try {
    steps = guidanceSteps(s.trip);
  } catch {
    return false;
  }
  const step = steps[s.stepIndex];
  if (!step) return false;
  const onRide = step.kind === "ride" && s.status === "active";
  if (onRide !== (s.ride !== null)) return false;
  const fits = (ride: RideState, rideStep: GuidanceStep | undefined) =>
    rideStep?.kind === "ride" &&
    ride.passedIndex <= rideStep.stops.length - 1 &&
    (ride.pendingIndex === null || ride.pendingIndex <= rideStep.stops.length - 1) &&
    (!ride.paraAcknowledged || paraSuggested(ride));
  if (s.ride && !fits(s.ride, step)) return false;
  if (s.lastRide) {
    // Kept only off a ride: on the step after it, or on the ride itself after "I missed my stop".
    if (s.status === "ended" || onRide) return false;
    if (!fits(s.lastRide, s.status === "missed_stop" ? step : steps[s.stepIndex - 1])) return false;
  }
  if (s.atStop && step.kind !== "walk_to_board" && step.kind !== "transfer") return false;
  if (s.status === "arrived" && !endsTrip(step)) return false;
  if (s.status === "missed_stop" && step.kind !== "ride") return false;
  return true;
}

export function serializeSession(session: GuidanceSession): string {
  return JSON.stringify(session);
}

/** A stored session, or null when missing, unreadable, inconsistent or too old. */
export function parseSession(raw: string | null, now: number): GuidanceSession | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = sessionSchema.safeParse(json);
  if (!parsed.success) return null;
  const session = { ...parsed.data, v: GUIDANCE_SESSION_FORMAT } as GuidanceSession;
  if (session.startedAt > now + CLOCK_SKEW_MS || now - session.startedAt > GUIDANCE_SESSION_MAX_AGE_MS) return null;
  return consistent(session) ? session : null;
}
