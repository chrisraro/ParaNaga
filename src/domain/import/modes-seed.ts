import { z } from "zod";
import { ETA_PARAM_KEYS } from "../eta/params";
import { isInsideNaga } from "../geo/naga";
import { zodMessage } from "./zod-message";

/**
 * The reviewed modes seed (data/source/research/naga-modes-seed-*.json): sources N01–N41 + U01,
 * terminals T01–T16, tricycle feeder routes, per-route vehicle classes (fleet), cooperatives
 * (names only), regional services, fare-rule source additions and new fare rules, time-estimate
 * parameters, street aliases and a conflicts register.
 *
 * Pure. The research JSON is never read here: scripts/draft-modes-seed.ts drafts the file once and
 * every record is then reviewed (`review.decision`). Zod objects are strict, so a field the schema
 * does not know (for example a cooperative chair or address) is refused, not carried along.
 *
 * Shape: top-level and header names as in the plan (camelCase); record fields snake_case, like
 * Data_Sets/naga_transport_seed.json.
 */

// ---------------------------------------------------------------- enums

export const TRANSIT_MODES = ["jeepney", "tricycle", "uv_express", "bus", "rail"] as const;
export const VEHICLE_CLASSES = [
  "traditional_puj", "modern_puj", "e_jeepney", "tricycle", "e_tricycle", "uv_express", "bus",
] as const;
export const EVIDENCE_LEVELS = [
  "legal_plan", "official_report", "news_report", "registry", "secondary_claim", "user_report", "owner_confirmation",
] as const;
export const FLEET_STATUSES = ["planned", "reported", "reported_not_confirmed", "operating"] as const;
export const TERMINAL_KINDS = ["terminal", "loading_point", "waiting_area", "station"] as const;
export { ETA_PARAM_KEYS } from "../eta/params";

/** J7: national PUJ rates effective 2026-09-28 [N17, N32]; the seed's F01/F02 must equal them. */
export const NATIONAL_PUJ_RATES_2026_09_28 = {
  F01: { baseCentavos: 1400, baseKm: 4, incrementCentavosPerKm: 200 },
  F02: { baseCentavos: 1700, baseKm: 4, incrementCentavosPerKm: 240 },
} as const;

// ---------------------------------------------------------------- schemas

const text = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const codes = z.array(text);

const Review = z.strictObject({
  decision: z.enum(["import", "exclude"]),
  reason: text,
  reviewedOn: isoDate,
});

const Header = z.strictObject({
  schemaVersion: z.literal(1),
  preparedOn: isoDate,
  preparedFrom: z.array(text).min(1),
  reviewer: text,
  jevModel: text,
  synthetic: z.literal(true).optional(),
});

const Source = z.strictObject({
  /** N/U/X codes; R-prefixed research codes (RT/RL/RP/RH) from the 2026-10 research, kept apart from terminal codes T01… */
  code: z.string().regex(/^(N|U|X)[0-9]{2}$|^R[TLPH][0-9]{2}$/),
  title: text,
  url: text.nullable(),
  extra_urls: z.array(text),
  publisher: text,
  /** Verbatim date text from the research (may be a range or "osm_base …"). */
  date: text,
  type: text,
  licence: text.nullable(),
  retrieved: isoDate,
  /** Provenance only (Jev scores, tested claim); never shown as a fact. */
  properties: z.record(z.string(), z.unknown()),
  review: Review,
});

const Coordinate = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  coord_source: z.enum(["osm_node", "osm_way_centroid"]),
  osm_type: z.enum(["node", "way"]),
  osm_id: z.number().int().positive(),
  osm_version: z.number().int().positive(),
  osm_timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  /** Where the numbers were read (snapshot file or source code + how the version was checked). */
  read_from: text,
  coord_note: text.nullable(),
});

