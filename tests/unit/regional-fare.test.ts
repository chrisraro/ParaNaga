// Regional fare estimates (J6, D5): per-km national rates of 28 Sep 2026 (F06–F12, plus F01 for
// regional jeepneys), always estimates, shown only on regional service / terminal detail.
import { describe, expect, it } from "vitest";
import type { FareRuleEstimate } from "@/domain/api/schemas";
import { regionalFareEstimate } from "@/domain/fares/regional";

const rule = (code: string, modeCode: string, over: Partial<FareRuleEstimate> = {}): FareRuleEstimate => ({
  code, modeCode, vehicleClass: null, baseCentavos: null, baseKm: null, incrementCentavosPerKm: null, discountPercent: null,
  discountedBaseCentavos: null, discountGroups: null, rounding: null, effectiveFrom: "2026-09-28", enactedOn: null,
  evidenceStatus: "provisional_national_rate", status: "draft", publishExact: false, isEstimate: true, sourceCodes: ["N17"], ...over,
});

const RULES: FareRuleEstimate[] = [
  rule("F01", "traditional_jeepney", { baseCentavos: 1400, baseKm: 4, incrementCentavosPerKm: 200, sourceCodes: ["S05", "N17"] }),
  rule("F06", "uv_express_traditional", { incrementCentavosPerKm: 260 }),
  rule("F07", "uv_express_modern", { incrementCentavosPerKm: 300 }),
  rule("F08", "bus_ordinary", { baseCentavos: 1200, baseKm: 5, incrementCentavosPerKm: 220 }),
  rule("F09", "bus_aircon", { incrementCentavosPerKm: 245 }),
  rule("F10", "bus_deluxe", { incrementCentavosPerKm: 260 }),
  rule("F11", "bus_super_deluxe", { incrementCentavosPerKm: 270 }),
  rule("F12", "bus_luxury", { incrementCentavosPerKm: 335 }),
];

describe("regionalFareEstimate", () => {
  it("UV Express (RS05) at 103 km: the per-km range rounded outward", () => {
    const e = regionalFareEstimate(103, "uv_express", ["F06", "F07"], RULES);
    expect(e.lowCentavos).toBe(26700); // floor(2.60 × 103 = 267.8)
    expect(e.highCentavos).toBe(30900); // ceil(3.00 × 103)
    expect(e.text).toBe("Estimate ₱267–₱309 (provisional per-km rate, 28 Sep 2026) · operator prices may differ");
    expect(e.ruleCodes).toEqual(["F06", "F07"]);
    expect(e.isEstimate).toBe(true);
  });

  it("no distance on file: rates only, no total", () => {
    const e = regionalFareEstimate(null, "uv_express", ["F06", "F07"], RULES);
    expect(e.lowCentavos).toBeNull();
    expect(e.highCentavos).toBeNull();
    expect(e.text).toBe("₱2.60–₱3.00/km (provisional per-km rate, 28 Sep 2026) · distance not on file · operator prices may differ");
  });

  it("bus ordinary at 3 km is the ₱12 minimum; air-conditioned classes are rates only", () => {
    const e = regionalFareEstimate(3, "bus", ["F08", "F09", "F10", "F11", "F12"], RULES);
    expect(e.lowCentavos).toBe(1200);
    expect(e.highCentavos).toBe(1200);
    expect(e.text).toBe(
      "Ordinary bus: Estimate ₱12 (28 Sep 2026 rate) · ₱2.45–₱3.35/km for air-conditioned classes (no base fare published) · operator prices may differ");
  });

  it("bus ordinary beyond 5 km: base + ceil(km − 5) × ₱2.20", () => {
    const e = regionalFareEstimate(7.2, "bus", ["F08"], RULES);
    expect(e.lowCentavos).toBe(1200 + 3 * 220);
    expect(e.text).toBe("Ordinary bus: Estimate ₱18.60 (28 Sep 2026 rate) · operator prices may differ");
  });

  it("bus without a distance: ordinary minimum and rates, no total", () => {
    const e = regionalFareEstimate(null, "bus", ["F08", "F09", "F12"], RULES);
    expect(e.lowCentavos).toBeNull();
    expect(e.text).toBe(
      "Ordinary bus: ₱12 first 5 km + ₱2.20/km (28 Sep 2026 rate) · ₱2.45–₱3.35/km for air-conditioned classes (no base fare published) · distance not on file · operator prices may differ");
  });

  it("regional jeepney (F01) without a distance: the rule, no total", () => {
    const e = regionalFareEstimate(null, "jeepney", ["F01"], RULES);
    expect(e.text).toBe("₱14 first 4 km + ₱2.00/km (28 Sep 2026 rate) · distance not on file · operator prices may differ");
    expect(regionalFareEstimate(10, "jeepney", ["F01"], RULES).lowCentavos).toBe(1400 + 6 * 200);
  });

  it("a rule that is not published: nothing is estimated", () => {
    const e = regionalFareEstimate(50, "uv_express", ["F06", "F07"], RULES.filter((r) => r.code !== "F07"));
    expect(e.lowCentavos).toBeNull();
    expect(e.text).toBe("No fare rule on file · operator prices may differ");
    expect(e.ruleCodes).toEqual([]);
  });
});
