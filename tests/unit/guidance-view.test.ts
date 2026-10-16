import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { haversineMeters } from "@/domain/geo/geometry";
import { STALE_MS, type LocationFix } from "@/domain/geo/location-fix";
import { ALIGHT_NEAR_M, STOP_PASS_RADIUS_M, preciseFix } from "@/domain/guidance/progress";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { reduceSession, startSession, type GuidanceEvent, type GuidanceSession } from "@/domain/guidance/session";
import { BY_STOP_COUNT, GUIDANCE_COPY, TIME_NOT_AVAILABLE, guidanceView, type GuidanceView } from "@/domain/guidance/view";
import type { PlanOptionDto } from "@/domain/api/plan";
import type { GuidanceTrip } from "@/domain/guidance/steps";
import { manila } from "./eta-fixtures";
import { currentStep } from "@/domain/guidance/session";
import { BASE, DEST, LOOP_A, LOOP_B, STEP_LAT, fixAt, oneRide, tripOf, twoRides, walkOnly } from "./guidance-fixtures";

const NOW = 1_000_000;
const tap = (type: Exclude<GuidanceEvent["type"], "fix">): GuidanceEvent => ({ type }) as GuidanceEvent;
const run = (s: GuidanceSession, ...types: Exclude<GuidanceEvent["type"], "fix">[]) => types.map(tap).reduce(reduceSession, s);
const fixEvent = (fix: LocationFix): GuidanceEvent => ({ type: "fix", fix, now: NOW });
const labels = (v: GuidanceView) => ("actions" in v ? v.actions.map((a) => `${a.kind}:${a.event}:${a.label}`) : []);

describe("Walk (walk_to_board)", () => {
  const s = startSession(tripOf(oneRide()), NOW);

  it("without location: the planner's estimate, labelled, and the honest notes", () => {
    const v = guidanceView(s, null, NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.stepLabel).toBe("Step 1 of 3 · Walk");
    expect(v.title).toBe("Walk to Plaza Rizal (A1)");
    expect(v.distanceText).toBe("≈ 140 m walk · straight-line estimate, path not verified");
    expect(v.directionText).toBeNull();
    expect(v.remainingTime).toBe("About 2–3 min to Plaza Rizal (A1) (estimate)");
    expect(v.locationNote).toBeNull();
    expect(v.notes).toEqual([GUIDANCE_COPY.boardingSideUnknown("Loop A")]);
    expect(v.nextRide).toEqual({ chip: "Loop A", routeName: "Centro–Magsaysay Loop A", direction: "clockwise (from pin order)", badge: UNVERIFIED_ROUTE_BADGE });
    expect(v.keepOpen).toBe("Keep ParaNaga open for guidance.");
    expect(labels(v)).toEqual(["primary:atStop:I'm at the stop", "secondary:boarded:I boarded Loop A", "secondary:end:End guidance"]);
    expect(v.live).toEqual({ politeness: "polite", text: "Walk to Plaza Rizal (A1)" });
  });

  it("with a precise fix: straight-line metres and a compass direction", () => {
    const from = { lat: LOOP_A[0]!.lat - 0.0018, lng: LOOP_A[0]!.lng }; // ≈ 200 m south of the stop
    const v = guidanceView(s, fixAt(from, 12, NOW), NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.distanceText).toBe("≈ 200 m to Plaza Rizal (A1) in a straight line");
    expect(v.directionText).toBe("In a straight line, Plaza Rizal (A1) is to the north.");
    expect(v.remainingTime).toBe("About 3–5 min to Plaza Rizal (A1) (estimate)"); // 200 m × 1.3
    expect(v.live).toEqual({ politeness: "polite", text: "≈ 200 m to Plaza Rizal (A1) in a straight line" });
  });

  it("an imprecise or stale fix hides distance and direction, and says why", () => {
    const approx = guidanceView(s, fixAt(BASE, 80, NOW), NOW);
    if (approx.screen !== "walk") throw new Error(approx.screen);
    expect(approx.distanceText).toBe("≈ 140 m walk · straight-line estimate, path not verified");
    expect(approx.directionText).toBeNull();
    expect(approx.locationNote).toBe("Your location is approximate (± 80 m), so distance and direction are hidden.");
    const stale = guidanceView(s, fixAt(BASE, 5, NOW - STALE_MS - 1), NOW);
    expect(stale.screen === "walk" && stale.locationNote).toBe("Your location hasn't updated recently, so distance and direction are hidden.");
  });

  it("near the stop, GPS only proposes; the person confirms", () => {
    const v = guidanceView(s, fixAt(LOOP_A[0]!, 8, NOW), NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.live).toEqual({ politeness: "polite", text: "You look close to Plaza Rizal (A1). Tap “I'm at the stop” when you're there." });
    expect(guidanceView(s, fixAt(LOOP_A[0]!, 8, NOW), NOW)).toEqual(v); // nothing advanced
  });

  it("at the stop: board the route, with the signboard caveat", () => {
    const v = guidanceView(run(s, "atStop"), null, NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.title).toBe("Wait for Loop A at Plaza Rizal (A1)");
    expect(v.notes).toEqual([GUIDANCE_COPY.boardingSideUnknown("Loop A"), GUIDANCE_COPY.signboardUnknown("Loop A")]);
    expect(labels(v)).toEqual(["primary:boarded:I boarded Loop A", "secondary:end:End guidance"]);
  });

  it("a walk under 15 m is 'Start at {stop}' with no distance (audit F-20)", () => {
    const v = guidanceView(startSession(tripOf(oneRide(5)), NOW), null, NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.title).toBe("Start at Plaza Rizal (A1)");
    expect(v.distanceText).toBeNull();
  });
});