const Terminal = z.strictObject({
  code: text,
  name: text,
  kind: z.enum(TERMINAL_KINDS),
  location_text: text.nullable(),
  modes: z.array(z.enum(TRANSIT_MODES)).min(1),
  modes_raw: z.array(text).min(1),
  mode_sources: z.partialRecord(z.enum(TRANSIT_MODES), codes.min(1)),
  coordinate: Coordinate.nullable(),
  verification: text,
  status_note: text.nullable(),
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

const Anchor = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("junction"), streets: z.tuple([text, text]) }),
  z.strictObject({ kind: z.literal("osm_place"), osmType: z.enum(["node", "way", "relation"]), osmId: z.number().int().positive() }),
  /** Key of a place in the committed OSM places snapshot, `osm:{type}/{id}`. */
  z.strictObject({ kind: z.literal("osm_places_snapshot"), key: z.string().regex(/^osm:(node|way|relation)\/[0-9]+$/) }),
  /** A named locality (sitio/subdivision) with no OSM id on file: resolved by name against the place nodes of the road snapshot (Task 4/5); unresolved → anchor_unresolved. */
  z.strictObject({ kind: z.literal("place_name"), name: text }),
]);

const Variant = z.strictObject({
  direction: z.enum(["branch", "circuit", "inbound", "outbound"]),
  name: text,
  street_text: text,
  anchors: z.array(Anchor).min(2),
});

const Route = z.strictObject({
  code: text,
  name: text,
  mode: z.enum(TRANSIT_MODES),
  service_status: z.enum(["legal_plan", "authorized_feeder", "historical_unknown"]),
  allocated_units: z.number().int().positive().nullable(),
  operator_text: text.nullable(),
  enacted_on: isoDate.nullable(),
  restrictions: z.array(text),
  conflict_notes: z.array(text),
  notes: text.nullable(),
  variants: z.array(Variant).min(1),
  source_codes: codes.min(1),
  review: Review,
});

const RouteStatusUpdate = z.strictObject({
  route_code: text,
  operating_status: z.enum(["operating"]),
  status_note: text,
  confirmed_on: isoDate,
  source_codes: codes.min(1),
  review: Review,
});

