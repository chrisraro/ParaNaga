import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { STALE_MS } from "@/domain/geo/location-fix";
import {
  GUIDANCE_SESSION_MAX_AGE_MS,
  currentStep,
  parseSession,
  reduceSession,
  serializeSession,
  startSession,
  type GuidanceEvent,
  type GuidanceSession,
} from "@/domain/guidance/session";
import { BASE, LOOP_A, LOOP_B, fixAt, oneRide, tripOf, twoRides, walkOnly } from "./guidance-fixtures";

const NOW = 1_000_000;
const run = (s: GuidanceSession, ...events: GuidanceEvent[]) => events.reduce(reduceSession, s);
const tap = (type: Exclude<GuidanceEvent["type"], "fix">): GuidanceEvent => ({ type }) as GuidanceEvent;

describe("startSession", () => {
  it("starts on the first step, nothing confirmed", () => {
    const s = startSession(tripOf(twoRides()), NOW);
    expect(s).toMatchObject({ v: 1, startedAt: NOW, status: "active", stepIndex: 0, atStop: false, ride: null });
    expect(currentStep(s).kind).toBe("walk_to_board");
  });
});

describe("reduceSession: a two-ride trip, every change confirmed by the person", () => {
  it("walk → at stop → boarded → Para → got off → transfer → boarded → got off → arrived → end", () => {
    let s = startSession(tripOf(twoRides()), NOW);
    s = reduceSession(s, tap("atStop"));
    expect(s.atStop).toBe(true);
    s = reduceSession(s, tap("boarded"));
    expect(currentStep(s).kind).toBe("ride");
    expect(s).toMatchObject({ stepIndex: 1, atStop: false, ride: { passedIndex: 0, alightNear: false, gpsSeen: false, stopIsNext: false, paraAcknowledged: false } });
    s = reduceSession(s, tap("nextStopIsMine"));
    expect(s.ride?.stopIsNext).toBe(true);
    s = reduceSession(s, tap("paraAcknowledged"));
    expect(s.ride?.paraAcknowledged).toBe(true);
    s = reduceSession(s, tap("gotOff"));
    expect(currentStep(s).kind).toBe("transfer");
    expect(s).toMatchObject({ stepIndex: 2, ride: null, atStop: false });
    s = run(s, tap("atStop"), tap("boarded"));
    expect(currentStep(s).kind).toBe("ride");
    expect(s.ride).toMatchObject({ passedIndex: 0, paraAcknowledged: false });
    s = reduceSession(s, tap("gotOff"));
    expect(currentStep(s).kind).toBe("walk_to_destination");
    s = reduceSession(s, tap("arrived"));
    expect(s.status).toBe("arrived");
    s = reduceSession(s, tap("end"));
    expect(s.status).toBe("ended");
  });

  it("boarding can be confirmed without 'I'm at the stop' (flagged down on the way)", () => {
    const s = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));
    expect(currentStep(s).kind).toBe("ride");
  });

  it("a walk-only trip: only arrived and end apply", () => {
    const s = startSession(tripOf(walkOnly()), NOW);
    for (const t of ["atStop", "boarded", "nextStopIsMine", "paraAcknowledged", "gotOff", "missedStop"] as const) {
      expect(reduceSession(s, tap(t))).toBe(s);
    }
    expect(reduceSession(s, tap("arrived")).status).toBe("arrived");
  });

  it("I missed my stop: guidance stops for a re-plan; only end applies after", () => {
    const missed = run(startSession(tripOf(oneRide()), NOW), tap("boarded"), tap("missedStop"));
    expect(missed.status).toBe("missed_stop");
    for (const t of ["gotOff", "arrived", "boarded", "atStop", "paraAcknowledged"] as const) expect(reduceSession(missed, tap(t))).toBe(missed);
    expect(reduceSession(missed, tap("end")).status).toBe("ended");
  });
});