describe("Time left (snapshot model, Task 14)", () => {
  const boardedAt = (opt: PlanOptionDto, at: number, trip: Partial<GuidanceTrip> = {}) =>
    run(startSession({ ...tripOf(opt), ...trip }, at), "boarded");
  /** Loop A with path measures: 250 m per segment along the approximate path (vs 200 m straight). */
  const measured = (): PlanOptionDto => {
    const o = oneRide();
    const r = o.legs[1]!;
    if (r.kind !== "ride") throw new Error("ride");
    o.legs[1] = { ...r, distanceMeters: 1250, distanceBasis: "approximate_path", boardMeasureM: 100, alightMeasureM: 1350, stopMeasuresM: [100, 350, 600, 850, 1100, 1350] };
    return o;
  };

  it("off-peak (09:30 Manila): the off-peak band 10–15 km/h", () => {
    const v = guidanceView(boardedAt(oneRide(), manila("09:30").getTime()), null, manila("09:30").getTime());
    expect(v.screen === "ride" && v.remainingTime).toBe("About 4–6 min of riding left (estimate)"); // 1 km: 4.0–6.0
  });

  it("peak (07:10 Manila): the peak band 7–13 km/h", () => {
    const v = guidanceView(boardedAt(oneRide(), manila("07:10").getTime()), null, manila("07:10").getTime());
    expect(v.screen === "ride" && v.remainingTime).toBe("About 4–9 min of riding left (estimate)"); // 1 km: 4.6–8.6
  });

  it("the peak test spans the rest of the trip: 10:50 + the remaining legs reaches the 11:00 window", () => {
    const longRide = oneRide();
    const r = longRide.legs[1]!;
    if (r.kind !== "ride") throw new Error("ride");
    longRide.legs[1] = { ...r, distanceMeters: 3000 };
    const at = manila("10:50").getTime();
    const v = guidanceView(boardedAt(longRide, at), null, at);
    expect(v.screen === "ride" && v.remainingTime).toBe("About 13–26 min of riding left (estimate)"); // peak band
  });

  it("measures-based: the last passed stop's measure to the alighting measure", () => {
    const s = reduceSession(boardedAt(measured(), NOW), fixEvent(fixAt(LOOP_A[2]!, 10, NOW)));
    const v = guidanceView(s, fixAt(LOOP_A[2]!, 10, NOW), NOW);
    // 1350 − 600 = 750 m at 10–15 km/h: 3.0–4.5 min.
    expect(v.screen === "ride" && v.remainingTime).toBe("About 3–5 min of riding left (estimate)");
  });

  it("without measures, a passed stop splits the ride by stop count, and says so", () => {
    const s = reduceSession(boardedAt(oneRide(), NOW), fixEvent(fixAt(LOOP_A[2]!, 10, NOW)));
    const v = guidanceView(s, fixAt(LOOP_A[2]!, 10, NOW), NOW);
    expect(v.screen === "ride" && v.remainingTime).toBe(`About 2–4 min of riding left (estimate) · ${BY_STOP_COUNT}`);
  });

  it("no model on file (an older snapshot): Time not available, never a guess", () => {
    const ride = guidanceView(boardedAt(oneRide(), NOW, { etaModel: null }), null, NOW);
    expect(ride.screen === "ride" && ride.remainingTime).toBe(TIME_NOT_AVAILABLE);
    const walk = guidanceView(startSession({ ...tripOf(oneRide()), etaModel: undefined }, NOW), null, NOW);
    expect(walk.screen === "walk" && walk.remainingTime).toBe(TIME_NOT_AVAILABLE);
  });

  it("a walk uses the plan's graph path length when one was on file", () => {
    const v = guidanceView(startSession({ ...tripOf(oneRide()), walkLengths: [400, null, null] }, NOW), null, NOW);
    expect(v.screen === "walk" && v.remainingTime).toBe("About 5–8 min to Plaza Rizal (A1) (estimate)"); // 400 m: 5.7–7.1
  });

  it("a GPS remainder is a straight line, so it is ×1.3 like the plan", () => {
    const from = { lat: LOOP_A[0]!.lat - 0.0018, lng: LOOP_A[0]!.lng }; // ≈ 200 m
    const v = guidanceView(startSession(tripOf(oneRide()), NOW), fixAt(from, 12, NOW), NOW);
    expect(v.screen === "walk" && v.remainingTime).toBe("About 3–5 min to Plaza Rizal (A1) (estimate)"); // 260 m: 3.7–4.6
  });
});

