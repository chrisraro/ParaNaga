import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { haversineMeters } from "@/domain/geo/geometry";
import { lineLengthM } from "@/domain/geo/measure";
import { PRECISE_M, STALE_MS, type LocationFix } from "@/domain/geo/location-fix";
import {
  ALIGHT_NEAR_M,
  GET_READY_M,
  PATH_OFF_M,
  pathRideProgress,
  BEARING_MIN_DISTANCE_M,
  CLOCK_SKEW_MS,
  GUIDANCE_MAX_ACCURACY_M,
  NEW_RIDE_MEMORY,
  PARA_MAX_ACCURACY_M,
  STOP_PASS_RADIUS_M,
  STOP_WINDOW,
  paraSuggested,
  preciseFix,
  rideProgress,
  usableFix,
  walkProgress,
  type RideMemory,
} from "@/domain/guidance/progress";
import { BASE, FULL_CIRCLE, LOOP_A, STEP_LAT, U_LOOP, fixAt } from "./guidance-fixtures";

const NOW = 1_000_000;
const STOPS = LOOP_A.map((p) => ({ lat: p.lat, lng: p.lng }));
const START: RideMemory = NEW_RIDE_MEMORY;
const mem = (passedIndex: number, more: Partial<RideMemory> = {}): RideMemory => ({ ...START, passedIndex, ...more });
/** 8 stops 200 m apart, northward. */
const EIGHT = Array.from({ length: 8 }, (_, i) => ({ lat: BASE.lat + i * STEP_LAT, lng: BASE.lng }));
/** Spacing 400 m: the stop before alighting is further than 300 m from the alighting pin. */
const WIDE = Array.from({ length: 4 }, (_, i) => ({ lat: BASE.lat + 2 * i * STEP_LAT, lng: BASE.lng }));

describe("constants (brief values and decision A)", () => {
  it("are the thresholds of the brief, with PRECISE_M for Para", () => {
    expect(GUIDANCE_MAX_ACCURACY_M).toBe(50);
    expect(PARA_MAX_ACCURACY_M).toBe(PRECISE_M);
    expect(PRECISE_M).toBe(30);
    expect(BEARING_MIN_DISTANCE_M).toBe(40);
    expect(STOP_PASS_RADIUS_M).toBe(120);
    expect(ALIGHT_NEAR_M).toBe(300);
    expect(STOP_WINDOW).toBe(2);
  });
});

describe("usableFix / preciseFix", () => {
  it("usable: accuracy ≤ 50 m, fresh, not from the future, finite", () => {
    expect(usableFix(fixAt(BASE, 50), NOW)).toBe(true);
    expect(usableFix(fixAt(BASE, 50.1), NOW)).toBe(false);
    expect(usableFix(fixAt(BASE, 10, NOW - STALE_MS), NOW)).toBe(true);
    expect(usableFix(fixAt(BASE, 10, NOW - STALE_MS - 1), NOW)).toBe(false);
    expect(usableFix(fixAt(BASE, 10, NOW + CLOCK_SKEW_MS), NOW)).toBe(true);
    expect(usableFix(fixAt(BASE, 10, NOW + CLOCK_SKEW_MS + 1), NOW)).toBe(false);
    expect(usableFix(fixAt(BASE, 10, NOW + 3_600_000), NOW)).toBe(false);
    expect(usableFix({ ...fixAt(BASE), accuracy: Number.NaN }, NOW)).toBe(false);
    expect(usableFix({ ...fixAt(BASE), accuracy: -1 }, NOW)).toBe(false);
    expect(usableFix({ ...fixAt(BASE), lat: Number.POSITIVE_INFINITY }, NOW)).toBe(false);
    expect(usableFix(null, NOW)).toBe(false);
  });

  it("precise: usable and ≤ 30 m", () => {
    expect(preciseFix(fixAt(BASE, 30), NOW)).toBe(true);
    expect(preciseFix(fixAt(BASE, 30.5), NOW)).toBe(false);
    expect(preciseFix(fixAt(BASE, 10, NOW - STALE_MS - 1), NOW)).toBe(false);
  });
});

