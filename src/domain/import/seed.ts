import { z } from "zod";
import type { DetectedConflict } from "./conflicts";
import { parseCsvObjects } from "./csv";
import { COORDINATE_TOLERANCE_DEG, type IdentifiedStop } from "./mapped-stops";

/**
 * Pure normalization of naga_transport_seed.json into typed rows shaped for the ingest/transit
 * tables. NULL means unknown: nothing here defaults a missing value to zero, false or a guess.
 * The JSON is validated with Zod first; a missing status or flag becomes null plus an
 * integrityIssues entry, never a silent default.
 */

// ---------------------------------------------------------------- row types

export type SourceRow = {
  code: string;
  title: string;
  url: string | null;
  evidenceType: string;
  /** Verbatim: a date, a year or a description; null when the seed has none. */
  publishedOrEnacted: string | null;
  checkedOn: string | null;
};

export type LegalStreets = { inbound: string[] | null; outbound: string[] | null; circuit: string[] | null };

export type RouteRow = {
  publicCode: string;
  officialGroupNumber: number | null;
  name: string;
  /** Verbatim seed `mode` (e.g. "PUJ_Class_2_plan"). */
  modeCode: string;
  legalStatus: string;
  operatingStatus: string | null;
  allocatedUnits: number | null;
  allocationIsActiveFleetCount: boolean | null;
  /** Seed `direction` (R8-A…D only). */
  direction: string | null;
  legalStreets: LegalStreets;
  notes: string | null;
  sourceCodes: string[];
  geometry: unknown;
  serviceHours: unknown;
  operator: unknown;
  fareRuleCode: string | null;
  /** Any seed key not mapped above (group_allocated_units, normalization_note, …), verbatim. */
  extra: Record<string, unknown>;
};

export type TrialChangeRow = {
  routeCode: string;
  sourceCode: string;
  adopted: string | null;
  durationDays: number | null;
  permanentStatus: string | null;
  simplifiedCircuit: string[];
};

export type FareRuleRow = {
  code: string;
  modeCode: string;
  baseCentavos: number | null;
  baseKm: number | null;
  incrementCentavosPerKm: number | null;
  discountPercent: number | null;
  discountedBaseCentavos: number | null;
  discountGroups: string[] | null;
  rounding: string | null;
  effectiveFrom: string | null;
  enactedOn: string | null;
  evidenceStatus: string | null;
  publishExact: boolean;
  sourceCodes: string[];
};

export type FareObservationRow = {
  code: string;
  /** Null: the observation is linked to a rule only through a conflict row. */
  ruleCode: string | null;
  modeCode: string;
  category: string;
  amountCentavos: number;
  kind: "reported_practice";
  observedAt: string | null;
  evidenceStatus: string | null;
  sourceCodes: string[];
  details: Record<string, unknown>;
};

export type FareConflictRow = {
  ruleCode: string;
  observationCode: string;
  observationCategory: string;
  status: "open";
  note: string;
};

export type TerminalRow = {
  code: string;
  name: string;
  locationText: string | null;
  modes: string[];
  evidenceStatus: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  sourceCodes: string[];
  entrances: unknown[];
  bays: unknown[];
  hours: unknown;
};

export type ExternalDestinationCategoryRow = {
  category: string;
  destinations: string[];
  candidateTerminalCode: string | null;
  evidenceStatus: string | null;
  sourceCodes: string[];
  details: { farePhp: number | null; serviceHours: unknown; geometry: unknown };
};

export type FeederRow = {
  code: string;
  name: string;
  notes: string | null;
  operatingStatus: string | null;
  fareCentavos: number | null;
  sourceCodes: string[];
  geometry: unknown;
};

export type ProviderRow = {
  name: string;
  cityPresence: string | null;
  products: string[] | null;
  quoteCentavos: number | null;
  sourceCodes: string[];
};

export type BarangayRow = {
  name: string;
  sourceCode: string | null;
  surveyStatus: string;
  exactBoardingPointsVerified: number | null;
};

export type RailStatusRow = { key: string; value: string | null; sourceCodes: string[] };

