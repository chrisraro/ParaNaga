import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { STALE_MS } from "@/domain/geo/location-fix";
import type { PlanOptionDto } from "@/domain/api/plan";
import { paraSuggested } from "@/domain/guidance/progress";
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
import { BASE, DEST, LOOP_A, LOOP_B, fixAt, oneRide, streetOnly, tripOf, twoRides, walkOnly } from "./guidance-fixtures";

const NOW = 1_000_000;
const run = (s: GuidanceSession, ...events: GuidanceEvent[]) => events.reduce(reduceSession, s);
const tap = (type: Exclude<GuidanceEvent["type"], "fix">): GuidanceEvent => ({ type }) as GuidanceEvent;
const gps = (p: { lat: number; lng: number }, accuracy = 10): GuidanceEvent => ({ type: "fix", fix: fixAt(p, accuracy, NOW), now: NOW });
/** GPS fixes at each stop after boarding, in pin order: the ride reaches its alighting stop (Para). */
const rideAlong = (pins: readonly { lat: number; lng: number }[]) => pins.slice(1).map((p) => gps(p));
/** A fix at the destination (within 100 m): "I've arrived" applies. */
const atDest = gps(DEST);

describe("startSession", () => {
  it("starts on the first step, nothing confirmed", () => {
    const s = startSession(tripOf(twoRides()), NOW);
    expect(s).toMatchObject({ v: 2, startedAt: NOW, status: "active", stepIndex: 0, atStop: false, ride: null, lastRide: null });
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
    expect(s).toMatchObject({ stepIndex: 1, atStop: false, ride: { passedIndex: 0, alightNear: false, nearStopBefore: false, gpsSeen: false, paraAcknowledged: false } });
    // "I said Para" before any suggestion is ignored (a stale or double tap).
    expect(reduceSession(s, tap("paraAcknowledged"))).toBe(s);
    s = run(s, ...rideAlong(LOOP_A));
    expect(paraSuggested(s.ride!)).toBe(true);
    s = reduceSession(s, tap("paraAcknowledged"));
    expect(s.ride?.paraAcknowledged).toBe(true);
    s = reduceSession(s, tap("gotOff"));
    expect(currentStep(s).kind).toBe("transfer");
    expect(s).toMatchObject({ stepIndex: 2, ride: null, atStop: false });
    s = run(s, tap("atStop"), tap("boarded"));
    expect(currentStep(s).kind).toBe("ride");
    expect(s.ride).toMatchObject({ passedIndex: 0, paraAcknowledged: false });
    s = run(s, ...rideAlong(LOOP_B), tap("gotOff"));
    expect(currentStep(s).kind).toBe("walk_to_destination");
    s = run(s, atDest, tap("arrived"));
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
    for (const t of ["atStop", "boarded", "paraAcknowledged", "gotOff", "gotOffEarly", "missedStop"] as const) {
      expect(reduceSession(s, tap(t))).toBe(s);
    }
    expect(run(s, atDest, tap("arrived")).status).toBe("arrived");
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
    ["walk_to_board", [], ["paraAcknowledged", "gotOff", "gotOffEarly", "missedStop", "arrived"]],
    ["walk_to_board at stop", ["atStop"], ["atStop", "gotOff", "arrived"]],
    ["ride", ["boarded"], ["atStop", "boarded", "arrived", "paraAcknowledged", "gotOff"]],
    ["ride after Para", ["boarded", "para", "paraAcknowledged"], ["paraAcknowledged", "gotOffEarly"]],
    ["walk_to_destination", ["boarded", "para", "gotOff"], ["atStop", "boarded", "gotOff", "gotOffEarly", "missedStop", "paraAcknowledged", "arrived"]],
    ["arrived", ["boarded", "para", "gotOff", "near", "arrived"], ["arrived", "boarded", "gotOff", "atStop"]],
    ["got off early", ["boarded", "gotOffEarly"], ["gotOff", "gotOffEarly", "missedStop", "arrived", "boarded"]],
    ["ended", ["end"], ["end", "back", "atStop", "boarded", "arrived"]],
    ["first step, nothing tapped", [], ["back"]],
  ] as const)("%s", (_, before, ignored) => {
    const step = (t: (typeof before)[number]): GuidanceEvent[] => (t === "para" ? rideAlong(LOOP_A) : t === "near" ? [atDest] : [tap(t)]);
    const s = run(startSession(tripOf(oneRide()), NOW), ...before.flatMap(step));
    for (const t of ignored) expect(reduceSession(s, tap(t))).toBe(s);
  });
});

