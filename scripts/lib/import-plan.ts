// Pure planning step of `pnpm db:import`: reads nothing but the bytes it is given, runs the
// Task 2 parsers and cross-checks, and returns every row the writer will insert plus a list of
// problems. The writer refuses to touch the database while `problems` is non-empty.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectConflicts, type DetectedConflict } from "../../src/domain/import/conflicts";
import { sha256Hex } from "../../src/domain/import/hash";
import {
  buildSnapshot,
  EXPECTED_LAYER_COUNTS,
  toRawFeatureRow,
  withIdentities,
  type IdentifiedStop,
  type RawFeatureRow,
} from "../../src/domain/import/mapped-stops";
import { provisionalLoopSequence, type LoopSequenceItem } from "../../src/domain/import/provisional-loops";
import {
  crossCheckDesignatedCsv,
  crossCheckSeedMappedStops,
  normalizeSeed,
  surveyTemplateNote,
  type DatasetNoteRow,
  type NormalizedSeed,
  type RouteRow,
} from "../../src/domain/import/seed";
import { parseSurveyTemplate } from "../../src/domain/import/survey-template";

export const DATA_FILES = [
  "naga_mapped_stops_source.kml",
  "naga_mapped_stops.geojson",
  "naga_mapped_stops.csv",
  "naga_transport_seed.json",
  "designated_stop_candidates.csv",
  "field_survey_template.csv",
  "Naga_Commuter_Research.md",
] as const;

export type DataFileName = (typeof DATA_FILES)[number];
export type DataFiles = Record<DataFileName, Buffer>;

export function readDataFiles(dir: string): DataFiles {
  return Object.fromEntries(DATA_FILES.map((f) => [f, readFileSync(path.join(dir, f))])) as DataFiles;
}

export type DocumentRow = {
  fileName: DataFileName;
  sha256: string;
  bytes: number;
  /** Only the KML is the source export itself (S40); the rest are research-package files. */
  sourceCode: string | null;
  retrievedOn: string | null;
};

export type PlannedRawFeature = RawFeatureRow & {
  coordinatesRaw: string;
  /** stop_point.name: the verbatim label, or the verbatim code when the label is empty. Never invented. */
  stopName: string;
};

export type VariantDirection = "inbound" | "outbound" | "circuit" | "clockwise" | "counterclockwise";

export type PlannedVariantVersion = {
  evidenceLevel: "documentary" | "provisional";
  legalStreets: { inbound?: string[]; outbound?: string[]; circuit?: string[] };
  trialStatus: string | null;
  effectiveFrom: string | null;
  trialDurationDays: number | null;
  operatingStatus: string | null;
  isCircular: boolean;
  sourceCodes: string[];
  notes: string | null;
  /** The version used as this variant's revision member (one per variant). */
  isMember: boolean;
  routeStops: LoopSequenceItem[];
  contentHash: string;
};

export type PlannedVariant = {
  routeCode: string;
  direction: VariantDirection;
  kind: "permanent" | "trial";
  versions: PlannedVariantVersion[];
};

export type ImportPlan = {
  mapId: string;
  retrievedOn: string;
  snapshotVersion: string;
  revisionLabel: string;
  documents: DocumentRow[];
  /** sha256 over the sorted "file:sha256" lines; equal hashes mean identical inputs. */
  documentsHash: string;
  rawFeatures: PlannedRawFeature[];
  conflicts: DetectedConflict[];
  seed: NormalizedSeed;
  variants: PlannedVariant[];
  datasetNotes: DatasetNoteRow[];
  counts: Record<string, number>;
  problems: string[];
};

const OPERATING_STATUSES = new Set(["unverified", "observed", "confirmed"]);
const LOOP_ROUTES = new Set(["R8-A", "R8-B"]);

const isBlank = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

function versionHash(routeCode: string, direction: string, kind: string, v: Omit<PlannedVariantVersion, "contentHash" | "isMember">) {
  return sha256Hex(JSON.stringify([routeCode, direction, kind, v]));
}

function makeVersion(
  routeCode: string,
  direction: string,
  kind: string,
  v: Omit<PlannedVariantVersion, "contentHash" | "isMember">,
  isMember: boolean,
): PlannedVariantVersion {
  return { ...v, isMember, contentHash: versionHash(routeCode, direction, kind, v) };
}

