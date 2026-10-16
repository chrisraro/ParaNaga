// Regional fare estimates (J6, D5) for UV Express, buses and regional jeepneys, from the national
// per-km rates effective 28 Sep 2026 (F06–F12; F01 for a regional jeepney). Pure.
//
// Shown ONLY on regional service / terminal detail: these rules are never planner inputs (the
// snapshot's fareRules stay scoped to intra-city modes, see INTRA_CITY_FARE_MODES).
// Always an estimate, always "operator prices may differ"; a missing distance gives rates only.
import type { FareRuleEstimate } from "../api/schemas";

export type RegionalMode = "uv_express" | "bus" | "jeepney";

export type RegionalFareEstimate = {
  /** Always true: never a ticket price. */
  isEstimate: true;
  distanceKm: number | null;
  /** Null when there is no distance (or no rule): rates only. */
  lowCentavos: number | null;
  highCentavos: number | null;
  text: string;
  /** The published rules the estimate used. */
  ruleCodes: string[];
};

const DIFFER = "operator prices may differ";
const NO_DISTANCE = "distance not on file";

function peso(centavos: number): string {
  return centavos % 100 === 0 ? `₱${centavos / 100}` : `₱${(centavos / 100).toFixed(2)}`;
}
const perKm = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dated(rules: readonly FareRuleEstimate[]): string | null {
  const d = rules.map((r) => r.effectiveFrom).find((x): x is string => x !== null);
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

const join = (...parts: (string | null)[]) => parts.filter((p): p is string => p !== null).join(" · ");

/** Distance-based fare of a rule with a base: base + ceil(max(0, km − baseKm)) × increment. */
function withBase(r: FareRuleEstimate, km: number): number {
  return r.baseCentavos! + Math.ceil(Math.max(0, km - (r.baseKm ?? 0))) * (r.incrementCentavosPerKm ?? 0);
}
const hasBase = (r: FareRuleEstimate | undefined): r is FareRuleEstimate =>
  r !== undefined && r.baseCentavos !== null && r.incrementCentavosPerKm !== null;

/**
 * The estimate for one regional service: `ruleCodes` are the service's fare rule codes, `rules`
 * the published fare rules (only those listed and published are used).
 */
export function regionalFareEstimate(
  distanceKm: number | null,
  mode: RegionalMode,
  ruleCodes: readonly string[],
  rules: readonly FareRuleEstimate[],
): RegionalFareEstimate {
  const listed = rules.filter((r) => ruleCodes.includes(r.code));
  const byMode = (m: string) => listed.find((r) => r.modeCode === m);
  const none: RegionalFareEstimate = {
    isEstimate: true, distanceKm, lowCentavos: null, highCentavos: null, text: join("No fare rule on file", DIFFER), ruleCodes: [],
  };
  const km = distanceKm !== null && Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null;

  if (mode === "uv_express") {
    const low = byMode("uv_express_traditional");
    const high = byMode("uv_express_modern");
    if (!low?.incrementCentavosPerKm || !high?.incrementCentavosPerKm) return none;
    const basis = `(provisional per-km rate${dated([low, high]) ? `, ${dated([low, high])}` : ""})`;
    const codes = [low.code, high.code];
    if (km === null) {
      return { ...none, ruleCodes: codes,
        text: join(`${perKm(low.incrementCentavosPerKm)}–${perKm(high.incrementCentavosPerKm)}/km ${basis}`, NO_DISTANCE, DIFFER) };
    }
    // Whole pesos, rounded outward.
    const lowC = Math.floor((low.incrementCentavosPerKm * km) / 100) * 100;
    const highC = Math.ceil((high.incrementCentavosPerKm * km) / 100) * 100;
    return { ...none, lowCentavos: lowC, highCentavos: highC, ruleCodes: codes,
      text: join(`Estimate ${peso(lowC)}–${peso(highC)} ${basis}`, DIFFER) };
  }

  if (mode === "bus") {
    const ordinary = byMode("bus_ordinary");
    const aircon = ["bus_aircon", "bus_deluxe", "bus_super_deluxe", "bus_luxury"]
      .map(byMode)
      .filter((r): r is FareRuleEstimate => r !== undefined && r.incrementCentavosPerKm !== null);
    if (!hasBase(ordinary) && aircon.length === 0) return none;
    const date = dated([...(ordinary ? [ordinary] : []), ...aircon]);
    const rate = date ? `(${date} rate)` : "(national rate)";
    const rates = aircon.map((r) => r.incrementCentavosPerKm!);
    const airconText = aircon.length === 0 ? null
      : `${perKm(Math.min(...rates))}${Math.min(...rates) === Math.max(...rates) ? "" : `–${perKm(Math.max(...rates))}`}/km for air-conditioned classes (no base fare published)`;
    const codes = [...(hasBase(ordinary) ? [ordinary.code] : []), ...aircon.map((r) => r.code)];
    if (hasBase(ordinary) && km !== null) {
      const total = withBase(ordinary, km);
      return { ...none, lowCentavos: total, highCentavos: total, ruleCodes: codes,
        text: join(`Ordinary bus: Estimate ${peso(total)} ${rate}`, airconText, DIFFER) };
    }
    const ordinaryText = hasBase(ordinary)
      ? `Ordinary bus: ${peso(ordinary.baseCentavos!)} first ${ordinary.baseKm} km + ${perKm(ordinary.incrementCentavosPerKm!)}/km ${rate}`
      : null;
    return { ...none, ruleCodes: codes, text: join(ordinaryText, airconText, km === null ? NO_DISTANCE : null, DIFFER) };
  }

  // A regional jeepney: the traditional jeepney rule (F01).
  const jeep = byMode("traditional_jeepney");
  if (!hasBase(jeep)) return none;
  const rate = `(${dated([jeep]) ?? "national"} rate)`;
  if (km === null) {
    return { ...none, ruleCodes: [jeep.code],
      text: join(`${peso(jeep.baseCentavos!)} first ${jeep.baseKm} km + ${perKm(jeep.incrementCentavosPerKm!)}/km ${rate}`, NO_DISTANCE, DIFFER) };
  }
  const total = withBase(jeep, km);
  return { ...none, lowCentavos: total, highCentavos: total, ruleCodes: [jeep.code], text: join(`Estimate ${peso(total)} ${rate}`, DIFFER) };
}