export type DatasetNoteRow = { key: string; value: unknown };

export type DesignatedCandidateRow = {
  code: string;
  labelRaw: string;
  labelType: string | null;
  routeCode: string | null;
  direction: string | null;
  sourceIds: string[];
  sourceContext: string | null;
  operatingStatus: string | null;
  notes: string | null;
  /** Whole seed object, verbatim. */
  properties: Record<string, unknown>;
};

export type SeedMappedStop = {
  packageId: string;
  sourceLayer: string;
  code: string;
  label: string;
  lat: number;
  lng: number;
  codePrefixMatchesLayer: boolean | null;
};

export type NormalizedSeed = {
  sources: SourceRow[];
  routes: RouteRow[];
  trialChanges: TrialChangeRow[];
  fareRules: FareRuleRow[];
  fareObservations: FareObservationRow[];
  fareConflicts: FareConflictRow[];
  terminals: TerminalRow[];
  externalDestinationCategories: ExternalDestinationCategoryRow[];
  feederCandidates: FeederRow[];
  providers: ProviderRow[];
  barangays: BarangayRow[];
  railStatus: RailStatusRow[];
  designatedCandidates: DesignatedCandidateRow[];
  mappedStopRecords: SeedMappedStop[];
  datasetNotes: DatasetNoteRow[];
  /** Problems found while normalizing (unknown source references, duplicate codes). Empty when clean. */
  integrityIssues: string[];
};

// ---------------------------------------------------------------- schemas (trust boundary)

const str = z.string();
const strs = z.array(z.string());
const php = z.number().finite().nonnegative();
const nn = z.number().finite().nonnegative();

const SourceSchema = z.looseObject({
  id: str,
  title: str,
  url: str.nullish(),
  evidence_type: str,
  published_or_enacted: str.nullish(),
  checked_on: str.nullish(),
});

const RouteSchema = z.looseObject({
  route_id: str,
  name: str,
  mode: str,
  legal_status: str,
  operating_status: str.optional(),
  official_group_number: nn.nullish(),
  allocated_units: nn.nullish(),
  allocation_is_active_fleet_count: z.boolean().optional(),
  direction: str.nullish(),
  inbound_streets: strs.nullish(),
  outbound_streets: strs.nullish(),
  circuit_streets: strs.nullish(),
  sources: strs.nullish(),
  geometry: z.unknown().optional(),
  stops: z.array(z.unknown()).max(0).optional(),
  service_hours: z.unknown().optional(),
  operator: z.unknown().optional(),
  fare_rule_id: str.nullish(),
  notes: str.nullish(),
});

const TrialSchema = z.looseObject({
  route_id: str,
  source: str,
  adopted: str.nullish(),
  duration_days: nn.nullish(),
  permanent_status: str.nullish(),
  simplified_circuit: strs.optional(),
});

const FareSchema = z.looseObject({
  id: str,
  mode: str,
  base_php: php.nullish(),
  base_km: nn.nullish(),
  additional_php_per_km: php.nullish(),
  discount_percent: z.number().finite().min(0).max(100).nullish(),
  discounted_base_php: php.nullish(),
  discounted_base_php_calculated: php.nullish(),
  discount_groups: strs.nullish(),
  rounding_rule: str.nullish(),
  effective_from: str.nullish(),
  ordinance_enacted: str.nullish(),
  evidence_status: str.nullish(),
  sources: strs.nullish(),
  publish_exact_trip_fares: z.boolean().optional(),
  // present only on observations; null or a string is rejected, never coerced
  reported_student_php: php.optional(),
  reported_at: str.nullish(),
});

const TerminalSchema = z.looseObject({
  id: str,
  name: str,
  location_text: str.nullish(),
  modes: strs.optional(),
  evidence_status: str.nullish(),
  notes: str.nullish(),
  latitude: z.number().finite().min(-90).max(90).nullish(),
  longitude: z.number().finite().min(-180).max(180).nullish(),
  sources: strs.nullish(),
  entrances: z.array(z.unknown()).optional(),
  bays: z.array(z.unknown()).optional(),
  hours: z.unknown().optional(),
});

