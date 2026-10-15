import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { haversineMeters } from "@/domain/geo/geometry";
import { STALE_MS, type LocationFix } from "@/domain/geo/location-fix";
import {
  ALIGHT_NEAR_M,
  BEARING_MIN_DISTANCE_M,
  GUIDANCE_MAX_ACCURACY_M,
  STOP_PASS_RADIUS_M,
  rideProgress,
  usableFix,
  walkProgress,
  type RideMemory,
} from "@/domain/guidance/progress";
import { BASE, LOOP_A, STEP_LAT, fixAt } from "./guidance-fixtures";

const NOW = 1_000_000;
const STOPS = LOOP_A.map((p) => ({ lat: p.lat, lng: p.lng }));
const START: RideMemory = { passedIndex: 0, alightNear: false };

describe("constants (brief values)", () => {
  it("are the thresholds of the brief", () => {
    expect(GUIDANCE_MAX_ACCURACY_M).toBe(50);
    expect(BEARING_MIN_DISTANCE_M).toBe(40);
    expect(STOP_PASS_RADIUS_M).toBe(120);
    expect(ALIGHT_NEAR_M).toBe(300);
  });
});

describe("usableFix", () => {
  it("needs accuracy ≤ 50 m, a fresh timestamp and finite numbers", () => {
    expect(usableFix(fixAt(BASE, 50), NOW)).toBe(true);
    expect(usableFix(fixAt(BASE, 50.1), NOW)).toBe(false);
    expect(usableFix(fixAt(BASE, 10, NOW - STALE_MS), NOW)).toBe(true);
    expect(usableFix(fixAt(BASE, 10, NOW - STALE_MS - 1), NOW)).toBe(false);
    expect(usableFix({ ...fixAt(BASE), accuracy: Number.NaN }, NOW)).toBe(false);
    expect(usableFix({ ...fixAt(BASE), accuracy: -1 }, NOW)).toBe(false);
    expect(usableFix({ ...fixAt(BASE), lat: Number.POSITIVE_INFINITY }, NOW)).toBe(false);
    expect(usableFix(null, NOW)).toBe(false);
  });
});

describe("walkProgress", () => {
  const target = { lat: BASE.lat + STEP_LAT, lng: BASE.lng }; // ≈ 200 m north

  it("is null without a usable fix", () => {
    expect(walkProgress(target, null, NOW)).toBeNull();
    expect(walkProgress(target, fixAt(BASE, 51), NOW)).toBeNull();
    expect(walkProgress(target, fixAt(BASE, 5, NOW - STALE_MS - 1), NOW)).toBeNull();
  });

  it("straight-line metres rounded to 10 m, with an 8-point bearing", () => {
    const p = walkProgress(target, fixAt(BASE, 12), NOW)!;
    expect(p.distanceMeters % 10).toBe(0);
    expect(Math.abs(p.distanceMeters - haversineMeters(BASE, target))).toBeLessThanOrEqual(5);
    expect(p.bearing).toBe("N");
    expect(p.nearTarget).toBe(false);
  });

  it("no bearing closer than 40 m", () => {
    const near = { lat: target.lat - 0.0003, lng: target.lng }; // ≈ 33 m
    expect(walkProgress(target, fixAt(near, 10), NOW)!.bearing).toBeNull();
    const far = { lat: target.lat - 0.0005, lng: target.lng }; // ≈ 56 m
    expect(walkProgress(target, fixAt(far, 10), NOW)!.bearing).toBe("N");
  });

  it("nearTarget within max(30 m, accuracy)", () => {
    const at25 = { lat: target.lat - 0.000225, lng: target.lng }; // ≈ 25 m
    const at45 = { lat: target.lat - 0.000405, lng: target.lng }; // ≈ 45 m
    expect(walkProgress(target, fixAt(at25, 5), NOW)!.nearTarget).toBe(true);
    expect(walkProgress(target, fixAt(at45, 5), NOW)!.nearTarget).toBe(false);
    expect(walkProgress(target, fixAt(at45, 48), NOW)!.nearTarget).toBe(true);
  });
});