describe("walkProgress", () => {
  const target = { lat: BASE.lat + STEP_LAT, lng: BASE.lng }; // ≈ 200 m north

  it("is null without a usable fix", () => {
    expect(walkProgress(target, null, NOW)).toBeNull();
    expect(walkProgress(target, fixAt(BASE, 51), NOW)).toBeNull();
    expect(walkProgress(target, fixAt(BASE, 5, NOW - STALE_MS - 1), NOW)).toBeNull();
  });

  it("straight-line metres rounded to 10 m, with an 8-point bearing (polite: 50 m gate)", () => {
    const p = walkProgress(target, fixAt(BASE, 45), NOW)!;
    expect(p.distanceMeters % 10).toBe(0);
    expect(Math.abs(p.distanceMeters - haversineMeters(BASE, target))).toBeLessThanOrEqual(5);
    expect(p.bearing).toBe("N");
    expect(p.nearTarget).toBe(false);
  });

  it("no bearing closer than 40 m", () => {
    expect(walkProgress(target, fixAt({ lat: target.lat - 0.0003, lng: target.lng }, 10), NOW)!.bearing).toBeNull(); // ≈ 33 m
    expect(walkProgress(target, fixAt({ lat: target.lat - 0.0005, lng: target.lng }, 10), NOW)!.bearing).toBe("N"); // ≈ 56 m
  });

  it("nearTarget within max(30 m, accuracy)", () => {
    const at25 = { lat: target.lat - 0.000225, lng: target.lng };
    const at45 = { lat: target.lat - 0.000405, lng: target.lng };
    expect(walkProgress(target, fixAt(at25, 5), NOW)!.nearTarget).toBe(true);
    expect(walkProgress(target, fixAt(at45, 5), NOW)!.nearTarget).toBe(false);
    expect(walkProgress(target, fixAt(at45, 48), NOW)!.nearTarget).toBe(true);
  });
});

describe("rideProgress: strictly by pin order", () => {
  it("starts at the boarding stop: every stop still to go, no Para", () => {
    expect(rideProgress(STOPS, START, null, NOW)).toEqual({ ...START, stopsRemaining: 5, fromGps: false });
  });

  it("moves only within the next two stops, and only within 120 m", () => {
    expect(rideProgress(STOPS, START, fixAt(STOPS[1]!, 10), NOW).passedIndex).toBe(1);
    expect(rideProgress(STOPS, START, fixAt(STOPS[2]!, 10), NOW).passedIndex).toBe(2); // one missed fix allowed
    expect(rideProgress(STOPS, START, fixAt(STOPS[3]!, 10), NOW).passedIndex).toBe(0); // three ahead: out of the window
    const offLine = { lat: BASE.lat + STEP_LAT, lng: BASE.lng + 0.0013 }; // ≈ 140 m east of stop 1
    expect(rideProgress(STOPS, START, fixAt(offLine, 10), NOW).passedIndex).toBe(0);
  });

  it("never goes back", () => {
    expect(rideProgress(STOPS, mem(3), fixAt(STOPS[1]!, 5), NOW).passedIndex).toBe(3);
  });

  it("U-shaped loop with a parallel return street: a fix just after boarding moves nothing", () => {
    const alight = U_LOOP.length - 1;
    const justAfter = { lat: U_LOOP[0]!.lat + 0.0005, lng: U_LOOP[0]!.lng }; // ≈ 55 m after boarding
    const p = rideProgress(U_LOOP, START, fixAt(justAfter, 5), NOW);
    expect(p).toMatchObject({ passedIndex: 0, alightNear: false, nearStopBefore: false, stopsRemaining: alight });
    expect(paraSuggested({ ...p, stopIsNext: false })).toBe(false);
  });

  it("U-shaped loop: a return-street stop never wins over the outbound stop beside it", () => {
    // Ride the outbound street in order, fixes exactly at each stop: the index follows the order.
    let m = START;
    for (let i = 1; i <= 4; i++) {
      m = rideProgress(U_LOOP, m, fixAt(U_LOOP[i]!, 5), NOW);
      expect(m.passedIndex).toBe(i);
    }
    // Beside stop 3 but on the return street (stop 6): from index 4, stop 6 is in the window and nearest.
    m = rideProgress(U_LOOP, m, fixAt(U_LOOP[6]!, 5), NOW);
    expect(m.passedIndex).toBe(6);
    expect(m.alightNear).toBe(false);
  });

  it("full-circle ride (alighting pin beside the boarding pin): a fix at boarding changes nothing", () => {
    const p = rideProgress(FULL_CIRCLE, START, fixAt(FULL_CIRCLE[0]!, 5), NOW);
    expect(p).toMatchObject({ passedIndex: 0, alightNear: false, nearStopBefore: false });
  });

  it("full-circle ride: riding it in order reaches the alighting stop and suggests Para there", () => {
    let m = START;
    const alight = FULL_CIRCLE.length - 1;
    for (let i = 1; i <= alight; i++) {
      m = rideProgress(FULL_CIRCLE, m, fixAt(FULL_CIRCLE[i]!, 5), NOW);
      expect(m.passedIndex).toBe(i);
      expect(paraSuggested({ ...m, stopIsNext: false })).toBe(i >= alight - 1);
    }
  });
});

