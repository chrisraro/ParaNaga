import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { basisRows } from "@/domain/eta/basis";
import { estimateOption, type EtaEstimate, type EtaOptionInput } from "@/domain/eta/eta";
import {
  formatDuration,
  formatLeg,
  formatPeakNote,
  formatRange,
  formatRemaining,
  formatTotal,
  remainingRange,
} from "@/domain/eta/format";
import { ETA_MODEL, jeep, manila, opt, trike, walk } from "./eta-fixtures";

function est(option: EtaOptionInput, dep: Date, walkLengths: (number | null)[] = []): EtaEstimate {
  const r = estimateOption(option, walkLengths, ETA_MODEL, dep);
  if (!r.ok) throw new Error(r.reason);
  return r.estimate;
}

describe("durations", () => {
  it("minutes below 60, hours and minutes from 60", () => {
    expect(formatDuration(5)).toBe("5 min");
    expect(formatDuration(59)).toBe("59 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(65)).toBe("1 h 5 min");
    expect(formatDuration(130)).toBe("2 h 10 min");
  });
  it("ranges", () => {
    expect(formatRange(12, 18)).toBe("12–18 min");
    expect(formatRange(50, 65)).toBe("50 min–1 h 5 min");
    expect(formatRange(60, 80)).toBe("1 h–1 h 20 min");
  });
});

describe("format (exact copy)", () => {
  it("walk-only total: no waiting text", () => {
    const e = est(opt(walk(1000)), manila("09:30"));
    expect(formatTotal(e.total)).toBe("Estimate 14–18 min walk");
    expect(formatTotal(e.total)).not.toMatch(/waiting/);
  });

  it("a total with rides adds waiting (unknown)", () => {
    const e = est(opt(jeep(3000)), manila("09:30"));
    expect(formatTotal(e.total)).toBe("Estimate 12–18 min + waiting (unknown)");
  });

  it("several rides: the waiting text gives the ride count", () => {
    const e = est(opt(walk(200), jeep(2500), walk(150), jeep(3000), walk(300)), manila("14:00"));
    expect(formatTotal(e.total)).toBe("Estimate 30–46 min + waiting (unknown, 2 rides)");
    expect(formatTotal(est(opt(walk(200), jeep(2500), walk(150), jeep(3000), walk(300)), manila("17:00")).total)).toBe(
      "Estimate 32 min–1 h 1 min + waiting (unknown, 2 rides)",
    );
  });

  it("a partial total says tricycle time is not estimated", () => {
    const e = est(opt(walk(300), trike(1500), jeep(3000)), manila("09:30"));
    expect(formatTotal(e.total)).toMatch(/^Estimate \d+–\d+ min \+ waiting \(unknown, 2 rides\) · tricycle time not estimated$/);
    expect(formatTotal(est(opt(trike(1500)), manila("09:30")).total)).toBe("Tricycle time not estimated + waiting (unknown)");
  });

  it("a 90 min high end from 09:30 reaches 11:00, so the trip takes the peak band", () => {
    expect(est(opt(jeep(15_000)), manila("09:30")).total.peak).toBe(true);
  });

  it("hours from 60 min", () => {
    const e = est(opt(jeep(15_000)), manila("20:00"));
    expect(formatTotal(e.total)).toBe("Estimate 1 h–1 h 30 min + waiting (unknown)");
  });

  it("peak note names the window(s) used; none off-peak", () => {
    expect(formatPeakNote(est(opt(jeep(3000)), manila("07:00")).total)).toBe("Peak hours · slower estimate (06:00–08:00)");
    expect(formatPeakNote(est(opt(jeep(3000)), manila("09:30")).total)).toBeNull();
  });

  it("per leg", () => {
    const e = est(opt(walk(1000), jeep(3000), trike(800)), manila("09:30"));
    expect(formatLeg(e.legs[0]!)).toBe("≈ 14–18 min walk");
    expect(formatLeg(e.legs[1]!)).toBe("≈ 12–18 min ride");
    expect(formatLeg(e.legs[2]!)).toBe("Tricycle time not estimated");
  });

  it("guidance remaining", () => {
    expect(formatRemaining({ lowMin: 10, highMin: 16 }, "trip")).toBe("About 10–16 min left (estimate)");
    expect(formatRemaining({ lowMin: 10, highMin: 16 }, "riding")).toBe("About 10–16 min of riding left (estimate)");
  });

  it("remainingRange sums the displayed leg ranges from an index (rides only for riding)", () => {
    const e = est(opt(walk(1000), jeep(3000), walk(500)), manila("09:30"));
    expect(remainingRange(e, 1, "riding")).toEqual({ lowMin: 12, highMin: 18 });
    const rest = remainingRange(e, 1, "trip")!;
    expect(rest).toEqual({ lowMin: e.legs[1]!.lowMin! + e.legs[2]!.lowMin!, highMin: e.legs[1]!.highMin! + e.legs[2]!.highMin! });
    expect(remainingRange(e, 3, "trip")).toBeNull();
    expect(remainingRange(e, 2, "riding")).toBeNull();
  });
});

describe("basis rows (exact copy from the model)", () => {
  it("the six rows", () => {
    expect(basisRows(ETA_MODEL).map((r) => r.text)).toEqual([
      "Walking: 4.24 km/h (Tolentino & Sigua 2022, N28); up to 25% slower for crossings (ParaNaga assumption)",
      "Jeepney off-peak: 10–15 km/h (SafeTravelPH 2025, N16; Puerto Princesa study 2025, N29)",
      "Jeepney peak: 7–13 km/h (upper from N29; lower is a ParaNaga assumption)",
      "Peak windows: 06:00–08:00, 11:00–13:00, 16:00–19:00 (Ordinance 2025-110, N04), applied every day (no day-of-week data)",
      "Waiting: unknown — no published schedules or headways for Naga",
      "Based on typical speeds. ParaNaga uses no traffic service.",
    ]);
  });

  it("records the sources and the assumption notes", () => {
    const rows = basisRows(ETA_MODEL);
    expect(rows.find((r) => r.key === "jeepney_peak")).toMatchObject({ sourceCodes: ["N29"], assumptions: [expect.stringMatching(/^A2:/)] });
    expect(rows.find((r) => r.key === "walk")).toMatchObject({ sourceCodes: ["N28"], assumptions: [expect.stringMatching(/^A1:/)] });
    expect(rows.find((r) => r.key === "jeepney_offpeak")).toMatchObject({ sourceCodes: ["N16", "N29"], assumptions: [] });
  });

  it("follows the model's values", () => {
    const m = { ...ETA_MODEL, params: ETA_MODEL.params.map((p) => (p.key === "jeepney_speed_offpeak_kmh" ? { ...p, low: 9.5, high: 14 } : p)) };
    expect(basisRows(m)[1]!.text).toBe("Jeepney off-peak: 9.5–14 km/h (SafeTravelPH 2025, N16; Puerto Princesa study 2025, N29)");
  });
});

// ---- honesty property (fixed seed) ----

const meters = fc.integer({ min: 0, max: 60_000 });
const legArb = fc.oneof(meters.map(walk), meters.map((m) => jeep(m)), meters.map(trike));
const optionArb = fc.array(legArb, { minLength: 1, maxLength: 6 }).map((legs) => opt(...legs));
const depArb = fc.integer({ min: 0, max: 2 * 365 * 24 * 60 }).map((m) => new Date(Date.UTC(2026, 0, 1) + m * 60_000));
const walkLengthsArb = fc.array(fc.option(meters, { nil: null }), { maxLength: 6 });

describe("honesty (property)", () => {
  it("formatted strings never say arriv…, ETA, live, a clock time (outside the peak note) or a bare number of minutes", () => {
    fc.assert(
      fc.property(optionArb, depArb, walkLengthsArb, (o, dep, wl) => {
        const e = est(o, dep, wl);
        const timed = [formatTotal(e.total), ...e.legs.map(formatLeg)];
        const rem = remainingRange(e, 0, "trip");
        if (rem) timed.push(formatRemaining(rem, "trip"), formatRemaining(rem, "riding"));
        const note = formatPeakNote(e.total);
        const all = [...timed, ...(note ? [note] : []), ...e.basis.map((b) => b.text)];
        return (
          all.every((t) => !/arriv/i.test(t) && !/\bETA\b/.test(t) && !/\blive\b/i.test(t)) &&
          timed.every((t) => !/\d{1,2}:\d{2}/.test(t)) &&
          timed.every((t) => /^(Estimate|≈|About|Tricycle time not estimated)/.test(t) || !/\d\s*(h|min)\b/.test(t)) &&
          timed.every((t) => !/NaN|undefined|null/.test(t))
        );
      }),
      { seed: 2027, numRuns: 1000 },
    );
  });
});