const Fleet = z.strictObject({
  code: text,
  route_code: text,
  vehicle_class: z.enum(VEHICLE_CLASSES),
  evidence_levels: z.array(z.enum(EVIDENCE_LEVELS)).min(1),
  status: z.enum(FLEET_STATUSES),
  first_reported_on: isoDate.nullable(),
  last_reported_on: isoDate.nullable(),
  units_note: text.nullable(),
  /** Vehicle attribute: air-conditioned. null = not stated by any source. */
  aircon: z.boolean().nullable(),
  aircon_source_codes: codes,
  cooperatives: z.array(text),
  conflict_notes: z.array(text),
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

/**
 * A rider/owner report of what is charged in practice, as a delta over the traditional fare for
 * the same trip. Never an enacted rule and never applied as one.
 */
const FareObservation = z.strictObject({
  code: text,
  route_code: text,
  vehicle_class: z.enum(VEHICLE_CLASSES),
  kind: z.literal("reported_practice"),
  relative_to: z.literal("traditional_fare"),
  delta_qualifier: z.enum(["range", "at_least"]),
  delta_centavos_low: z.number().int().nonnegative(),
  /** null when the report is "at least" the low value. */
  delta_centavos_high: z.number().int().nonnegative().nullable(),
  observed_on: isoDate,
  report_text: text,
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

const Cooperative = z.strictObject({
  route_code: text.nullable(),
  name: text,
  basis: z.enum(["corridor_reported", "name_matches_corridor"]),
  reported_on: text,
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

const RegionalService = z.strictObject({
  code: text,
  mode: z.enum(["uv_express", "bus", "jeepney"]),
  name: text,
  operators: z.array(text),
  terminal_code: text,
  terminal_note: text,
  destination: text,
  osm_relation_ids: z.array(z.number().int().positive()).min(1),
  status: z.enum(["community_mapped"]),
  fare_rule_codes: codes,
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

/** Passenger fare modes (Data_Sets F01/F02 names for jeepneys) plus two non-rule kinds kept only as excluded records. */
export const FARE_MODES = [
  "traditional_jeepney", "modern_jeepney", "uv_express_traditional", "uv_express_modern",
  "bus_ordinary", "bus_aircon", "bus_deluxe", "bus_super_deluxe", "bus_luxury",
  "bus_regional_ticket_observed", "terminal_dispatch_fee",
] as const;
const NON_RULE_FARE_MODES = new Set<string>(["bus_regional_ticket_observed", "terminal_dispatch_fee"]);
export const FARE_EVIDENCE_STATUSES = [
  "national_rate_reported", "provisional_national_rate", "aggregator_outdated", "official_historical",
] as const;

const php = z.number().nonnegative();
const FareRule = z.strictObject({
  code: text,
  mode: z.enum(FARE_MODES),
  base_php: php.nullable(),
  base_km: z.number().nonnegative().nullable(),
  additional_php_per_km: php.nullable(),
  effective_from: isoDate.nullable(),
  evidence_status: z.enum(FARE_EVIDENCE_STATUSES),
  publish_exact: z.literal(false),
  rule_text: text,
  notes: text.nullable(),
  source_codes: codes.min(1),
  review: Review,
});

const FareRuleSourceAddition = z.strictObject({
  rule_code: text,
  add_source_codes: codes.min(1),
  review: Review,
});

const Window = z.strictObject({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

const EtaParam = z.strictObject({
  key: text,
  value_low: z.number().positive().nullable(),
  value_high: z.number().positive().nullable(),
  unit: z.enum(["km_per_h", "factor", "windows"]),
  windows: z.array(Window).nullable(),
  days: z.enum(["every_day"]).nullable(),
  applies_to: z.array(z.enum(["walk", "jeepney", "tricycle"])).min(1),
  is_assumption: z.boolean(),
  assumption_note: text.nullable(),
  basis: text,
  source_codes: codes,
  review: Review,
});

/** A reviewed legal-name → OSM-name mapping for the path tracer, with its evidence (OSM way ids). */
const StreetAlias = z.strictObject({
  legal_name: text,
  osm_name: text,
  /** The OSM ways carrying `osm_name` in the road snapshot the alias was reviewed against. */
  osm_way_ids: z.array(z.number().int().positive()).min(1),
  /** The road snapshot file the evidence was read from. */
  evidence_snapshot: z.string().regex(/^naga-roads-\d{4}-\d{2}-\d{2}\.osm\.json$/),
  reason: text,
  review: Review,
});

const Conflict = z.strictObject({
  code: z.string().regex(/^CX[0-9]{2}$/),
  topic: text,
  description: text,
  refs: z.array(text),
  source_codes: codes.min(1),
  review: Review,
});

const ModesSeedSchema = z.strictObject({
  header: Header,
  sources: z.array(Source),
  terminals: z.array(Terminal),
  routes: z.array(Route),
  routeStatusUpdates: z.array(RouteStatusUpdate),
  fleet: z.array(Fleet),
  cooperatives: z.array(Cooperative),
  regionalServices: z.array(RegionalService),
  fareRules: z.array(FareRule),
  fareObservations: z.array(FareObservation),
  fareRuleSourceAdditions: z.array(FareRuleSourceAddition),
  etaParams: z.array(EtaParam),
  streetAliases: z.array(StreetAlias),
  conflicts: z.array(Conflict),
});

export type ModesSeed = z.infer<typeof ModesSeedSchema>;
export type ModesSeedTerminal = ModesSeed["terminals"][number];
export type ModesSeedFleet = ModesSeed["fleet"][number];
export type ModesSeedFareObservation = ModesSeed["fareObservations"][number];
export type ModesSeedEtaParam = ModesSeed["etaParams"][number];
type Reviewed = { review: { decision: "import" | "exclude" } };

/** The arrays of records that carry a review. */
const RECORD_KEYS = [
  "sources", "terminals", "routes", "routeStatusUpdates", "fleet", "cooperatives", "regionalServices",
  "fareRules", "fareObservations", "fareRuleSourceAdditions", "etaParams", "streetAliases", "conflicts",
] as const satisfies readonly (keyof ModesSeed)[];

// ---------------------------------------------------------------- parse

/** Validates the file shape (strict). Throws a one-line message on the first problem. */
export function parseModesSeed(input: unknown): ModesSeed {
  const r = ModesSeedSchema.safeParse(input);
  if (!r.success) throw new Error(zodMessage("Modes seed", r.error));
  return r.data;
}

/** The same seed with every excluded record removed. The importer only ever reads this. */
export function importableRecords(seed: ModesSeed): ModesSeed {
  const out = { ...seed } as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
    out[key] = (seed[key] as Reviewed[]).filter((r) => r.review.decision === "import");
  }
  return out as ModesSeed;
}

/** Excluded records as `kind code: reason`, for the dry-run print. */
export function excludedRecords(seed: ModesSeed): string[] {
  const out: string[] = [];
  for (const key of RECORD_KEYS) {
    for (const r of seed[key] as (Reviewed & { review: { reason: string } } & Record<string, unknown>)[]) {
      if (r.review.decision !== "exclude") continue;
      const id = r.code ?? r.key ?? r.route_code ?? r.rule_code ?? r.name ?? r.legal_name;
      out.push(`${key} ${String(id)}: ${r.review.reason}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- validation

export type ModesSeedContext = {
  /** Source codes already in ingest (Data_Sets seed S01–S42). */
  externalSourceCodes: Iterable<string>;
  /** LPTRP route codes R1–R8-D from the Data_Sets seed. */
  existingRouteCodes: Iterable<string>;
  existingTerminalCodes: Iterable<string>;
  existingFareRules: readonly {
    code: string;
    baseCentavos: number | null;
    baseKm: number | null;
    incrementCentavosPerKm: number | null;
  }[];
};

const NOT_CONFIRMED_EVIDENCE = new Set(["secondary_claim", "user_report"]);
const REPORT_EVIDENCE = new Set(["official_report", "news_report", "registry"]);

function fleetStatusProblem(f: ModesSeedFleet): string | null {
  const ev = f.evidence_levels;
  const onlyNotConfirmed = ev.every((e) => NOT_CONFIRMED_EVIDENCE.has(e));
  if ((f.status === "reported_not_confirmed") !== onlyNotConfirmed) {
    return "status reported_not_confirmed is required exactly when every evidence level is secondary_claim or user_report";
  }
  if (f.status === "operating" && !ev.includes("owner_confirmation")) {
    return "status operating requires owner_confirmation evidence";
  }
  if (f.status !== "operating" && ev.includes("owner_confirmation")) {
    return "owner_confirmation evidence means status operating";
  }
  if ((f.status === "planned") !== (ev.length === 1 && ev[0] === "legal_plan")) {
    return "status planned is used exactly when the only evidence is legal_plan";
  }
  if (f.status === "reported" && !ev.some((e) => REPORT_EVIDENCE.has(e))) {
    return "status reported needs official_report, news_report or registry evidence";
  }
  return null;
}

/**
 * Every rule the file must satisfy beyond its shape. Checks only imported records (an excluded
 * record is kept for the record, not for use). Empty array means the file is consistent.
 */
export function validateModesSeed(seed: ModesSeed, ctx: ModesSeedContext): string[] {
  const issues: string[] = [];
  const imp = importableRecords(seed);

  const dupes = (label: string, values: string[]) => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) issues.push(`Duplicate ${label} ${v}`);
      seen.add(v);
    }
  };
  dupes("source code", seed.sources.map((s) => s.code));
  dupes("terminal code", seed.terminals.map((t) => t.code));
  dupes("route code", seed.routes.map((r) => r.code));
  dupes("fleet code", seed.fleet.map((f) => f.code));
  dupes("regional service code", seed.regionalServices.map((r) => r.code));
  dupes("fare rule code", seed.fareRules.map((f) => f.code));
  dupes("fare observation code", seed.fareObservations.map((o) => o.code));
  dupes("conflict code", seed.conflicts.map((c) => c.code));
  dupes("eta param key", imp.etaParams.map((p) => p.key));
  dupes("route status update", imp.routeStatusUpdates.map((u) => u.route_code));

  // sources: imported seed sources plus the Data_Sets ones; an excluded source cannot be cited
  const known = new Set<string>([...ctx.externalSourceCodes, ...imp.sources.map((s) => s.code)]);
  const excludedSources = new Set(seed.sources.filter((s) => s.review.decision === "exclude").map((s) => s.code));
  const refs = (where: string, list: string[]) => {
    for (const c of list) {
      if (excludedSources.has(c)) issues.push(`${where} cites excluded source ${c}`);
      else if (!known.has(c)) issues.push(`${where} cites unknown source ${c}`);
    }
  };
  for (const t of imp.terminals) {
    refs(`terminal ${t.code}`, t.source_codes);
    for (const [mode, list] of Object.entries(t.mode_sources)) refs(`terminal ${t.code} mode ${mode}`, list ?? []);
  }
  imp.routes.forEach((r) => refs(`route ${r.code}`, r.source_codes));
  imp.routeStatusUpdates.forEach((u) => refs(`route status ${u.route_code}`, u.source_codes));
  imp.fleet.forEach((f) => refs(`fleet ${f.code}`, [...f.source_codes, ...f.aircon_source_codes]));
  imp.fareObservations.forEach((o) => refs(`fare observation ${o.code}`, o.source_codes));
  imp.cooperatives.forEach((c) => refs(`cooperative ${c.name}`, c.source_codes));
  imp.regionalServices.forEach((r) => refs(`regional service ${r.code}`, r.source_codes));
  imp.fareRules.forEach((f) => refs(`fare rule ${f.code}`, f.source_codes));
  imp.fareRuleSourceAdditions.forEach((a) => refs(`fare source addition ${a.rule_code}`, a.add_source_codes));
  imp.etaParams.forEach((p) => refs(`eta param ${p.key}`, p.source_codes));
  imp.conflicts.forEach((c) => refs(`conflict ${c.code}`, c.source_codes));

  // terminals
  const terminalCodes = new Set(imp.terminals.map((t) => t.code));
  for (const code of ctx.existingTerminalCodes) {
    if (!terminalCodes.has(code)) issues.push(`terminal ${code} from Data_Sets has no reviewed record (D17 keeps T01–T06)`);
  }
  for (const t of imp.terminals) {
    if (!/^T[0-9]{2}$/.test(t.code)) issues.push(`terminal ${t.code}: an imported terminal code must be T01…T99`);
    for (const m of t.modes) if (!t.mode_sources[m]) issues.push(`terminal ${t.code}: mode ${m} has no mode_sources`);
    for (const m of Object.keys(t.mode_sources)) {
      if (!t.modes.includes(m as (typeof TRANSIT_MODES)[number])) issues.push(`terminal ${t.code}: mode_sources lists ${m}, not in modes`);
    }
    const c = t.coordinate;
    if (c) {
      if (!isInsideNaga(c)) issues.push(`terminal ${t.code}: coordinate ${c.lat},${c.lng} is outside Naga`);
      if ((c.coord_source === "osm_node") !== (c.osm_type === "node")) {
        issues.push(`terminal ${t.code}: coord_source ${c.coord_source} does not match osm_type ${c.osm_type}`);
      }
    }
  }

  // routes and the codes records may point at
  const routeCodes = new Set<string>([...ctx.existingRouteCodes, ...imp.routes.map((r) => r.code)]);
  const lptrp = new Set(ctx.existingRouteCodes);
  for (const r of imp.routes) {
    if (lptrp.has(r.code)) issues.push(`route ${r.code}: already an LPTRP route in Data_Sets`);
  }
  for (const u of imp.routeStatusUpdates) {
    if (!lptrp.has(u.route_code)) issues.push(`route status update: ${u.route_code} is not an LPTRP route`);
  }

  // fleet (C1–C5 and the 2026-10-16 user decisions)
  for (const f of imp.fleet) {
    if (!routeCodes.has(f.route_code)) issues.push(`fleet ${f.code}: unknown route ${f.route_code}`);
    if (f.vehicle_class === "e_jeepney") {
      issues.push(`fleet ${f.code}: vehicle class e_jeepney is not allowed (no route is an e-jeepney route; e-jeepney dropped 2026-10-16)`);
    }
    const p = fleetStatusProblem(f);
    if (p) issues.push(`fleet ${f.code}: ${p}`);
    if ((f.aircon === null) !== (f.aircon_source_codes.length === 0)) {
      issues.push(`fleet ${f.code}: aircon needs aircon_source_codes exactly when it is stated`);
    }
    if (f.first_reported_on && f.last_reported_on && f.first_reported_on > f.last_reported_on) {
      issues.push(`fleet ${f.code}: first_reported_on is after last_reported_on`);
    }
  }

  for (const o of imp.fareObservations) {
    if (!imp.fleet.some((f) => f.route_code === o.route_code && f.vehicle_class === o.vehicle_class)) {
      issues.push(`fare observation ${o.code}: no imported fleet record for ${o.route_code} ${o.vehicle_class}`);
    }
    if ((o.delta_qualifier === "at_least") !== (o.delta_centavos_high === null)) {
      issues.push(`fare observation ${o.code}: delta_centavos_high is null exactly when the qualifier is at_least`);
    }
    if (o.delta_centavos_high !== null && o.delta_centavos_low > o.delta_centavos_high) {
      issues.push(`fare observation ${o.code}: delta_centavos_low is above delta_centavos_high`);
    }
  }

  for (const c of imp.cooperatives) {
    if (c.route_code === null) issues.push(`cooperative ${c.name}: an imported cooperative needs a route`);
    else if (!routeCodes.has(c.route_code)) issues.push(`cooperative ${c.name}: unknown route ${c.route_code}`);
  }

  // fares (J7)
  const existingFares = new Map(ctx.existingFareRules.map((f) => [f.code, f]));
  for (const [code, want] of Object.entries(NATIONAL_PUJ_RATES_2026_09_28)) {
    const got = existingFares.get(code);
    if (!got) {
      issues.push(`fare rule ${code} is missing from Data_Sets`);
      continue;
    }
    if (got.baseCentavos !== want.baseCentavos || got.baseKm !== want.baseKm || got.incrementCentavosPerKm !== want.incrementCentavosPerKm) {
      issues.push(
        `fare rule ${code} (${got.baseCentavos}/${got.baseKm} km/+${got.incrementCentavosPerKm} per km) differs from the national 2026-09-28 rate (${want.baseCentavos}/${want.baseKm} km/+${want.incrementCentavosPerKm})`,
      );
    }
  }
  for (const a of imp.fareRuleSourceAdditions) {
    if (!existingFares.has(a.rule_code)) issues.push(`fare source addition: unknown rule ${a.rule_code}`);
  }
  const fareCodes = new Set<string>(existingFares.keys());
  for (const f of imp.fareRules) {
    if (!/^F[0-9]{2}$/.test(f.code)) issues.push(`fare rule ${f.code}: an imported fare rule code must be F01…F99`);
    if (NON_RULE_FARE_MODES.has(f.mode)) issues.push(`fare rule ${f.code}: mode ${f.mode} is not a passenger fare rule`);
    if (f.effective_from === null) issues.push(`fare rule ${f.code}: an imported rule needs effective_from`);
    if (existingFares.has(f.code)) issues.push(`fare rule ${f.code}: already exists in Data_Sets`);
    if (f.base_php === null && f.additional_php_per_km === null) issues.push(`fare rule ${f.code}: has neither a base nor a per-km rate`);
    if ((f.base_php === null) !== (f.base_km === null)) issues.push(`fare rule ${f.code}: base_php and base_km must both be set or both be null`);
    fareCodes.add(f.code);
  }

  for (const r of imp.regionalServices) {
    if (!/^RS[0-9]{2}$/.test(r.code)) issues.push(`regional service ${r.code}: an imported code must be RS01…RS99`);
    if (!terminalCodes.has(r.terminal_code)) issues.push(`regional service ${r.code}: terminal ${r.terminal_code} is not an imported terminal`);
    for (const c of r.fare_rule_codes) if (!fareCodes.has(c)) issues.push(`regional service ${r.code}: unknown fare rule ${c}`);
  }

  // time-estimate parameters (D8, D9)
  for (const key of ETA_PARAM_KEYS) {
    if (!imp.etaParams.some((p) => p.key === key)) issues.push(`eta param ${key} is not imported`);
  }
  for (const p of imp.etaParams) {
    if (!(ETA_PARAM_KEYS as readonly string[]).includes(p.key)) issues.push(`eta param ${p.key}: not a known key`);
    if (p.is_assumption && p.assumption_note === null) issues.push(`eta param ${p.key}: an assumption needs an assumption_note`);
    if (!p.is_assumption && p.source_codes.length === 0) issues.push(`eta param ${p.key}: a value that is not an assumption needs sources`);
    if (p.unit === "windows") {
      if (!p.windows || p.windows.length === 0 || p.days === null) issues.push(`eta param ${p.key}: windows and days are required`);
      for (const w of p.windows ?? []) if (w.start >= w.end) issues.push(`eta param ${p.key}: window ${w.start}–${w.end} is empty`);
    } else {
      if (p.value_low === null || p.value_high === null) issues.push(`eta param ${p.key}: value_low and value_high are required`);
      else if (p.value_low > p.value_high) issues.push(`eta param ${p.key}: value_low is above value_high`);
      if (p.windows !== null) issues.push(`eta param ${p.key}: windows only belong to unit windows`);
    }
  }

  return issues;
}
