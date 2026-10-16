import { describe, expect, it } from "vitest";
import { fareClasses, legFareEstimate, padyakFare, sumFares, tricycleFare } from "@/domain/planner/fares";
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

  it("rounds the distance to whole metres first, so a float just above a whole km adds nothing", () => {
    expect(legFareEstimate(4000.0000004, rules)).toMatchObject({ minCentavos: 1400, maxCentavos: 1700 });
    expect(legFareEstimate(4000.6, rules)).toMatchObject({ minCentavos: 1400, maxCentavos: 2000 });
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

describe("legFareEstimate: distance basis and mixed fleets (D13, C6, user decisions 2026-10-16)", () => {
  // Rider reports (observations, never rules): R4 modern +₱3–5, R7 modern at least +₱5.
  const R4_MOD = { code: "FO-R4-MOD", vehicleClass: "modern_puj", deltaQualifier: "range", deltaCentavosLow: 300, deltaCentavosHigh: 500 } as const;
  const R7_MOD = { code: "FO-R7-MOD", vehicleClass: "modern_puj", deltaQualifier: "at_least", deltaCentavosLow: 500, deltaCentavosHigh: null } as const;

  it("prices exactly the distance it is given (the planner passes the D13 distance)", () => {
    expect(legFareEstimate(4001, rules)).toMatchObject({ maxCentavos: 2000 });
    expect(legFareEstimate(4000, rules)).toMatchObject({ maxCentavos: 1700 });
  });

  it("keeps the C6 F01–F02 span for an unconfirmed fleet (class unknown), with the rule basis", () => {
    for (const f of [legFareEstimate(3200, rules), legFareEstimate(3200, rules, { classes: "unconfirmed", reports: [R4_MOD] })]) {
      expect(f).toMatchObject({ minCentavos: 1400, maxCentavos: 1700, span: "rule_span", basis: "fare_rules", reportCodes: [] });
    }
  });

  it("mixed fleet without reports: traditional minimum to the national modern maximum", () => {
    expect(legFareEstimate(3200, rules, { classes: "traditional_and_modern", reports: [] })).toMatchObject({
      minCentavos: 1400, maxCentavos: 1700, span: "traditional_to_modern", basis: "fare_rules", reportCodes: [],
    });
  });

  it("mixed fleet: modern max = max(national modern rule, traditional + the riders' reported delta)", () => {
    // 3.2 km: traditional max ₱14 + ₱5 = ₱19 > F02 ₱17
    expect(legFareEstimate(3200, rules, { classes: "traditional_and_modern", reports: [R4_MOD] })).toMatchObject({
      minCentavos: 1400, maxCentavos: 1900, span: "traditional_to_modern", basis: "fare_rules_and_reports", reportCodes: ["FO-R4-MOD"],
    });
    // "at least +₱5": the stated minimum delta is used (never a guessed upper bound)
    expect(legFareEstimate(3200, rules, { classes: "traditional_and_modern", reports: [R7_MOD] })).toMatchObject({
      minCentavos: 1400, maxCentavos: 1900, basis: "fare_rules_and_reports", reportCodes: ["FO-R7-MOD"],
    });
    // 4.001 km: traditional max 1400 + 1×200 = ₱16 + ₱5 = ₱21 > F02 ₱20
    expect(legFareEstimate(4001, rules, { classes: "traditional_and_modern", reports: [R4_MOD] })).toMatchObject({ maxCentavos: 2100 });
  });

  it("mixed fleet: the national rule wins when it is higher, and then the reports are not cited", () => {
    // 10 km: traditional max 1400 + 6×200 = ₱26 + ₱5 = ₱31; F02 1700 + 6×240 = 3140 → ₱32
    expect(legFareEstimate(10_000, rules, { classes: "traditional_and_modern", reports: [R4_MOD] })).toMatchObject({
      minCentavos: 2600, maxCentavos: 3200, span: "traditional_to_modern", basis: "fare_rules", reportCodes: [],
    });
  });

  it("ignores reports about other classes", () => {
    const trad = { ...R4_MOD, code: "FO-X", vehicleClass: "traditional_puj" } as const;
    expect(legFareEstimate(3200, rules, { classes: "traditional_and_modern", reports: [trad] })).toMatchObject({ maxCentavos: 1700, reportCodes: [] });
  });

  it("traditional-only fleet (ruling 2026-10-16): F01 alone, no modern F02 maximum, reports ignored", () => {
    const trad = (m: number) => legFareEstimate(m, rules, { classes: "traditional", reports: [R4_MOD] });
    expect(trad(3200)).toMatchObject({ minCentavos: 1400, maxCentavos: 1400, span: "traditional_rule", basis: "fare_rules", ruleCodes: ["F01"], reportCodes: [] });
    // 1 m over the base: min floors the extra km (₱14), max ceils it (1400 + 200 = ₱16)
    expect(trad(4001)).toMatchObject({ minCentavos: 1400, maxCentavos: 1600 });
    expect(trad(5500)).toMatchObject({ minCentavos: 1600, maxCentavos: 1800 });
    // F02 is not needed for a traditional-only route
    expect(legFareEstimate(3200, [rules[0]!], { classes: "traditional", reports: [] })).toMatchObject({ status: "estimate", minCentavos: 1400, maxCentavos: 1400 });
    expect(legFareEstimate(3200, [rules[1]!], { classes: "traditional", reports: [] })).toMatchObject({ status: "unavailable", ruleCodes: ["F01"] });
  });

  it("modern-only fleet (C6): the national modern rule alone", () => {
    expect(legFareEstimate(3200, rules, { classes: "modern", reports: [] })).toMatchObject({
      minCentavos: 1700, maxCentavos: 1700, span: "modern_rule", ruleCodes: ["F02"],
    });
    expect(legFareEstimate(4001, rules, { classes: "modern", reports: [] })).toMatchObject({ minCentavos: 1700, maxCentavos: 2000 });
  });

  it("maps the route's fleet colour key to the fare classes", () => {
    expect(fareClasses("traditional_puj")).toBe("traditional");
    expect(fareClasses("modern_puj")).toBe("modern");
    expect(fareClasses("mixed_trad_modern")).toBe("traditional_and_modern");
    expect(fareClasses("unconfirmed")).toBe("unconfirmed");
    expect(fareClasses("tricycle")).toBe("unconfirmed");
  });

  it("is still unavailable without usable F01/F02, mixed fleet or not", () => {
    expect(legFareEstimate(3200, [rules[0]!], { classes: "traditional_and_modern", reports: [R4_MOD] })).toMatchObject({
      minCentavos: null, maxCentavos: null, status: "unavailable", reportCodes: [],
    });
  });
});

describe("tricycle and padyak fares (plan E §D: F03 minimum, F04 flat)", () => {
  const f03 = { ...fareRule("F03", 1500, 0), modeCode: "trimobile_e_trike_taxicle", baseKm: null, incrementCentavosPerKm: null, discountPercent: 20 };
  const f04 = { ...fareRule("F04", 1000, 0), modeCode: "padyak", baseKm: null, incrementCentavosPerKm: null, discountedBaseCentavos: 800 };

  it("tricycle: F03 minimum only, no maximum, discounts not applied", () => {
    expect(tricycleFare([...rules, f03])).toEqual({ minCentavos: 1500, maxCentavos: null, status: "minimum", ruleCodes: ["F03"], discountsApplied: false });
  });

  it("padyak: F04 flat per passenger with the ID discount amount", () => {
    expect(padyakFare([...rules, f04])).toEqual({
      minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger", discountedCentavos: 800, ruleCodes: ["F04"],
    });
  });

  it("is unavailable without the rule or its base (never hard-coded)", () => {
    expect(tricycleFare(rules)).toMatchObject({ minCentavos: null, status: "unavailable" });
    expect(padyakFare([...rules, { ...f04, baseCentavos: null }])).toMatchObject({ minCentavos: null, maxCentavos: null, status: "unavailable" });
  });
});
