import { describe, expect, it } from "vitest";
import { RUBBER_BAND_D, nearestDetent, rubberBand, settleDuration, smoothVelocity, stretchedOffset } from "@/ui/app-shell/sheet-physics";

describe("rubberBand", () => {
  it("is 0 at 0, rises monotonically and never reaches D", () => {
    expect(rubberBand(0)).toBe(0);
    let prev = 0;
    for (const x of [10, 40, 120, 400, 4000]) {
      const y = rubberBand(x);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(RUBBER_BAND_D);
      prev = y;
    }
  });
  it("resists: the stretch is always less than the finger travel", () => {
    for (const x of [5, 30, 100, 300]) expect(rubberBand(x)).toBeLessThan(x);
  });
  it("matches (1 - 1 / (x * 0.55 / D + 1)) * D", () => {
    expect(rubberBand(120)).toBeCloseTo((1 - 1 / (0.55 + 1)) * 120, 6);
  });
});

describe("stretchedOffset", () => {
  it("passes through inside the detents and stretches past either end", () => {
    expect(stretchedOffset(300, 586)).toBe(300);
    expect(stretchedOffset(0, 586)).toBe(0);
    expect(stretchedOffset(586, 586)).toBe(586);
    expect(stretchedOffset(-80, 586)).toBeLessThan(0);
    expect(stretchedOffset(-80, 586)).toBeGreaterThan(-80);
    expect(stretchedOffset(586 + 80, 586)).toBeGreaterThan(586);
    expect(stretchedOffset(586 + 80, 586)).toBeLessThan(586 + 80);
  });
});

describe("smoothVelocity", () => {
  it("weights the newest sample 0.8 and the old average 0.2", () => {
    expect(smoothVelocity(1, 0)).toBeCloseTo(0.8, 6);
    expect(smoothVelocity(0, 2)).toBeCloseTo(0.4, 6);
  });
});

describe("nearestDetent", () => {
  const offsets: [number, number, number] = [586, 356, 0];
  it("takes the closest detent to the projected rest point", () => {
    expect(nearestDetent(offsets, 340, 0)).toBe(1);
    expect(nearestDetent(offsets, 560, 0)).toBe(0);
    expect(nearestDetent(offsets, 20, 0)).toBe(2);
  });
  it("projects the release velocity 200 ms ahead: a fast upward fling from half reaches full", () => {
    expect(nearestDetent(offsets, 356, 0)).toBe(1);
    expect(nearestDetent(offsets, 356, -1.5)).toBe(2);
    expect(nearestDetent(offsets, 356, 1.5)).toBe(0);
  });
});

describe("nearestDetent: position versus velocity at the half/full boundary", () => {
  const offsets: [number, number, number] = [586, 356, 0]; // the half-full midpoint is 178
  it("position alone decides when the release is slow", () => {
    expect(nearestDetent(offsets, 190, 0)).toBe(1);
    expect(nearestDetent(offsets, 170, 0)).toBe(2);
  });
  it("velocity alone tips the same position across the boundary", () => {
    expect(nearestDetent(offsets, 190, -0.1)).toBe(2); // 190 - 20 = 170
    expect(nearestDetent(offsets, 170, 0.1)).toBe(1); // 170 + 20 = 190
  });
});

describe("settleDuration", () => {
  it("clamps to 180..360 ms", () => {
    expect(settleDuration(0, 0)).toBe(180);
    expect(settleDuration(2000, 0)).toBe(360);
    expect(settleDuration(300, 0)).toBe(270);
  });
  it("is shorter for a faster release", () => {
    expect(settleDuration(300, 2)).toBeLessThan(settleDuration(300, 0));
    expect(settleDuration(300, -2)).toBe(settleDuration(300, 2));
  });
});
