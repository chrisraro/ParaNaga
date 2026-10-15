// The guidance session: where the person is in the step list, as a reducer. Pure.
//
// Every change that matters is a confirmation by the person: "I'm at the stop" (atStop),
// "I boarded …" (boarded), "My stop is next" (nextStopIsMine, the manual advance), "I said Para"
// (paraAcknowledged), "I got off" (gotOff), "I missed my stop" (missedStop), "I've arrived"
// (arrived) and "End guidance" / "Done" (end). A location fix only moves the ride's stop count
// (progress.ts) and is ignored when imprecise or stale; it never changes the step or the status.
// An event that does not apply to the current step or status is ignored: the same object comes
// back, so callers can compare by reference.
//
// The session is kept in sessionStorage (state survives a reload, not a new tab), validated with
// Zod on the way back in, and dropped after GUIDANCE_SESSION_MAX_AGE_MS. It has no time estimate:
// `startedAt` is only for that expiry.
import { z } from "zod";
import { planOptionSchema } from "../api/plan";
import type { LocationFix } from "../geo/location-fix";
import { rideProgress, usableFix } from "./progress";
import { guidanceSteps, type GuidanceStep, type GuidanceTrip } from "./steps";

export const GUIDANCE_SESSION_FORMAT = 1;
/** A restored session older than this (a forgotten tab) is not resumed. */
export const GUIDANCE_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** sessionStorage key (same "paranaga." prefix as the other device keys). */
export const GUIDANCE_SESSION_KEY = "paranaga.guidance";

const CLOCK_SKEW_MS = 5_000;

export type GuidanceStatus = "active" | "missed_stop" | "arrived" | "ended";

export type RideState = {
  passedIndex: number;
  alightNear: boolean;
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
  | { type: "fix"; fix: LocationFix; now: number };

const NEW_RIDE: RideState = { passedIndex: 0, alightNear: false, gpsSeen: false, stopIsNext: false, paraAcknowledged: false };

export function startSession(trip: GuidanceTrip, now: number): GuidanceSession {
  const first = guidanceSteps(trip)[0]!;
  return { v: GUIDANCE_SESSION_FORMAT, trip, startedAt: now, status: "active", stepIndex: 0, atStop: false, ride: first.kind === "ride" ? NEW_RIDE : null };
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

export function reduceSession(session: GuidanceSession, event: GuidanceEvent): GuidanceSession {
  if (event.type === "end") return session.status === "ended" ? session : { ...session, status: "ended", ride: null };
  if (session.status !== "active") return session;

  const steps = sessionSteps(session);
  const step = steps[session.stepIndex]!;
  const boarding = step.kind === "walk_to_board" || step.kind === "transfer";
  const ride = step.kind === "ride" ? session.ride : null;

  switch (event.type) {
    case "atStop":
      return boarding && !session.atStop ? { ...session, atStop: true } : session;
    case "boarded":
      return boarding ? nextStep(session, steps) : session;
    case "nextStopIsMine":
      return ride && !ride.stopIsNext && !ride.paraAcknowledged ? { ...session, ride: { ...ride, stopIsNext: true } } : session;
    case "paraAcknowledged":
      return ride && !ride.paraAcknowledged ? { ...session, ride: { ...ride, paraAcknowledged: true } } : session;
    case "gotOff":
      return ride ? nextStep(session, steps) : session;
    case "missedStop":
      return ride ? { ...session, status: "missed_stop", ride: null } : session;
    case "arrived":
      return step.kind === "walk_to_destination" ? { ...session, status: "arrived" } : session;
    case "fix": {
      if (!ride || step.kind !== "ride" || !usableFix(event.fix, event.now)) return session;
      const p = rideProgress(step.stops, ride, event.fix, event.now);
      if (p.passedIndex === ride.passedIndex && p.alightNear === ride.alightNear && ride.gpsSeen) return session;
      return { ...session, ride: { ...ride, passedIndex: p.passedIndex, alightNear: p.alightNear, gpsSeen: true } };
    }
  }
}

// ---------------------------------------------------------------- sessionStorage

const tripSchema = z.strictObject({
  option: planOptionSchema,
  stops: z.array(z.strictObject({ id: z.string(), name: z.string(), code: z.string().nullable() })),
  variants: z.array(z.strictObject({ variantId: z.string(), loopDirection: z.enum(["clockwise", "counterclockwise"]).nullable() })),
  destinationLabel: z.string().max(200).nullable(),
});

const sessionSchema = z.strictObject({
  v: z.literal(GUIDANCE_SESSION_FORMAT),
  trip: tripSchema,
  startedAt: z.number().int().nonnegative(),
  status: z.enum(["active", "missed_stop", "arrived", "ended"]),
  stepIndex: z.number().int().nonnegative(),
  atStop: z.boolean(),
  ride: z
    .strictObject({
      passedIndex: z.number().int().nonnegative(),
      alightNear: z.boolean(),
      gpsSeen: z.boolean(),
      stopIsNext: z.boolean(),
      paraAcknowledged: z.boolean(),
    })
    .nullable(),
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
  if (s.ride && step.kind === "ride" && s.ride.passedIndex > step.stops.length - 1) return false;
  if (s.atStop && step.kind !== "walk_to_board" && step.kind !== "transfer") return false;
  if (s.status === "arrived" && step.kind !== "walk_to_destination") return false;
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
  const session = parsed.data as GuidanceSession;
  if (session.startedAt > now + CLOCK_SKEW_MS || now - session.startedAt > GUIDANCE_SESSION_MAX_AGE_MS) return null;
  return consistent(session) ? session : null;
}