describe("Ride", () => {
  const boarded = run(startSession(tripOf(oneRide()), NOW), "boarded");

  it("without GPS: the alighting stop and the pin-order count, no progress claimed", () => {
    const v = guidanceView(boarded, null, NOW);
    if (v.screen !== "ride") throw new Error(v.screen);
    expect(v.stepLabel).toBe("Step 2 of 3 · Ride");
    expect(v.title).toBe("Ride to Naga Cathedral");
    expect(v.subtitle).toBe("Loop A · clockwise (from pin order)");
    expect(v.badge).toBe(UNVERIFIED_ROUTE_BADGE);
    expect(v.boardedText).toBe("Plaza Rizal (A1) · boarded");
    expect(v.alightText).toBe("Get off · Naga Cathedral");
    expect(v.countText).toBe("5 stops after Plaza Rizal (A1), by pin order");
    expect(v.countNote).toBe(GUIDANCE_COPY.stopsByPinOrder);
    expect(v.stops.map((x) => x.state)).toEqual(["boarded", "ahead", "ahead", "ahead", "ahead", "alight"]);
    expect(v.para).toBeNull();
    expect(labels(v)).toEqual(["secondary:nextStopIsMine:My stop is next", "secondary:gotOff:I got off", "secondary:missedStop:I missed my stop", "secondary:end:End guidance"]);
    expect(v.remainingTime).toBe("About 4–6 min of riding left (estimate)");
    expect(v.reportDriver).toBe(true);
  });

  it("with GPS: stops to go, counted by pin order", () => {
    const s = reduceSession(boarded, fixEvent(fixAt(LOOP_A[2]!, 10, NOW)));
    const v = guidanceView(s, fixAt(LOOP_A[2]!, 10, NOW), NOW);
    if (v.screen !== "ride") throw new Error(v.screen);
    expect(v.title).toBe("3 stops to go");
    expect(v.stops.map((x) => x.state)).toEqual(["boarded", "passed", "passed", "ahead", "ahead", "alight"]);
    expect(v.remainingTime).toBe(`About 2–4 min of riding left (estimate) · ${BY_STOP_COUNT}`);
    expect(v.para).toBeNull();
  });

  it("a fix far ahead in pin order (a jump to the stop before alighting) shows nothing", () => {
    const s = reduceSession(boarded, fixEvent(fixAt(LOOP_A[4]!, 10, NOW)));
    expect(s.ride).toMatchObject({ passedIndex: 0, alightNear: false, nearStopBefore: false });
    expect(guidanceView(s, null, NOW).screen === "ride" && (guidanceView(s, null, NOW) as { para: unknown }).para).toBeNull();
  });

  it("Para! once precise fixes reach the stop before alighting in pin order — an assertive suggestion — then 'I said Para'", () => {
    const s = [2, 4].reduce((acc, i) => reduceSession(acc, fixEvent(fixAt(LOOP_A[i]!, 10, NOW))), boarded);
    const v = guidanceView(s, null, NOW);
    if (v.screen !== "ride") throw new Error(v.screen);
    expect(v.title).toBe("Your stop is next");
    expect(v.para).toEqual({ title: "Para! Next stop is yours", body: "Get off at Naga Cathedral. Say “Para” to the driver when you see it.", acknowledged: false });
    expect(v.live).toEqual({ politeness: "assertive", text: "Para! Next stop is yours" });
    expect(labels(v)[0]).toBe("primary:paraAcknowledged:I said “Para”");
    const acked = guidanceView(reduceSession(s, tap("paraAcknowledged")), null, NOW);
    if (acked.screen !== "ride") throw new Error(acked.screen);
    expect(acked.title).toBe("Getting off at the next stop");
    expect(acked.para).toEqual({ title: "Getting off at the next stop", body: "Step off when the jeepney stops at Naga Cathedral, then tap “I got off”.", acknowledged: true });
    expect(acked.live?.politeness).toBe("polite");
    expect(labels(acked)[0]).toBe("primary:gotOff:I got off");
  });

  it("or when the person says their stop is next (manual advance)", () => {
    const v = guidanceView(reduceSession(boarded, tap("nextStopIsMine")), null, NOW);
    expect(v.screen === "ride" && v.para?.title).toBe("Para! Next stop is yours");
  });

  it("a two-stop ride: pin order alone (no fix, or a fix far away) shows no Para", () => {
    const opt = oneRide();
    const legs = opt.legs.map((l) => (l.kind === "ride" ? { ...l, stops: l.stops.slice(0, 2) } : l));
    const s = run(startSession(tripOf({ ...opt, legs }), NOW), "boarded");
    const v = guidanceView(s, null, NOW);
    expect(v.screen === "ride" && v.para).toBeNull();
    const far = reduceSession(s, fixEvent(fixAt({ lat: BASE.lat - 0.004, lng: BASE.lng }, 10, NOW))); // ≈ 445 m away
    expect(guidanceView(far, null, NOW).screen === "ride" && (guidanceView(far, null, NOW) as { para: unknown }).para).toBeNull();
  });

  it("a two-stop ride: a precise fix at the boarding pin (200 m from the alighting pin) does suggest Para — truthfully, the next stop is yours; a 40 m fix does not", () => {
    const opt = oneRide();
    const legs = opt.legs.map((l) => (l.kind === "ride" ? { ...l, stops: l.stops.slice(0, 2) } : l));
    const s = run(startSession(tripOf({ ...opt, legs }), NOW), "boarded");
    const polite = reduceSession(s, fixEvent(fixAt(LOOP_A[0]!, 40, NOW)));
    expect(guidanceView(polite, null, NOW).screen === "ride" && (guidanceView(polite, null, NOW) as { para: unknown }).para).toBeNull();
    const precise = reduceSession(s, fixEvent(fixAt(LOOP_A[0]!, 10, NOW)));
    const v = guidanceView(precise, null, NOW);
    expect(v.screen === "ride" && v.para?.title).toBe("Para! Next stop is yours");
  });

  it("after a GPS gap the count is dropped (no-GPS copy, no GPS Para) until two in-order fixes resync it", () => {
    const at = (i: number) => fixEvent(fixAt(LOOP_A[i]!, 10, NOW));
    const lost = [1, 4].map(at).reduce(reduceSession, boarded);
    const v = guidanceView(lost, null, NOW);
    if (v.screen !== "ride") throw new Error(v.screen);
    expect(v.title).toBe("Ride to Naga Cathedral");
    expect(v.countText).toBe("5 stops after Plaza Rizal (A1), by pin order");
    expect(v.stops.map((x) => x.state)).toEqual(["boarded", "ahead", "ahead", "ahead", "ahead", "alight"]);
    expect(v.para).toBeNull();
    const synced = reduceSession(lost, at(5));
    const w = guidanceView(synced, null, NOW);
    expect(w.screen === "ride" && w.para?.title).toBe("Para! Next stop is yours");
  });

  it("Undo after 'I got off' at the alighting pin never shows a restarted count", () => {
    const atEnd = [1, 2, 3, 4, 5].map((i) => fixEvent(fixAt(LOOP_A[i]!, 10, NOW))).reduce(reduceSession, boarded);
    const undone = reduceSession(reduceSession(reduceSession(atEnd, tap("gotOff")), tap("back")), fixEvent(fixAt(LOOP_A[5]!, 10, NOW)));
    const v = guidanceView(undone, null, NOW);
    if (v.screen !== "ride") throw new Error(v.screen);
    expect(v.title).toBe("Your stop is next");
    expect(v.title).not.toBe("5 stops to go");
    expect(v.para?.title).toBe("Para! Next stop is yours");
  });

  it("the ride screen reads the session only (a fix not dispatched as an event shows nothing)", () => {
    expect(guidanceView(boarded, fixAt(LOOP_A[1]!, 5, NOW), NOW)).toEqual(guidanceView(boarded, null, NOW));
  });
});

