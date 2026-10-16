import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { estimateOption, roundRange, type EtaEstimate, type EtaOptionInput } from "@/domain/eta/eta";
import type { PlanOption } from "@/domain/planner/plan";
import { ETA_MODEL, jeep, manila, opt, trike, walk } from "./eta-fixtures";

const OFFPEAK = manila("09:30");
const PEAK = manila("07:00");

function ok(option: EtaOptionInput, dep: Date, walkLengths: (number | null)[] = []): EtaEstimate {
  const r = estimateOption(option, walkLengths, ETA_MODEL, dep);
  if (!r.ok) throw new Error(r.reason);
  return r.estimate;
}

describe("roundRange (outward, whole minutes, never a single number)", () => {
  it("floors the low end and ceils the high end", () => {
    expect(roundRange(14.16, 17.7)).toEqual({ lowMin: 14, highMin: 18 });
    expect(roundRange(12, 18)).toEqual({ lowMin: 12, highMin: 18 });
  });
  it("minimum 1 and the high end above the low end", () => {
    expect(roundRange(0.1, 0.2)).toEqual({ lowMin: 1, highMin: 2 });
    expect(roundRange(5, 5)).toEqual({ lowMin: 5, highMin: 6 });
  });
});

describe("estimateOption", () => {
  it("walk (D8): d / 4.238 km/h to × 1.25, on the graph path when there is one", () => {
    const e = ok(opt(walk(1300)), OFFPEAK, [1000]);
    expect(e.legs[0]).toMatchObject({ kind: "walk", meters: 1000, basis: "graph_path", band: null, estimated: true, lowMin: 14, highMin: 18 });
    expect(e.total).toMatchObject({ lowMin: 14, highMin: 18, rides: 0, waitUnknown: false, peak: false, band: null, partial: false, walkOnly: true });
  });

  it("walk without a graph path uses the × 1.3 estimate, labelled so", () => {
    const e = ok(opt(walk(1000)), OFFPEAK);
    expect(e.legs[0]).toMatchObject({ meters: 1000, basis: "straight_x1_3" });
    expect(ok(opt(walk(1000)), OFFPEAK, [null]).legs[0]!.basis).toBe("straight_x1_3");
  });

  it("jeepney off-peak 10–15 km/h: 3 km → 12–18 min, waiting unknown", () => {
    const e = ok(opt(jeep(3000)), OFFPEAK);
    expect(e.legs[0]).toMatchObject({ kind: "ride", basis: "approximate_path", band: "offpeak", estimated: true, lowMin: 12, highMin: 18 });
    expect(e.total).toMatchObject({ lowMin: 12, highMin: 18, rides: 1, waitUnknown: true, peak: false, band: "offpeak", peakWindows: [], walkOnly: false });
  });

  it("jeepney peak 7–13 km/h: 3 km at 07:00 → 13–26 min, with the window used", () => {
    const e = ok(opt(jeep(3000, "stop_to_stop_straight_line")), PEAK);
    expect(e.legs[0]).toMatchObject({ basis: "stop_to_stop", band: "peak", lowMin: 13, highMin: 26 });
    expect(e.total).toMatchObject({ peak: true, band: "peak", peakWindows: [{ start: "06:00", end: "08:00" }] });
  });

  it("D9 two passes: 10:50 with a 15 min off-peak high end overlaps 11:00 → every ride leg in the peak band", () => {
    // 2.5 km off-peak high = 15 min → [10:50, 11:05] overlaps 11:00.
    const e = ok(opt(jeep(2500)), manila("10:50"));
    expect(e.total.peak).toBe(true);
    expect(e.legs.every((l) => l.band === "peak")).toBe(true);
    expect(e.total.peakWindows).toEqual([{ start: "11:00", end: "13:00" }]);
    // The first leg alone would end before 11:00; the whole trip decides the band (conservative).
    const two = ok(opt(jeep(1000), jeep(1500)), manila("10:50"));
    expect(two.legs.map((l) => l.band)).toEqual(["peak", "peak"]);
  });

  it("09:30 with a 20 min high end stays off-peak (the trip ends before 11:00)", () => {
    const e = ok(opt(walk(100), jeep(3000)), OFFPEAK);
    expect(e.total.highMin).toBe(20);
    expect(e.total.peak).toBe(false);
  });

  it("walk legs never take the peak band", () => {
    const e = ok(opt(walk(300), jeep(3000), walk(200)), PEAK);
    expect(e.legs.map((l) => l.band)).toEqual([null, "peak", null]);
    const w = ok(opt(walk(300)), PEAK);
    expect(w.total).toMatchObject({ peak: false, band: null });
  });

  it("a tricycle leg is not estimated and marks the total partial", () => {
    const e = ok(opt(walk(300), trike(1500), jeep(3000)), OFFPEAK);
    expect(e.legs[1]).toMatchObject({ kind: "ride", mode: "tricycle", estimated: false, lowMin: null, highMin: null, band: null });
    expect(e.total).toMatchObject({ partial: true, rides: 2, waitUnknown: true });
    // The total covers the estimated legs only.
    const known = ok(opt(walk(300), jeep(3000)), OFFPEAK);
    expect([e.total.lowMin, e.total.highMin]).toEqual([known.total.lowMin, known.total.highMin]);
  });

  it("an option of tricycle legs only has no total range", () => {
    const e = ok(opt(trike(1500)), OFFPEAK);
    expect(e.total).toMatchObject({ lowMin: null, highMin: null, partial: true });
  });

  it("waiting is never folded into the range: the total is the sum of the leg ranges", () => {
    const e = ok(opt(walk(200), jeep(2500), walk(150), jeep(3000), walk(300)), OFFPEAK);
    const sumLow = e.legs.reduce((s, l) => s + (l.rawLowMin ?? 0), 0);
    const sumHigh = e.legs.reduce((s, l) => s + (l.rawHighMin ?? 0), 0);
    expect(e.total.rawLowMin).toBeCloseTo(sumLow, 9);
    expect(e.total.rawHighMin).toBeCloseTo(sumHigh, 9);
    expect(e.total).toMatchObject({ rides: 2, waitUnknown: true });
  });

  it("the total equals the sum of the displayed leg ranges", () => {
    const e = ok(opt(walk(200), jeep(2500), walk(150), jeep(3000), walk(300)), OFFPEAK);
    expect(e.legs.map((l) => [l.lowMin, l.highMin])).toEqual([[2, 4], [10, 15], [2, 3], [12, 18], [4, 6]]);
    expect([e.total.lowMin, e.total.highMin]).toEqual([30, 46]);
  });

  it("carries the basis rows from the model", () => {
    const e = ok(opt(jeep(3000)), OFFPEAK);
    expect(e.basis.map((b) => b.key)).toEqual(["walk", "jeepney_offpeak", "jeepney_peak", "peak_windows", "waiting", "traffic"]);
  });

  describe("no estimate, with a reason — never a guess", () => {
    it("an old snapshot without the model", () => {
      expect(estimateOption(opt(walk(500)), [], null, OFFPEAK)).toEqual({ ok: false, reason: "no_model" });
      expect(estimateOption(opt(walk(500)), [], undefined, OFFPEAK)).toEqual({ ok: false, reason: "no_model" });
    });
    it("a model missing a parameter", () => {
      const m = { ...ETA_MODEL, params: ETA_MODEL.params.filter((p) => p.key !== "peak_windows") };
      expect(estimateOption(opt(walk(500)), [], m, OFFPEAK)).toEqual({ ok: false, reason: "invalid_model" });
    });
    it("a peak band faster than off-peak", () => {
      const m = { ...ETA_MODEL, params: ETA_MODEL.params.map((p) => (p.key === "jeepney_speed_peak_kmh" ? { ...p, low: 11, high: 16 } : p)) };
      expect(estimateOption(opt(walk(500)), [], m, OFFPEAK)).toEqual({ ok: false, reason: "invalid_model" });
    });
    it("a slowdown factor below 1", () => {
      const m = { ...ETA_MODEL, params: ETA_MODEL.params.map((p) => (p.key === "walk_slowdown_factor" ? { ...p, high: 0.8, low: 0.5 } : p)) };
      expect(estimateOption(opt(walk(500)), [], m, OFFPEAK)).toEqual({ ok: false, reason: "invalid_model" });
    });
    it("an invalid departure", () => {
      expect(estimateOption(opt(walk(500)), [], ETA_MODEL, new Date(Number.NaN))).toEqual({ ok: false, reason: "invalid_departure" });
    });
    it("a leg distance that is negative or not finite", () => {
      expect(estimateOption(opt(jeep(Number.NaN)), [], ETA_MODEL, OFFPEAK)).toEqual({ ok: false, reason: "invalid_leg" });
      expect(estimateOption(opt(walk(-1)), [], ETA_MODEL, OFFPEAK)).toEqual({ ok: false, reason: "invalid_leg" });
      expect(estimateOption(opt(walk(100)), [Number.POSITIVE_INFINITY], ETA_MODEL, OFFPEAK)).toEqual({ ok: false, reason: "invalid_leg" });
    });
    it("an empty option", () => {
      expect(estimateOption(opt(), [], ETA_MODEL, OFFPEAK)).toEqual({ ok: false, reason: "invalid_leg" });
    });
  });
});

