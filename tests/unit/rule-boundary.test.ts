import { describe, expect, it } from "vitest";
import { msUntilNextRuleBoundary } from "@/domain/walk/rules";

const night = { liftedFrom: "21:00", liftedTo: "05:00" };
/** Manila is UTC+8: "HH:MM" Manila on 2026-10-29. */
const at = (hhmm: string, sec = 0) => new Date(`2026-10-29T${hhmm}:${String(sec).padStart(2, "0")}+08:00`);

describe("msUntilNextRuleBoundary", () => {
  it("counts to the evening lift at 21:00", () => {
    expect(msUntilNextRuleBoundary([night], at("20:30"))).toBe(30 * 60_000 + 1_000);
  });
  it("counts to the morning restriction at 05:00, across midnight", () => {
    expect(msUntilNextRuleBoundary([night], at("23:00"))).toBe(6 * 60 * 60_000 + 1_000);
  });
  it("subtracts the seconds already past the minute", () => {
    expect(msUntilNextRuleBoundary([night], at("20:59", 30))).toBe(31_000);
  });
  it("at the boundary minute itself waits a full day for the next one of that rule", () => {
    expect(msUntilNextRuleBoundary([night], at("05:00"))).toBe(16 * 60 * 60_000 + 1_000);
  });
  it("is null when no rule has hours (an all-day ban)", () => {
    expect(msUntilNextRuleBoundary([{ liftedFrom: null, liftedTo: null }], at("12:00"))).toBeNull();
  });
});