function routeVariants(route: RouteRow, records: IdentifiedStop[], problems: string[]): PlannedVariant[] {
  const base = {
    trialStatus: null,
    effectiveFrom: null,
    trialDurationDays: null,
    operatingStatus: route.operatingStatus,
    sourceCodes: route.sourceCodes,
    notes: null,
    routeStops: [] as LoopSequenceItem[],
  };
  const out: PlannedVariant[] = [];
  const { inbound, outbound, circuit } = route.legalStreets;
  if (inbound) {
    out.push({ routeCode: route.publicCode, direction: "inbound", kind: "permanent", versions: [
      makeVersion(route.publicCode, "inbound", "permanent",
        { ...base, evidenceLevel: "documentary", legalStreets: { inbound }, isCircular: false }, true),
    ] });
  }
  if (outbound) {
    out.push({ routeCode: route.publicCode, direction: "outbound", kind: "permanent", versions: [
      makeVersion(route.publicCode, "outbound", "permanent",
        { ...base, evidenceLevel: "documentary", legalStreets: { outbound }, isCircular: false }, true),
    ] });
  }
  if (circuit) {
    // Loops carry the seed's direction; other circuit lists use the street-list key itself.
    const isLoop = route.publicCode.startsWith("R8-");
    const direction = (isLoop ? route.direction : "circuit") as VariantDirection | null;
    if (direction !== "circuit" && direction !== "clockwise" && direction !== "counterclockwise") {
      problems.push(`route ${route.publicCode}: loop direction "${String(route.direction)}" is not clockwise/counterclockwise`);
      return out;
    }
    const documentary = { ...base, evidenceLevel: "documentary" as const, legalStreets: { circuit }, isCircular: isLoop };
    const versions: PlannedVariantVersion[] = [];
    if (LOOP_ROUTES.has(route.publicCode)) {
      const seq = provisionalLoopSequence(records, route.publicCode) ?? [];
      versions.push(makeVersion(route.publicCode, direction, "permanent", documentary, false));
      versions.push(makeVersion(route.publicCode, direction, "permanent",
        { ...documentary, evidenceLevel: "provisional", isCircular: true, routeStops: seq,
          notes: "Provisional stop order by pin code (A1… / B1…), not a surveyed sequence." }, true));
    } else {
      versions.push(makeVersion(route.publicCode, direction, "permanent", documentary, true));
    }
    out.push({ routeCode: route.publicCode, direction, kind: "permanent", versions });
  }
  if (!inbound && !outbound && !circuit) problems.push(`route ${route.publicCode}: no legal street list`);
  return out;
}

/** Seed fields the schema has no column for must be empty; otherwise they would be silently lost. */
function unmappedData(seed: NormalizedSeed): string[] {
  const issues: string[] = [];
  const check = (what: string, field: string, value: unknown) => {
    if (!isBlank(value)) issues.push(`${what}: ${field} has data but the schema has no column for it`);
  };
  for (const r of seed.routes) {
    check(`route ${r.publicCode}`, "geometry", r.geometry);
    check(`route ${r.publicCode}`, "service_hours", r.serviceHours);
    check(`route ${r.publicCode}`, "operator", r.operator);
    check(`route ${r.publicCode}`, "fare_rule_id", r.fareRuleCode);
  }
  for (const t of seed.terminals) {
    check(`terminal ${t.code}`, "entrances", t.entrances);
    check(`terminal ${t.code}`, "bays", t.bays);
    check(`terminal ${t.code}`, "hours", t.hours);
  }
  for (const f of seed.feederCandidates) check(`feeder ${f.code}`, "geometry", f.geometry);
  for (const c of seed.externalDestinationCategories) {
    check(`destination category ${c.category}`, "fare_php", c.details.farePhp);
    check(`destination category ${c.category}`, "service_hours", c.details.serviceHours);
    check(`destination category ${c.category}`, "geometry", c.details.geometry);
  }
  for (const r of seed.routes) {
    if (r.operatingStatus !== null && !OPERATING_STATUSES.has(r.operatingStatus)) {
      issues.push(`route ${r.publicCode}: operating_status "${r.operatingStatus}" is not unverified/observed/confirmed`);
    }
  }
  return issues;
}

