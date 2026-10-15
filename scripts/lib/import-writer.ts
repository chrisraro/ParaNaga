// Database half of `pnpm db:import --commit`. Runs the whole write in ONE transaction on the
// owner connection, as `SET LOCAL ROLE paranaga_import`, under
// pg_advisory_xact_lock(hashtext(snapshot_version)) and pg_advisory_xact_lock(hashtext(map_id)).
//
// Idempotency (Task 1 made released rows immutable):
//   - no committed batch for this map yet          -> first import: insert everything, publish;
//   - committed batch for this snapshot with the same document hashes and raw-feature content
//                                                  -> "unchanged": nothing is written;
//   - anything else (same snapshot with other files, or a new snapshot of an imported map)
//                                                  -> refused: the changed-data path is not built yet.
// Ids are generated here so related rows can be inserted in bulk without RETURNING lookups.
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ImportPlan } from "./import-plan";

export const IMPORT_ACTOR = "scripts/import-naga";

export type ImportOutcome =
  | { outcome: "committed"; batchId: string; revisionId: string; revisionLabel: string; counts: Record<string, number> }
  | { outcome: "unchanged"; batchId: string; publishedRevisionLabel: string | null; counts: Record<string, number> };

export class ImportRefusedError extends Error {}

type Row = Record<string, unknown>;

type Column = [name: string, type: string, expr?: string];

/**
 * Bulk insert: `insert into <table> (<cols>) select <exprs> from jsonb_to_recordset($1) as x(<fields>)`.
 * Each column is also a recordset field and reads x.<name> unless it has an expression.
 * `inputs` are recordset fields that only feed expressions; `computed` are columns with no field.
 */
async function insertRows(
  c: pg.ClientBase,
  table: string,
  rows: Row[],
  columns: Column[],
  extra: { inputs?: [string, string][]; computed?: [string, string][] } = {},
) {
  if (rows.length === 0) return 0;
  const targets: [string, string][] = [...columns.map(([n, , e]): [string, string] => [n, e ?? `x.${n}`]), ...(extra.computed ?? [])];
  const fields = [...columns.map(([n, t]) => `${n} ${t}`), ...(extra.inputs ?? []).map(([n, t]) => `${n} ${t}`)];
  const result = await c.query(
    `insert into ${table} (${targets.map(([n]) => n).join(", ")})
     select ${targets.map(([, e]) => e).join(", ")} from jsonb_to_recordset($1::jsonb) as x(${fields.join(", ")})`,
    [JSON.stringify(rows)],
  );
  if (result.rowCount !== rows.length) throw new Error(`${table}: inserted ${result.rowCount} of ${rows.length} rows`);
  return rows.length;
}

/** jsonb array (or null) -> text[] (or null), keeping order. */
const textArray = (col: string) =>
  `case when x.${col} is null or jsonb_typeof(x.${col}) = 'null' then null
        else array(select e from jsonb_array_elements_text(x.${col}) with ordinality t(e, i) order by i) end`;
const textArrayNotNull = (col: string) => `coalesce(${textArray(col)}, '{}')`;
const point = (lon: string, lat: string) =>
  `case when x.${lon} is null or x.${lat} is null then null else
     extensions.ST_SetSRID(extensions.ST_MakePoint(x.${lon}::float8, x.${lat}::float8), 4326)::extensions.geography end`;

export async function commitImport(connectionString: string, plan: ImportPlan): Promise<ImportOutcome> {
  if (plan.problems.length > 0) throw new ImportRefusedError(`plan has ${plan.problems.length} problem(s); nothing written`);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    try {
      await client.query("set local role paranaga_import");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [plan.snapshotVersion]);
      // The prior-batch lookup is per map, not per snapshot: also lock the map id so two first
      // imports of the same map with different retrieved_on dates are serialized by design
      // (not only by the unique route/source keys failing the second one).
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [plan.mapId]);
      const result = await writeInTransaction(client, plan);
      await client.query(result.outcome === "unchanged" ? "rollback" : "commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function writeInTransaction(c: pg.ClientBase, plan: ImportPlan): Promise<ImportOutcome> {
  const prior = await c.query<{ id: string; snapshot_version: string; counts: Row }>(
    `select id, snapshot_version, counts from ingest.batch
      where mode = 'commit' and status = 'committed' and split_part(snapshot_version, ':', 2) = $1
      order by finished_at desc nulls last, started_at desc limit 1`,
    [plan.mapId],
  );
  const last = prior.rows[0];
  if (last) return checkUnchanged(c, plan, last);
  return firstImport(c, plan);
}