describe("Transfer", () => {
  const s = run(startSession(tripOf(twoRides()), NOW), "boarded", "gotOff");

  it("from the alighting stop to the next boarding stop, with a checklist", () => {
    const v = guidanceView(s, null, NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.stepKind).toBe("transfer");
    expect(v.stepLabel).toBe("Step 3 of 5 · Transfer");
    expect(v.title).toBe("Walk to Del Rosario");
    expect(v.subtitle).toBe("Naga Cathedral → Del Rosario");
    expect(v.distanceText).toBe("≈ 60 m walk · straight-line estimate, path not verified");
    expect(v.checklist).toEqual([
      { text: "Got off at Naga Cathedral", done: true },
      { text: "Walk to Del Rosario", done: false },
      { text: "Wait for Loop B at Del Rosario", done: false },
    ]);
    expect(labels(v)).toEqual(["primary:atStop:I'm at the stop", "secondary:boarded:I boarded Loop B", "secondary:end:End guidance"]);
    const at = guidanceView(reduceSession(s, tap("atStop")), null, NOW);
    expect(at.screen === "walk" && at.checklist?.[1]?.done).toBe(true);
  });

  it("a change at the same spot says so; a 0 m change between two different stops names the target", () => {
    const v = guidanceView(run(startSession(tripOf(twoRides(8)), NOW), "boarded", "gotOff"), null, NOW);
    expect(v.screen === "walk" && v.title).toBe("Change to Loop B at Del Rosario");
    const opt = twoRides();
    const noWalk = { ...opt, legs: opt.legs.filter((_, i) => i !== 2) };
    const w = guidanceView(run(startSession(tripOf(noWalk), NOW), "boarded", "gotOff"), null, NOW);
    expect(w.screen === "walk" && w.title).toBe("Change to Loop B at Del Rosario");
  });
});