describe("after a GPS gap: honest fallback, then resync on two in-order fixes", () => {
  const ride = (fixes: { lat: number; lng: number }[], stops = EIGHT, from: RideMemory = START) =>
    fixes.reduce((m, at) => rideProgress(stops, m, fixAt(at, 10, NOW), NOW), from);

  it("8 stops, 200 m apart: a fix at 1, then 4, 5, 6 — lost at 4, resynced at 5, Para at 6", () => {
    const at1 = ride([EIGHT[1]!]);
    expect(at1).toMatchObject({ passedIndex: 1, countLost: false });
    const at4 = ride([EIGHT[4]!], EIGHT, at1);
    expect(at4).toMatchObject({ passedIndex: 1, countLost: true, pendingIndex: 4, alightNear: false, nearStopBefore: false });
    expect(paraSuggested({ ...at4, stopIsNext: false })).toBe(false);
    const at5 = ride([EIGHT[5]!], EIGHT, at4);
    expect(at5).toMatchObject({ passedIndex: 5, countLost: false, pendingIndex: null });
    const at6 = ride([EIGHT[6]!], EIGHT, at5);
    expect(at6).toMatchObject({ passedIndex: 6, nearStopBefore: true, alightNear: true });
    expect(paraSuggested({ ...at6, stopIsNext: false })).toBe(true);
    // The reviewer's sequence (1, 4, 5, 6, 7) ends at the alighting stop with Para.
    expect(ride([EIGHT[1]!, EIGHT[4]!, EIGHT[5]!, EIGHT[6]!, EIGHT[7]!])).toMatchObject({ passedIndex: 7, countLost: false, nearStopBefore: true });
  });

  it("while the count is lost, Para from GPS is off (manual only)", () => {
    const lost = { ...START, passedIndex: 1, countLost: true, alightNear: true };
    expect(paraSuggested({ ...lost, stopIsNext: false })).toBe(false);
    expect(paraSuggested({ ...lost, stopIsNext: true })).toBe(true);
  });

  it("no resync on one beyond fix, on a decreasing pair, or on a pair broken by another fix", () => {
    expect(ride([EIGHT[4]!]).passedIndex).toBe(0);
    expect(ride([EIGHT[5]!, EIGHT[4]!]).passedIndex).toBe(0);
    const between = { lat: BASE.lat + 4.5 * STEP_LAT, lng: BASE.lng + 0.003 }; // ≈ 340 m off the line: matches nothing
    const broken = ride([EIGHT[4]!, between, EIGHT[5]!]);
    expect(broken).toMatchObject({ passedIndex: 0, countLost: true, pendingIndex: 5 });
  });

  it("an in-window match clears the lost count", () => {
    const lost = ride([EIGHT[4]!]);
    expect(lost.countLost).toBe(true);
    expect(ride([EIGHT[1]!], EIGHT, lost)).toMatchObject({ passedIndex: 1, countLost: false, pendingIndex: null });
  });

  it("U-loop with a gap: return-street stops beside earlier stops are never a resync target", () => {
    const from1 = { ...START, passedIndex: 1 };
    // Return-street stops 6 and 7 sit beside outbound stops 3 and 2.
    expect(ride([U_LOOP[6]!, U_LOOP[7]!], U_LOOP, from1).passedIndex).toBe(1);
    expect(ride([U_LOOP[7]!, U_LOOP[8]!], U_LOOP, START).passedIndex).toBe(0);
    expect(ride([U_LOOP[8]!, U_LOOP[9]!], U_LOOP, START)).toMatchObject({ passedIndex: 0, alightNear: false, nearStopBefore: false });
    // A real gap on the outbound street does resync.
    expect(ride([U_LOOP[3]!, U_LOOP[4]!], U_LOOP, START).passedIndex).toBe(4);
  });
});