async function checkUnchanged(
  c: pg.ClientBase,
  plan: ImportPlan,
  last: { id: string; snapshot_version: string; counts: Row },
): Promise<ImportOutcome> {
  if (last.snapshot_version !== plan.snapshotVersion || last.counts.documents_sha256 !== plan.documentsHash) {
    throw new ImportRefusedError(
      `the files differ from the last committed batch (${last.snapshot_version}); importing changed data ` +
        "(new versions in a new draft revision) is not implemented yet. Nothing was written.",
    );
  }
  const stored = await c.query<{ source_identity: string; content_hash: string }>(
    "select source_identity, content_hash from ingest.raw_feature where batch_id = $1",
    [last.id],
  );
  const storedHashes = new Map(stored.rows.map((r) => [r.source_identity, r.content_hash]));
  const differing = plan.rawFeatures.filter((r) => storedHashes.get(r.sourceIdentity) !== r.contentHash);
  if (stored.rows.length !== plan.rawFeatures.length || differing.length > 0) {
    throw new ImportRefusedError(
      `document hashes match batch ${last.id} but ${differing.length} raw feature(s) differ; nothing written`,
    );
  }
  const pointer = await c.query<{ label: string }>(
    `select r.label from transit.published_pointer p join transit.revision r on r.id = p.revision_id`,
  );
  return { outcome: "unchanged", batchId: last.id, publishedRevisionLabel: pointer.rows[0]?.label ?? null, counts: plan.counts };
}

