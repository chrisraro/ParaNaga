// N4 / AC-6: effective dates, discount scope, unknown-fare handling, cheapest ranking. Money is integer centavos.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FareRuleEstimate } from "@/domain/api/schemas";
import {
  byCheapest, discountedFare, legFareEstimate, manilaDate, rulesInForce, sumFares, type DiscountRule, type FareCategory, type FareFleet,
} from "@/domain/planner/fares";
import { planTrip } from "@/domain/planner/plan";
import { at, fareRule, SYNTHETIC_FARE_RULES } from "../fixtures/synthetic/planner-network";
import { manila, streetSnapshot, syntheticLines, syntheticStreets } from "../fixtures/synthetic/planner-streets";

const dated = (code: string, base: number, from: string | null): FareRuleEstimate => ({ ...fareRule(code, base, 200), effectiveFrom: from });

describe("rulesInForce (effective dates)", () => {
  const rows = [dated("F01", 1200, "2020-01-01"), dated("F01", 1400, "2026-09-28"), dated("F01", 1600, "2027-01-01"), dated("F02", 1700, null)];

  it("a row applies only from its effective date; the newest applicable row wins", () => {
    const pick = (on: string) => rulesInForce(rows, on).find((r) => r.code === "F01")?.baseCentavos;
    expect(pick("2019-12-31")).toBeUndefined();
    expect(pick("2020-01-01")).toBe(1200);
    expect(pick("2026-09-27")).toBe(1200);
    expect(pick("2026-09-28")).toBe(1400);
    expect(pick("2026-12-31")).toBe(1400);
    expect(pick("2027-01-01")).toBe(1600);
  });

  it("a row with no effective date always applies, and loses to any dated row in force", () => {
    expect(rulesInForce(rows, "2019-01-01").map((r) => r.code)).toEqual(["F02"]);
    expect(rulesInForce([dated("F01", 1000, null), dated("F01", 1100, "2020-01-01")], "2026-01-01")[0]!.baseCentavos).toBe(1100);
  });

  it("is independent of row order", () => {
    fc.assert(fc.property(fc.shuffledSubarray(rows, { minLength: rows.length }), fc.constantFrom("2019-01-01", "2026-10-01", "2027-06-01"), (shuffled, on) => {
      const key = (rs: FareRuleEstimate[]) => rs.map((r) => `${r.code}:${r.baseCentavos}`).sort();
      expect(key(rulesInForce(shuffled, on))).toEqual(key(rulesInForce(rows, on)));
    }));
  });

  it("manilaDate reads the Manila calendar day (UTC+8)", () => {
    expect(manilaDate(new Date("2026-10-16T16:30:00Z"))).toBe("2026-10-17");
    expect(manilaDate(new Date("2026-10-16T15:59:00Z"))).toBe("2026-10-16");
  });

  it("planTrip prices from the rows in force on its date; a not-yet-effective rule leaves the fare unknown, never 0", () => {
    const o = at(2100, 200);
    const d = at(3900, 250);
    const future = { ...streetSnapshot(), fareRules: streetSnapshot().fareRules.map((r) => (r.code.startsWith("F0") && r.code <= "F02" ? { ...r, effectiveFrom: "2030-01-01" } : r)) };
    const net = { lines: syntheticLines(), streets: syntheticStreets() };
    const jeep = (s: typeof future) => planTrip(s, net, o, d, { now: manila(10) }).options.find((x) => x.mode === "jeepney")!;
    expect(jeep(streetSnapshot()).fare.status).toBe("estimate");
    expect(jeep(future).fare).toMatchObject({ status: "unavailable", minCentavos: null, maxCentavos: null });
  });
});

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  category: "student", modeScope: ["traditional_jeepney"], percent: 20, fixedCentavos: null, rounding: "ceil_peso",
  effectiveFrom: "2020-01-01", effectiveTo: null, ...over,
});
const ON = "2026-10-22";

