import { describe, expect, it } from "vitest";
import { legFareEstimate, sumFares } from "@/domain/planner/fares";
import { SYNTHETIC_FARE_RULES, fareRule } from "../fixtures/synthetic/planner-network";

const rules = SYNTHETIC_FARE_RULES;

describe("legFareEstimate (F01 min, F02 max, whole pesos)", () => {
  it("3.2 km → ₱14–₱17", () => {
    expect(legFareEstimate(3200, rules)).toMatchObject({ minCentavos: 1400, maxCentavos: 1700, status: "estimate" });
  });

  it("6.0 km → ₱18–₱22 (F02 2180 rounded up)", () => {
    expect(legFareEstimate(6000, rules)).toMatchObject({ minCentavos: 1800, maxCentavos: 2200 });
  });

  it("exactly the base distance adds nothing; 1 m over floors/ceils the extra km apart", () => {
    expect(legFareEstimate(4000, rules)).toMatchObject({ minCentavos: 1400, maxCentavos: 1700 });
    // min: floor(0.001) = 0 km extra → 1400; max: ceil(0.001) = 1 km → 1940 → ₱20
    expect(legFareEstimate(4001, rules)).toMatchObject({ minCentavos: 1400, maxCentavos: 2000 });
    // 5.5 km: min 1400 + 1×200 = 1600; max 1700 + 2×240 = 2180 → 2200
    expect(legFareEstimate(5500, rules)).toMatchObject({ minCentavos: 1600, maxCentavos: 2200 });
  });

  it("is always an approximate estimate with discounts not applied", () => {
    const f = legFareEstimate(1000, rules);
    expect(f).toMatchObject({ completeness: "estimate", approximate: true, discountsApplied: false, ruleCodes: ["F01", "F02"] });
  });

  it("rounds a non-whole-peso minimum down and maximum up", () => {
    const odd = [fareRule("F01", 1450, 200), fareRule("F02", 1710, 240)];
    expect(legFareEstimate(1000, odd)).toMatchObject({ minCentavos: 1400, maxCentavos: 1800 });
  });

  it("is unavailable (null amounts) when F01 or F02 is missing or incomplete — never hard-coded", () => {
    for (const r of [[rules[0]!], [rules[1]!], [], [rules[0]!, { ...rules[1]!, incrementCentavosPerKm: null }], [{ ...rules[0]!, baseKm: null }, rules[1]!]]) {
      expect(legFareEstimate(3000, r)).toMatchObject({ minCentavos: null, maxCentavos: null, status: "unavailable" });
    }
  });
});

describe("sumFares", () => {
  it("sums per-leg ranges", () => {
    expect(sumFares([legFareEstimate(3200, rules), legFareEstimate(6000, rules)])).toEqual({
      minCentavos: 3200, maxCentavos: 3900, status: "estimate", completeness: "estimate",
    });
  });

  it("is unavailable if any leg is", () => {
    expect(sumFares([legFareEstimate(3200, rules), legFareEstimate(3200, [])])).toEqual({
      minCentavos: null, maxCentavos: null, status: "unavailable", completeness: "estimate",
    });
  });

  it("is no_ride (0) for a walk-only trip", () => {
    expect(sumFares([])).toEqual({ minCentavos: 0, maxCentavos: 0, status: "no_ride", completeness: "estimate" });
  });
});
