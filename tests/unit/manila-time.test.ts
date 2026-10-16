import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { clockMinutes, manilaMinutesOfDay, peakWindowsHit, inPeakWindow } from "@/domain/eta/manila-time";

const WINDOWS = [
  { start: "06:00", end: "08:00" },
  { start: "11:00", end: "13:00" },
  { start: "16:00", end: "19:00" },
];
const utc = (iso: string) => new Date(iso);

describe("manilaMinutesOfDay (fixed UTC+8, no DST, host TZ never used)", () => {
  it("maps UTC instants around midnight", () => {
    expect(manilaMinutesOfDay(utc("2026-10-16T16:00:00Z"))).toBe(0); // 00:00 Manila on the 17th
    expect(manilaMinutesOfDay(utc("2026-10-16T15:59:00Z"))).toBe(23 * 60 + 59);
    expect(manilaMinutesOfDay(utc("2026-10-16T16:30:00Z"))).toBe(30);
    expect(manilaMinutesOfDay(utc("2026-10-16T00:00:00Z"))).toBe(8 * 60);
    expect(manilaMinutesOfDay(utc("2026-10-15T23:00:00Z"))).toBe(7 * 60);
  });

  it("is DST-free: the same UTC clock time maps the same in January and July", () => {
    expect(manilaMinutesOfDay(utc("2026-01-15T22:00:00Z"))).toBe(manilaMinutesOfDay(utc("2026-07-15T22:00:00Z")));
    expect(manilaMinutesOfDay(utc("2026-03-29T01:30:00Z"))).toBe(9 * 60 + 30); // EU DST switch day
  });

  it("before 1970 (negative epoch) still lands in [0, 1440)", () => {
    expect(manilaMinutesOfDay(utc("1969-12-31T16:00:00Z"))).toBe(0);
  });

  it("property: in [0, 1440), equals (UTC minutes + 480) mod 1440, never NaN", () => {
    fc.assert(
      fc.property(fc.integer({ min: -4e12, max: 8e12 }), (ms) => {
        const d = new Date(ms);
        const m = manilaMinutesOfDay(d);
        const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
        return m >= 0 && m < 1440 && Number.isFinite(m) && Math.abs(m - ((utcMin + 480) % 1440)) < 1e-6;
      }),
      { seed: 909, numRuns: 1000 },
    );
  });

  it("refuses an invalid date", () => {
    expect(() => manilaMinutesOfDay(new Date(Number.NaN))).toThrow();
  });
});

describe("clockMinutes", () => {
  it("parses HH:MM", () => {
    expect(clockMinutes("00:00")).toBe(0);
    expect(clockMinutes("06:00")).toBe(360);
    expect(clockMinutes("23:59")).toBe(1439);
  });
});

describe("inPeakWindow (interval overlap, windows after midnight included)", () => {
  const at = (hhmm: string) => utc(`2026-10-16T${hhmm}:00+08:00`);

  it("07:00 departure is in the morning window", () => {
    expect(inPeakWindow(at("07:00"), 10, WINDOWS)).toBe(true);
    expect(peakWindowsHit(at("07:00"), 10, WINDOWS)).toEqual([{ start: "06:00", end: "08:00" }]);
  });

  it("09:30 with a 20 min high end is off-peak", () => {
    expect(inPeakWindow(at("09:30"), 20, WINDOWS)).toBe(false);
  });

  it("10:50 with a 15 min high end overlaps 11:00 → peak", () => {
    expect(inPeakWindow(at("10:50"), 15, WINDOWS)).toBe(true);
  });

  it("boundaries: ending exactly at a window start counts (conservative); starting at its end does not", () => {
    expect(inPeakWindow(at("10:45"), 15, WINDOWS)).toBe(true);
    expect(inPeakWindow(at("08:00"), 30, WINDOWS)).toBe(false);
    expect(inPeakWindow(at("06:00"), 0, WINDOWS)).toBe(true);
    expect(inPeakWindow(at("19:00"), 0, WINDOWS)).toBe(false);
  });

  it("a trip crossing midnight reaches the next day's morning window", () => {
    expect(inPeakWindow(at("23:30"), 7 * 60, WINDOWS)).toBe(true); // ends 06:30 next day
    expect(inPeakWindow(at("23:30"), 60, WINDOWS)).toBe(false);
  });

  it("a long trip can hit several windows, each listed once", () => {
    expect(peakWindowsHit(at("07:30"), 4 * 60, WINDOWS)).toEqual([WINDOWS[0], WINDOWS[1]]);
  });

  it("property: agrees with a minute-by-minute scan", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 0, max: 600 }), (dep, dur) => {
        const d = new Date(Date.UTC(2026, 9, 16, 0, 0) - 480 * 60_000 + dep * 60_000);
        let scan = false;
        for (let t = dep; t <= dep + dur; t++) {
          const m = t % 1440;
          if (WINDOWS.some((w) => m >= clockMinutes(w.start) && m < clockMinutes(w.end))) scan = true;
        }
        return inPeakWindow(d, dur, WINDOWS) === scan;
      }),
      { seed: 4242, numRuns: 1000 },
    );
  });
});
