// Vehicle classes per route (controller rulings C1–C8, D3 and the user decisions of 2026-10-16).
// Pure: the API and the UI derive every label, chip and line colour key from the published
// transit.route_vehicle_class records, never from anything else.
//
// Honesty rules:
//  - a class is named only with its evidence (status and date); no record → "Vehicle type not confirmed";
//  - "operating" means the project owner confirmed SERVICE; it never says anything about stops or paths;
//  - "reported, not confirmed" classes never change the line colour (text only);
//  - there is no e-jeepney class: no route is ever labelled e-jeepney (user decision 2026-10-16).

import { compareCodeUnits } from "../text/compare";

export const VEHICLE_CLASSES = ["traditional_puj", "modern_puj", "tricycle", "e_tricycle", "uv_express", "bus"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const FLEET_EVIDENCE_LEVELS = [
  "legal_plan", "official_report", "news_report", "registry", "secondary_claim", "user_report", "owner_confirmation",
] as const;
export type FleetEvidenceLevel = (typeof FLEET_EVIDENCE_LEVELS)[number];

export const FLEET_STATUSES = ["planned", "reported", "reported_not_confirmed", "operating"] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];

export const COLOUR_KEYS = ["traditional_puj", "modern_puj", "mixed_trad_modern", "tricycle", "unconfirmed"] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];

export const ROUTE_MODES = ["jeepney", "tricycle", "uv_express", "bus", "rail"] as const;
export type RouteMode = (typeof ROUTE_MODES)[number];

export type FleetRecord = {
  code: string;
  vehicleClass: VehicleClass;
  evidenceLevels: FleetEvidenceLevel[];
  status: FleetStatus;
  /** ISO dates (YYYY-MM-DD); null when no source dates it. */
  firstReportedOn: string | null;
  lastReportedOn: string | null;
  unitsNote: string | null;
  /** Null: no source states it. */
  aircon: boolean | null;
  airconSourceCodes: string[];
  /** Cooperative names only (never chairs or addresses). */
  cooperatives: string[];
  sourceCodes: string[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];

/** "May 2024" from "2024-05-…" or "2024-05" (read from the text: no time zone shift); null stays null. */
export function monthYear(date: string | null): string | null {
  if (date === null) return null;
  const m = /^(\d{4})-(\d{2})/.exec(date);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : null;
}

const year = (date: string | null) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : null);

const CLASS_NAME: Record<VehicleClass, string> = {
  traditional_puj: "Traditional jeepney",
  modern_puj: "Modern jeepney",
  tricycle: "Tricycle (special trimobile)",
  e_tricycle: "E-tricycle",
  uv_express: "UV Express",
  bus: "Bus",
};

const CLASS_ORDER: Record<VehicleClass, number> = {
  traditional_puj: 0, modern_puj: 1, tricycle: 2, e_tricycle: 3, uv_express: 4, bus: 5,
};

const isJeepney = (r: FleetRecord) => r.vehicleClass === "traditional_puj" || r.vehicleClass === "modern_puj";

/** The evidence text of one class record ("Modern jeepney · air-conditioned · operating (owner-confirmed October 2026)"). */
export function classLabel(r: FleetRecord): string {
  const parts = [CLASS_NAME[r.vehicleClass]];
  if (r.aircon === true) parts.push("air-conditioned");
  const last = monthYear(r.lastReportedOn);
  switch (r.status) {
    case "operating":
      parts.push(last ? `operating (owner-confirmed ${last})` : "operating (owner-confirmed)");
      break;
    case "reported":
      parts.push(last ? `last reported ${last}` : "reported");
      break;
    case "reported_not_confirmed":
      parts.push("reported, not confirmed");
      break;
    case "planned":
      if (isJeepney(r)) parts.push(`${year(r.lastReportedOn) ?? "2025"} route plan`, "not confirmed on the street");
      else parts.push(`authorized ${year(r.lastReportedOn ?? r.firstReportedOn) ?? ""}`.trim(), "operation not verified");
      break;
  }
  return parts.join(" · ");
}

/**
 * Whether a record counts toward the line colour (D3): never a "reported, not confirmed" class;
 * a "reported" class only with an official or news report; route-plan and owner-confirmed
 * records count.
 */
function counts(r: FleetRecord): boolean {
  if (r.status === "reported_not_confirmed") return false;
  if (r.status === "reported") return r.evidenceLevels.some((e) => e === "official_report" || e === "news_report");
  return true;
}

export function colourKey(records: readonly FleetRecord[]): ColourKey {
  const counted = records.filter(counts);
  const trad = counted.some((r) => r.vehicleClass === "traditional_puj");
  const modern = counted.some((r) => r.vehicleClass === "modern_puj");
  if (trad && modern) return "mixed_trad_modern";
  if (trad) return "traditional_puj";
  if (modern) return "modern_puj";
  if (counted.some((r) => r.vehicleClass === "tricycle" || r.vehicleClass === "e_tricycle")) return "tricycle";
  return "unconfirmed";
}

const of = (records: readonly FleetRecord[], cls: VehicleClass) => records.filter((r) => r.vehicleClass === cls);