describe("Para paths, each in isolation", () => {
  it("path 1: the person says their stop is next (no GPS)", () => {
    expect(paraSuggested({ ...START, stopIsNext: true })).toBe(true);
    expect(paraSuggested({ ...START, stopIsNext: false })).toBe(false);
  });

  it("path 2: a precise fix within 300 m of the alighting pin while pin order agrees (not near any later stop)", () => {
    const beyond = { lat: STOPS[5]!.lat + 0.0023, lng: STOPS[5]!.lng }; // ≈ 255 m past the alighting pin
    const p = rideProgress(STOPS, mem(4), fixAt(beyond, 10), NOW);
    expect(p).toMatchObject({ passedIndex: 4, alightNear: true, nearStopBefore: false });
    // The same fix with the stop before alighting not yet counted proves nothing (field test 2026-10-21: a loop's
    // parallel return street brings the alighting pin within 300 m while stops are still to go).
    expect(rideProgress(STOPS, mem(3), fixAt(beyond, 10), NOW)).toMatchObject({ alightNear: false, nearStopBefore: false });
    // And a 40 m fix proves nothing (polite only).
    expect(rideProgress(STOPS, mem(4), fixAt(beyond, 40), NOW)).toMatchObject({ alightNear: false });
  });

  it("path 3: a precise fix at the stop before alighting, in order, further than 300 m from the alighting pin", () => {
    const p = rideProgress(WIDE, mem(1), fixAt(WIDE[2]!, 10), NOW);
    expect(p).toMatchObject({ passedIndex: 2, alightNear: false, nearStopBefore: true });
  });

  it("a 40 m fix advances the count but suggests nothing; a later precise fix at the same stop does", () => {
    const polite = rideProgress(WIDE, mem(1), fixAt(WIDE[2]!, 40), NOW);
    expect(polite).toMatchObject({ passedIndex: 2, nearStopBefore: false, alightNear: false, fromGps: true });
    expect(rideProgress(WIDE, polite, fixAt(WIDE[2]!, 20), NOW)).toMatchObject({ passedIndex: 2, nearStopBefore: true });
  });

  it("a fix at the alighting pin out of pin order changes nothing", () => {
    expect(rideProgress(STOPS, START, fixAt(STOPS[5]!, 5), NOW)).toMatchObject({ passedIndex: 0, alightNear: false, nearStopBefore: false });
  });

  it("a two-stop ride: pin order alone never suggests Para; a precise fix at the boarding pin (200 m from the alighting pin) does", () => {
    const two = STOPS.slice(0, 2);
    expect(paraSuggested({ ...rideProgress(two, START, null, NOW), stopIsNext: false })).toBe(false);
    expect(paraSuggested({ ...rideProgress(two, START, fixAt(two[0]!, 40), NOW), stopIsNext: false })).toBe(false);
    expect(paraSuggested({ ...rideProgress(two, START, fixAt(two[0]!, 10), NOW), stopIsNext: false })).toBe(true);
  });

  it("poor, stale or future fixes change nothing", () => {
    const m = mem(2);
    for (const f of [fixAt(STOPS[4]!, 80), fixAt(STOPS[4]!, 5, NOW - STALE_MS - 1), fixAt(STOPS[3]!, 5, NOW + 60_000)]) {
      expect(rideProgress(STOPS, m, f, NOW)).toMatchObject({ ...m, fromGps: false });
    }
  });
});

// ---------------------------------------------------------------- properties (fixed seeds)