const DestinationSchema = z.looseObject({
  category: str,
  destinations: strs,
  candidate_terminal_id: str.nullish(),
  evidence_status: str.nullish(),
  sources: strs.nullish(),
  fare_php: php.nullish(),
  service_hours: z.unknown().optional(),
  geometry: z.unknown().optional(),
});

const FeederSchema = z.looseObject({
  id: str,
  name: str,
  notes: str.nullish(),
  operating_status: str.optional(),
  fare_php: php.nullish(),
  sources: strs.nullish(),
  geometry: z.unknown().optional(),
});

const ProviderSchema = z.looseObject({
  name: str,
  city_presence: str.nullish(),
  service_types_currently_bookable: strs.nullish(),
  quote_php: php.nullish(),
  sources: strs.nullish(),
});

const BarangaySchema = z.looseObject({
  name: str,
  source: str.nullish(),
  survey_status: str,
  exact_boarding_points_verified: nn.nullish(),
});

const RailSchema = z.looseObject({ sources: strs.nullish() });

const CandidateSchema = z.looseObject({
  id: str,
  label_raw: str,
  label_type: str.nullish(),
  route_id: str.nullish(),
  direction: str.nullish(),
  source_ids: strs.nullish(),
  source_context: str.nullish(),
  operating_status: str.nullish(),
  notes: str.nullish(),
});

const SeedMappedStopSchema = z.looseObject({
  id: str,
  source_stop_code: str,
  label_raw: str,
  source_layer: str,
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  code_prefix_matches_layer: z.boolean().nullish(),
});

const SeedSchema = z.looseObject({
  sources: z.array(SourceSchema),
  routes: z.array(RouteSchema),
  trial_route_changes: z.array(TrialSchema),
  fare_rules: z.array(FareSchema),
  terminals: z.array(TerminalSchema),
  external_destination_categories: z.array(DestinationSchema),
  feeder_candidates: z.array(FeederSchema),
  ride_hailing: z.array(ProviderSchema),
  barangay_audit: z.array(BarangaySchema),
  boarding_points: z.array(z.unknown()).optional(),
  rail_status: RailSchema,
  designated_stop_candidates: z.array(CandidateSchema),
  mapped_stop_records: z.array(SeedMappedStopSchema),
});

const NOTE_KEYS = [
  "dataset_version", "researched_on", "timezone", "geography", "coverage_claim", "navigation_ready",
  "designated_stop_program", "public_stop_map", "stop_inventory_gaps",
] as const;

const KNOWN_TOP_LEVEL = new Set<string>([...Object.keys(SeedSchema.shape), ...NOTE_KEYS]);

function parseSeedSchema(input: unknown) {
  const r = SeedSchema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`Seed: invalid at ${first && first.path.length > 0 ? first.path.join(".") : "root"}: ${first?.message ?? "unknown error"}`);
  }
  return r.data;
}