// ---- properties (fixed seeds) ----

const meters = fc.integer({ min: 0, max: 40_000 });
const legArb = fc.oneof(
  { arbitrary: meters.map(walk), weight: 3 },
  { arbitrary: meters.map((m) => jeep(m)), weight: 3 },
  { arbitrary: meters.map(trike), weight: 1 },
);
const optionArb = fc.array(legArb, { minLength: 1, maxLength: 6 }).map((legs) => opt(...legs));
const depArb = fc.integer({ min: 0, max: 4 * 365 * 24 * 60 }).map((m) => new Date(Date.UTC(2025, 0, 1) + m * 60_000));

describe("properties (fixed seeds)", () => {
  it("min < max (never a single number), ≥ 1, whole minutes, no NaN — every leg and the total", () => {
    fc.assert(
      fc.property(optionArb, depArb, (o, dep) => {
        const e = ok(o, dep);
        const ranges = [...e.legs.filter((l) => l.estimated), ...(e.total.lowMin === null ? [] : [e.total])];
        const est = e.legs.filter((l) => l.estimated);
        const sums = e.total.lowMin === null || (e.total.lowMin === est.reduce((a, l) => a + l.lowMin!, 0) && e.total.highMin === est.reduce((a, l) => a + l.highMin!, 0));
        return sums && ranges.every((r) => Number.isInteger(r.lowMin) && Number.isInteger(r.highMin) && r.lowMin! >= 1 && r.lowMin! < r.highMin!);
      }),
      { seed: 9001, numRuns: 1000 },
    );
  });

  it("monotonic in distance: a longer leg never gives fewer minutes (same band)", () => {
    fc.assert(
      fc.property(fc.constantFrom("walk", "jeep"), meters, meters, depArb, (kind, a, b, dep) => {
        const mk = (m: number) => (kind === "walk" ? walk(m) : jeep(m));
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const x = ok(opt(mk(lo)), dep).legs[0]!;
        const y = ok(opt(mk(hi)), dep).legs[0]!;
        if (x.band !== y.band) return y.band === "peak"; // only a longer trip can reach a window
        return x.lowMin! <= y.lowMin! && x.highMin! <= y.highMin!;
      }),
      { seed: 9002, numRuns: 1000 },
    );
  });

  it("peak ≥ off-peak, leg by leg and in total", () => {
    fc.assert(
      fc.property(optionArb, (o) => {
        const off = ok(o, manila("09:00"));
        const peak = ok(o, manila("07:00"));
        if (off.total.peak) return true; // a very long trip from 09:00 reaches 11:00
        const legsOk = off.legs.every((l, i) => !l.estimated || (peak.legs[i]!.lowMin! >= l.lowMin! && peak.legs[i]!.highMin! >= l.highMin!));
        const totalOk = off.total.lowMin === null || (peak.total.lowMin! >= off.total.lowMin && peak.total.highMin! >= off.total.highMin!);
        return legsOk && totalOk;
      }),
      { seed: 9004, numRuns: 1000 },
    );
  });

  it("waiting stays unknown and outside the range whenever there is a ride", () => {
    fc.assert(
      fc.property(optionArb, depArb, (o, dep) => {
        const e = ok(o, dep);
        const rides = o.legs.filter((l) => l.kind === "ride").length;
        return e.total.rides === rides && e.total.waitUnknown === rides > 0 && e.total.walkOnly === (rides === 0);
      }),
      { seed: 9005, numRuns: 500 },
    );
  });

  it("Manila time comes from UTC, not the host time zone", () => {
    const o = opt(walk(400), jeep(3000));
    expect(ok(o, new Date("2026-10-16T22:50:00Z")).total.peak).toBe(true); // 06:50 Manila on the 17th
    expect(ok(o, new Date("2026-10-16T01:00:00Z")).total.peak).toBe(false); // 09:00 Manila
  });
});

describe("types", () => {
  it("a planner option is an estimate input", () => {
    const check = (o: PlanOption): EtaOptionInput => o;
    expect(typeof check).toBe("function");
  });
});