describe("Walk to destination and Arrive", () => {
  it("the last walk proposes arrival near the destination; the person confirms", () => {
    const s = run(startSession(tripOf(oneRide()), NOW), "boarded", "gotOff");
    const v = guidanceView(s, fixAt(DEST, 10, NOW), NOW);
    if (v.screen !== "walk") throw new Error(v.screen);
    expect(v.stepLabel).toBe("Step 3 of 3 · Walk");
    expect(v.title).toBe("Walk to SM City Naga");
    expect(v.notes).toEqual([GUIDANCE_COPY.entranceUnknown]);
    expect(v.live?.text).toBe("You look close to SM City Naga. Tap “I've arrived” when you're there.");
    expect(labels(v)).toEqual(["primary:arrived:I've arrived", "secondary:end:End guidance"]);
  });

  it("Arrive: trip complete, location off, an estimate summary with no time", () => {
    const s = run(startSession(tripOf(twoRides()), NOW), "boarded", "gotOff", "boarded", "gotOff", "arrived");
    const v = guidanceView(s, fixAt(DEST, 5, NOW), NOW);
    if (v.screen !== "arrive") throw new Error(v.screen);
    expect(v.stepLabel).toBe("Trip complete · Step 5 of 5");
    expect(v.title).toBe("You've arrived");
    expect(v.body).toBe("SM City Naga. Guidance has ended and ParaNaga has stopped using your location.");
    expect(v.summary).toEqual({
      walkText: "≈ 390 m walk · estimate",
      rides: [
        { chip: "Loop A", stopsText: "5 stops" },
        { chip: "Loop B", stopsText: "4 stops" },
      ],
      fareText: "Estimate ₱13–₱15",
    });
    expect(v.usesLocation).toBe(false);
    expect(labels(v)).toEqual(["primary:end:Done"]);
    expect(v.undo).toEqual({ event: "back", label: "Undo last step", kind: "secondary" });
  });

  it("Arrive without a destination name starts with a sentence", () => {
    const s = run(startSession(tripOf(walkOnly(), null), NOW), "arrived");
    const v = guidanceView(s, null, NOW);
    expect(v.screen === "arrive" && v.body).toBe("You're at your destination. Guidance has ended and ParaNaga has stopped using your location.");
  });

  it("a walk-only trip is a single walk step", () => {
    const v = guidanceView(startSession(tripOf(walkOnly()), NOW), null, NOW);
    expect(v.screen === "walk" && v.stepLabel).toBe("Step 1 of 1 · Walk");
  });
});

