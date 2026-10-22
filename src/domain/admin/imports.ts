// The admin import (C2, A2, N5b): one uploaded My Maps export (KML, the raw authority, or the
// package CSV) planned against the newest committed batch. Pure, but server-side only: the
// identities and content hashes are sha256 (node:crypto, src/domain/import/hash.ts). The parsers,
// identities, raw-feature rows and conflict rules are the CLI importer's own
// (src/domain/import/*, scripts/lib/import-plan.ts); nothing here re-parses differently.
// The database recomputes the change kinds from its stored hashes (ingest.admin_import_commit).
import { createHash } from "node:crypto";
import { haversineMeters } from "@/domain/geo/geometry";
import { detectConflicts, type DetectedConflict } from "@/domain/import/conflicts";
import {
  EXPECTED_LAYER_COUNTS,
  EXPECTED_RECORD_COUNT,
  parseCsvStops,
  parseKmlStops,
  planRawFeatures,
  withIdentities,
  type IdentifiedStop,
  type MappedStopRecord,
  type PlannedRawFeature,
} from "@/domain/import/mapped-stops";
import type { ImportDryRun, ImportUpload } from "./stops";
import { SERVICE_BBOX } from "./validation";

export type BaselineFeature = {
  sourceIdentity: string;
  contentHash: string;
  layer: string;
  code: string | null;
  label: string;
  lat: number;
  lng: number;
};
export type ImportBaseline = { batchId: string; snapshotVersion: string; mapId: string; features: BaselineFeature[] };

export type AdminImportPlan = {
  dryRun: ImportDryRun;
  /** The rows ingest.admin_import_commit writes (commitPayload refuses a plan with problems). */
  features: PlannedRawFeature[];
  conflicts: DetectedConflict[];
};

/** Rows listed in the dry run; the counts are always complete. */
export const DIFF_ROWS_MAX = 300;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What ingest.raw_feature (numeric(11, 8)) stores verbatim. */
const COORD_TEXT = /^-?\d{1,3}(\.\d{1,8})?$/;
const round1 = (m: number) => Math.round(m * 10) / 10;

function parse(upload: ImportUpload, problems: string[]): MappedStopRecord[] {
  try {
    return upload.format === "kml" ? parseKmlStops(upload.text) : parseCsvStops(upload.text);
  } catch (error) {
    problems.push(`The ${upload.format.toUpperCase()} file could not be read: ${message(error)}`);
    return [];
  }
}

