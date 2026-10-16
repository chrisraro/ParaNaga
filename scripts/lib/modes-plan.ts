// Pure planning step for the reviewed modes seed (data/source/research/naga-modes-seed-*.json,
// Increment D Task 2). Reads nothing but the bytes it is given plus the normalized Data_Sets seed,
// validates the file (src/domain/import/modes-seed.ts), keeps only `review.decision = "import"`
// records and returns every row the writer needs, each with a content hash, plus the excluded
// records with their reason and a list of problems. The writer refuses to run while `problems`
// is non-empty.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../../src/domain/import/hash";
import {
  excludedRecords,
  importableRecords,
  parseModesSeed,
  validateModesSeed,
  type ModesSeed,
  type ModesSeedPadyakArea,
  type ModesSeedRoadRule,
} from "../../src/domain/import/modes-seed";
import type { FareRuleRow, NormalizedSeed } from "../../src/domain/import/seed";

export const MODES_DIR = "data/source/research";
export const MODES_FILE_RE = /^naga-modes-seed-(\d{4}-\d{2}-\d{2})\.json$/;

export type ModesFile = { fileName: string; bytes: Buffer };

/** The newest `naga-modes-seed-YYYY-MM-DD.json` in `dir` (by the date in its name), or null. */
export function readNewestModesSeed(dir: string = MODES_DIR): ModesFile | null {
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir).filter((f) => MODES_FILE_RE.test(f)).sort().at(-1);
  return newest ? { fileName: newest, bytes: readFileSync(path.join(dir, newest)) } : null;
}

export type PlannedSource = {
  code: string;
  title: string;
  url: string | null;
  evidenceType: string;
  publishedOrEnacted: string;
  checkedOn: string;
  publisher: string;
  licence: string | null;
  extraUrls: string[];
};

export type PlannedTerminal = {
  code: string;
  name: string;
  kind: string;
  locationText: string | null;
  modes: string[];
  modesRaw: string[];
  modeSources: Record<string, string[]>;
  lat: number | null;
  lng: number | null;
  coordSource: string | null;
  osmType: string | null;
  osmId: number | null;
  osmVersion: number | null;
  osmTimestamp: string | null;
  coordNote: string | null;
  coordReadFrom: string | null;
  verification: string;
  statusNote: string | null;
  notes: string | null;
  sourceCodes: string[];
  contentHash: string;
};

export type PlannedModesVariant = {
  direction: "branch" | "circuit" | "inbound" | "outbound";
  kind: "permanent";
  name: string;
  legalStreets: Record<string, string[]>;
  anchors: unknown[];
  evidenceLevel: "documentary";
  sourceCodes: string[];
  contentHash: string;
};

export type PlannedModesRoute = {
  publicCode: string;
  name: string;
  /** Verbatim seed mode (also the route's `mode`). */
  modeCode: string;
  mode: string;
  serviceStatus: string;
  planning: "none";
  allocatedUnits: number | null;
  notes: string | null;
  sourceCodes: string[];
  properties: Record<string, unknown>;
  variants: PlannedModesVariant[];
};

export type PlannedOperatingStatus = {
  routeCode: string;
  operatingStatus: string;
  statusNote: string;
  confirmedOn: string;
  sourceCodes: string[];
  contentHash: string;
};

export type PlannedVehicleClass = {
  routeCode: string;
  code: string;
  vehicleClass: string;
  evidenceLevels: string[];
  status: string;
  firstReportedOn: string | null;
  lastReportedOn: string | null;
  unitsNote: string | null;
  aircon: boolean | null;
  airconSourceCodes: string[];
  cooperatives: string[];
  conflictNotes: string[];
  notes: string | null;
  sourceCodes: string[];
  contentHash: string;
};

export type PlannedCooperative = {
  routeCode: string;
  name: string;
  basis: string;
  reportedOn: string;
  notes: string | null;
  sourceCodes: string[];
  contentHash: string;
};