describe("Missed stop and ended", () => {
  it("missed: plan again from here, location off", () => {
    const v = guidanceView(run(startSession(tripOf(oneRide()), NOW), "boarded", "missedStop"), null, NOW);
    expect(v).toEqual({
      screen: "missed",
      title: "Missed your stop?",
      body: "Get off when the jeepney next stops, then plan again from where you are.",
      replan: true,
      usesLocation: false,
      actions: [{ event: "end", label: "End guidance", kind: "primary" }],
      undo: { event: "back", label: "Undo last step", kind: "secondary" },
      live: { politeness: "polite", text: "Missed your stop?" },
    });
  });

  it("ended: nothing to show, location off", () => {
    expect(guidanceView(run(startSession(tripOf(oneRide()), NOW), "end"), null, NOW)).toEqual({ screen: "ended", usesLocation: false });
  });
});

// ---------------------------------------------------------------- honesty properties

// A duration token may appear only in a string labelled as an estimate (Task 9, D12).
const DURATION = /\d\s*(h|min|mins|minutes?|secs?|seconds?|hrs?|hours?)\b/i;
const durationLabelled = (t: string) => !DURATION.test(t) || /^(Estimate|≈|About)/.test(t);
const FORBIDDEN = [
  /\blive\b/i,
  /arriving/i,
  /arrives? in/i,
  /\bETA\b/,
  /guarantee/i,
  /\bofficial\b/i,
  /on route/i,
  /curb/i,
  /this side/i,
  /\bexact\b/i,
  /signalled/i,
  /buzz|vibrat/i,
  /submitted to the city/i,
];

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const eventArb: fc.Arbitrary<GuidanceEvent> = fc.oneof(
  { arbitrary: fc.constantFrom(...(["atStop", "boarded", "nextStopIsMine", "paraAcknowledged", "gotOff", "missedStop", "arrived", "end", "back"] as const)).map(tap), weight: 3 },
  // Exactly at a pin, precise: lets rides progress in order.
  { arbitrary: fc.integer({ min: 0, max: 10 }).map((i) => fixEvent(fixAt([...LOOP_A, ...LOOP_B][i]!, 8, NOW))), weight: 4 },
  { arbitrary: fc
    .record({ i: fc.integer({ min: 0, max: 10 }), d: fc.double({ min: -0.003, max: 0.003, noNaN: true }), accuracy: fc.double({ min: 0, max: 150, noNaN: true }) })
    .map(({ i, d, accuracy }) => {
      const p = i === 10 ? DEST : [...LOOP_A, ...LOOP_B][i]!;
      return fixEvent({ lat: p.lat + d, lng: p.lng + d / 2, accuracy, timestamp: NOW });
    }), weight: 2 },
);
const fixArb = fc.option(
  fc
    .record({ lat: fc.double({ min: BASE.lat - 0.005, max: BASE.lat + 14 * STEP_LAT, noNaN: true }), accuracy: fc.double({ min: 0, max: 150, noNaN: true }), age: fc.integer({ min: 0, max: 2 * STALE_MS }) })
    .map(({ lat, accuracy, age }): LocationFix => ({ lat, lng: BASE.lng, accuracy, timestamp: NOW - age })),
  { nil: null },
);
const optionArb = fc.constantFrom(walkOnly(), oneRide(), oneRide(5), twoRides(), twoRides(8));