/** The strongest status among the records of one class (operating > reported > planned > not confirmed). */
function best(records: readonly FleetRecord[]): FleetRecord | null {
  const rank: Record<FleetStatus, number> = { operating: 3, reported: 2, planned: 1, reported_not_confirmed: 0 };
  return [...records].sort((a, b) => rank[b.status] - rank[a.status] || compareCodeUnits(b.lastReportedOn ?? "", a.lastReportedOn ?? ""))[0] ?? null;
}

/** The route's fleet sentence (route detail, options, search). */
export function fleetLabel(records: readonly FleetRecord[]): string {
  if (records.length === 0) return "Vehicle type not confirmed";
  const trad = best(of(records, "traditional_puj"));
  const modern = best(of(records, "modern_puj"));
  const modernNote = (m: FleetRecord) => {
    const last = monthYear(m.lastReportedOn);
    return m.status === "reported" && last ? ` · modern units last reported ${last}` : "";
  };

  if (trad && trad.status !== "reported_not_confirmed") {
    const tradText = trad.status === "planned"
      ? "Traditional jeepneys (2025 route plan) · vehicles on the street not confirmed"
      : "Traditional jeepneys";
    if (modern && modern.status === "reported_not_confirmed") return `${tradText} · modern units reported, not confirmed`;
    if (modern && counts(modern)) {
      return trad.status === "planned"
        ? `Traditional and modern jeepneys (traditional from the 2025 route plan)${modernNote(modern)}`
        : `Traditional and modern jeepneys${modernNote(modern)}`;
    }
    return tradText;
  }
  if (modern && modern.status !== "reported_not_confirmed") {
    const last = monthYear(modern.lastReportedOn);
    return modern.status === "reported" && last ? `Modern jeepneys · last reported ${last}` : "Modern jeepneys";
  }
  const tricycle = best(of(records, "tricycle"));
  if (tricycle) return tricycle.status === "operating" ? "Tricycles" : classLabel(tricycle);
  // Anything else on file (UV Express, bus, or only unconfirmed claims): its own evidence text.
  return [...records].sort((a, b) => CLASS_ORDER[a.vehicleClass] - CLASS_ORDER[b.vehicleClass]).map(classLabel).join("; ");
}

const MODE_NAME: Record<RouteMode, string> = {
  jeepney: "Jeepney", tricycle: "Tricycle", uv_express: "UV Express", bus: "Bus", rail: "Train",
};

/** The short vehicle-class chip of a ride option (C7). */
export function fleetChip(records: readonly FleetRecord[], mode: RouteMode): string {
  const name = MODE_NAME[mode];
  if (mode === "jeepney") {
    const trad = of(records, "traditional_puj").some(counts);
    const modern = of(records, "modern_puj").some(counts);
    const modernClaim = of(records, "modern_puj").some((r) => r.status === "reported_not_confirmed");
    if (trad && modern) return `${name} · traditional + modern`;
    if (modernClaim) return `${name} · modern units reported`;
    if (trad) return `${name} · traditional`;
    if (modern) return `${name} · modern`;
    return `${name} · type not confirmed`;
  }
  if (mode === "tricycle" && records.some((r) => r.vehicleClass === "tricycle" && counts(r))) return `${name} · special trimobile`;
  return `${name} · type not confirmed`;
}

export type FleetClass = FleetRecord & { label: string };
export type FleetSummary = { label: string; chip: string; colourKey: ColourKey; classes: FleetClass[] };

/** Label, chip, colour key and the classes (traditional first) with their evidence text. */
export function fleetSummary(records: readonly FleetRecord[], mode: RouteMode): FleetSummary {
  const classes = [...records]
    .sort((a, b) => CLASS_ORDER[a.vehicleClass] - CLASS_ORDER[b.vehicleClass] || compareCodeUnits(a.code, b.code))
    .map((r) => ({ ...r, evidenceLevels: [...r.evidenceLevels], airconSourceCodes: [...r.airconSourceCodes],
      cooperatives: [...r.cooperatives], sourceCodes: [...r.sourceCodes], label: classLabel(r) }));
  return { label: fleetLabel(records), chip: fleetChip(records, mode), colourKey: colourKey(records), classes };
}

/** Service status (user decision 2026-10-16): confirms service only, never stops, stop order or paths. */
export function operatingStatusLabel(confirmedOn: string): string {
  return `Operating (owner-confirmed ${confirmedOn})`;
}

export const COOPERATIVE_BASES = ["corridor_reported", "name_matches_corridor"] as const;
export type CooperativeBasis = (typeof COOPERATIVE_BASES)[number];

/** C8: how a cooperative is linked to the route. */
export function cooperativeLabel(basis: CooperativeBasis, reportedOn: string | null): string {
  const when = monthYear(reportedOn);
  if (basis === "name_matches_corridor") {
    return `Registered cooperative whose name matches this corridor (OTC masterlist${when ? `, ${when}` : ""}) · route not confirmed`;
  }
  return when ? `Reported on this corridor (${when})` : "Reported on this corridor";
}
