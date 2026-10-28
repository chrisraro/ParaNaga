// Facts: the rider's observed pace (live-speed.ts) and its blend with the model's range (live-eta.ts),
// plus the Manila clock used for "arrive about". Pure.
import { describe, expect, it } from "vitest";
import { MAX_OBSERVED_WEIGHT, blendLeg } from "@/domain/eta/live-eta";
import { NO_SPEED, SPEED_ALPHA, SPEED_LIMITS, observedSpeed, speedSample, updateSpeed, type SpeedTracker } from "@/domain/eta/live-speed";
import { formatManilaClock } from "@/domain/eta/manila-time";
import type { LocationFix } from "@/domain/geo/location-fix";

const T0 = 1_000_000;
const KEY = "s:0:walk";
/** ≈ metres of latitude → degrees. */
const dLat = (m: number) => m / 111_320;
const fix = (m: number, sec: number, extra: Partial<LocationFix> = {}): LocationFix => ({ lat: 13.62 + dLat(m), lng: 123.18, accuracy: 5, timestamp: T0 + sec * 1000, ...extra });
const feed = (mode: "walk" | "ride", fixes: LocationFix[], start: SpeedTracker = NO_SPEED) => fixes.reduce((t, f) => updateSpeed(t, KEY, mode, f), start);

describe("speed samples", () => {
  it("uses the device speed when it gives one", () => {
    expect(speedSample(null, fix(0, 0, { speed: 1.4 }))).toBe(1.4);
  });

  it("derives a speed from two fixes", () => {
    const a = fix(0, 0);
    expect(speedSample({ lat: a.lat, lng: a.lng, timestamp: a.timestamp }, fix(14, 10))).toBeCloseTo(1.4, 1);
  });

  it("gives none for a poor fix, a gap that is too short or too long, or movement within the fix's noise", () => {
    const a = fix(0, 0);
    const last = { lat: a.lat, lng: a.lng, timestamp: a.timestamp };
    expect(speedSample(last, fix(14, 10, { accuracy: 80 }))).toBeNull();
    expect(speedSample(last, fix(14, 1))).toBeNull();
    expect(speedSample(last, fix(14, 45))).toBeNull();
    expect(speedSample(last, fix(3, 10, { accuracy: 8 }))).toBeNull();
    expect(speedSample(null, fix(14, 10))).toBeNull();
  });
});

describe("the moving average", () => {
  it("ignores stationary samples (a red light is not the pace of the leg)", () => {
    const t = feed("ride", [fix(0, 0, { speed: 0.2 }), fix(0, 5, { speed: 0 }), fix(0, 10, { speed: 0.5 })]);
    expect(t.samples).toBe(0);
    expect(t.emaMps).toBeNull();
  });

  it("clamps a GPS spike to what the mode can do", () => {
    const walk = feed("walk", [fix(0, 0, { speed: 30 })]);
    expect(walk.emaMps).toBe(SPEED_LIMITS.walk.max);
    const ride = feed("ride", [fix(0, 0, { speed: 80 })]);
    expect(ride.emaMps).toBe(SPEED_LIMITS.ride.max);
  });

  it("folds samples in with the smoothing factor", () => {
    const t = feed("walk", [fix(0, 0, { speed: 1 }), fix(5, 5, { speed: 2 })]);
    expect(t.samples).toBe(2);
    expect(t.emaMps).toBeCloseTo(1 + SPEED_ALPHA * (2 - 1), 10);
  });

  it("is used only after three samples", () => {
    const two = feed("walk", [fix(0, 0, { speed: 1.4 }), fix(7, 5, { speed: 1.4 })]);
    expect(observedSpeed(two)).toBeNull();
    const three = feed("walk", [fix(0, 0, { speed: 1.4 }), fix(7, 5, { speed: 1.4 }), fix(14, 10, { speed: 1.4 })]);
    expect(observedSpeed(three)).toEqual({ mps: 1.4, samples: 3 });
  });

  it("skips poor-accuracy fixes entirely and ignores out-of-order ones", () => {
    const t = feed("walk", [fix(0, 0, { speed: 1.4 }), fix(7, 5, { speed: 9, accuracy: 120 })]);
    expect(t.samples).toBe(1);
    const late = updateSpeed(t, KEY, "walk", fix(7, -5, { speed: 1.4 }));
    expect(late).toBe(t);
  });

  it("starts over when the step (the key) changes", () => {
    const t = feed("walk", [fix(0, 0, { speed: 1.4 }), fix(7, 5, { speed: 1.4 })]);
    const next = updateSpeed(t, "s:1:ride", "ride", fix(30, 10, { speed: 6 }));
    expect(next.key).toBe("s:1:ride");
    expect(next.samples).toBe(1);
    expect(next.emaMps).toBe(6);
  });
});

describe("blendLeg", () => {
  const model = { lowMin: 6, highMin: 9 };

  it("is the model alone without an observed pace, or with nothing left to cover", () => {
    expect(blendLeg(model, 500, null, "walk")).toEqual({ ...model, weight: 0 });
    expect(blendLeg(model, 0, { mps: 1.4, samples: 10 }, "walk")).toEqual({ ...model, weight: 0 });
    expect(blendLeg(model, 500, { mps: 1.4, samples: 2 }, "walk").weight).toBe(0);
  });

  it("a brisk walker shortens the range, a slow one lengthens it, always a range", () => {
    const fast = blendLeg(model, 500, { mps: 1.9, samples: 12 }, "walk");
    const slow = blendLeg(model, 500, { mps: 0.8, samples: 12 }, "walk");
    expect(fast.highMin).toBeLessThan(model.highMin);
    expect(slow.highMin).toBeGreaterThan(model.highMin);
    for (const b of [fast, slow]) expect(b.highMin).toBeGreaterThan(b.lowMin);
  });

  it("the weight grows with the samples and stops at the cap (a ride trusts the pace less)", () => {
    const few = blendLeg(model, 500, { mps: 1.4, samples: 4 }, "walk").weight;
    const many = blendLeg(model, 500, { mps: 1.4, samples: 40 }, "walk").weight;
    expect(few).toBeGreaterThan(0);
    expect(few).toBeLessThan(many);
    expect(many).toBe(MAX_OBSERVED_WEIGHT.walk);
    expect(blendLeg({ lowMin: 3, highMin: 6 }, 1000, { mps: 5, samples: 40 }, "ride").weight).toBe(MAX_OBSERVED_WEIGHT.ride);
  });

  it("keeps the observed minutes within bounds of the model range", () => {
    const crawl = blendLeg(model, 500, { mps: 0.01, samples: 40 }, "walk");
    expect(crawl.highMin).toBeLessThan(model.highMin * 2.5 * 1.2 + 1);
    const warp = blendLeg(model, 500, { mps: 500, samples: 40 }, "walk");
    expect(warp.lowMin).toBeGreaterThan(model.lowMin * 0.3 * 0.5);
  });
});

describe("formatManilaClock", () => {
  it("is Asia/Manila time, 12-hour, whatever the host zone", () => {
    expect(formatManilaClock(Date.UTC(2026, 9, 29, 7, 5))).toBe("3:05 PM");
    expect(formatManilaClock(Date.UTC(2026, 9, 29, 16, 0))).toBe("12:00 AM");
    expect(formatManilaClock(Date.UTC(2026, 9, 29, 4, 30))).toBe("12:30 PM");
    expect(formatManilaClock(Date.UTC(2026, 9, 29, 0, 9))).toBe("8:09 AM");
  });
});
