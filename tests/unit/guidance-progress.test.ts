import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { haversineMeters } from "@/domain/geo/geometry";
import { PRECISE_M, STALE_MS, type LocationFix } from "@/domain/geo/location-fix";
import {
  ALIGHT_NEAR_M,
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

describe("Para paths, each in isolation", () => {
  it("path 1: the person says their stop is next (no GPS)", () => {
    expect(paraSuggested({ ...START, stopIsNext: true })).toBe(true);
    expect(paraSuggested({ ...START, stopIsNext: false })).toBe(false);
  });

  it("path 2: a precise fix within 300 m of the alighting pin while pin order agrees (not near any later stop)", () => {
    const beyond = { lat: STOPS[5]!.lat + 0.0023, lng: STOPS[5]!.lng }; // ≈ 255 m past the alighting pin
    const p = rideProgress(STOPS, mem(3), fixAt(beyond, 10), NOW);
    expect(p).toMatchObject({ passedIndex: 3, alightNear: true, nearStopBefore: false });
    // The same fix out of order (only 1 stop passed) proves nothing.
    expect(rideProgress(STOPS, mem(1), fixAt(beyond, 10), NOW)).toMatchObject({ alightNear: false, nearStopBefore: false });
    // And a 40 m fix proves nothing (polite only).
    expect(rideProgress(STOPS, mem(3), fixAt(beyond, 40), NOW)).toMatchObject({ alightNear: false });
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

describe("ride progress properties", () => {
  it("monotonic, in range, at most two stops per fix, latched Para flags", () => {
    fc.assert(
      fc.property(rideArb, ([stops, fixes]) => {
        let m: RideMemory = START;
        for (const fix of fixes) {
          const next = rideProgress(stops, m, fix, NOW);
          if (next.passedIndex < m.passedIndex || next.passedIndex > stops.length - 1) return false;
          if (next.passedIndex - m.passedIndex > STOP_WINDOW) return false;
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
            if (!precise || haversineMeters(fix, stops[alight]!) > ALIGHT_NEAR_M || next.passedIndex < alight - 2) return false;
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
          const next = rideProgress(STOPS, { passedIndex, alightNear, nearStopBefore }, fix, NOW);
          return next.passedIndex === passedIndex && next.alightNear === alightNear && next.nearStopBefore === nearStopBefore && next.fromGps === false;
        },
      ),
      { seed: 3, numRuns: 400 },
    );
  });
});
