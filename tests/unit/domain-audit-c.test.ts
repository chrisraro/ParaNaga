// Regressions for the domain audit of 2026-10-28 (findings D2, D3, D5, D6, D7; D1 is in roadside.test.ts,
// D4 in ride-without-pins.test.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planOptionSchema } from "@/domain/api/plan";
import type { FareRuleEstimate } from "@/domain/api/schemas";
import { regionalFareEstimate } from "@/domain/fares/regional";
import { STALE_MS, pickBetterFix, type LocationFix } from "@/domain/geo/location-fix";
import { encodePolyline } from "@/domain/geo/polyline";
import { pathRideProgress } from "@/domain/guidance/progress";
import { reduceSession, startSession, type GuidanceEvent } from "@/domain/guidance/session";
import { guidanceView } from "@/domain/guidance/view";
import type { GuidanceTrip } from "@/domain/guidance/steps";
import type { PlanOptionDto } from "@/domain/api/plan";
import { BASE, PATH_VARIANT_ID, oneRide, pathRide, tripOf, walkOnly } from "./guidance-fixtures";

const rule = (code: string, modeCode: string, over: Partial<FareRuleEstimate> = {}): FareRuleEstimate => ({
  code, modeCode, vehicleClass: null, baseCentavos: null, baseKm: null, incrementCentavosPerKm: null, discountPercent: null,
  discountedBaseCentavos: null, discountGroups: null, rounding: null, effectiveFrom: "2026-09-28", enactedOn: null,
  evidenceStatus: "provisional_national_rate", status: "draft", publishExact: false, isEstimate: true, sourceCodes: ["N17"], ...over,
});
const NOW = new Date("2026-10-28T02:00:00Z");

describe("D2: a bus rule with no base distance is not priced", () => {
  it("no total and no 'first null km' text", () => {
    const e = regionalFareEstimate(10, "bus", ["F08"], [rule("F08", "bus_ordinary", { baseCentavos: 1200, baseKm: null, incrementCentavosPerKm: 200 })], NOW);
    expect(e.lowCentavos).toBeNull();
    expect(e.text).not.toMatch(/null/);
    const j = regionalFareEstimate(null, "jeepney", ["F01"], [rule("F01", "traditional_jeepney", { baseCentavos: 1400, baseKm: null, incrementCentavosPerKm: 200 })], NOW);
    expect(j.text).not.toMatch(/null/);
    expect(j.lowCentavos).toBeNull();
  });
});

describe("D3: regional fares honour effective dates", () => {
  const today = rule("F08", "bus_ordinary", { baseCentavos: 1200, baseKm: 5, incrementCentavosPerKm: 220, effectiveFrom: "2026-09-28" });
  const future = rule("F08", "bus_ordinary", { baseCentavos: 1500, baseKm: 5, incrementCentavosPerKm: 300, effectiveFrom: "2026-12-01" });

  it("a rate that starts later is not shown today; the rate in force is", () => {
    expect(regionalFareEstimate(3, "bus", ["F08"], [today, future], NOW).lowCentavos).toBe(1200);
    expect(regionalFareEstimate(3, "bus", ["F08"], [future], NOW).lowCentavos).toBeNull();
    expect(regionalFareEstimate(3, "bus", ["F08"], [today, future], new Date("2026-12-02T02:00:00Z")).lowCentavos).toBe(1500);
  });
});

describe("D5: out-and-back path progress remembers the pass it is on", () => {
  const M = 111_195;
  const k = Math.cos((BASE.lat * Math.PI) / 180);
  const o = (east: number, north: number) => ({ lat: BASE.lat + north / M, lng: BASE.lng + east / (M * k) });
  // North 1,000 m, 60 m east, back south on a parallel street: the two passes run 60 m apart.
  const OUT_BACK = [o(0, 0), o(0, 1000), o(60, 1000), o(60, 0)];
  const fix = (p: { lat: number; lng: number }): LocationFix => ({ ...p, accuracy: 10, timestamp: 1_000_000 });

  it("with the last measure on the return pass, an ambiguous fix stays on the return pass", () => {
    // 35 m east at north 300: 25 m from the return pass, 35 m from the outbound one (within SAME_PLACE_M).
    const p = pathRideProgress(OUT_BACK, false, 100, 2000, fix(o(35, 300)), 1_000_000, 1700);
    expect(p).toMatchObject({ offPath: false, getReady: true });
    expect((p as { remainingM: number }).remainingM).toBeCloseTo(240, -1);
  });

  it("a guidance session carries the measure between fixes", () => {
    const leg = { ...pathRide(100, 2000, (m) => (m <= 1000 ? o(0, m) : o(60, 2060 - m))), variantId: PATH_VARIANT_ID };
    const option: PlanOptionDto = { ...oneRide(), legs: [oneRide().legs[0]!, leg, oneRide().legs[2]!] };
    const trip: GuidanceTrip = { ...tripOf(option), ridePaths: { [PATH_VARIANT_ID]: { encoded: encodePolyline(OUT_BACK), isCircuit: false } } };
    const ev = (p: { lat: number; lng: number }): GuidanceEvent => ({ type: "fix", fix: fix(p), now: 1_000_000 });
    let s = reduceSession(startSession(trip, 1_000_000), { type: "boarded" });
    for (const p of [o(0, 500), o(0, 900), o(30, 1000), o(60, 700), o(60, 400)]) s = reduceSession(s, ev(p));
    const v = guidanceView(reduceSession(s, ev(o(35, 300))), fix(o(35, 300)), 1_000_000);
    if (v.screen !== "ride") throw new Error(v.screen);
    expect(v.countText).toMatch(/About 2[0-9]0 m of riding left/);
  });
});

describe("D6: a stale fix never replaces a fresh one", () => {
  it("even when it is more accurate", () => {
    const now = 1_000_000;
    const fresh: LocationFix = { lat: 13.62, lng: 123.19, accuracy: 40, timestamp: now - 1_000 };
    const stale: LocationFix = { lat: 13.6, lng: 123.2, accuracy: 5, timestamp: now - STALE_MS - 1 };
    expect(pickBetterFix(fresh, stale, now)).toBe(fresh);
    expect(pickBetterFix(null, stale, now)).toBe(stale);
  });
});

describe("D7: a corrupt walk polyline fails validation instead of crashing a render", () => {
  const walk = walkOnly().legs[0]!;
  const withPath = (path: string) => ({ ...walkOnly(), legs: [{ ...walk, basis: "street_graph", path }] });

  it("a valid path parses; a truncated or invalid one is rejected", () => {
    expect(planOptionSchema.safeParse(withPath(encodePolyline([{ lat: 13.62, lng: 123.19 }, { lat: 13.63, lng: 123.19 }]))).success).toBe(true);
    fc.assert(
      fc.property(fc.constantFrom("_", "~~~~", " ", "{{{{{{"), (bad) => !planOptionSchema.safeParse(withPath(bad)).success),
      { seed: 3 },
    );
  });
});