describe("discountedFare (scope per mode, rounding, effective dates)", () => {
  it("applies a percent discount to the listed mode only, in integer centavos", () => {
    expect(discountedFare(1400, "student", "traditional_jeepney", [rule()], ON)).toEqual({ centavos: 1200, applied: true, reason: null });
    expect(discountedFare(1400, "student", "padyak", [rule()], ON)).toEqual({ centavos: 1400, applied: false, reason: "out_of_scope" });
  });

  it("scope is exact per category: solo parent never inherits a student/senior/PWD scope", () => {
    const rules = [rule({ category: "student" }), rule({ category: "senior" }), rule({ category: "pwd" })];
    expect(discountedFare(1400, "solo_parent", "traditional_jeepney", rules, ON)).toMatchObject({ centavos: 1400, applied: false, reason: "no_rule" });
    expect(discountedFare(1400, "senior", "traditional_jeepney", rules, ON)).toMatchObject({ applied: true });
  });

  it("the regular category is never discounted", () => {
    expect(discountedFare(1400, "regular", "traditional_jeepney", [rule()], ON)).toMatchObject({ centavos: 1400, applied: false });
  });

  it("an unset rounding is never assumed: the regular fare stands", () => {
    expect(discountedFare(1400, "student", "traditional_jeepney", [rule({ rounding: null })], ON)).toMatchObject({ centavos: 1400, applied: false, reason: "no_rounding" });
  });

  it("a rule applies only inside its effective interval; the newest in-force rule wins", () => {
    expect(discountedFare(1400, "student", "traditional_jeepney", [rule({ effectiveFrom: "2027-01-01" })], ON).reason).toBe("not_in_force");
    expect(discountedFare(1400, "student", "traditional_jeepney", [rule({ effectiveTo: ON })], ON).reason).toBe("not_in_force");
    const older = rule({ percent: 10, effectiveFrom: "2020-01-01" });
    const newer = rule({ percent: 50, effectiveFrom: "2026-01-01", rounding: "none" });
    expect(discountedFare(1400, "student", "traditional_jeepney", [older, newer], ON).centavos).toBe(700);
  });

  it("unknown stays unknown (never 0)", () => {
    expect(discountedFare(null, "student", "traditional_jeepney", [rule()], ON)).toEqual({ centavos: null, applied: false, reason: "unknown_fare" });
  });

  it("property: a discount never increases a fare, and never goes below 0", () => {
    const rounding = fc.constantFrom("none", "nearest_25c", "nearest_peso", "ceil_peso", null);
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100_000 }), fc.constantFrom<FareCategory>("student", "senior", "pwd", "solo_parent", "regular"),
      fc.integer({ min: 0, max: 100 }), fc.option(fc.integer({ min: 0, max: 200_000 }), { nil: null }), rounding,
      (regular, category, percent, fixed, r) => {
        const out = discountedFare(regular, category, "traditional_jeepney", [rule({ category, percent: fixed === null ? percent : null, fixedCentavos: fixed, rounding: r })], ON);
        expect(out.centavos).toBeGreaterThanOrEqual(0);
        expect(out.centavos).toBeLessThanOrEqual(regular);
        expect(Number.isInteger(out.centavos)).toBe(true);
      },
    ));
  });
});

describe("leg fare properties (AC-6)", () => {
  const fleets: (FareFleet | undefined)[] = [
    undefined,
    { classes: "traditional", reports: [] },
    { classes: "modern", reports: [] },
    { classes: "traditional_and_modern", reports: [] },
  ];

  it("monotonic in distance: a longer ride never costs less (min and max), integer centavos", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 40_000 }), fc.integer({ min: 0, max: 40_000 }), fc.constantFrom(...fleets), (a, b, fleet) => {
      const [short, long] = a <= b ? [a, b] : [b, a];
      const s = legFareEstimate(short, SYNTHETIC_FARE_RULES, fleet);
      const l = legFareEstimate(long, SYNTHETIC_FARE_RULES, fleet);
      expect(l.minCentavos!).toBeGreaterThanOrEqual(s.minCentavos!);
      expect(l.maxCentavos!).toBeGreaterThanOrEqual(s.maxCentavos!);
      expect(s.maxCentavos!).toBeGreaterThanOrEqual(s.minCentavos!);
      expect(Number.isInteger(l.minCentavos) && Number.isInteger(l.maxCentavos)).toBe(true);
    }));
  });

  it("unknown stays unknown: a missing rule gives null amounts, and one unknown leg makes the trip unknown", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 40_000 }), fc.constantFrom(...fleets), (m, fleet) => {
      const none = legFareEstimate(m, [], fleet);
      expect(none).toMatchObject({ minCentavos: null, maxCentavos: null, status: "unavailable" });
      const known = legFareEstimate(m, SYNTHETIC_FARE_RULES, fleet);
      const trip = sumFares([known, none, known]);
      expect(trip).toMatchObject({ minCentavos: null, maxCentavos: null, status: "unavailable" });
    }));
  });
});

describe("byCheapest (cheapest handles unknown fares)", () => {
  const opt = (min: number | null, score = 0) => ({ fare: { minCentavos: min }, score });

  it("an unknown fare ranks after every known fare, even 0, and is never read as 0", () => {
    expect([opt(null, 1), opt(0, 9), opt(1400, 5)].sort(byCheapest).map((o) => o.fare.minCentavos)).toEqual([0, 1400, null]);
  });

  it("equal fares (and two unknowns) fall back to the score", () => {
    expect([opt(1400, 9), opt(1400, 2)].sort(byCheapest).map((o) => o.score)).toEqual([2, 9]);
    expect([opt(null, 9), opt(null, 2)].sort(byCheapest).map((o) => o.score)).toEqual([2, 9]);
  });

  it("property: no unknown-fare option is ever ahead of a known-fare option", () => {
    fc.assert(fc.property(fc.array(fc.record({ fare: fc.record({ minCentavos: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }) }), score: fc.integer({ min: 0, max: 99 }) })), (xs) => {
      const sorted = [...xs].sort(byCheapest);
      const firstUnknown = sorted.findIndex((x) => x.fare.minCentavos === null);
      if (firstUnknown >= 0) expect(sorted.slice(firstUnknown).every((x) => x.fare.minCentavos === null)).toBe(true);
    }));
  });
});