async function firstImport(c: pg.ClientBase, plan: ImportPlan): Promise<ImportOutcome> {
  const { seed } = plan;
  const batchId = randomUUID();
  const revisionId = randomUUID();

  // ---------------------------------------------------------------- ingest
  await insertRows(c, "ingest.source", seed.sources.map((s) => ({
    code: s.code, title: s.title, url: s.url, evidence_type: s.evidenceType,
    published_or_enacted: s.publishedOrEnacted, checked_on: s.checkedOn,
  })), [["code", "text"], ["title", "text"], ["url", "text"], ["evidence_type", "text"],
    ["published_or_enacted", "text"], ["checked_on", "date"]]);

  const documents = plan.documents.map((d) => ({ ...d, id: randomUUID() }));
  await insertRows(c, "ingest.source_document", documents.map((d) => ({
    id: d.id, source_code: d.sourceCode, file_name: d.fileName, sha256: d.sha256, bytes: d.bytes,
    retrieved_on: d.retrievedOn,
  })), [["id", "uuid"], ["source_code", "text"], ["file_name", "text"], ["sha256", "text"], ["bytes", "bigint"],
    ["retrieved_on", "date"]]);
  const kmlDocument = documents.find((d) => d.fileName === "naga_mapped_stops_source.kml")!;

  await c.query(
    `insert into ingest.batch (id, source_document_id, snapshot_version, mode, status, started_by)
     values ($1, $2, $3, 'commit', 'running', $4)`,
    [batchId, kmlDocument.id, plan.snapshotVersion, IMPORT_ACTOR],
  );

  const features = plan.rawFeatures.map((r) => ({
    ...r, rawId: randomUUID(), stopPointId: randomUUID(), stopVersionId: randomUUID(),
  }));
  await insertRows(c, "ingest.raw_feature", features.map((r) => ({
    id: r.rawId, batch_id: batchId, source_identity: r.sourceIdentity, identity_method: r.identityMethod,
    source_layer: r.sourceLayer, source_code_raw: r.sourceCodeRaw, label_raw: r.labelRaw,
    description_raw: r.descriptionRaw, coordinates_raw: r.coordinatesRaw, lon: r.lonText, lat: r.latText,
    properties: r.properties, content_hash: r.contentHash,
  })), [["id", "uuid"], ["batch_id", "uuid"], ["source_identity", "text"], ["identity_method", "text"],
    ["source_layer", "text"], ["source_code_raw", "text"], ["label_raw", "text"], ["description_raw", "text"],
    ["coordinates_raw", "text"], ["lon", "numeric"], ["lat", "numeric"],
    ["properties", "jsonb"], ["content_hash", "text"]]);

  await insertRows(c, "ingest.change", features.map((r) => ({
    batch_id: batchId, source_identity: r.sourceIdentity, kind: "added",
  })), [["batch_id", "uuid"], ["source_identity", "text"], ["kind", "text"]]);

  await insertRows(c, "ingest.conflict", plan.conflicts.map((k) => ({
    batch_id: batchId, kind: k.kind, refs: k.refs, detail: k.detail,
  })), [["batch_id", "uuid"], ["kind", "text"], ["refs", "jsonb", textArray("refs")], ["detail", "jsonb"]]);

  // ---------------------------------------------------------------- candidate stops (one per raw feature)
  await insertRows(c, "transit.stop_point", features.map((r) => ({ id: r.stopPointId, name: r.stopName })),
    [["id", "uuid"], ["name", "text"]]);
  await insertRows(c, "transit.stop_point_version", features.map((r) => ({
    id: r.stopVersionId, stop_point_id: r.stopPointId, lon: r.lonText, lat: r.latText,
    source_layer: r.sourceLayer, source_code_raw: r.sourceCodeRaw, label_raw: r.labelRaw, content_hash: r.contentHash,
  })), [["id", "uuid"], ["stop_point_id", "uuid"], ["source_layer", "text"], ["source_code_raw", "text"],
    ["label_raw", "text"], ["content_hash", "text"]],
  { inputs: [["lon", "text"], ["lat", "text"]], computed: [["geog", point("lon", "lat")], ["status", "'candidate'"]] });
  await insertRows(c, "transit.stop_point_source", features.map((r) => ({
    stop_point_id: r.stopPointId, stop_point_version_id: r.stopVersionId, raw_feature_id: r.rawId,
  })), [["stop_point_id", "uuid"], ["stop_point_version_id", "uuid"], ["raw_feature_id", "uuid"]]);
  await insertRows(c, "ingest.raw_feature_lineage", features.map((r) => ({
    source_identity: r.sourceIdentity, stop_point_id: r.stopPointId,
  })), [["source_identity", "text"], ["stop_point_id", "uuid"]]);
  const stopVersionByIdentity = new Map(features.map((r) => [r.sourceIdentity, r.stopVersionId]));

  // ---------------------------------------------------------------- routes and variants
  const routeIds = new Map(seed.routes.map((r) => [r.publicCode, randomUUID()]));
  await insertRows(c, "transit.route", seed.routes.map((r) => ({
    id: routeIds.get(r.publicCode), public_code: r.publicCode, official_group_number: r.officialGroupNumber,
    name: r.name, mode_code: r.modeCode, legal_status: r.legalStatus, allocated_units: r.allocatedUnits,
    allocation_is_active_fleet_count: r.allocationIsActiveFleetCount, notes: r.notes, source_codes: r.sourceCodes,
    properties: r.extra,
  })), [["id", "uuid"], ["public_code", "text"], ["official_group_number", "integer"], ["name", "text"],
    ["mode_code", "text"], ["legal_status", "text"], ["allocated_units", "integer"],
    ["allocation_is_active_fleet_count", "boolean"], ["notes", "text"],
    ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["properties", "jsonb"]]);

  const variants = plan.variants.map((v) => ({
    ...v, id: randomUUID(), versions: v.versions.map((x) => ({ ...x, id: randomUUID() })),
  }));
  await insertRows(c, "transit.variant", variants.map((v) => ({
    id: v.id, route_id: routeIds.get(v.routeCode), direction: v.direction, kind: v.kind,
  })), [["id", "uuid"], ["route_id", "uuid"], ["direction", "text"], ["kind", "text"]]);
  const versions = variants.flatMap((v) => v.versions.map((x) => ({ variantId: v.id, ...x })));
  await insertRows(c, "transit.variant_version", versions.map((x) => ({
    id: x.id, variant_id: x.variantId, legal_streets: x.legalStreets, trial_status: x.trialStatus,
    effective_from: x.effectiveFrom, trial_duration_days: x.trialDurationDays, operating_status: x.operatingStatus,
    evidence_level: x.evidenceLevel, is_circular: x.isCircular, source_codes: x.sourceCodes, notes: x.notes,
    content_hash: x.contentHash,
  })), [["id", "uuid"], ["variant_id", "uuid"], ["legal_streets", "jsonb"], ["trial_status", "text"],
    ["effective_from", "date"], ["trial_duration_days", "integer"], ["operating_status", "text"],
    ["evidence_level", "text"], ["is_circular", "boolean"], ["source_codes", "jsonb", textArrayNotNull("source_codes")],
    ["notes", "text"], ["content_hash", "text"]]);
  await insertRows(c, "transit.route_stop", versions.flatMap((x) => x.routeStops.map((s) => {
    const stopVersion = stopVersionByIdentity.get(s.recordIdentity);
    if (!stopVersion) throw new Error(`route stop ${s.seq}: unknown source identity`);
    return { variant_version_id: x.id, stop_point_version_id: stopVersion, seq: s.seq, evidence_level: "provisional" };
  })), [["variant_version_id", "uuid"], ["stop_point_version_id", "uuid"], ["seq", "integer"], ["evidence_level", "text"]]);

  // ---------------------------------------------------------------- terminals and fares
  const terminals = seed.terminals.map((t) => ({ ...t, id: randomUUID() }));
  await insertRows(c, "transit.terminal", terminals.map((t) => ({
    id: t.id, code: t.code, name: t.name, location_text: t.locationText, modes: t.modes,
    evidence_status: t.evidenceStatus, notes: t.notes, lon: t.lng, lat: t.lat, source_codes: t.sourceCodes,
  })), [["id", "uuid"], ["code", "text"], ["name", "text"], ["location_text", "text"],
    ["modes", "jsonb", textArrayNotNull("modes")], ["evidence_status", "text"], ["notes", "text"],
    ["source_codes", "jsonb", textArrayNotNull("source_codes")]],
  { inputs: [["lon", "float8"], ["lat", "float8"]], computed: [["geog", point("lon", "lat")]] });

  const fareRules = plan.fareRules.map((f) => ({ ...f, id: randomUUID(), versionId: randomUUID() }));
  await insertRows(c, "transit.fare_rule", fareRules.map((f) => ({ id: f.id, code: f.code, mode_code: f.modeCode })),
    [["id", "uuid"], ["code", "text"], ["mode_code", "text"]]);
  await insertRows(c, "transit.fare_rule_version", fareRules.map((f) => ({
    id: f.versionId, fare_rule_id: f.id, base_centavos: f.baseCentavos, base_km: f.baseKm,
    increment_centavos_per_km: f.incrementCentavosPerKm, discount_percent: f.discountPercent,
    discounted_base_centavos: f.discountedBaseCentavos, discount_groups: f.discountGroups, rounding: f.rounding,
    effective_from: f.effectiveFrom, enacted_on: f.enactedOn, evidence_status: f.evidenceStatus,
    publish_exact: f.publishExact, source_codes: f.sourceCodes,
    content_hash: f.contentHash,
  })), [["id", "uuid"], ["fare_rule_id", "uuid"], ["base_centavos", "integer"], ["base_km", "numeric"],
    ["increment_centavos_per_km", "integer"], ["discount_percent", "numeric"], ["discounted_base_centavos", "integer"],
    ["discount_groups", "jsonb", textArray("discount_groups")], ["rounding", "text"], ["effective_from", "date"],
    ["enacted_on", "date"], ["evidence_status", "text"], ["publish_exact", "boolean"],
    ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"]]);

  const ruleId = (ruleCode: string, observationCode: string) => {
    const rule = fareRules.find((f) => f.code === ruleCode);
    if (!rule) throw new Error(`fare observation ${observationCode}: unknown fare rule ${ruleCode}`);
    return rule.id;
  };
  const observations = seed.fareObservations.map((o) => ({ ...o, id: randomUUID() }));
  await insertRows(c, "transit.fare_observation", observations.map((o) => ({
    id: o.id, code: o.code, fare_rule_id: o.ruleCode === null ? null : ruleId(o.ruleCode, o.code),
    mode_code: o.modeCode, amount_centavos: o.amountCentavos, category: o.category, kind: o.kind,
    observed_at: o.observedAt, evidence_status: o.evidenceStatus, source_codes: o.sourceCodes, details: o.details,
  })), [["id", "uuid"], ["code", "text"], ["fare_rule_id", "uuid"], ["mode_code", "text"], ["amount_centavos", "integer"],
    ["category", "text"], ["kind", "text"], ["observed_at", "date"], ["evidence_status", "text"],
    ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["details", "jsonb"]]);

  const fareConflicts = seed.fareConflicts.map((k) => {
    const rule = fareRules.find((f) => f.code === k.ruleCode);
    const observation = observations.find((o) => o.code === k.observationCode && o.category === k.observationCategory);
    if (!rule || !observation) throw new Error(`fare conflict ${k.ruleCode}/${k.observationCode}: unresolved reference`);
    return { id: randomUUID(), fare_rule_id: rule.id, fare_observation_id: observation.id, status: k.status, note: k.note };
  });
  await insertRows(c, "transit.fare_conflict", fareConflicts, [["id", "uuid"], ["fare_rule_id", "uuid"],
    ["fare_observation_id", "uuid"], ["status", "text"], ["note", "text"]]);

  // ---------------------------------------------------------------- coverage and context
  const barangays = seed.barangays.map((b) => ({ ...b, id: randomUUID(), auditId: randomUUID() }));
  await insertRows(c, "transit.barangay", barangays.map((b) => ({
    id: b.id, name: b.name, survey_status: b.surveyStatus, source_code: b.sourceCode,
  })), [["id", "uuid"], ["name", "text"], ["survey_status", "text"], ["source_code", "text"]]);
  await insertRows(c, "transit.coverage_audit", barangays.map((b) => ({
    id: b.auditId, barangay_id: b.id, dimensions: { exact_boarding_points_verified: b.exactBoardingPointsVerified },
  })), [["id", "uuid"], ["barangay_id", "uuid"], ["dimensions", "jsonb"]]);

  const feeders = seed.feederCandidates.map((f) => ({ ...f, id: randomUUID() }));
  await insertRows(c, "transit.feeder_lead", feeders.map((f) => ({
    id: f.id, code: f.code, name: f.name, notes: f.notes, operating_status: f.operatingStatus,
    fare_centavos: f.fareCentavos, source_codes: f.sourceCodes,
  })), [["id", "uuid"], ["code", "text"], ["name", "text"], ["notes", "text"], ["operating_status", "text"],
    ["fare_centavos", "integer"], ["source_codes", "jsonb", textArrayNotNull("source_codes")]]);

  const providers = seed.providers.map((p) => ({ ...p, id: randomUUID() }));
  await insertRows(c, "transit.provider_presence", providers.map((p) => ({
    id: p.id, name: p.name, city_presence: p.cityPresence, products: p.products, quote_centavos: p.quoteCentavos,
    source_codes: p.sourceCodes,
  })), [["id", "uuid"], ["name", "text"], ["city_presence", "text"], ["products", "jsonb", textArray("products")],
    ["quote_centavos", "integer"], ["source_codes", "jsonb", textArrayNotNull("source_codes")]]);

  const rail = seed.railStatus.map((r) => ({ ...r, id: randomUUID() }));
  await insertRows(c, "transit.rail_status", rail.map((r) => ({
    id: r.id, key: r.key, value: r.value, source_codes: r.sourceCodes,
  })), [["id", "uuid"], ["key", "text"], ["value", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")]]);

  const candidates = seed.designatedCandidates.map((d) => ({ ...d, id: randomUUID() }));
  await insertRows(c, "transit.designated_stop_candidate", candidates.map((d) => ({
    id: d.id, code: d.code, label_raw: d.labelRaw, label_type: d.labelType, route_code: d.routeCode,
    direction: d.direction, source_ids: d.sourceIds, source_context: d.sourceContext,
    operating_status: d.operatingStatus, notes: d.notes, properties: d.properties,
  })), [["id", "uuid"], ["code", "text"], ["label_raw", "text"], ["label_type", "text"], ["route_code", "text"],
    ["direction", "text"], ["source_ids", "jsonb", textArrayNotNull("source_ids")], ["source_context", "text"],
    ["operating_status", "text"], ["notes", "text"], ["properties", "jsonb"]]);

  const categories = seed.externalDestinationCategories.map((d) => ({ ...d, id: randomUUID() }));
  await insertRows(c, "transit.external_destination_category", categories.map((d) => ({
    id: d.id, category: d.category, destinations: d.destinations, candidate_terminal_code: d.candidateTerminalCode,
    evidence_status: d.evidenceStatus, source_codes: d.sourceCodes,
  })), [["id", "uuid"], ["category", "text"], ["destinations", "jsonb", textArrayNotNull("destinations")],
    ["candidate_terminal_code", "text"], ["evidence_status", "text"],
    ["source_codes", "jsonb", textArrayNotNull("source_codes")]]);

  const notes = plan.datasetNotes.map((n) => ({ ...n, id: randomUUID() }));
  await insertRows(c, "transit.dataset_note", notes.map((n) => ({ id: n.id, key: n.key, value: n.value })),
    [["id", "uuid"], ["key", "text"], ["value", "jsonb"]]);

  // ---------------------------------------------------------------- revision
  await c.query(
    `insert into transit.revision (id, label, kind, status, created_by, content_hash)
     values ($1, $2, 'provisional', 'draft', $3, $4)`,
    [revisionId, plan.revisionLabel, IMPORT_ACTOR, plan.documentsHash],
  );
  const same = (kind: string, ids: string[]) => ids.map((id) => ({ entity_kind: kind, entity_id: id, version_id: id }));
  const members = [
    ...same("route", [...routeIds.values()]),
    ...variants.map((v) => ({ entity_kind: "variant", entity_id: v.id, version_id: v.versions.find((x) => x.isMember)!.id })),
    ...features.map((r) => ({ entity_kind: "stop_point", entity_id: r.stopPointId, version_id: r.stopVersionId })),
    ...same("terminal", terminals.map((t) => t.id)),
    ...fareRules.map((f) => ({ entity_kind: "fare_rule", entity_id: f.id, version_id: f.versionId })),
    ...same("fare_observation", observations.map((o) => o.id)),
    ...same("fare_conflict", fareConflicts.map((k) => k.id)),
    ...same("barangay", barangays.map((b) => b.id)),
    ...same("coverage_audit", barangays.map((b) => b.auditId)),
    ...same("feeder_lead", feeders.map((f) => f.id)),
    ...same("provider_presence", providers.map((p) => p.id)),
    ...same("rail_status", rail.map((r) => r.id)),
    ...same("designated_stop_candidate", candidates.map((d) => d.id)),
    ...same("external_destination_category", categories.map((d) => d.id)),
    ...same("dataset_note", notes.map((n) => n.id)),
  ].map((m) => ({ ...m, revision_id: revisionId }));
  await insertRows(c, "transit.revision_member", members, [["revision_id", "uuid"], ["entity_kind", "text"],
    ["entity_id", "uuid"], ["version_id", "uuid"]]);

  await c.query("select transit.publish_revision($1)", [revisionId]);

  const counts = { ...plan.counts, revision_members: members.length };
  await c.query(
    `update ingest.batch set status = 'committed', finished_at = now(), counts = $2::jsonb where id = $1`,
    [batchId, JSON.stringify({
      ...counts,
      documents_sha256: plan.documentsHash,
      documents: plan.documents.map((d) => ({ file: d.fileName, sha256: d.sha256, bytes: d.bytes })),
      revision_id: revisionId,
      revision_label: plan.revisionLabel,
    })],
  );
  return { outcome: "committed", batchId, revisionId, revisionLabel: plan.revisionLabel, counts };
}
