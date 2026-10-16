// Fare ESTIMATES for provisional trips. Pure. Never an exact fare.
//
// Rule values come only from the snapshot's fare rules F01 (traditional jeepney) and F02
// (modern jeepney). Which rules apply follows the route's fleet (fareClasses):
//
//  - traditional only (ruling 2026-10-16; R1–R3, R5, R6, R8): F01 alone, min and max below
//    both from F01 (max = F01.base + ceil(extraM / 1000) × F01.perKm, rounded UP) — no modern
//    maximum. 3.2 km → ₱14; 5.5 km → ₱16–₱18.
//  - modern only (C6, no such route today): F02 alone, the same way.
//  - traditional and modern (R4, R7): mixed fleet, below.
//  - unconfirmed (no fleet record, e.g. an older cached snapshot without routes[]): the class
//    of the vehicle is unknown, so the estimate spans both rules (C6, span "rule_span"):
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
// basis is "fare_rules_and_reports".
//
// Discounts are never applied (eligibility unverified). If a rule the leg needs (ruleCodes) is
// missing or lacks a base, base distance or per-km increment, the leg is "unavailable" with null amounts — there
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
import type { ColourKey, VehicleClass } from "../modes/fleet";

export const FARE_RULE_CODES = ["F01", "F02"] as const;
export type FareRuleCode = (typeof FARE_RULE_CODES)[number];
export type FareRuleCodes = readonly ["F01", "F02"] | readonly ["F01"] | readonly ["F02"];

/** The jeepney classes a route runs, as far as fares go. */
export type FareClasses = "traditional" | "modern" | "traditional_and_modern" | "unconfirmed";

/** From the route's fleet colour key (D3 counting: "reported, not confirmed" classes never count). */
export function fareClasses(key: ColourKey): FareClasses {
  switch (key) {
    case "traditional_puj":
      return "traditional";
    case "modern_puj":
      return "modern";
    case "mixed_trad_modern":
      return "traditional_and_modern";
    default:
      return "unconfirmed";
  }
}

/** A rider report of what one vehicle class charges over the traditional fare (snapshot routes[].fareReports). */
export type FareReport = {
  code: string;
  vehicleClass: VehicleClass;
  deltaQualifier: "range" | "at_least";
  deltaCentavosLow: number;
  deltaCentavosHigh: number | null;
};

/** The ride's fleet as far as fares go: its classes, and the route's rider reports. */
export type FareFleet = { classes: FareClasses; reports: readonly FareReport[] };

export type LegFare = {
  minCentavos: number | null;
  maxCentavos: number | null;
  status: "estimate" | "unavailable";
  completeness: "estimate";
  /** The distance (D13: approximate path or straight-line sum) is never a surveyed one. */
  approximate: true;
  discountsApplied: false;
  /**
   * The rules the estimate uses: F01 alone on a traditional-only route, F02 alone on a
   * modern-only one, and both when the route runs both classes (mixed fleet, R4/R7: whichever
   * unit comes, so traditional to modern rate) or its class is not confirmed (unknown, C6 span).
   */
  ruleCodes: FareRuleCodes;
  /** traditional_rule / modern_rule (one class), traditional_to_modern (mixed fleet), rule_span (unconfirmed). */
  span: FareSpan;
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

export type FareSpan = "rule_span" | "traditional_rule" | "modern_rule" | "traditional_to_modern";

const SPAN: Record<FareClasses, { span: FareSpan; ruleCodes: FareRuleCodes }> = {
  traditional: { span: "traditional_rule", ruleCodes: ["F01"] },
  modern: { span: "modern_rule", ruleCodes: ["F02"] },
  traditional_and_modern: { span: "traditional_to_modern", ruleCodes: FARE_RULE_CODES },
  unconfirmed: { span: "rule_span", ruleCodes: FARE_RULE_CODES },
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

const ruleMin = (r: UsableRule, meters: number) => floorPeso(r.base + Math.floor(extraMeters(r, meters) / 1000) * r.perKm);
const ruleMax = (r: UsableRule, meters: number) => ceilPeso(r.base + Math.ceil(extraMeters(r, meters) / 1000) * r.perKm);

/** No fleet given (a caller without routes[]): the class is unknown, C6 span. */
export function legFareEstimate(rideMeters: number, rules: readonly FareRuleEstimate[], fleet?: FareFleet): LegFare {
  const classes = fleet?.classes ?? "unconfirmed";
  const { span, ruleCodes } = SPAN[classes];
  const common = { completeness: "estimate", approximate: true, discountsApplied: false, ruleCodes, span } as const;
  const unavailable: LegFare = { minCentavos: null, maxCentavos: null, status: "unavailable", ...common, basis: "fare_rules", reportCodes: [] };
  const meters = Math.round(rideMeters);
  const one = classes === "traditional" ? usable(rules, "F01") : classes === "modern" ? usable(rules, "F02") : undefined;
  if (one !== undefined) {
    if (!one) return unavailable;
    return { minCentavos: ruleMin(one, meters), maxCentavos: ruleMax(one, meters), status: "estimate", ...common, basis: "fare_rules", reportCodes: [] };
  }
  const low = usable(rules, "F01");
  const high = usable(rules, "F02");
  if (!low || !high) return unavailable;
  const min = ruleMin(low, meters);
  let max = ruleMax(high, meters);
  let reportCodes: string[] = [];
  if (classes === "traditional_and_modern") {
    const traditionalMax = ruleMax(low, meters);
    for (const r of (fleet?.reports ?? []).filter((x) => x.vehicleClass === "modern_puj")) {
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