export function buildImportPlan(files: DataFiles): ImportPlan {
  const text = (f: DataFileName) => files[f].toString("utf8");
  const problems: string[] = [];

  const snapshot = buildSnapshot(text("naga_mapped_stops_source.kml"), text("naga_mapped_stops.geojson"), text("naga_mapped_stops.csv"));
  problems.push(...snapshot.errors);
  const mapId = snapshot.metadata.mapId;
  const retrievedOn = snapshot.metadata.retrievedOn ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn)) problems.push(`GeoJSON metadata retrieved_on "${retrievedOn}" is not a date`);

  const identified = withIdentities(snapshot.records, mapId);
  const conflicts = detectConflicts(identified);

  const seed = normalizeSeed(JSON.parse(text("naga_transport_seed.json")));
  problems.push(...seed.integrityIssues);
  problems.push(...crossCheckDesignatedCsv(seed.designatedCandidates, text("designated_stop_candidates.csv")));
  problems.push(...crossCheckSeedMappedStops(seed.mappedStopRecords, identified, conflicts));
  problems.push(...unmappedData(seed));

  const rawFeatures = identified.map((r): PlannedRawFeature => ({
    ...toRawFeatureRow(r),
    coordinatesRaw: r.coordinatesRaw!,
    stopName: r.label.trim() === "" ? r.code : r.label,
  }));

  const variants = seed.routes.flatMap((r) => routeVariants(r, identified, problems));
  for (const t of seed.trialChanges) {
    const route = seed.routes.find((r) => r.publicCode === t.routeCode);
    const direction = route?.direction;
    if (direction !== "clockwise" && direction !== "counterclockwise") {
      problems.push(`trial change ${t.routeCode}: route direction "${String(direction)}" is unusable`);
      continue;
    }
    const v = {
      evidenceLevel: "documentary" as const,
      legalStreets: { circuit: t.simplifiedCircuit },
      trialStatus: t.permanentStatus === null ? null : `permanence_${t.permanentStatus}`,
      effectiveFrom: t.adopted,
      trialDurationDays: t.durationDays,
      operatingStatus: null,
      isCircular: true,
      sourceCodes: [t.sourceCode],
      notes: null,
      routeStops: [],
    };
    variants.push({ routeCode: t.routeCode, direction, kind: "trial", versions: [makeVersion(t.routeCode, direction, "trial", v, true)] });
  }

  const datasetNotes = [...seed.datasetNotes, surveyTemplateNote(parseSurveyTemplate(text("field_survey_template.csv")))];

  const documents = DATA_FILES.map((fileName): DocumentRow => {
    const isExport = fileName === "naga_mapped_stops_source.kml";
    return {
      fileName,
      sha256: createHash("sha256").update(files[fileName]).digest("hex"),
      bytes: files[fileName].byteLength,
      sourceCode: isExport ? "S40" : null,
      retrievedOn: isExport ? retrievedOn || null : null,
    };
  });
  const documentsHash = sha256Hex(documents.map((d) => `${d.fileName}:${d.sha256}`).sort().join("\n"));

  const layerCounts = Object.fromEntries(
    Object.keys(EXPECTED_LAYER_COUNTS).map((l) => [`raw_features_${l}`, identified.filter((r) => r.layer === l).length]),
  );
  const versions = variants.flatMap((v) => v.versions);
  const counts: Record<string, number> = {
    documents: documents.length,
    sources: seed.sources.length,
    raw_features: rawFeatures.length,
    ...layerCounts,
    conflicts: conflicts.length,
    conflicts_code_prefix_mismatch: conflicts.filter((c) => c.kind === "code_prefix_mismatch").length,
    conflicts_exact_coordinate_shared: conflicts.filter((c) => c.kind === "exact_coordinate_shared").length,
    conflicts_near_duplicate: conflicts.filter((c) => c.kind === "near_duplicate").length,
    stop_points: rawFeatures.length,
    routes: seed.routes.length,
    route_aliases: 0,
    variants: variants.length,
    variant_versions: versions.length,
    route_stops: versions.reduce((n, v) => n + v.routeStops.length, 0),
    fare_rules: seed.fareRules.length,
    fare_observations: seed.fareObservations.length,
    fare_conflicts: seed.fareConflicts.length,
    terminals: seed.terminals.length,
    feeder_leads: seed.feederCandidates.length,
    providers: seed.providers.length,
    rail_status: seed.railStatus.length,
    barangays: seed.barangays.length,
    coverage_audits: seed.barangays.length,
    designated_stop_candidates: seed.designatedCandidates.length,
    external_destination_categories: seed.externalDestinationCategories.length,
    dataset_notes: datasetNotes.length,
  };

  return {
    mapId,
    retrievedOn,
    snapshotVersion: `mymaps:${mapId}:${retrievedOn}`,
    revisionLabel: `provisional-loops-${retrievedOn}`,
    documents,
    documentsHash,
    rawFeatures,
    conflicts,
    seed,
    variants,
    datasetNotes,
    counts,
    problems,
  };
}