describe("location fixes", () => {
  it("move ride progress only; never a step or a confirmation", () => {
    const riding = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));
    const moved = reduceSession(riding, { type: "fix", fix: fixAt(LOOP_A[2]!, 10, NOW), now: NOW });
    expect(moved.ride).toMatchObject({ passedIndex: 2, gpsSeen: true });
    expect(moved).toMatchObject({ stepIndex: riding.stepIndex, status: "active" });
    // A jump to the alighting pin out of pin order moves nothing: the count is marked lost, no Para.
    const jumped = reduceSession(moved, { type: "fix", fix: fixAt(LOOP_A[5]!, 5, NOW), now: NOW });
    expect(jumped.ride).toMatchObject({ passedIndex: 2, countLost: true, alightNear: false, nearStopBefore: false });
    expect(paraSuggested(jumped.ride!)).toBe(false);
    // In order up to the alighting stop: still no "got off" without the tap.
    const atEnd = [3, 4, 5].reduce((s, i) => reduceSession(s, { type: "fix", fix: fixAt(LOOP_A[i]!, 5, NOW), now: NOW }), moved);
    expect(atEnd.stepIndex).toBe(riding.stepIndex);
    expect(atEnd.ride).toMatchObject({ passedIndex: 5, alightNear: true, nearStopBefore: true, paraAcknowledged: false });
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
  fc.constantFrom(...(["atStop", "boarded", "paraAcknowledged", "gotOff", "gotOffEarly", "missedStop", "arrived", "end", "back"] as const)).map(tap),
  fc
    .record({
      i: fc.integer({ min: 0, max: 11 }),
      d: fc.double({ min: -0.002, max: 0.002, noNaN: true }),
      accuracy: fc.double({ min: 0, max: 120, noNaN: true }),
      age: fc.integer({ min: 0, max: 2 * STALE_MS }),
    })
    .map(({ i, d, accuracy, age }): GuidanceEvent => {
      const p = [...LOOP_A, ...LOOP_B, DEST][i]!;
      return { type: "fix", fix: { lat: p.lat + d, lng: p.lng - d, accuracy, timestamp: NOW - age }, now: NOW };
    }),
);
const optionArb = fc.constantFrom(walkOnly(), oneRide(), oneRide(5), twoRides(), twoRides(8));

describe("session properties (fixed seeds)", () => {
  it("any event sequence keeps the invariants; steps move by one and only on a confirmation (or its undo)", () => {
    fc.assert(
      fc.property(optionArb, fc.array(eventArb, { maxLength: 40 }), (option, events) => {
        let s = startSession(tripOf(option), NOW);
        for (const e of events) {
          const next = reduceSession(s, e);
          const delta = next.stepIndex - s.stepIndex;
          if (delta === 1 && e.type !== "boarded" && e.type !== "gotOff") return false;
          if (delta === -1 && e.type !== "back") return false;
          if (Math.abs(delta) > 1) return false;
          if (next.ride?.paraAcknowledged && !paraSuggested(next.ride)) return false;
          if (next.status !== s.status && e.type === "fix") return false;
          if (s.status === "ended" && next !== s) return false;
          const step = currentStep(next);
          if ((step.kind === "ride" && next.status === "active") !== (next.ride !== null)) return false;
          if (next.ride && (next.ride.passedIndex < 0 || step.kind !== "ride" || next.ride.passedIndex > step.stops.length - 1)) return false;
          if (s.ride && next.ride && next.stepIndex === s.stepIndex && next.ride.passedIndex < s.ride.passedIndex) return false;
          if (s.ride && next.ride && next.stepIndex === s.stepIndex && next.ride.passedIndex - s.ride.passedIndex > 2 && s.ride.pendingIndex === null) return false;
          if (next.status === "arrived" && (step.kind !== "walk_to_destination" || !next.nearDestination)) return false;
          if (e.type === "gotOff" && next !== s && !paraSuggested(s.ride!)) return false;
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

describe("back (undo the last confirmation)", () => {
  const start = startSession(tripOf(twoRides()), NOW);

  it("undoes, one tap at a time, in reverse order", () => {
    const atStop = run(start, tap("atStop"));
    expect(reduceSession(atStop, tap("back"))).toEqual(start);
    const riding = run(atStop, tap("boarded"));
    // Boarded by mistake: back at the boarding stop (confirmed there).
    expect(reduceSession(riding, tap("back"))).toEqual(atStop);
    const said = run(riding, ...rideAlong(LOOP_A), tap("paraAcknowledged"));
    const unsaid = reduceSession(said, tap("back"));
    expect(unsaid.ride).toMatchObject({ passedIndex: 5, paraAcknowledged: false });
    // Got off by mistake: back on the ride exactly as it was left.
    const off = run(said, tap("gotOff"));
    expect(off.lastRide).toEqual(said.ride);
    const backOn = reduceSession(off, tap("back"));
    expect(backOn).toMatchObject({ stepIndex: 1, atStop: false, lastRide: null });
    expect(backOn.ride).toEqual(said.ride);
    // Boarding the next ride forgets the snapshot.
    expect(run(off, tap("boarded")).lastRide).toBeNull();
  });

  it("arrived and missed stop can be undone; ended cannot", () => {
    const arrived = run(start, tap("boarded"), ...rideAlong(LOOP_A), tap("gotOff"), tap("boarded"), ...rideAlong(LOOP_B), tap("gotOff"), atDest, tap("arrived"));
    expect(reduceSession(arrived, tap("back"))).toMatchObject({ status: "active", stepIndex: 4, nearDestination: true });
    const missed = run(start, tap("boarded"), tap("missedStop"));
    expect(reduceSession(missed, tap("back"))).toMatchObject({ status: "active", stepIndex: 1, ride: { passedIndex: 0 } });
    const ended = run(start, tap("end"));
    expect(reduceSession(ended, tap("back"))).toBe(ended);
  });
});

describe("undo after leaving a ride keeps its progress (lastRide)", () => {
  const fix = (i: number) => ({ type: "fix" as const, fix: fixAt(LOOP_A[i]!, 10, NOW), now: NOW });
  const boarded = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));

  it("'I got off' at the alighting pin, then Undo: still at the alighting stop with Para, never a restart", () => {
    const atEnd = run(boarded, fix(1), fix(2), fix(3), fix(4), fix(5));
    expect(atEnd.ride).toMatchObject({ passedIndex: 5, nearStopBefore: true });
    const undone = run(atEnd, tap("gotOff"), tap("back"));
    expect(undone.ride).toEqual(atEnd.ride);
    expect(paraSuggested(undone.ride!)).toBe(true);
    // A further fix at the alighting pin keeps it there.
    expect(reduceSession(undone, fix(5)).ride?.passedIndex).toBe(5);
  });

  it("'I got off early', then Undo: GPS Para can still fire further on", () => {
    const early = run(boarded, fix(1), fix(2), fix(3));
    expect(paraSuggested(early.ride!)).toBe(false);
    expect(reduceSession(early, tap("gotOffEarly"))).toMatchObject({ status: "got_off_early", stepIndex: 1, ride: null, lastRide: early.ride });
    const undone = run(early, tap("gotOffEarly"), tap("back"));
    expect(undone).toMatchObject({ status: "active", lastRide: null });
    const later = reduceSession(undone, fix(4));
    expect(later.ride).toMatchObject({ passedIndex: 4, nearStopBefore: true });
    expect(paraSuggested(later.ride!)).toBe(true);
  });

  it("'I missed my stop', then Undo: the ride comes back as it was", () => {
    const ridden = run(boarded, fix(1), fix(2));
    const undone = run(ridden, tap("missedStop"), tap("back"));
    expect(undone).toMatchObject({ status: "active", lastRide: null });
    expect(undone.ride).toEqual(ridden.ride);
  });
});

describe("a session started on routed walks (the screens hold a decoded path, storage the encoded one)", () => {
  it("survives serialize and parse", () => {
    const opt = oneRide();
    const coords = [BASE, { lat: BASE.lat + 0.0003, lng: BASE.lng }];
    const legs = opt.legs.map((l) =>
      l.kind === "walk" ? { ...l, path: { kind: "path", coords, lengthM: 40, snapFromM: 0, snapToM: 0, label: "x" } } : l,
    ) as PlanOptionDto["legs"];
    const s = startSession(tripOf({ ...opt, legs }), NOW);
    const back = parseSession(serializeSession(s), NOW);
    expect(back).not.toBeNull();
    expect(back!.trip.option.legs.find((l) => l.kind === "walk")).toMatchObject({ basis: "street_graph", path: expect.any(String) });
  });
});

describe("parseSession (sessionStorage is untrusted)", () => {
  const s = run(startSession(tripOf(twoRides()), NOW), tap("boarded"));
  const raw = JSON.parse(serializeSession(s)) as Record<string, unknown>;
  const bad = (patch: Record<string, unknown>) => JSON.stringify({ ...raw, ...patch });

  it("an old format-1 session (before ridePaths) still resumes, as format 2; format 1 is no longer written", () => {
    const trip = { ...(raw.trip as Record<string, unknown>) };
    delete trip.ridePaths;
    const old = JSON.stringify({ ...raw, v: 1, trip });
    expect(parseSession(old, NOW)).toEqual({ ...s, v: 2 });
    expect(JSON.parse(serializeSession(s)).v).toBe(2);
    expect(parseSession(JSON.stringify({ ...raw, v: 1, trip: { ...trip, unknownFromFuture: 1 } }), NOW)).toBeNull();
  });

  it("refuses nothing, junk, other formats and broken invariants", () => {
    expect(parseSession(null, NOW)).toBeNull();
    expect(parseSession("", NOW)).toBeNull();
    expect(parseSession("{not json", NOW)).toBeNull();
    expect(parseSession("[]", NOW)).toBeNull();
    expect(parseSession(bad({ v: 3 }), NOW)).toBeNull();
    expect(parseSession(bad({ stepIndex: 9 }), NOW)).toBeNull();
    expect(parseSession(bad({ stepIndex: 0 }), NOW)).toBeNull(); // a ride memory on a walk step
    expect(parseSession(bad({ ride: null }), NOW)).toBeNull(); // on a ride step without its memory
    expect(parseSession(bad({ ride: { ...(raw.ride as object), passedIndex: 6 } }), NOW)).toBeNull();
    expect(parseSession(bad({ status: "live" }), NOW)).toBeNull();
    expect(parseSession(bad({ eta: 5 }), NOW)).toBeNull(); // strict: no extra (time) fields
    expect(parseSession(bad({ ride: { ...(raw.ride as object), paraAcknowledged: true } }), NOW)).toBeNull(); // Para said, never suggested
    expect(parseSession(bad({ status: "missed_stop", stepIndex: 2, ride: null }), NOW)).toBeNull(); // missed stop on a walk step
    expect(parseSession(bad({ lastRide: raw.ride }), NOW)).toBeNull(); // a snapshot while still on the ride
    expect(parseSession(bad({ stepIndex: 0, ride: null, lastRide: raw.ride }), NOW)).toBeNull(); // a snapshot with no ride before
    expect(parseSession(bad({ ride: { ...(raw.ride as object), pendingIndex: 99 } }), NOW)).toBeNull();
    const off = run(s, ...rideAlong(LOOP_A), tap("gotOff"));
    expect(parseSession(serializeSession(off), NOW)).toEqual(off);
    const early = reduceSession(s, tap("gotOffEarly"));
    expect(parseSession(serializeSession(early), NOW)).toEqual(early);
    expect(parseSession(bad({ status: "got_off_early", stepIndex: 2, ride: null }), NOW)).toBeNull(); // off early on a walk step
    expect(parseSession(bad({ nearDestination: true }), NOW)).toBeNull(); // near the destination while on a ride
    const trip = raw.trip as { stops: { id: string; name: string; code: string | null }[] };
    expect(parseSession(bad({ trip: { ...trip, stops: [{ ...trip.stops[0]!, name: "x".repeat(201) }] } }), NOW)).toBeNull();
  });

  it("drops a session older than the maximum age", () => {
    expect(parseSession(serializeSession(s), NOW + GUIDANCE_SESSION_MAX_AGE_MS)).toEqual(s);
    expect(parseSession(serializeSession(s), NOW + GUIDANCE_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(parseSession(serializeSession(s), NOW - 60_000)).toBeNull(); // started in the future
  });
});

describe("owner rules 2026-10-22: no manual advance, arrival needs location, got off early re-plans", () => {
  const boarded = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));
  const lastWalk = run(boarded, ...rideAlong(LOOP_A), tap("gotOff"));

  it("'I got off' only once GPS puts the rider at the alighting stop; before that it is ignored", () => {
    expect(reduceSession(boarded, tap("gotOff"))).toBe(boarded);
    const near = run(boarded, ...rideAlong(LOOP_A));
    expect(currentStep(reduceSession(near, tap("gotOff"))).kind).toBe("walk_to_destination");
  });

  it("'I got off early' leaves the ride for a re-plan (never the next step, never arrived); Undo restores the ride", () => {
    const ridden = run(boarded, gps(LOOP_A[1]!));
    const early = reduceSession(ridden, tap("gotOffEarly"));
    expect(early).toMatchObject({ status: "got_off_early", stepIndex: ridden.stepIndex, ride: null, lastRide: ridden.ride });
    expect(reduceSession(early, tap("back"))).toEqual(ridden);
    // At the alighting stop "I got off" applies instead.
    const near = run(boarded, ...rideAlong(LOOP_A));
    expect(reduceSession(near, tap("gotOffEarly"))).toBe(near);
  });

  it("'I've arrived' is ignored until a usable fix within 100 m of the destination", () => {
    expect(reduceSession(lastWalk, tap("arrived"))).toBe(lastWalk);
    const far = run(lastWalk, gps({ lat: DEST.lat - 0.0012, lng: DEST.lng })); // ≈ 133 m
    expect(far.nearDestination).toBe(false);
    expect(reduceSession(far, tap("arrived"))).toBe(far);
    const rough = run(lastWalk, gps(DEST, 80)); // too rough to count
    expect(rough.nearDestination).toBe(false);
    const near = run(lastWalk, gps({ lat: DEST.lat - 0.0008, lng: DEST.lng })); // ≈ 89 m
    expect(near.nearDestination).toBe(true);
    // Latches: walking off again keeps it.
    const away = run(near, gps({ lat: DEST.lat - 0.005, lng: DEST.lng }));
    expect(away.nearDestination).toBe(true);
    expect(reduceSession(away, tap("arrived")).status).toBe("arrived");
    // Back to the ride clears it.
    expect(reduceSession(near, tap("back"))).toMatchObject({ stepIndex: 1, nearDestination: false });
  });

  it("a tricycle to the destination needs the same; a fix on a walk to the stop sets nothing", () => {
    const tri = startSession(tripOf(streetOnly("tricycle")), NOW);
    expect(reduceSession(tri, tap("arrived"))).toBe(tri);
    expect(run(tri, atDest, tap("arrived")).status).toBe("arrived");
    const start = startSession(tripOf(oneRide()), NOW);
    expect(reduceSession(start, atDest)).toBe(start);
  });

  it("an old session with the manual 'My stop is next' still resumes, without it", () => {
    const raw = JSON.parse(serializeSession(boarded)) as Record<string, unknown>;
    delete raw.nearDestination;
    const old = JSON.stringify({ ...raw, ride: { ...(raw.ride as object), stopIsNext: true, paraAcknowledged: true } });
    const parsed = parseSession(old, NOW);
    expect(parsed).toEqual(boarded);
    expect(parsed!.ride).not.toHaveProperty("stopIsNext");
    const oldOff = JSON.parse(serializeSession(reduceSession(boarded, tap("missedStop")))) as Record<string, unknown>;
    delete oldOff.nearDestination;
    expect(parseSession(JSON.stringify({ ...oldOff, lastRide: { ...(oldOff.lastRide as object), stopIsNext: false } }), NOW)).toMatchObject({ status: "missed_stop", nearDestination: false });
  });
});