export type PlannedRouteFareObservation = {
  routeCode: string;
  code: string;
  vehicleClass: string;
  kind: string;
  relativeTo: string;
  deltaQualifier: string;
  deltaCentavosLow: number;
  deltaCentavosHigh: number | null;
  observedOn: string;
  reportText: string;
  notes: string | null;
  sourceCodes: string[];
  contentHash: string;
};

export type PlannedRegionalService = {
  code: string;
  mode: string;
  name: string;
  operators: string[];
  terminalCode: string;
  terminalNote: string;
  destination: string;
  osmRelationIds: number[];
  status: string;
  fareRuleCodes: string[];
  notes: string | null;
  sourceCodes: string[];
  contentHash: string;
};

/** A fare rule version to write: a new rule (F06…) or a new version of a Data_Sets rule with sources added. */
export type PlannedModesFareRule = FareRuleRow & {
  ruleText: string | null;
  notes: string | null;
  /** true: the rule (code) is new here; false: a new version of an existing Data_Sets rule. */
  isNewRule: boolean;
  contentHash: string;
};

/** A time-estimate parameter (D8/D9), written with the road outputs (scripts/lib/lines-writer.ts). */
export type PlannedEtaParam = {
  key: string;
  valueLow: number | null;
  valueHigh: number | null;
  unit: "km_per_h" | "factor" | "windows";
  windows: { start: string; end: string }[] | null;
  days: "every_day" | null;
  appliesTo: string[];
  isAssumption: boolean;
  assumptionNote: string | null;
  basis: string;
  sourceCodes: string[];
  contentHash: string;
};

/** A reviewed legal-name → OSM-name street alias for the path tracer (Task 5). */
export type PlannedStreetAlias = {
  legalName: string;
  osmName: string;
  osmWayIds: number[];
  evidenceSnapshot: string;
  reason: string;
};

export type PlannedResearchConflict = {
  code: string;
  topic: string;
  description: string;
  refs: string[];
  sourceCodes: string[];
};

/** A reviewed route note (E-J7): one per seed note and route; the writer resolves the route id. */
export type PlannedRouteNote = {
  routeCode: string;
  noteCode: string;
  text: string;
  evidence: string;
  nearLat: number | null;
  nearLng: number | null;
  nearRadiusM: number | null;
  sourceCodes: string[];
  contentHash: string;
};

export type ModesPlan = {
  fileName: string;
  sha256: string;
  bytes: number;
  /** YYYY-MM-DD from the file name; must equal header.preparedOn. */
  seedDate: string;
  /** ingest.batch.snapshot_version, e.g. modes-seed:2026-10-16. */
  snapshotVersion: string;
  /** `modes-{date}`; the road outputs then publish `anywhere-alight-{roads date}` on top (lines-writer). */
  revisionLabel: string;
  synthetic: boolean;
  sources: PlannedSource[];
  terminals: PlannedTerminal[];
  routes: PlannedModesRoute[];
  operatingStatuses: PlannedOperatingStatus[];
  vehicleClasses: PlannedVehicleClass[];
  cooperatives: PlannedCooperative[];
  routeFareObservations: PlannedRouteFareObservation[];
  regionalServices: PlannedRegionalService[];
  fareRules: PlannedModesFareRule[];
  conflicts: PlannedResearchConflict[];
  etaParams: PlannedEtaParam[];
  streetAliases: PlannedStreetAlias[];
  /** Imported road rules and padyak areas (street graph v2, lines plan) and route notes (lines writer). */
  roadRules: ModesSeedRoadRule[];
  padyakAreas: ModesSeedPadyakArea[];
  routeNotes: PlannedRouteNote[];
  /** `kind code: reason` for every record the review excluded. */
  excluded: string[];
  /** Imported records that this task does not write yet, with the reason. */
  deferred: Record<string, string>;
  counts: Record<string, number>;
  problems: string[];
};

/** Content hash of a row: kind + synthetic marker + content (no ids), so equal content hashes equal. */
function hashOf(kind: string, synthetic: boolean, content: unknown): string {
  return sha256Hex(JSON.stringify(synthetic ? [kind, "synthetic", content] : [kind, content]));
}