type P = { lat: number; lng: number };
const fixArb = (stops: P[]) =>
  fc.oneof(
    // Near a stop of the ride, any accuracy and age (some stale, some from the future).
    fc
      .record({
        i: fc.integer({ min: 0, max: stops.length - 1 }),
        dLat: fc.double({ min: -0.002, max: 0.002, noNaN: true }),
        dLng: fc.double({ min: -0.002, max: 0.002, noNaN: true }),
        accuracy: fc.oneof(fc.double({ min: 0, max: 80, noNaN: true }), fc.constant(Number.NaN)),
        age: fc.integer({ min: -2 * CLOCK_SKEW_MS, max: 2 * STALE_MS }),
      })
      .map(({ i, dLat, dLng, accuracy, age }): LocationFix => ({ lat: stops[i]!.lat + dLat, lng: stops[i]!.lng + dLng, accuracy, timestamp: NOW - age })),
    // Exactly at a stop, precise (exercises the order window on loops).
    fc.integer({ min: 0, max: stops.length - 1 }).map((i): LocationFix => fixAt(stops[i]!, 5, NOW)),
    // Anywhere around.
    fc
      .record({
        lat: fc.double({ min: BASE.lat - 0.02, max: BASE.lat + 0.03, noNaN: true }),
        lng: fc.double({ min: BASE.lng - 0.02, max: BASE.lng + 0.02, noNaN: true }),
        accuracy: fc.double({ min: 0, max: 80, noNaN: true }),
      })
      .map(({ lat, lng, accuracy }): LocationFix => ({ lat, lng, accuracy, timestamp: NOW })),
  );

const RIDES: P[][] = [STOPS, STOPS.slice(0, 2), STOPS.slice(0, 3), U_LOOP, FULL_CIRCLE, WIDE];
const rideArb = fc.integer({ min: 0, max: RIDES.length - 1 }).chain((r) => fc.tuple(fc.constant(RIDES[r]!), fc.array(fixArb(RIDES[r]!), { maxLength: 40 })));

const RIDES_WITH_GAPS = [...RIDES, EIGHT];
const gapRideArb = fc
  .integer({ min: 0, max: RIDES_WITH_GAPS.length - 1 })
  .chain((r) => fc.tuple(fc.constant(RIDES_WITH_GAPS[r]!), fc.array(fixArb(RIDES_WITH_GAPS[r]!), { maxLength: 40 })));

