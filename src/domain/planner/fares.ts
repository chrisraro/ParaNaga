// Fare ESTIMATES for provisional trips. Pure. Never an exact fare.
//
// Rule values come only from the snapshot's fare rules F01 (traditional jeepney) and F02
// (modern jeepney); the vehicle class of a ride is unknown, so a leg's estimate spans both:
//
//   distance  = the ride's D13 distance, as given by the planner: metres along the variant's
//               approximate path when it has one, else the straight-line stop-to-stop sum (the
//               leg says which; neither is exact);
//   extraM    = max(0, distance − baseKm × 1000);
//   min       = F01.base + floor(extraM / 1000) × F01.perKm, rounded DOWN to whole pesos;
//   max       = F02.base + ceil(extraM / 1000)  × F02.perKm, rounded UP to whole pesos.
//
// The seed's rounding rule is unknown (null), so the range is widened honestly in both
// directions instead of guessing: 3.2 km → ₱14–₱17; 6.0 km → ₱18–₱22 (F02 2180 → 2200).
// Mixed fleet (C6 and the user decisions of 2026-10-16): when the route runs traditional AND
// modern jeepneys (R4, R7; fleet colour key mixed_trad_modern), the range spans the traditional
// minimum to the modern maximum, where
//
//   modern max = max(F02 max above, traditional max + the riders' reported modern delta),
//   traditional max = F01.base + ceil(extraM / 1000) × F01.perKm, rounded UP;
//
// the delta is a rider REPORT (an observation, never a rule): a range uses its upper bound and
// "at least" its stated minimum. When a report sets the maximum, its code is listed and the
// basis is "fare_rules_and_reports". The minimum is F01 either way, so a single-class or
// unconfirmed fleet keeps exactly the C6 F01–F02 span (span "rule_span").
//
// Discounts are never applied (eligibility unverified). If F01 or F02 is missing or lacks a
// base, base distance or per-km increment, the leg is "unavailable" with null amounts — there
// is no hard-coded fallback. A trip total is the sum of its legs' ranges.
//
// The distance is rounded to whole metres first (the planner already passes whole metres), so
// floating-point noise just above a whole km cannot add a kilometre to the maximum.
//
// Deliberately NOT read: a rule's `status` and `rounding`. Every imported fare rule is draft,
// reported estimate data (`isEstimate: true`, `publishExact: false`) — none is an approved
// matrix — so status cannot separate usable from unusable rules today, and the seed's rounding
// is null (unknown), which is why the range is widened above instead. Revisit both when a
// verified fare matrix is published.
import type { FareRuleEstimate } from "../api/schemas";
import type { VehicleClass } from "../modes/fleet";

export const FARE_RULE_CODES = ["F01", "F02"] as const;

/** A rider report of what one vehicle class charges over the traditional fare (snapshot routes[].fareReports). */
export type FareReport = {
  code: string;
  vehicleClass: VehicleClass;
  deltaQualifier: "range" | "at_least";
  deltaCentavosLow: number;
  deltaCentavosHigh: number | null;
};

/** The ride's fleet as far as fares go: mixed traditional + modern, and the route's rider reports. */
export type FareFleet = { mixedFleet: boolean; reports: readonly FareReport[] };

export type LegFare = {
  minCentavos: number | null;
  maxCentavos: number | null;
  status: "estimate" | "unavailable";
  completeness: "estimate";
  /** The distance (D13: approximate path or straight-line sum) is never a surveyed one. */
  approximate: true;
  discountsApplied: false;
  /**
   * Always both: the class of the vehicle that comes is unknown. On a mixed-fleet route (R4, R7)
   * that is literal — traditional and modern units run the same route — so the range runs from
   * the traditional rate to the modern one.
   */
  ruleCodes: readonly ["F01", "F02"];
  /** "traditional_to_modern" on a mixed-fleet route; otherwise the C6 rule span. */
  span: "rule_span" | "traditional_to_modern";
  /** "fare_rules_and_reports" when a rider report set the maximum. */
  basis: "fare_rules" | "fare_rules_and_reports";
  /** The rider reports that set the maximum (empty otherwise). */
  reportCodes: string[];
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

const reportedDelta = (r: FareReport) => (r.deltaQualifier === "range" && r.deltaCentavosHigh !== null ? r.deltaCentavosHigh : r.deltaCentavosLow);

export function legFareEstimate(rideMeters: number, rules: readonly FareRuleEstimate[], fleet?: FareFleet): LegFare {
  const span = fleet?.mixedFleet ? "traditional_to_modern" : "rule_span";
  const common = { completeness: "estimate", approximate: true, discountsApplied: false, ruleCodes: FARE_RULE_CODES, span } as const;
  const low = usable(rules, "F01");
  const high = usable(rules, "F02");
  if (!low || !high) return { minCentavos: null, maxCentavos: null, status: "unavailable", ...common, basis: "fare_rules", reportCodes: [] };
  const meters = Math.round(rideMeters);
  const min = floorPeso(low.base + Math.floor(extraMeters(low, meters) / 1000) * low.perKm);
  let max = ceilPeso(high.base + Math.ceil(extraMeters(high, meters) / 1000) * high.perKm);
  let reportCodes: string[] = [];
  if (fleet?.mixedFleet) {
    const traditionalMax = ceilPeso(low.base + Math.ceil(extraMeters(low, meters) / 1000) * low.perKm);
    for (const r of fleet.reports.filter((x) => x.vehicleClass === "modern_puj")) {
      const reported = ceilPeso(traditionalMax + reportedDelta(r));
      if (reported > max) {
        max = reported;
        reportCodes = [r.code];
      } else if (reported === max && reportCodes.length > 0) {
        reportCodes = [...reportCodes, r.code].sort();
      }
    }
  }
  const basis = reportCodes.length > 0 ? "fare_rules_and_reports" : "fare_rules";
  return { minCentavos: min, maxCentavos: max, status: "estimate", ...common, basis, reportCodes };
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
