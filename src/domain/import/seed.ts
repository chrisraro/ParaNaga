import { parseCsvObjects } from "./csv";

/**
 * Pure normalization of naga_transport_seed.json into typed rows shaped for the ingest/transit
 * tables. NULL means unknown: nothing here defaults a missing value to zero, false or a guess.
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
  operatingStatus: string;
  allocatedUnits: number | null;
  allocationIsActiveFleetCount: boolean;
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
  operatingStatus: string;
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
  datasetNotes: DatasetNoteRow[];
  /** Problems found while normalizing (unknown source references, duplicate codes). Empty when clean. */
  integrityIssues: string[];
};

// ---------------------------------------------------------------- helpers

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function obj(v: unknown, where: string): Obj {
  if (!isObj(v)) throw new Error(`Seed: ${where} must be an object`);
  return v;
}

function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`Seed: ${where} must be an array`);
  return v;
}

function reqStr(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new Error(`Seed: ${where}.${key} must be a string`);
  return v;
}

const optStr = (o: Obj, key: string): string | null => (typeof o[key] === "string" ? (o[key] as string) : null);
const optNum = (o: Obj, key: string): number | null => (typeof o[key] === "number" && Number.isFinite(o[key]) ? (o[key] as number) : null);

function strList(v: unknown, where: string): string[] {
  const a = arr(v, where);
  if (!a.every((x) => typeof x === "string")) throw new Error(`Seed: ${where} must be a list of strings`);
  return a as string[];
}

function optStrList(o: Obj, key: string, where: string): string[] | null {
  return o[key] === null || o[key] === undefined ? null : strList(o[key], `${where}.${key}`);
}

function sourceList(o: Obj, key: string, where: string): string[] {
  return o[key] === undefined || o[key] === null ? [] : strList(o[key], `${where}.${key}`);
}

/** Pesos to integer centavos; rejects values that are not whole centavos. */
export function pesosToCentavos(php: number, where = "amount"): number {
  const c = Math.round(php * 100);
  if (Math.abs(php * 100 - c) > 1e-6) throw new Error(`Seed: ${where} (${php}) is not a whole number of centavos`);
  return c;
}

const optCentavos = (o: Obj, key: string, where: string): number | null => {
  const n = optNum(o, key);
  return n === null ? null : pesosToCentavos(n, `${where}.${key}`);
};

function pick(o: Obj, known: string[]): Obj {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));
}

// ---------------------------------------------------------------- normalizers

function normalizeRoute(raw: unknown, i: number): RouteRow {
  const where = `routes[${i}]`;
  const o = obj(raw, where);
  const known = [
    "route_id", "name", "official_group_number", "mode", "allocated_units", "allocation_is_active_fleet_count",
    "inbound_streets", "outbound_streets", "circuit_streets", "sources", "legal_status", "operating_status",
    "geometry", "stops", "service_hours", "operator", "fare_rule_id", "notes", "direction",
  ];
  if (arr(o.stops ?? [], `${where}.stops`).length > 0) throw new Error(`Seed: ${where}.stops is not empty; surveyed stops are not expected in this seed`);
  return {
    publicCode: reqStr(o, "route_id", where),
    officialGroupNumber: optNum(o, "official_group_number"),
    name: reqStr(o, "name", where),
    modeCode: reqStr(o, "mode", where),
    legalStatus: reqStr(o, "legal_status", where),
    operatingStatus: optStr(o, "operating_status") ?? "unverified",
    allocatedUnits: optNum(o, "allocated_units"),
    allocationIsActiveFleetCount: o.allocation_is_active_fleet_count === true,
    direction: optStr(o, "direction"),
    legalStreets: {
      inbound: optStrList(o, "inbound_streets", where),
      outbound: optStrList(o, "outbound_streets", where),
      circuit: optStrList(o, "circuit_streets", where),
    },
    notes: optStr(o, "notes"),
    sourceCodes: sourceList(o, "sources", where),
    geometry: o.geometry ?? null,
    serviceHours: o.service_hours ?? null,
    operator: o.operator ?? null,
    fareRuleCode: optStr(o, "fare_rule_id"),
    extra: pick(o, known),
  };
}