describe("ride progress properties", () => {
  it("a GPS-backed count is only shown when a usable fix matched the counted stop after the last beyond-window fix", () => {
    fc.assert(
      fc.property(gapRideArb, ([stops, fixes]) => {
        const alight = stops.length - 1;
        let m: RideMemory = START;
        let seen = false;
        let lastBeyond = -1;
        let lastAnchor = -1;
        for (const [t, fix] of fixes.entries()) {
          const next = rideProgress(stops, m, fix, NOW);
          if (usableFix(fix, NOW)) {
            seen = true;
            const d = stops.map((st) => haversineMeters(fix, st));
            const nearest = Math.min(...d);
            // "Beyond" is judged against the window after this fix (a resync fix is its own anchor).
            const windowEnd = Math.min(alight, next.passedIndex + STOP_WINDOW);
            const nearestIndex = d.indexOf(nearest);
            if (nearestIndex > windowEnd && d.slice(next.passedIndex + 1, windowEnd + 1).every((x) => x > STOP_PASS_RADIUS_M)) lastBeyond = t;
            if (d[next.passedIndex]! <= STOP_PASS_RADIUS_M) lastAnchor = t;
          }
          const shown = seen && !next.countLost;
          if (shown && lastBeyond >= 0 && !(lastAnchor > lastBeyond)) return false;
          m = next;
        }
        return true;
      }),
      { seed: 404, numRuns: 600 },
    );
  });

  it("monotonic, in range, at most two stops per fix unless resynced, latched Para flags", () => {
    fc.assert(
      fc.property(rideArb, ([stops, fixes]) => {
        let m: RideMemory = START;
        for (const fix of fixes) {
          const next = rideProgress(stops, m, fix, NOW);
          if (next.passedIndex < m.passedIndex || next.passedIndex > stops.length - 1) return false;
          // Beyond the window only as the second of two in-order beyond-window matches.
          if (next.passedIndex - m.passedIndex > STOP_WINDOW) {
            if (m.pendingIndex === null || next.passedIndex <= m.pendingIndex) return false;
            if (haversineMeters(fix, stops[next.passedIndex]!) > STOP_PASS_RADIUS_M) return false;
          }
          if ((m.alightNear && !next.alightNear) || (m.nearStopBefore && !next.nearStopBefore)) return false;
          if (next.stopsRemaining !== stops.length - 1 - next.passedIndex) return false;
          m = next;
        }
        return true;
      }),
      { seed: 20261016, numRuns: 500 },
    );
  });

  it("Para (GPS) is set only by a precise fix: within 300 m of the alighting pin in pin order, or within 120 m of a stop with index ≥ max(1, alight − 1)", () => {
    fc.assert(
      fc.property(rideArb, ([stops, fixes]) => {
        const alight = stops.length - 1;
        let m: RideMemory = START;
        for (const fix of fixes) {
          const next = rideProgress(stops, m, fix, NOW);
          const precise = preciseFix(fix, NOW);
          if (next.alightNear && !m.alightNear) {
            if (!precise || haversineMeters(fix, stops[alight]!) > ALIGHT_NEAR_M || next.passedIndex < alight - 1) return false;
          }
          if (next.nearStopBefore && !m.nearStopBefore) {
            const near = stops.some((s, k) => k >= Math.max(1, alight - 1) && haversineMeters(fix, s) <= STOP_PASS_RADIUS_M);
            if (!precise || !near) return false;
          }
          m = next;
        }
        return true;
      }),
      { seed: 7, numRuns: 500 },
    );
  });

  it("on the U-loop and the full circle, a single fix right after boarding never suggests Para", () => {
    fc.assert(
      fc.property(fc.constantFrom(U_LOOP, FULL_CIRCLE), fc.double({ min: 0, max: 0.0007, noNaN: true }), fc.double({ min: 0, max: 30, noNaN: true }), (stops, d, accuracy) => {
        const p = rideProgress(stops, START, fixAt({ lat: stops[0]!.lat + d, lng: stops[0]!.lng }, accuracy, NOW), NOW);
        return !paraSuggested({ ...p, stopIsNext: false });
      }),
      { seed: 11, numRuns: 300 },
    );
  });

  it("an unusable fix never changes the memory", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        fc.boolean(),
        fixArb(STOPS).filter((f) => !usableFix(f, NOW)),
        (passedIndex, alightNear, nearStopBefore, fix) => {
          const next = rideProgress(STOPS, { ...START, passedIndex, alightNear, nearStopBefore }, fix, NOW);
          return next.passedIndex === passedIndex && next.alightNear === alightNear && next.nearStopBefore === nearStopBefore && next.fromGps === false;
        },
      ),
      { seed: 3, numRuns: 400 },
    );
  });
});

// ---------------------------------------------------------------- ride progress along the Lines path (Increment E)

