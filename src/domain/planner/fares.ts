// Fare ESTIMATES for provisional trips. Pure. Never an exact fare.
//
// Rule values come only from the snapshot's fare rules F01 (traditional jeepney) and F02
// (modern jeepney); the vehicle class of a ride is unknown, so a leg's estimate spans both:
//
//   distance  = the ride's approximate distance (sum of straight-line stop-to-stop segments);
//   extraM    = max(0, distance − baseKm × 1000);
//   min       = F01.base + floor(extraM / 1000) × F01.perKm, rounded DOWN to whole pesos;
//   max       = F02.base + ceil(extraM / 1000)  × F02.perKm, rounded UP to whole pesos.
//
// The seed's rounding rule is unknown (null), so the range is widened honestly in both
// directions instead of guessing: 3.2 km → ₱14–₱17; 6.0 km → ₱18–₱22 (F02 2180 → 2200).
// Discounts are never applied (eligibility unverified). If F01 or F02 is missing or lacks a
// base, base distance or per-km increment, the leg is "unavailable" with null amounts — there
// is no hard-coded fallback. A trip total is the sum of its legs' ranges.
import type { FareRuleEstimate } from "../api/schemas";

export const FARE_RULE_CODES = ["F01", "F02"] as const;

export type LegFare = {
  minCentavos: number | null;
  maxCentavos: number | null;
  status: "estimate" | "unavailable";
  completeness: "estimate";
  /** Distance is the straight-line sum along the stop order, not a surveyed path. */
  approximate: true;
  discountsApplied: false;
  ruleCodes: readonly ["F01", "F02"];
};

export type TripFare = {
  minCentavos: number | null;
  maxCentavos: number | null;
  /** "no_ride" for a walk-only option (0–0). */
  status: "estimate" | "unavailable" | "no_ride";
  completeness: "estimate";
};

type UsableRule = { base: number; baseKm: number; perKm: number };

function usable(rules: readonly FareRuleEstimate[], code: string): UsableRule | null {
  const r = rules.find((x) => x.code === code);
  if (!r || r.baseCentavos === null || r.baseKm === null || r.incrementCentavosPerKm === null) return null;
  return { base: r.baseCentavos, baseKm: r.baseKm, perKm: r.incrementCentavosPerKm };
}

const floorPeso = (c: number) => Math.floor(c / 100) * 100;
const ceilPeso = (c: number) => Math.ceil(c / 100) * 100;

function extraMeters(rule: UsableRule, rideMeters: number): number {
  return Math.max(0, rideMeters - rule.baseKm * 1000);
}

export function legFareEstimate(rideMeters: number, rules: readonly FareRuleEstimate[]): LegFare {
  const common = { completeness: "estimate", approximate: true, discountsApplied: false, ruleCodes: FARE_RULE_CODES } as const;
  const low = usable(rules, "F01");
  const high = usable(rules, "F02");
  if (!low || !high) return { minCentavos: null, maxCentavos: null, status: "unavailable", ...common };
  const min = floorPeso(low.base + Math.floor(extraMeters(low, rideMeters) / 1000) * low.perKm);
  const max = ceilPeso(high.base + Math.ceil(extraMeters(high, rideMeters) / 1000) * high.perKm);
  return { minCentavos: min, maxCentavos: max, status: "estimate", ...common };
}

export function sumFares(legs: readonly LegFare[]): TripFare {
  if (legs.length === 0) return { minCentavos: 0, maxCentavos: 0, status: "no_ride", completeness: "estimate" };
  let min = 0;
  let max = 0;
  for (const l of legs) {
    if (l.status !== "estimate" || l.minCentavos === null || l.maxCentavos === null) {
      return { minCentavos: null, maxCentavos: null, status: "unavailable", completeness: "estimate" };
    }
    min += l.minCentavos;
    max += l.maxCentavos;
  }
  return { minCentavos: min, maxCentavos: max, status: "estimate", completeness: "estimate" };
}