/** Pesos to integer centavos; rejects non-finite, negative and fractional-centavo values. */
export function pesosToCentavos(value: number, where = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Seed: ${where} (${String(value)}) must be a finite, non-negative number`);
  }
  const c = Math.round(value * 100);
  if (Math.abs(value * 100 - c) > 1e-6) throw new Error(`Seed: ${where} (${value}) is not a whole number of centavos`);
  return c;
}

const centavos = (v: number | null | undefined, where: string): number | null =>
  v === null || v === undefined ? null : pesosToCentavos(v, where);

const KNOWN_ROUTE_KEYS = [
  "route_id", "name", "official_group_number", "mode", "allocated_units", "allocation_is_active_fleet_count",
  "inbound_streets", "outbound_streets", "circuit_streets", "sources", "legal_status", "operating_status",
  "geometry", "stops", "service_hours", "operator", "fare_rule_id", "notes", "direction",
];

function pickExtra(o: Record<string, unknown>, known: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));
}

// ---------------------------------------------------------------- main entry

export function normalizeSeed(input: unknown): NormalizedSeed {
  const seed = parseSeedSchema(input);
  const root = input as Record<string, unknown>;
  const issues: string[] = [];

  for (const key of Object.keys(root)) {
    if (!KNOWN_TOP_LEVEL.has(key)) issues.push(`Unknown top-level seed key "${key}" is not mapped`);
  }

  const sources = seed.sources.map(
    (o): SourceRow => ({
      code: o.id,
      title: o.title,
      url: o.url ?? null,
      evidenceType: o.evidence_type,
      publishedOrEnacted: o.published_or_enacted ?? null,
      checkedOn: o.checked_on ?? null,
    }),
  );

  const routes = seed.routes.map((o): RouteRow => {
    if (o.operating_status === undefined) issues.push(`route ${o.route_id}: operating_status is missing`);
    if (o.allocation_is_active_fleet_count === undefined) {
      issues.push(`route ${o.route_id}: allocation_is_active_fleet_count is missing`);
    }
    return {
      publicCode: o.route_id,
      officialGroupNumber: o.official_group_number ?? null,
      name: o.name,
      modeCode: o.mode,
      legalStatus: o.legal_status,
      operatingStatus: o.operating_status ?? null,
      allocatedUnits: o.allocated_units ?? null,
      allocationIsActiveFleetCount: o.allocation_is_active_fleet_count ?? null,
      direction: o.direction ?? null,
      legalStreets: {
        inbound: o.inbound_streets ?? null,
        outbound: o.outbound_streets ?? null,
        circuit: o.circuit_streets ?? null,
      },
      notes: o.notes ?? null,
      sourceCodes: o.sources ?? [],
      geometry: o.geometry ?? null,
      serviceHours: o.service_hours ?? null,
      operator: o.operator ?? null,
      fareRuleCode: o.fare_rule_id ?? null,
      extra: pickExtra(o, KNOWN_ROUTE_KEYS),
    };
  });

  const trialChanges = seed.trial_route_changes.map(
    (o): TrialChangeRow => ({
      routeCode: o.route_id,
      sourceCode: o.source,
      adopted: o.adopted ?? null,
      durationDays: o.duration_days ?? null,
      permanentStatus: o.permanent_status ?? null,
      simplifiedCircuit: o.simplified_circuit ?? [],
    }),
  );

  const fareRules: FareRuleRow[] = [];
  const fareObservations: FareObservationRow[] = [];
  const fareConflicts: FareConflictRow[] = [];
  // Seed-calculated (not official) discounted bases, kept out of the rule rows.
  const calculatedDiscountedBase = new Map<string, number>();

  for (const o of seed.fare_rules) {
    const where = `fare_rules.${o.id}`;
    if (o.reported_student_php !== undefined) {
      fareObservations.push({
        code: o.id,
        ruleCode: null,
        modeCode: o.mode,
        category: "student",
        amountCentavos: pesosToCentavos(o.reported_student_php, `${where}.reported_student_php`),
        kind: "reported_practice",
        observedAt: o.reported_at ?? null,
        evidenceStatus: o.evidence_status ?? null,
        sourceCodes: o.sources ?? [],
        details: { reportedBaseCentavos: centavos(o.base_php, `${where}.base_php`), publishExact: o.publish_exact_trip_fares === true },
      });
      continue;
    }
    const calc = centavos(o.discounted_base_php_calculated, `${where}.discounted_base_php_calculated`);
    if (calc !== null) calculatedDiscountedBase.set(o.id, calc);
    fareRules.push({
      code: o.id,
      modeCode: o.mode,
      baseCentavos: centavos(o.base_php, `${where}.base_php`),
      baseKm: o.base_km ?? null,
      incrementCentavosPerKm: centavos(o.additional_php_per_km, `${where}.additional_php_per_km`),
      discountPercent: o.discount_percent ?? null,
      // official value only; a calculated one is never stored as the rule's value
      discountedBaseCentavos: centavos(o.discounted_base_php, `${where}.discounted_base_php`),
      discountGroups: o.discount_groups ?? null,
      rounding: o.rounding_rule ?? null,
      effectiveFrom: o.effective_from ?? null,
      enactedOn: o.ordinance_enacted ?? null,
      evidenceStatus: o.evidence_status ?? null,
      publishExact: o.publish_exact_trip_fares === true,
      sourceCodes: o.sources ?? [],
    });
  }

  // The reported price conflicts with the 20 percent calculation, which is F03's rule
  // (seed evidence_status; spec 03 and 04). The conflict is recorded, never applied.
  const f03 = fareRules.find((f) => f.code === "F03");
  for (const observation of fareObservations) {
    const calc = calculatedDiscountedBase.get("F03");
    if (!f03 || calc === undefined) {
      issues.push(`Fare observation ${observation.code} cannot be compared: rule F03 or its calculated discounted base is missing`);
      continue;
    }
    observation.details = { ...observation.details, calculatedDiscountedBaseCentavos: calc };
    fareConflicts.push({
      ruleCode: f03.code,
      observationCode: observation.code,
      observationCategory: observation.category,
      status: "open",
      note: `Reported ${observation.category} fare ${observation.amountCentavos} centavos (${observation.observedAt ?? "date unknown"}) differs from the ${f03.discountPercent ?? "?"} percent discount calculated on ${f03.code} (${calc} centavos, seed arithmetic). Reported practice only; never applied.`,
    });
  }

  const terminals = seed.terminals.map(
    (o): TerminalRow => ({
      code: o.id,
      name: o.name,
      locationText: o.location_text ?? null,
      modes: o.modes ?? [],
      evidenceStatus: o.evidence_status ?? null,
      notes: o.notes ?? null,
      lat: o.latitude ?? null,
      lng: o.longitude ?? null,
      sourceCodes: o.sources ?? [],
      entrances: o.entrances ?? [],
      bays: o.bays ?? [],
      hours: o.hours ?? null,
    }),
  );

  const externalDestinationCategories = seed.external_destination_categories.map(
    (o): ExternalDestinationCategoryRow => ({
      category: o.category,
      destinations: o.destinations,
      candidateTerminalCode: o.candidate_terminal_id ?? null,
      evidenceStatus: o.evidence_status ?? null,
      sourceCodes: o.sources ?? [],
      details: { farePhp: o.fare_php ?? null, serviceHours: o.service_hours ?? null, geometry: o.geometry ?? null },
    }),
  );

  const feederCandidates = seed.feeder_candidates.map((o): FeederRow => {
    if (o.operating_status === undefined) issues.push(`feeder ${o.id}: operating_status is missing`);
    return {
      code: o.id,
      name: o.name,
      notes: o.notes ?? null,
      operatingStatus: o.operating_status ?? null,
      fareCentavos: centavos(o.fare_php, `feeder ${o.id}.fare_php`),
      sourceCodes: o.sources ?? [],
      geometry: o.geometry ?? null,
    };
  });

  const providers = seed.ride_hailing.map(
    (o): ProviderRow => ({
      name: o.name,
      cityPresence: o.city_presence ?? null,
      products: o.service_types_currently_bookable ?? null,
      quoteCentavos: centavos(o.quote_php, `provider ${o.name}.quote_php`),
      sourceCodes: o.sources ?? [],
    }),
  );

  const barangays = seed.barangay_audit.map(
    (o): BarangayRow => ({
      name: o.name,
      sourceCode: o.source ?? null,
      surveyStatus: o.survey_status,
      exactBoardingPointsVerified: o.exact_boarding_points_verified ?? null,
    }),
  );

  const railSources = seed.rail_status.sources ?? [];
  const railStatus = Object.keys(seed.rail_status)
    .filter((k) => k !== "sources")
    .map((key): RailStatusRow => {
      const v = (seed.rail_status as Record<string, unknown>)[key];
      if (v !== null && typeof v !== "string") throw new Error(`Seed: rail_status.${key} must be a string or null`);
      return { key, value: v, sourceCodes: railSources };
    });

  const designatedCandidates = seed.designated_stop_candidates.map(
    (o): DesignatedCandidateRow => ({
      code: o.id,
      labelRaw: o.label_raw,
      labelType: o.label_type ?? null,
      routeCode: o.route_id ?? null,
      direction: o.direction ?? null,
      sourceIds: o.source_ids ?? [],
      sourceContext: o.source_context ?? null,
      operatingStatus: o.operating_status ?? null,
      notes: o.notes ?? null,
      properties: o,
    }),
  );

  const mappedStopRecords = seed.mapped_stop_records.map(
    (o): SeedMappedStop => ({
      packageId: o.id,
      sourceLayer: o.source_layer,
      code: o.source_stop_code,
      label: o.label_raw,
      lat: o.latitude,
      lng: o.longitude,
      codePrefixMatchesLayer: o.code_prefix_matches_layer ?? null,
    }),
  );

  if ((seed.boarding_points ?? []).length > 0) issues.push("boarding_points is not empty; this importer does not map it");

  const datasetNotes: DatasetNoteRow[] = NOTE_KEYS.map((key) => {
    if (root[key] === undefined) throw new Error(`Seed: ${key} is missing`);
    return { key, value: root[key] };
  });

  // integrity: unique codes and resolvable source references
  const known = new Set(sources.map((s) => s.code));
  if (known.size !== sources.length) issues.push("Duplicate source codes");
  const checkRefs = (kind: string, id: string, codes: string[]) => {
    for (const c of codes) if (!known.has(c)) issues.push(`${kind} ${id} references unknown source ${c}`);
  };
  routes.forEach((r) => checkRefs("route", r.publicCode, r.sourceCodes));
  trialChanges.forEach((t) => checkRefs("trial change", t.routeCode, [t.sourceCode]));
  fareRules.forEach((f) => checkRefs("fare rule", f.code, f.sourceCodes));
  fareObservations.forEach((f) => checkRefs("fare observation", f.code, f.sourceCodes));
  terminals.forEach((t) => checkRefs("terminal", t.code, t.sourceCodes));
  externalDestinationCategories.forEach((c) => checkRefs("destination category", c.category, c.sourceCodes));
  feederCandidates.forEach((f) => checkRefs("feeder", f.code, f.sourceCodes));
  providers.forEach((p) => checkRefs("provider", p.name, p.sourceCodes));
  railStatus.forEach((r) => checkRefs("rail status", r.key, r.sourceCodes));
  designatedCandidates.forEach((c) => checkRefs("designated candidate", c.code, c.sourceIds));
  barangays.forEach((b) => b.sourceCode !== null && checkRefs("barangay", b.name, [b.sourceCode]));
  const dupe = (label: string, values: string[]) => {
    if (new Set(values).size !== values.length) issues.push(`Duplicate ${label}`);
  };
  dupe("route codes", routes.map((r) => r.publicCode));
  dupe("terminal codes", terminals.map((t) => t.code));
  dupe("designated candidate codes", designatedCandidates.map((c) => c.code));
  dupe("barangay names", barangays.map((b) => b.name));
  dupe("seed mapped stop ids", mappedStopRecords.map((m) => m.packageId));
  for (const r of routes) {
    if (r.fareRuleCode !== null && !fareRules.some((f) => f.code === r.fareRuleCode)) {
      issues.push(`route ${r.publicCode} references unknown fare rule ${r.fareRuleCode}`);
    }
  }
  for (const t of trialChanges) {
    if (!routes.some((r) => r.publicCode === t.routeCode)) issues.push(`trial change references unknown route ${t.routeCode}`);
  }

  return {
    sources, routes, trialChanges, fareRules, fareObservations, fareConflicts, terminals,
    externalDestinationCategories, feederCandidates, providers, barangays, railStatus,
    designatedCandidates, mappedStopRecords, datasetNotes, integrityIssues: issues,
  };
}

/**
 * The seed carries a fourth copy of the 128 pins. Checks it against the snapshot (same package ids,
 * layer, code, label, coordinates) and that its code_prefix_matches_layer=false set equals the set of
 * code_prefix_mismatch conflicts. Empty array means agreement.
 */
export function crossCheckSeedMappedStops(
  seedRecords: SeedMappedStop[],
  snapshot: IdentifiedStop[],
  conflicts: DetectedConflict[],
): string[] {
  const errors: string[] = [];
  if (seedRecords.length !== snapshot.length) {
    errors.push(`seed mapped_stop_records count ${seedRecords.length}, snapshot has ${snapshot.length}`);
  }
  const byPackage = new Map(snapshot.map((r) => [r.packageId, r]));
  for (const s of seedRecords) {
    const r = byPackage.get(s.packageId);
    if (!r) {
      errors.push(`${s.packageId}: in seed but not in snapshot`);
      continue;
    }
    if (r.sourceLayer !== s.sourceLayer || r.code !== s.code || r.label !== s.label) {
      errors.push(`${s.packageId}: layer, code or label differs from snapshot`);
    }
    if (Math.abs(r.lat - s.lat) > COORDINATE_TOLERANCE_DEG || Math.abs(r.lng - s.lng) > COORDINATE_TOLERANCE_DEG) {
      errors.push(`${s.packageId}: coordinates differ from snapshot`);
    }
  }
  const seedFalse = new Set(seedRecords.filter((s) => s.codePrefixMatchesLayer === false).map((s) => s.packageId));
  const byIdentity = new Map(snapshot.map((r) => [r.sourceIdentity, r]));
  const detected = new Set(
    conflicts
      .filter((c) => c.kind === "code_prefix_mismatch")
      .map((c) => byIdentity.get(c.refs[0]!)?.packageId ?? ""),
  );
  for (const id of seedFalse) if (!detected.has(id)) errors.push(`${id}: seed says code prefix mismatch, detectConflicts does not`);
  for (const id of detected) if (!seedFalse.has(id)) errors.push(`${id}: detectConflicts reports a prefix mismatch, seed does not`);
  return errors;
}

/** dataset_note row (transit.dataset_note: key, value jsonb) holding the survey import columns. */
export function surveyTemplateNote(header: string[]): DatasetNoteRow {
  return { key: "survey_template_columns", value: { columns: header, count: header.length } };
}

// ---------------------------------------------------------------- designated_stop_candidates.csv

/** Compares the seed's candidates with designated_stop_candidates.csv; empty array means agreement. */
export function crossCheckDesignatedCsv(candidates: DesignatedCandidateRow[], csvText: string): string[] {
  const { rows } = parseCsvObjects(csvText);
  const errors: string[] = [];
  if (rows.length !== candidates.length) {
    errors.push(`designated candidates count: CSV has ${rows.length}, seed has ${candidates.length}`);
  }
  const byCode = new Map(candidates.map((c) => [c.code, c]));
  const csvCodes = new Set<string>();
  for (const r of rows) {
    const id = r.id!;
    csvCodes.add(id);
    const c = byCode.get(id);
    if (!c) {
      errors.push(`${id}: in CSV but not in seed`);
      continue;
    }
    const expected: Record<string, string> = {
      label_raw: c.labelRaw,
      route_id: c.routeCode ?? "",
      direction: c.direction ?? "",
      source_ids: c.sourceIds.join(";"),
      operating_status: c.operatingStatus ?? "",
      latitude: c.properties.latitude === null || c.properties.latitude === undefined ? "" : String(c.properties.latitude),
      longitude: c.properties.longitude === null || c.properties.longitude === undefined ? "" : String(c.properties.longitude),
      curb_side: c.properties.curb_side === null || c.properties.curb_side === undefined ? "" : String(c.properties.curb_side),
      navigation_ready: c.properties.navigation_ready === true ? "True" : c.properties.navigation_ready === false ? "False" : "",
    };
    for (const [col, want] of Object.entries(expected)) {
      if (r[col] !== want) errors.push(`${id}: ${col} differs (CSV "${r[col]}", seed "${want}")`);
    }
  }
  for (const c of candidates) if (!csvCodes.has(c.code)) errors.push(`${c.code}: in seed but not in CSV`);
  return errors;
}