describe("pathRideProgress", () => {
  const NOW_P = 1_000_000;
  const fixP = (p: { lat: number; lng: number }, accuracy = 10): LocationFix => ({ ...p, accuracy, timestamp: NOW_P });
  const M_PER_DEG = 111_195;
  const centre = { lat: 13.62, lng: 123.19 };
  const cos = Math.cos((centre.lat * Math.PI) / 180);
  const off = (east: number, north: number) => ({ lat: centre.lat + north / M_PER_DEG, lng: centre.lng + east / (M_PER_DEG * cos) });
  // A closed 500 m square, counter-clockwise from its south-west corner: a circuit of ≈ 2,000 m.
  const SQUARE = [off(0, 0), off(500, 0), off(500, 500), off(0, 500), off(0, 0)];
  const L = lineLengthM(SQUARE);
  const along = (m: number) => pointAt(SQUARE, ((m % L) + L) % L);

  it("on a circuit the ride across the path start counts the metres left correctly", () => {
    // Board 300 m before the start, alight 500 m after it: an 800 m ride across the seam.
    const board = L - 300;
    const alight = 500;
    const at = (m: number) => pathRideProgress(SQUARE, true, board, alight, fixP(along(m)), NOW_P);
    expect(at(L - 300)).toMatchObject({ offPath: false });
    expect((at(L - 300) as { remainingM: number }).remainingM).toBeCloseTo(800, -1);
    expect((at(0) as { remainingM: number }).remainingM).toBeCloseTo(500, -1);
    expect((at(250) as { remainingM: number }).remainingM).toBeCloseTo(250, -1);
    expect(at(250)).toMatchObject({ getReady: true });
    expect(at(0)).toMatchObject({ getReady: false });
  });

  it("a line ride: remaining = alight − current, get ready at 300 m", () => {
    const line = [off(0, 0), off(0, 3000)];
    const p = pathRideProgress(line, false, 200, 2500, fixP(off(0, 2300)), NOW_P);
    expect(p).toMatchObject({ offPath: false, getReady: true });
    expect((p as { remainingM: number }).remainingM).toBeCloseTo(200, -1);
    expect(pathRideProgress(line, false, 200, 2500, fixP(off(0, 1000)), NOW_P)).toMatchObject({ offPath: false, getReady: false });
  });

  it("GPS 120 m off the path is 'off path', not progress", () => {
    const line = [off(0, 0), off(0, 3000)];
    expect(pathRideProgress(line, false, 200, 2500, fixP(off(120, 1000)), NOW_P)).toEqual({ offPath: true, distM: 120 });
    expect(PATH_OFF_M).toBeLessThan(120);
  });

  it("an unusable fix gives nothing (no guess)", () => {
    const line = [off(0, 0), off(0, 3000)];
    expect(pathRideProgress(line, false, 200, 2500, null, NOW_P)).toBeNull();
    expect(pathRideProgress(line, false, 200, 2500, fixP(off(0, 1000), 80), NOW_P)).toBeNull();
    expect(pathRideProgress(line, false, 200, 2500, { ...fixP(off(0, 1000)), timestamp: NOW_P - 2 * STALE_MS }, NOW_P)).toBeNull();
  });

  it("property: remaining stays within [0, ride length] and get-ready matches the 300 m rule", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: L, noNaN: true }), fc.double({ min: 200, max: L - 1, noNaN: true }), fc.double({ min: 0, max: L, noNaN: true }), (board, ride, at) => {
        const p = pathRideProgress(SQUARE, true, board, board + ride, fixP(along(at)), NOW_P);
        if (!p || p.offPath) return true;
        return p.remainingM >= 0 && p.remainingM <= Math.round(ride) && p.getReady === (p.remainingM <= GET_READY_M);
      }),
      { seed: 9, numRuns: 300 },
    );
  });
});

/** The point `m` metres along `line`. */
function pointAt(line: readonly { lat: number; lng: number }[], m: number) {
  let left = m;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = haversineMeters(a, b);
    if (left <= d || i === line.length - 1) {
      const t = d === 0 ? 0 : Math.min(1, left / d);
      return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
    }
    left -= d;
  }
  return line.at(-1)!;
}

describe("pathRideProgress: out-and-back (review I1)", () => {
  const M = 111_195;
  const c = { lat: 13.62, lng: 123.19 };
  const k = Math.cos((c.lat * Math.PI) / 180);
  const o = (east: number, north: number) => ({ lat: c.lat + north / M, lng: c.lng + east / (M * k) });
  // North 1,000 m, 60 m east, back south on a parallel street: the two passes run 60 m apart.
  const OUT_BACK = [o(0, 0), o(0, 1000), o(60, 1000), o(60, 0)];

  it("a fix slightly nearer the return pass still reads the earlier (outbound) pass", () => {
    const fix: LocationFix = { ...o(35, 500), accuracy: 10, timestamp: 1_000_000 };
    const p = pathRideProgress(OUT_BACK, false, 100, 2000, fix, 1_000_000);
    expect(p).toMatchObject({ offPath: false, getReady: false });
    expect((p as { remainingM: number }).remainingM).toBeCloseTo(1500, -1);
  });

  it("a fix clearly on the return pass reads the return pass", () => {
    const fix: LocationFix = { ...o(60, 300), accuracy: 10, timestamp: 1_000_000 };
    expect((pathRideProgress(OUT_BACK, false, 100, 2000, fix, 1_000_000) as { remainingM: number }).remainingM).toBeCloseTo(240, -1);
  });
});