const dedupe = (list: string[]) => [...new Set(list)];

export function buildModesPlan(file: ModesFile, dataSets: NormalizedSeed): ModesPlan {
  const problems: string[] = [];
  const nameDate = MODES_FILE_RE.exec(file.fileName)?.[1] ?? "";
  if (!nameDate) problems.push(`${file.fileName}: not named naga-modes-seed-YYYY-MM-DD.json`);
  const base = {
    fileName: file.fileName,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
    bytes: file.bytes.byteLength,
    seedDate: nameDate,
    snapshotVersion: `modes-seed:${nameDate}`,
    revisionLabel: `modes-${nameDate}`,
  };

  let seed: ModesSeed;
  try {
    seed = parseModesSeed(JSON.parse(file.bytes.toString("utf8")));
  } catch (error) {
    problems.push(`${file.fileName}: ${(error as Error).message}`);
    return { ...base, ...emptyPlan(), problems };
  }
  const synthetic = seed.header.synthetic === true;
  if (nameDate && seed.header.preparedOn !== nameDate) {
    problems.push(`${file.fileName}: header preparedOn ${seed.header.preparedOn} differs from the file name date`);
  }

  // A synthetic fixture is never published, so it need not cover the Data_Sets terminals T01–T06.
  problems.push(...validateModesSeed(seed, {
    externalSourceCodes: dataSets.sources.map((s) => s.code),
    existingRouteCodes: dataSets.routes.map((r) => r.publicCode),
    existingTerminalCodes: synthetic ? [] : dataSets.terminals.map((t) => t.code),
    existingFareRules: dataSets.fareRules,
  }).map((p) => `${file.fileName}: ${p}`));

  const imp = importableRecords(seed);
  const hash = (kind: string, content: unknown) => hashOf(kind, synthetic, content);

  const sources = imp.sources.map((s): PlannedSource => ({
    code: s.code, title: s.title, url: s.url, evidenceType: s.type, publishedOrEnacted: s.date,
    checkedOn: s.retrieved, publisher: s.publisher, licence: s.licence, extraUrls: s.extra_urls,
  }));

  const terminals = imp.terminals.map((t): PlannedTerminal => {
    const c = t.coordinate;
    const row = {
      code: t.code, name: t.name, kind: t.kind, locationText: t.location_text, modes: t.modes, modesRaw: t.modes_raw,
      modeSources: t.mode_sources as Record<string, string[]>,
      lat: c?.lat ?? null, lng: c?.lng ?? null, coordSource: c?.coord_source ?? null, osmType: c?.osm_type ?? null,
      osmId: c?.osm_id ?? null, osmVersion: c?.osm_version ?? null, osmTimestamp: c?.osm_timestamp ?? null,
      coordNote: c?.coord_note ?? null, coordReadFrom: c?.read_from ?? null,
      verification: t.verification, statusNote: t.status_note, notes: t.notes, sourceCodes: t.source_codes,
    };
    return { ...row, contentHash: hash("terminal_version", row) };
  });

  const routes = imp.routes.map((r): PlannedModesRoute => ({
    publicCode: r.code, name: r.name, modeCode: r.mode, mode: r.mode, serviceStatus: r.service_status, planning: "none",
    allocatedUnits: r.allocated_units, notes: r.notes, sourceCodes: r.source_codes,
    properties: {
      operator_text: r.operator_text, enacted_on: r.enacted_on, restrictions: r.restrictions, conflict_notes: r.conflict_notes,
    },
    variants: r.variants.map((v) => {
      const row = {
        direction: v.direction, kind: "permanent" as const, name: v.name,
        // Same "direction → street list" shape as the LPTRP variants; a feeder has one street text.
        legalStreets: { [v.direction]: [v.street_text] }, anchors: v.anchors as unknown[],
        evidenceLevel: "documentary" as const, sourceCodes: r.source_codes,
      };
      return { ...row, contentHash: hash("variant_version", [r.code, row]) };
    }),
  }));

  const operatingStatuses = imp.routeStatusUpdates.map((u): PlannedOperatingStatus => {
    const row = {
      routeCode: u.route_code, operatingStatus: u.operating_status, statusNote: u.status_note,
      confirmedOn: u.confirmed_on, sourceCodes: u.source_codes,
    };
    return { ...row, contentHash: hash("route_operating_status", row) };
  });

  const vehicleClasses = imp.fleet.map((f): PlannedVehicleClass => {
    const row = {
      routeCode: f.route_code, code: f.code, vehicleClass: f.vehicle_class, evidenceLevels: f.evidence_levels,
      status: f.status, firstReportedOn: f.first_reported_on, lastReportedOn: f.last_reported_on,
      unitsNote: f.units_note, aircon: f.aircon, airconSourceCodes: f.aircon_source_codes,
      cooperatives: f.cooperatives, conflictNotes: f.conflict_notes, notes: f.notes, sourceCodes: f.source_codes,
    };
    return { ...row, contentHash: hash("route_vehicle_class", row) };
  });

  const cooperatives = imp.cooperatives.flatMap((c): PlannedCooperative[] => {
    if (c.route_code === null) return []; // refused by validateModesSeed
    const row = {
      routeCode: c.route_code, name: c.name, basis: c.basis, reportedOn: c.reported_on, notes: c.notes,
      sourceCodes: c.source_codes,
    };
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(c.reported_on)) {
      problems.push(`${file.fileName}: cooperative ${c.name}: reported_on "${c.reported_on}" is not YYYY-MM or YYYY-MM-DD`);
    }
    return [{ ...row, contentHash: hash("route_cooperative", row) }];
  });

  const routeFareObservations = imp.fareObservations.map((o): PlannedRouteFareObservation => {
    const row = {
      routeCode: o.route_code, code: o.code, vehicleClass: o.vehicle_class, kind: o.kind, relativeTo: o.relative_to,
      deltaQualifier: o.delta_qualifier, deltaCentavosLow: o.delta_centavos_low, deltaCentavosHigh: o.delta_centavos_high,
      observedOn: o.observed_on, reportText: o.report_text, notes: o.notes, sourceCodes: o.source_codes,
    };
    return { ...row, contentHash: hash("route_fare_observation", row) };
  });

  const regionalServices = imp.regionalServices.map((r): PlannedRegionalService => {
    const row = {
      code: r.code, mode: r.mode, name: r.name, operators: r.operators, terminalCode: r.terminal_code,
      terminalNote: r.terminal_note, destination: r.destination, osmRelationIds: r.osm_relation_ids, status: r.status,
      fareRuleCodes: r.fare_rule_codes, notes: r.notes, sourceCodes: r.source_codes,
    };
    return { ...row, contentHash: hash("regional_service_version", row) };
  });

  const centavos = (php: number | null) => (php === null ? null : Math.round(php * 100));
  const newRules = imp.fareRules.map((f): PlannedModesFareRule => {
    const row: FareRuleRow & { ruleText: string | null; notes: string | null } = {
      code: f.code, modeCode: f.mode, baseCentavos: centavos(f.base_php), baseKm: f.base_km,
      incrementCentavosPerKm: centavos(f.additional_php_per_km), discountPercent: null, discountedBaseCentavos: null,
      discountGroups: null, rounding: null, effectiveFrom: f.effective_from, enactedOn: null,
      evidenceStatus: f.evidence_status, publishExact: f.publish_exact, sourceCodes: f.source_codes,
      ruleText: f.rule_text, notes: f.notes,
    };
    return { ...row, isNewRule: true, contentHash: hash("fare_rule_version", row) };
  });
  // J7: Data_Sets rules keep their values; the new version only adds sources. Same hash scheme as
  // the Data_Sets import (scripts/lib/import-plan.ts), so equal content means an equal hash.
  const updatedRules = imp.fareRuleSourceAdditions.flatMap((a): PlannedModesFareRule[] => {
    const existing = dataSets.fareRules.find((f) => f.code === a.rule_code);
    if (!existing) return []; // refused by validateModesSeed
    const row: FareRuleRow = { ...existing, sourceCodes: dedupe([...existing.sourceCodes, ...a.add_source_codes]) };
    return [{ ...row, ruleText: null, notes: null, isNewRule: false, contentHash: hash("fare_rule_version", row) }];
  });

  const conflicts = imp.conflicts.map((c): PlannedResearchConflict => ({
    code: c.code, topic: c.topic, description: c.description, refs: c.refs, sourceCodes: c.source_codes,
  }));

  const etaParams = imp.etaParams.map((p): PlannedEtaParam => {
    const row = {
      key: p.key, valueLow: p.value_low, valueHigh: p.value_high, unit: p.unit, windows: p.windows, days: p.days,
      appliesTo: p.applies_to, isAssumption: p.is_assumption, assumptionNote: p.assumption_note, basis: p.basis,
      sourceCodes: p.source_codes,
    };
    return { ...row, contentHash: hash("eta_param_version", row) };
  });
  const streetAliases = imp.streetAliases.map((a): PlannedStreetAlias => ({
    legalName: a.legal_name, osmName: a.osm_name, osmWayIds: a.osm_way_ids, evidenceSnapshot: a.evidence_snapshot, reason: a.reason,
  }));

  const routeNotes = imp.routeNotes.flatMap((n) => n.routeCodes.map((routeCode): PlannedRouteNote => {
    const row = {
      routeCode, noteCode: n.code, text: n.text, evidence: n.evidence, nearLat: n.near?.lat ?? null, nearLng: n.near?.lng ?? null,
      nearRadiusM: n.near?.radiusM ?? null, sourceCodes: n.sourceCodes,
    };
    return { ...row, contentHash: hash("route_note", row) };
  }));

  // Written by the road stage (scripts/lib/lines-writer.ts), which needs the road snapshot.
  const deferred: Record<string, string> = {
    eta_params: `${etaParams.length} records; written with the road outputs (modes-lines revision, lines-writer)`,
    street_aliases: `${streetAliases.length} records; used by the path tracer (lines plan)`,
    road_rules_padyak_areas: `${imp.roadRules.length} rules, ${imp.padyakAreas.length} areas; used by the street graph (lines plan)`,
    route_notes: `${routeNotes.length} records; written with the road outputs (lines-writer)`,
  };

  const counts: Record<string, number> = {
    sources: sources.length,
    terminals: terminals.length,
    terminals_with_coordinate: terminals.filter((t) => t.lat !== null).length,
    routes: routes.length,
    variants: routes.reduce((n, r) => n + r.variants.length, 0),
    route_operating_statuses: operatingStatuses.length,
    route_vehicle_classes: vehicleClasses.length,
    route_cooperatives: cooperatives.length,
    route_fare_observations: routeFareObservations.length,
    regional_services: regionalServices.length,
    fare_rules_new: newRules.length,
    fare_rule_versions_sources_added: updatedRules.length,
    research_conflicts: conflicts.length,
    excluded_records: excludedRecords(seed).length,
  };

  return {
    ...base,
    synthetic,
    sources,
    terminals,
    routes,
    operatingStatuses,
    vehicleClasses,
    cooperatives,
    routeFareObservations,
    regionalServices,
    fareRules: [...updatedRules, ...newRules],
    conflicts,
    etaParams,
    streetAliases,
    roadRules: imp.roadRules,
    padyakAreas: imp.padyakAreas,
    routeNotes,
    excluded: excludedRecords(seed),
    deferred,
    counts,
    problems,
  };
}

function emptyPlan() {
  return {
    synthetic: false, sources: [], terminals: [], routes: [], operatingStatuses: [], vehicleClasses: [], cooperatives: [],
    routeFareObservations: [], regionalServices: [], fareRules: [], conflicts: [], etaParams: [], streetAliases: [], roadRules: [], padyakAreas: [], routeNotes: [], excluded: [],
    deferred: {}, counts: {},
  };
}