describe("rideProgress", () => {
  it("starts at the boarding stop: every stop still to go", () => {
    expect(rideProgress(STOPS, START, null, NOW)).toEqual({ passedIndex: 0, alightNear: false, stopsRemaining: 5, nextIsAlight: false, fromGps: false });
  });

  it("advances to a later stop only within 120 m of it", () => {
    const between = { lat: STOPS[2]!.lat - 0.0009, lng: STOPS[2]!.lng }; // ≈ 100 m from stops 1 and 2
    expect(rideProgress(STOPS, START, fixAt(between, 10), NOW).passedIndex).toBe(1); // the earliest later stop within 120 m
    const far = { lat: BASE.lat + 1.5 * STEP_LAT, lng: BASE.lng + 0.003 }; // ≈ 330 m off the line
    expect(rideProgress(STOPS, START, fixAt(far, 10), NOW).passedIndex).toBe(0);
  });

  it("nextIsAlight when the stop before alighting is passed, or within 300 m of the alighting stop", () => {
    const p = rideProgress(STOPS, { passedIndex: 3, alightNear: false }, fixAt(STOPS[4]!, 10), NOW);
    expect(p).toMatchObject({ passedIndex: 4, stopsRemaining: 1, nextIsAlight: true, fromGps: true });
    const nearAlight = { lat: STOPS[5]!.lat + 0.0025, lng: STOPS[5]!.lng }; // ≈ 280 m beyond, off the stop list
    expect(rideProgress(STOPS, START, fixAt(nearAlight, 10), NOW)).toMatchObject({ passedIndex: 0, alightNear: true, nextIsAlight: true });
  });

  it("a two-stop ride: the next stop is the alighting stop from the start", () => {
    expect(rideProgress(STOPS.slice(0, 2), START, null, NOW)).toMatchObject({ stopsRemaining: 1, nextIsAlight: true });
  });

  it("never goes back: a fix near an earlier stop keeps the index", () => {
    expect(rideProgress(STOPS, { passedIndex: 3, alightNear: false }, fixAt(STOPS[1]!, 5), NOW).passedIndex).toBe(3);
  });

  it("poor or stale fixes change nothing", () => {
    const mem = { passedIndex: 2, alightNear: false };
    expect(rideProgress(STOPS, mem, fixAt(STOPS[4]!, 80), NOW)).toMatchObject({ ...mem, fromGps: false });
    expect(rideProgress(STOPS, mem, fixAt(STOPS[4]!, 5, NOW - STALE_MS - 1), NOW)).toMatchObject({ ...mem, fromGps: false });
  });
});

// ---------------------------------------------------------------- properties (fixed seeds)

const fixArb = (stops: { lat: number; lng: number }[]) =>
  fc.oneof(
    // Near a stop of the ride, any accuracy and age (some stale, some from the future).
    fc
      .record({
        i: fc.integer({ min: 0, max: stops.length - 1 }),
        dLat: fc.double({ min: -0.002, max: 0.002, noNaN: true }),
        dLng: fc.double({ min: -0.002, max: 0.002, noNaN: true }),
        accuracy: fc.oneof(fc.double({ min: 0, max: 200, noNaN: true }), fc.constant(Number.NaN)),
        age: fc.integer({ min: -1000, max: 2 * STALE_MS }),
      })
      .map(({ i, dLat, dLng, accuracy, age }): LocationFix => ({ lat: stops[i]!.lat + dLat, lng: stops[i]!.lng + dLng, accuracy, timestamp: NOW - age })),
    // Anywhere around.
    fc
      .record({
        lat: fc.double({ min: BASE.lat - 0.02, max: BASE.lat + 0.03, noNaN: true }),
        lng: fc.double({ min: BASE.lng - 0.02, max: BASE.lng + 0.02, noNaN: true }),
        accuracy: fc.double({ min: 0, max: 200, noNaN: true }),
      })
      .map(({ lat, lng, accuracy }): LocationFix => ({ lat, lng, accuracy, timestamp: NOW })),
  );

const lengthArb = fc.integer({ min: 2, max: STOPS.length });

describe("ride progress properties", () => {
  it("the passed index is monotonic and within the ride under any fix sequence", () => {
    fc.assert(
      fc.property(
        lengthArb.chain((n) => fc.tuple(fc.constant(n), fc.array(fc.option(fixArb(STOPS.slice(0, n)), { nil: null }), { maxLength: 40 }))),
        ([n, fixes]) => {
          const stops = STOPS.slice(0, n);
          let mem: RideMemory = START;
          for (const fix of fixes) {
            const next = rideProgress(stops, mem, fix, NOW);
            if (next.passedIndex < mem.passedIndex || next.passedIndex > n - 1) return false;
            if (mem.alightNear && !next.alightNear) return false;
            if (next.stopsRemaining !== n - 1 - next.passedIndex) return false;
            mem = next;
          }
          return true;
        },
      ),
      { seed: 20261016, numRuns: 400 },
    );
  });

  it("nextIsAlight never fires before the stop before alighting is reached or a usable fix within 300 m", () => {
    fc.assert(
      fc.property(
        lengthArb.chain((n) => fc.tuple(fc.constant(n), fc.array(fixArb(STOPS.slice(0, n)), { maxLength: 30 }))),
        ([n, fixes]) => {
          const stops = STOPS.slice(0, n);
          const alight = stops[n - 1]!;
          let mem: RideMemory = START;
          let sawNear = false;
          for (const fix of fixes) {
            if (usableFix(fix, NOW) && haversineMeters(fix, alight) <= ALIGHT_NEAR_M) sawNear = true;
            const next = rideProgress(stops, mem, fix, NOW);
            if (next.nextIsAlight && !(next.passedIndex >= n - 2 || sawNear)) return false;
            mem = next;
          }
          return true;
        },
      ),
      { seed: 7, numRuns: 400 },
    );
  });

  it("an unusable fix never changes the memory", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        fixArb(STOPS).filter((f) => !usableFix(f, NOW)),
        (passedIndex, alightNear, fix) => {
          const next = rideProgress(STOPS, { passedIndex, alightNear }, fix, NOW);
          return next.passedIndex === passedIndex && next.alightNear === alightNear && next.fromGps === false;
        },
      ),
      { seed: 3, numRuns: 400 },
    );
  });
});