function normalizeFare(raw: unknown, i: number): { rule?: FareRuleRow; observation?: FareObservationRow } {
  const where = `fare_rules[${i}]`;
  const o = obj(raw, where);
  const code = reqStr(o, "id", where);
  const mode = reqStr(o, "mode", where);

  // A rule carries the official or national rate. A "reported student" price is an observation, not a rule.
  if (o.reported_student_php !== undefined) {
    const amount = pesosToCentavos(o.reported_student_php as number, `${where}.reported_student_php`);
    const baseCentavos = optCentavos(o, "base_php", where);
    const observation: FareObservationRow = {
      code,
      ruleCode: null,
      modeCode: mode,
      category: "student",
      amountCentavos: amount,
      kind: "reported_practice",
      observedAt: optStr(o, "reported_at"),
      evidenceStatus: optStr(o, "evidence_status"),
      sourceCodes: sourceList(o, "sources", where),
      details: { reportedBaseCentavos: baseCentavos, publishExact: o.publish_exact_trip_fares === true },
    };
    return { observation };
  }

  const rule: FareRuleRow = {
    code,
    modeCode: mode,
    baseCentavos: optCentavos(o, "base_php", where),
    baseKm: optNum(o, "base_km"),
    incrementCentavosPerKm: optCentavos(o, "additional_php_per_km", where),
    discountPercent: optNum(o, "discount_percent"),
    discountedBaseCentavos:
      optCentavos(o, "discounted_base_php", where) ?? optCentavos(o, "discounted_base_php_calculated", where),
    discountGroups: optStrList(o, "discount_groups", where),
    rounding: optStr(o, "rounding_rule"),
    effectiveFrom: optStr(o, "effective_from"),
    enactedOn: optStr(o, "ordinance_enacted"),
    evidenceStatus: optStr(o, "evidence_status"),
    publishExact: o.publish_exact_trip_fares === true,
    sourceCodes: sourceList(o, "sources", where),
  };
  return { rule };
}

// ---------------------------------------------------------------- main entry