describe("view properties (fixed seeds)", () => {
  it("the duration rule: minutes only inside a labelled estimate", () => {
    expect(["Estimate 12–18 min + waiting (unknown)", "≈ 3–5 min walk", "About 10–16 min left (estimate)", "≈ 140 m walk"].every(durationLabelled)).toBe(true);
    expect(["5 min to Plaza Rizal", "Ride 1 h 5 min", "Next stop in 2 mins", "5 min to Plaza Rizal (estimates vary)"].some(durationLabelled)).toBe(false);
  });

  it("no copy ever claims times, live tracking, curb sides or certainty", () => {
    fc.assert(
      fc.property(optionArb, fc.array(eventArb, { maxLength: 30 }), fixArb, (option, events, fix) => {
        const s = events.reduce(reduceSession, startSession(tripOf(option), NOW));
        const text = strings(guidanceView(s, fix, NOW));
        return text.every((t) => FORBIDDEN.every((re) => !re.test(t)) && durationLabelled(t));
      }),
      { seed: 2026, numRuns: 500 },
    );
  });

  it("Para appears only after a manual advance, or a dispatched precise fix on this ride within 300 m of the alighting pin in pin order, or within 120 m of a stop ≥ max(1, alight − 1)", () => {
    let shownCount = 0;
    let gpsShownCount = 0;
    fc.assert(
      fc.property(optionArb, fc.array(eventArb, { maxLength: 40 }), fixArb, (option, events, fix) => {
        let s = startSession(tripOf(option), NOW);
        let justified = false;
        // Board first (ignored on a walk-only trip) so the sequence exercises rides.
        for (const e of [tap("boarded"), ...events]) {
          const next = reduceSession(s, e);
          if (next.stepIndex !== s.stepIndex || (s.ride === null && next.ride !== null)) justified = false;
          const step = currentStep(next);
          if (e.type === "fix" && next.ride && step.kind === "ride" && preciseFix(e.fix, e.now)) {
            const alight = step.stops.length - 1;
            const nearAlight = haversineMeters(e.fix, step.stops[alight]!) <= ALIGHT_NEAR_M && next.ride.passedIndex >= alight - 2;
            const nearBefore = step.stops.some((st, k) => k >= Math.max(1, alight - 1) && haversineMeters(e.fix, st) <= STOP_PASS_RADIUS_M);
            if (nearAlight || nearBefore) justified = true;
          }
          s = next;
        }
        const v = guidanceView(s, fix, NOW);
        const shown = v.screen === "ride" && v.para !== null;
        if (!shown) return true;
        shownCount += 1;
        if (!s.ride!.stopIsNext) gpsShownCount += 1;
        return s.status === "active" && (s.ride!.stopIsNext || justified);
      }),
      { seed: 516, numRuns: 2000 },
    );
    // The property must actually exercise Para.
    expect(shownCount).toBeGreaterThan(25);
    expect(gpsShownCount).toBeGreaterThan(5);
  });

  it("the assertive announcement is used for Para only", () => {
    fc.assert(
      fc.property(optionArb, fc.array(eventArb, { maxLength: 30 }), fixArb, (option, events, fix) => {
        const s = events.reduce(reduceSession, startSession(tripOf(option), NOW));
        const v = guidanceView(s, fix, NOW);
        const live = "live" in v ? v.live : null;
        return live?.politeness !== "assertive" || live.text === GUIDANCE_COPY.paraTitle;
      }),
      { seed: 17, numRuns: 300 },
    );
  });
});