export function planAdminImport(upload: ImportUpload, baseline: ImportBaseline | null): AdminImportPlan {
  const problems: string[] = [];
  const bytes = new TextEncoder().encode(upload.text).byteLength;
  const sha256 = createHash("sha256").update(upload.text, "utf8").digest("hex");
  if (!baseline) problems.push("No My Maps import has been committed yet; the first import runs from the command line (pnpm db:import --commit).");
  const mapId = baseline?.mapId ?? null;

  const records = parse(upload, problems);
  let identified: IdentifiedStop[] = [];
  if (records.length > 0 && mapId) {
    try {
      identified = withIdentities(records, mapId);
    } catch (error) {
      problems.push(message(error));
    }
  }
  const features = planRawFeatures(identified, problems);

  // Counts check (spec 06 A2): commit is disabled on a count mismatch.
  const byLayer: Record<string, number> = Object.fromEntries(Object.keys(EXPECTED_LAYER_COUNTS).map((l) => [l, 0]));
  for (const r of records) byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1;
  if (records.length > 0 && records.length !== EXPECTED_RECORD_COUNT) problems.push(`The file has ${records.length} pins; ${EXPECTED_RECORD_COUNT} are expected.`);
  for (const [layer, expected] of Object.entries(EXPECTED_LAYER_COUNTS)) {
    if (records.length > 0 && byLayer[layer] !== expected) problems.push(`Layer ${layer} has ${byLayer[layer] ?? 0} pins; ${expected} are expected.`);
  }
  for (const f of features) {
    if (!COORD_TEXT.test(f.lonText) || !COORD_TEXT.test(f.latText)) {
      problems.push(`${f.sourceLayer}/${f.sourceCodeRaw}: coordinates "${f.coordinatesRaw}" are not plain numbers with at most 8 decimals.`);
    }
    if (f.lon < SERVICE_BBOX.west || f.lon > SERVICE_BBOX.east || f.lat < SERVICE_BBOX.south || f.lat > SERVICE_BBOX.north) {
      problems.push(`${f.sourceLayer}/${f.sourceCodeRaw} is outside the service area (${f.lat}, ${f.lon}).`);
    }
  }

  const conflicts = detectConflicts(identified);

  // Diff against the newest committed batch, by source identity and content hash.
  const before = new Map((baseline?.features ?? []).map((b) => [b.sourceIdentity, b]));
  const seen = new Set<string>();
  const rows: ImportDryRun["rows"] = [];
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const f of features) {
    seen.add(f.sourceIdentity);
    const b = before.get(f.sourceIdentity);
    if (!b) {
      added += 1;
      rows.push({ kind: "added", layer: f.sourceLayer, code: f.sourceCodeRaw, label: f.labelRaw, fromLabel: null, movedM: null });
    } else if (b.contentHash !== f.contentHash) {
      changed += 1;
      rows.push({
        kind: "changed",
        layer: f.sourceLayer,
        code: f.sourceCodeRaw,
        label: f.labelRaw,
        fromLabel: b.label === f.labelRaw ? null : b.label,
        movedM: round1(haversineMeters({ lat: b.lat, lng: b.lng }, { lat: f.lat, lng: f.lon })),
      });
    } else {
      unchanged += 1;
    }
  }
  let missing = 0;
  if (baseline && features.length > 0) {
    for (const b of baseline.features) {
      if (seen.has(b.sourceIdentity)) continue;
      missing += 1;
      rows.push({ kind: "missing", layer: b.layer, code: b.code, label: b.label, fromLabel: null, movedM: null });
    }
  }

  const snapshotVersion = mapId ? `mymaps:${mapId}:${upload.retrievedOn}` : null;
  const dryRun: ImportDryRun = {
    snapshotVersion,
    mapId,
    fileName: upload.fileName,
    sha256,
    bytes,
    baseline: baseline ? { batchId: baseline.batchId, snapshotVersion: baseline.snapshotVersion } : null,
    counts: { total: records.length, byLayer, expectedTotal: EXPECTED_RECORD_COUNT, expectedByLayer: { ...EXPECTED_LAYER_COUNTS } },
    changes: { added, changed, unchanged, missing },
    rows: rows.slice(0, DIFF_ROWS_MAX),
    conflicts: conflicts.map((c) => ({
      kind: c.kind,
      meters: typeof c.detail.meters === "number" ? c.detail.meters : null,
      records: ((c.detail.records as { sourceLayer: string; code: string; label: string }[] | undefined) ?? [
        { sourceLayer: String(c.detail.sourceLayer), code: String(c.detail.code), label: String(c.detail.label) },
      ]).map((r) => ({ layer: r.sourceLayer, code: r.code, label: r.label })),
    })),
    problems,
    canCommit: problems.length === 0 && features.length > 0,
  };
  return { dryRun, features, conflicts };
}

/** The p_plan argument of ingest.admin_import_commit (snake_case rows, as in ingest.raw_feature). */
export function commitPayload(upload: ImportUpload, plan: AdminImportPlan, expectedBaselineBatchId: string): Record<string, unknown> {
  const d = plan.dryRun;
  if (!d.canCommit || !d.mapId || !d.snapshotVersion) throw new Error("the plan has problems; nothing to commit");
  return {
    mapId: d.mapId,
    snapshotVersion: d.snapshotVersion,
    retrievedOn: upload.retrievedOn,
    fileName: upload.fileName,
    sha256: d.sha256,
    bytes: d.bytes,
    expectedBaselineBatchId,
    features: plan.features.map((f) => ({
      source_identity: f.sourceIdentity,
      identity_method: f.identityMethod,
      source_layer: f.sourceLayer,
      source_code_raw: f.sourceCodeRaw,
      label_raw: f.labelRaw,
      description_raw: f.descriptionRaw,
      coordinates_raw: f.coordinatesRaw,
      lon: f.lonText,
      lat: f.latText,
      properties: f.properties,
      content_hash: f.contentHash,
      stop_name: f.stopName,
    })),
    conflicts: plan.conflicts.map((c) => ({ kind: c.kind, refs: c.refs, detail: c.detail })),
  };
}
