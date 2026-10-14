import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  APPROXIMATE_M,
  PRECISE_M,
  STALE_MS,
  assessFix,
  fixQuality,
  isStale,
  pickBetterFix,
  type LocationFix,
} from "@/domain/geo/location-fix";

const PLAZA = { lat: 13.6233869, lng: 123.1846726 };
const PILI = { lat: 13.5828, lng: 123.2756 };

const fix = (accuracy: number, timestamp = 1_000_000, at = PLAZA): LocationFix => ({
  ...at,
  accuracy,
  timestamp,
});

describe("constants", () => {
  it("uses the strict GPS policy values", () => {
    expect(PRECISE_M).toBe(30);
    expect(APPROXIMATE_M).toBe(100);
    expect(STALE_MS).toBe(30_000);
  });
});

describe("fixQuality", () => {
  it.each([
    [0, "precise"],
    [30, "precise"],
    [30.01, "approximate"],
    [100, "approximate"],
    [100.01, "coarse"],
    [5000, "coarse"],
  ] as const)("accuracy %s m is %s", (accuracy, expected) => {
    expect(fixQuality(fix(accuracy))).toBe(expected);
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "invalid accuracy %s is coarse",
    (accuracy) => {
      expect(fixQuality(fix(accuracy))).toBe("coarse");
    },
  );
});

describe("isStale", () => {
  it("is not stale at exactly 30 000 ms", () => {
    expect(isStale(fix(10, 0), 30_000)).toBe(false);
  });
  it("is stale at 30 001 ms", () => {
    expect(isStale(fix(10, 0), 30_001)).toBe(true);
  });
});

describe("pickBetterFix", () => {
  const now = 1_000_000;
  const current = fix(20, now - 5_000);

  it("returns next when there is no current", () => {
    const next = fix(500, now);
    expect(pickBetterFix(null, next, now)).toBe(next);
  });

  it("returns next when current is stale, even if next is worse", () => {
    const stale = fix(10, now - 30_001);
    const next = fix(500, now);
    expect(pickBetterFix(stale, next, now)).toBe(next);
  });

  it("returns next when it is more accurate", () => {
    const next = fix(10, now - 5_000);
    expect(pickBetterFix(current, next, now)).toBe(next);
  });

  it("returns next on an accuracy tie", () => {
    const next = fix(20, now - 5_000);
    expect(pickBetterFix(current, next, now)).toBe(next);
  });

  it("keeps current when next is worse and not newer by more than 10 s", () => {
    const next = fix(25, now - 5_000 + 10_000);
    expect(pickBetterFix(current, next, now)).toBe(current);
  });

  it("keeps current when a coarse network fix arrives after a good GPS fix", () => {
    const next = fix(2_000, now);
    expect(pickBetterFix(current, next, now)).toBe(current);
  });

  it("returns next when newer by more than 10 s and within 1.5x accuracy", () => {
    const next = fix(30, now - 5_000 + 10_001);
    expect(pickBetterFix(current, next, now)).toBe(next);
  });

  it("keeps current when newer by more than 10 s but beyond 1.5x accuracy", () => {
    const next = fix(30.01, now - 5_000 + 10_001);
    expect(pickBetterFix(current, next, now)).toBe(current);
  });

  it.each([Number.NaN, -5, Number.POSITIVE_INFINITY])(
    "never prefers a next fix with invalid accuracy %s over a valid current",
    (accuracy) => {
      const next = fix(accuracy, now + 60_000);
      expect(pickBetterFix(current, next, now)).toBe(current);
    },
  );

  it("property: only swaps to a worse fix when current is stale or next is newer by >10 s within 1.5x", () => {
    const arbFix = fc.record({
      lat: fc.constant(PLAZA.lat),
      lng: fc.constant(PLAZA.lng),
      accuracy: fc.double({ min: 0, max: 5_000, noNaN: true }),
      timestamp: fc.integer({ min: 0, max: 200_000 }),
    });
    fc.assert(
      fc.property(arbFix, arbFix, fc.integer({ min: 0, max: 300_000 }), (cur, next, at) => {
        const result = pickBetterFix(cur, next, at);
        if (result === cur) return true;
        expect(result).toBe(next);
        if (next.accuracy <= cur.accuracy) return true;
        const stale = at - cur.timestamp > STALE_MS;
        const newerWithin =
          next.timestamp - cur.timestamp > 10_000 && next.accuracy <= cur.accuracy * 1.5;
        return stale || newerWithin;
      }),
    );
  });

  it("property: keeps current whenever next is worse, current is fresh and next is not newer by >10 s", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000, noNaN: true }),
        fc.integer({ min: 0, max: 10_000 }),
        (a, extra, dt) => {
          const cur = fix(a, 100_000);
          const next = fix(a + extra + 0.001, 100_000 + dt);
          return pickBetterFix(cur, next, 100_000) === cur;
        },
      ),
    );
  });
});

describe("assessFix", () => {
  const now = 1_000_000;

  it("precise, fresh, inside Naga is usable as start", () => {
    expect(assessFix(fix(10, now), now)).toEqual({
      quality: "precise",
      stale: false,
      insideCity: true,
      usableAsStart: true,
    });
  });

  it("approximate, fresh, inside Naga is usable as start", () => {
    expect(assessFix(fix(80, now), now).usableAsStart).toBe(true);
  });

  it("is not usable outside Naga even when precise", () => {
    const result = assessFix(fix(5, now, PILI), now);
    expect(result.quality).toBe("precise");
    expect(result.insideCity).toBe(false);
    expect(result.usableAsStart).toBe(false);
  });

  it("coarse is not usable even inside Naga", () => {
    const result = assessFix(fix(500, now), now);
    expect(result.insideCity).toBe(true);
    expect(result.usableAsStart).toBe(false);
  });

  it("stale is not usable even when precise and inside Naga", () => {
    const result = assessFix(fix(5, now - 30_001), now);
    expect(result.stale).toBe(true);
    expect(result.usableAsStart).toBe(false);
  });
});