describe("invalid transitions are ignored (the same object comes back)", () => {
  it.each([
    ["walk_to_board", [], ["nextStopIsMine", "paraAcknowledged", "gotOff", "missedStop", "arrived"]],
    ["walk_to_board at stop", ["atStop"], ["atStop", "gotOff", "arrived"]],
    ["ride", ["boarded"], ["atStop", "boarded", "arrived"]],
    ["ride after Para", ["boarded", "paraAcknowledged"], ["paraAcknowledged", "nextStopIsMine"]],
    ["walk_to_destination", ["boarded", "gotOff"], ["atStop", "boarded", "gotOff", "missedStop", "paraAcknowledged"]],
    ["arrived", ["boarded", "gotOff", "arrived"], ["arrived", "boarded", "gotOff", "atStop"]],
    ["ended", ["end"], ["end", "atStop", "boarded", "arrived"]],
  ] as const)("%s", (_, before, ignored) => {
    const s = run(startSession(tripOf(oneRide()), NOW), ...before.map(tap));
    for (const t of ignored) expect(reduceSession(s, tap(t))).toBe(s);
  });
});

describe("location fixes", () => {
  it("move ride progress only; never a step or a confirmation", () => {
    const riding = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));
    const moved = reduceSession(riding, { type: "fix", fix: fixAt(LOOP_A[2]!, 10, NOW), now: NOW });
    expect(moved.ride).toMatchObject({ passedIndex: 2, gpsSeen: true });
    expect(moved).toMatchObject({ stepIndex: riding.stepIndex, status: "active" });
    // Even at the alighting stop: no "got off" without the tap.
    const atEnd = reduceSession(moved, { type: "fix", fix: fixAt(LOOP_A[5]!, 5, NOW), now: NOW });
    expect(atEnd.stepIndex).toBe(riding.stepIndex);
    expect(atEnd.ride).toMatchObject({ passedIndex: 5, alightNear: true, paraAcknowledged: false });
  });

  it("are ignored while walking (walk progress is derived, not stored)", () => {
    const s = startSession(tripOf(oneRide()), NOW);
    expect(reduceSession(s, { type: "fix", fix: fixAt(LOOP_A[0]!, 5, NOW), now: NOW })).toBe(s);
  });

  it("poor-accuracy or stale fixes never change state", () => {
    const riding = run(startSession(tripOf(twoRides()), NOW), tap("boarded"));
    fc.assert(
      fc.property(
        fc.record({
          lat: fc.double({ min: BASE.lat - 0.01, max: BASE.lat + 0.03, noNaN: true }),
          lng: fc.double({ min: BASE.lng - 0.01, max: BASE.lng + 0.01, noNaN: true }),
          bad: fc.oneof(
            fc.record({ accuracy: fc.double({ min: 50.0001, max: 5000, noNaN: true }), age: fc.integer({ min: 0, max: STALE_MS }) }),
            fc.record({ accuracy: fc.double({ min: 0, max: 50, noNaN: true }), age: fc.integer({ min: STALE_MS + 1, max: 10 * STALE_MS }) }),
            fc.record({ accuracy: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -5), age: fc.constant(0) }),
          ),
        }),
        ({ lat, lng, bad }) => reduceSession(riding, { type: "fix", fix: { lat, lng, accuracy: bad.accuracy, timestamp: NOW - bad.age }, now: NOW }) === riding,
      ),
      { seed: 42, numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------- properties over any event sequence

const eventArb: fc.Arbitrary<GuidanceEvent> = fc.oneof(
  fc.constantFrom(...(["atStop", "boarded", "nextStopIsMine", "paraAcknowledged", "gotOff", "missedStop", "arrived", "end"] as const)).map(tap),
  fc
    .record({
      i: fc.integer({ min: 0, max: 9 }),
      d: fc.double({ min: -0.002, max: 0.002, noNaN: true }),
      accuracy: fc.double({ min: 0, max: 120, noNaN: true }),
      age: fc.integer({ min: 0, max: 2 * STALE_MS }),
    })
    .map(({ i, d, accuracy, age }): GuidanceEvent => {
      const p = [...LOOP_A, ...LOOP_B][i]!;
      return { type: "fix", fix: { lat: p.lat + d, lng: p.lng - d, accuracy, timestamp: NOW - age }, now: NOW };
    }),
);
const optionArb = fc.constantFrom(walkOnly(), oneRide(), oneRide(5), twoRides(), twoRides(8));

describe("session properties (fixed seeds)", () => {
  it("any event sequence keeps the invariants; steps advance by one and only on a confirmation", () => {
    fc.assert(
      fc.property(optionArb, fc.array(eventArb, { maxLength: 40 }), (option, events) => {
        let s = startSession(tripOf(option), NOW);
        for (const e of events) {
          const next = reduceSession(s, e);
          const stepMoved = next.stepIndex !== s.stepIndex;
          if (stepMoved && (e.type === "fix" || next.stepIndex !== s.stepIndex + 1)) return false;
          if (stepMoved && e.type !== "boarded" && e.type !== "gotOff") return false;
          if (next.status !== s.status && e.type === "fix") return false;
          if (s.status === "ended" && next !== s) return false;
          const step = currentStep(next);
          if ((step.kind === "ride" && next.status === "active") !== (next.ride !== null)) return false;
          if (next.ride && (next.ride.passedIndex < 0 || step.kind !== "ride" || next.ride.passedIndex > step.stops.length - 1)) return false;
          if (s.ride && next.ride && next.stepIndex === s.stepIndex && next.ride.passedIndex < s.ride.passedIndex) return false;
          if (next.status === "arrived" && step.kind !== "walk_to_destination") return false;
          s = next;
        }
        return true;
      }),
      { seed: 1016, numRuns: 500 },
    );
  });

  it("serialise → parse round trip", () => {
    fc.assert(
      fc.property(optionArb, fc.array(eventArb, { maxLength: 30 }), (option, events) => {
        const s = events.reduce(reduceSession, startSession(tripOf(option), NOW));
        expect(parseSession(serializeSession(s), NOW)).toEqual(s);
      }),
      { seed: 99, numRuns: 200 },
    );
  });
});

describe("parseSession (sessionStorage is untrusted)", () => {
  const s = run(startSession(tripOf(twoRides()), NOW), tap("boarded"));
  const raw = JSON.parse(serializeSession(s)) as Record<string, unknown>;
  const bad = (patch: Record<string, unknown>) => JSON.stringify({ ...raw, ...patch });

  it("refuses nothing, junk, other formats and broken invariants", () => {
    expect(parseSession(null, NOW)).toBeNull();
    expect(parseSession("", NOW)).toBeNull();
    expect(parseSession("{not json", NOW)).toBeNull();
    expect(parseSession("[]", NOW)).toBeNull();
    expect(parseSession(bad({ v: 2 }), NOW)).toBeNull();
    expect(parseSession(bad({ stepIndex: 9 }), NOW)).toBeNull();
    expect(parseSession(bad({ stepIndex: 0 }), NOW)).toBeNull(); // a ride memory on a walk step
    expect(parseSession(bad({ ride: null }), NOW)).toBeNull(); // on a ride step without its memory
    expect(parseSession(bad({ ride: { ...(raw.ride as object), passedIndex: 6 } }), NOW)).toBeNull();
    expect(parseSession(bad({ status: "live" }), NOW)).toBeNull();
    expect(parseSession(bad({ eta: 5 }), NOW)).toBeNull(); // strict: no extra (time) fields
  });

  it("drops a session older than the maximum age", () => {
    expect(parseSession(serializeSession(s), NOW + GUIDANCE_SESSION_MAX_AGE_MS)).toEqual(s);
    expect(parseSession(serializeSession(s), NOW + GUIDANCE_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(parseSession(serializeSession(s), NOW - 60_000)).toBeNull(); // started in the future
  });
});