export function normalizeSeed(input: unknown): NormalizedSeed {
  const seed = obj(input, "root");
  const issues: string[] = [];

  const sources = arr(seed.sources, "sources").map((raw, i): SourceRow => {
    const o = obj(raw, `sources[${i}]`);
    return {
      code: reqStr(o, "id", `sources[${i}]`),
      title: reqStr(o, "title", `sources[${i}]`),
      url: optStr(o, "url"),
      evidenceType: reqStr(o, "evidence_type", `sources[${i}]`),
      publishedOrEnacted: optStr(o, "published_or_enacted"),
      checkedOn: optStr(o, "checked_on"),
    };
  });

  const routes = arr(seed.routes, "routes").map(normalizeRoute);

  const trialChanges = arr(seed.trial_route_changes, "trial_route_changes").map((raw, i): TrialChangeRow => {
    const o = obj(raw, `trial_route_changes[${i}]`);
    return {
      routeCode: reqStr(o, "route_id", `trial_route_changes[${i}]`),
      sourceCode: reqStr(o, "source", `trial_route_changes[${i}]`),
      adopted: optStr(o, "adopted"),
      durationDays: optNum(o, "duration_days"),
      permanentStatus: optStr(o, "permanent_status"),
      simplifiedCircuit: strList(o.simplified_circuit ?? [], `trial_route_changes[${i}].simplified_circuit`),
    };
  });

  const fareRules: FareRuleRow[] = [];
  const fareObservations: FareObservationRow[] = [];
  const fareConflicts: FareConflictRow[] = [];
  arr(seed.fare_rules, "fare_rules").forEach((raw, i) => {
    const r = normalizeFare(raw, i);
    if (r.rule) fareRules.push(r.rule);
    if (r.observation) fareObservations.push(r.observation);
  });
  // The seed (F05 evidence_status) says the reported price conflicts with the 20 percent calculation,
  // which is F03's rule (and the project spec names F03). The conflict is recorded, never applied.
  const f03 = fareRules.find((f) => f.code === "F03");
  for (const observation of fareObservations) {
    if (!f03 || f03.discountedBaseCentavos === null) {
      issues.push(`Fare observation ${observation.code} cannot be compared: rule F03 or its discounted base is missing`);
      continue;
    }
    observation.details = { ...observation.details, calculatedDiscountedBaseCentavos: f03.discountedBaseCentavos };
    fareConflicts.push({
      ruleCode: f03.code,
      observationCode: observation.code,
      observationCategory: observation.category,
      status: "open",
      note: `Reported ${observation.category} fare ${observation.amountCentavos} centavos (${observation.observedAt ?? "date unknown"}) differs from the ${f03.discountPercent ?? "?"} percent discount calculated on ${f03.code} (${f03.discountedBaseCentavos} centavos). Reported practice only; never applied.`,
    });
  }

  const terminals = arr(seed.terminals, "terminals").map((raw, i): TerminalRow => {
    const o = obj(raw, `terminals[${i}]`);
    const w = `terminals[${i}]`;
    return {
      code: reqStr(o, "id", w),
      name: reqStr(o, "name", w),
      locationText: optStr(o, "location_text"),
      modes: strList(o.modes ?? [], `${w}.modes`),
      evidenceStatus: optStr(o, "evidence_status"),
      notes: optStr(o, "notes"),
      lat: optNum(o, "latitude"),
      lng: optNum(o, "longitude"),
      sourceCodes: sourceList(o, "sources", w),
      entrances: arr(o.entrances ?? [], `${w}.entrances`),
      bays: arr(o.bays ?? [], `${w}.bays`),
      hours: o.hours ?? null,
    };
  });

  const externalDestinationCategories = arr(seed.external_destination_categories, "external_destination_categories").map(
    (raw, i): ExternalDestinationCategoryRow => {
      const o = obj(raw, `external_destination_categories[${i}]`);
      const w = `external_destination_categories[${i}]`;
      return {
        category: reqStr(o, "category", w),
        destinations: strList(o.destinations, `${w}.destinations`),
        candidateTerminalCode: optStr(o, "candidate_terminal_id"),
        evidenceStatus: optStr(o, "evidence_status"),
        sourceCodes: sourceList(o, "sources", w),
        details: { farePhp: optNum(o, "fare_php"), serviceHours: o.service_hours ?? null, geometry: o.geometry ?? null },
      };
    },
  );

  const feederCandidates = arr(seed.feeder_candidates, "feeder_candidates").map((raw, i): FeederRow => {
    const o = obj(raw, `feeder_candidates[${i}]`);
    const w = `feeder_candidates[${i}]`;
    return {
      code: reqStr(o, "id", w),
      name: reqStr(o, "name", w),
      notes: optStr(o, "notes"),
      operatingStatus: optStr(o, "operating_status") ?? "unverified",
      fareCentavos: optCentavos(o, "fare_php", w),
      sourceCodes: sourceList(o, "sources", w),
      geometry: o.geometry ?? null,
    };
  });

  const providers = arr(seed.ride_hailing, "ride_hailing").map((raw, i): ProviderRow => {
    const o = obj(raw, `ride_hailing[${i}]`);
    const w = `ride_hailing[${i}]`;
    return {
      name: reqStr(o, "name", w),
      cityPresence: optStr(o, "city_presence"),
      products: optStrList(o, "service_types_currently_bookable", w),
      quoteCentavos: optCentavos(o, "quote_php", w),
      sourceCodes: sourceList(o, "sources", w),
    };
  });

  const barangays = arr(seed.barangay_audit, "barangay_audit").map((raw, i): BarangayRow => {
    const o = obj(raw, `barangay_audit[${i}]`);
    return {
      name: reqStr(o, "name", `barangay_audit[${i}]`),
      sourceCode: optStr(o, "source"),
      surveyStatus: reqStr(o, "survey_status", `barangay_audit[${i}]`),
      exactBoardingPointsVerified: optNum(o, "exact_boarding_points_verified"),
    };
  });

  const rail = obj(seed.rail_status, "rail_status");
  const railSources = sourceList(rail, "sources", "rail_status");
  const railStatus = Object.keys(rail)
    .filter((k) => k !== "sources")
    .map((key): RailStatusRow => {
      const v = rail[key];
      if (v !== null && typeof v !== "string") throw new Error(`Seed: rail_status.${key} must be a string or null`);
      return { key, value: v, sourceCodes: railSources };
    });

  const designatedCandidates = arr(seed.designated_stop_candidates, "designated_stop_candidates").map(
    (raw, i): DesignatedCandidateRow => {
      const o = obj(raw, `designated_stop_candidates[${i}]`);
      const w = `designated_stop_candidates[${i}]`;
      return {
        code: reqStr(o, "id", w),
        labelRaw: reqStr(o, "label_raw", w),
        labelType: optStr(o, "label_type"),
        routeCode: optStr(o, "route_id"),
        direction: optStr(o, "direction"),
        sourceIds: sourceList(o, "source_ids", w),
        sourceContext: optStr(o, "source_context"),
        operatingStatus: optStr(o, "operating_status"),
        notes: optStr(o, "notes"),
        properties: o,
      };
    },
  );

  if (arr(seed.boarding_points ?? [], "boarding_points").length > 0) {
    issues.push("boarding_points is not empty; this importer does not map it");
  }

  const datasetNotes: DatasetNoteRow[] = [
    "dataset_version",
    "coverage_claim",
    "designated_stop_program",
    "public_stop_map",
    "stop_inventory_gaps",
  ].map((key) => {
    if (seed[key] === undefined) throw new Error(`Seed: ${key} is missing`);
    return { key, value: seed[key] };
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
  for (const r of routes) if (r.fareRuleCode !== null && !fareRules.some((f) => f.code === r.fareRuleCode)) issues.push(`route ${r.publicCode} references unknown fare rule ${r.fareRuleCode}`);
  for (const t of trialChanges) if (!routes.some((r) => r.publicCode === t.routeCode)) issues.push(`trial change references unknown route ${t.routeCode}`);

  return {
    sources,
    routes,
    trialChanges,
    fareRules,
    fareObservations,
    fareConflicts,
    terminals,
    externalDestinationCategories,
    feederCandidates,
    providers,
    barangays,
    railStatus,
    designatedCandidates,
    datasetNotes,
    integrityIssues: issues,
  };
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
