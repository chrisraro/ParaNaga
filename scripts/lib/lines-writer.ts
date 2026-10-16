// Database half of the road outputs (Increment D, Task 7), run by commitImport after the modes seed
// stage, in the same transaction, as paranaga_import, under
// pg_advisory_xact_lock(hashtext(<lines snapshot_version>)).
//
//   - no committed batch for this road snapshot + modes seed -> a new draft revision
//       `anywhere-alight-<roads date>` that carries the published revision forward
//       (carryForwardRevision): every member is copied by id except the shapes, the street graph
//       (format v2), the time-estimate parameters and the route notes (replaced as a whole) and the
//       regional services that get a
//       distance (a new version: the seed row plus the D5 distance). Stop, route and variant ids
//       are unchanged, so saved trips stay valid. Rows are inserted only where the content is new
//       (content hash); released rows are never updated. Then transit.publish_revision.
//   - committed batch with the same key (roads date, seed date and inputs hash) -> "unchanged";
//   - the same roads date with other inputs (a new places snapshot, Data_Sets, seed or builder) -> a new
//       revision labelled anywhere-alight-<roads date>.<n>;
//   - a road snapshot older than a committed one -> refused.
// Every member variant of the published revision must have a planned trace of exactly its member
// version (content hash), and every planned trace a member variant: otherwise refused (the paths
// would not describe what is published).
// The ROUTE_LANDMARKS / ROUTE_TERMINI review decisions, with how they resolved, are recorded in
// the batch (counts.trace_rules) so the paths are auditable.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { LinesPlan, PlannedTrace } from "./lines-plan";
import { carryForwardRevision } from "./modes-writer";
import { IMPORT_ACTOR, ImportRefusedError, insertRows, numberArray, point, publishedIncludes, textArrayNotNull, type Row } from "./sql-rows";

export type LinesOutcome =
  | { outcome: "committed"; batchId: string; revisionId: string; revisionLabel: string; counts: Record<string, number> }
  | {
      outcome: "unchanged";
      batchId: string;
      revisionLabel: string | null;
      publishedRevisionLabel: string | null;
      /** True when the published revision holds every road-output member of the batch's revision. */
      publishedIncludesBatch: boolean;
      counts: Record<string, number>;
    };

/** Member kinds whose whole set comes from the road stage (replaced, never carried). */
export const LINES_OWNED_KINDS = ["shape", "walk_graph", "eta_param", "route_note"] as const;

const OSMR_TITLE = "OpenStreetMap road network snapshot for Naga City (highways, OSM relation 3084673 + 300 m)";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

type Member = { entity_kind: string; entity_id: string; version_id: string };
type MemberVariant = {
  variant_id: string;
  version_id: string;
  public_code: string;
  direction: string;
  kind: string;
  name: string | null;
  content_hash: string | null;
};

const keyOf = (x: { routeCode: string; direction: string; kind: string; name: string | null }) =>
  `${x.routeCode}|${x.direction}|${x.kind}|${x.name ?? ""}`;

export async function writeLines(c: pg.ClientBase, lines: LinesPlan): Promise<LinesOutcome> {
  await c.query("select pg_advisory_xact_lock(hashtext($1))", [lines.snapshotVersion]);

  const prior = await c.query<{ id: string; snapshot_version: string; counts: Row }>(
    `select id, snapshot_version, counts from ingest.batch
      where mode = 'commit' and status = 'committed' and split_part(snapshot_version, ':', 1) = 'modes-lines'
      order by split_part(snapshot_version, ':', 2) desc, split_part(snapshot_version, ':', 3) desc, finished_at desc nulls last`,
  );
  const same = prior.rows.find((b) => b.snapshot_version === lines.snapshotVersion);
  if (same) return checkLinesUnchanged(c, lines, same);
  const roadsDateOf = (v: string) => v.split(":")[1] ?? "";
  const newer = prior.rows.find((b) => roadsDateOf(b.snapshot_version) > lines.roadsDate);
  if (newer) {
    throw new ImportRefusedError(`road snapshot ${lines.roadsFileName} is older than the committed ${newer.snapshot_version}; nothing written`);
  }

  // The base must stay the published revision until our publish (same lock as publish_revision).
  await c.query("select pg_advisory_xact_lock(hashtext('transit.publish_revision'))");
  const published = await c.query<{ id: string; kind: string; label: string }>(
    `select r.id, r.kind, r.label from transit.published_pointer p join transit.revision r on r.id = p.revision_id`,
  );
  const base = published.rows[0];
  if (!base) throw new ImportRefusedError("no published revision to carry forward; import the transit files first");

  // ---------------------------------------------------------------- ingest provenance
  const batchId = randomUUID();
  await writeRoadSource(c, lines);
  // One document row per file (unique file name + sha256): a later batch with a newer seed reuses it.
  const document = await c.query<{ id: string }>(
    "select id from ingest.source_document where file_name = $1 and sha256 = $2", [lines.roadsFileName, lines.roadsSha256]);
  const documentId = document.rows[0]?.id ?? randomUUID();
  if (!document.rows[0]) {
    await c.query(
      `insert into ingest.source_document (id, source_code, file_name, sha256, bytes, retrieved_on)
       values ($1, $2, $3, $4, $5, $6::date)`,
      [documentId, lines.sourceCode, lines.roadsFileName, lines.roadsSha256, lines.roadsBytes, lines.roadsDate],
    );
  }
  await c.query(
    `insert into ingest.batch (id, source_document_id, snapshot_version, mode, status, started_by)
     values ($1, $2, $3, 'commit', 'running', $4)`,
    [batchId, documentId, lines.snapshotVersion, IMPORT_ACTOR],
  );
  const counts: Record<string, number> = { ...lines.counts };

  // ---------------------------------------------------------------- variants: planned trace ↔ member version
  const memberVariants = await c.query<MemberVariant>(
    `select v.id as variant_id, m.version_id, r.public_code, v.direction, v.kind, v.name, vv.content_hash
       from transit.revision_member m
       join transit.variant v on v.id = m.entity_id
       join transit.route r on r.id = v.route_id
       join transit.variant_version vv on vv.id = m.version_id
      where m.revision_id = $1 and m.entity_kind = 'variant'`, [base.id]);
  const planned = new Map(lines.traces.map((t) => [keyOf(t), t]));
  const matched: { trace: PlannedTrace; variant: MemberVariant }[] = [];
  for (const v of memberVariants.rows) {
    const key = keyOf({ routeCode: v.public_code, direction: v.direction, kind: v.kind, name: v.name });
    const trace = planned.get(key);
    if (!trace) throw new ImportRefusedError(`published variant ${key} has no planned path; nothing written`);
    if (trace.variantVersionHash !== v.content_hash) {
      throw new ImportRefusedError(`published variant ${key}: its member version is not the one traced; nothing written`);
    }
    matched.push({ trace, variant: v });
    planned.delete(key);
  }
  if (planned.size > 0) {
    throw new ImportRefusedError(`planned path(s) for variants that are not published: ${[...planned.keys()].join(", ")}; nothing written`);
  }

  // Stop point versions of the member route stops, for the stop measures.
  const stops = await c.query<{ variant_version_id: string; seq: number; stop_point_version_id: string }>(
    `select rs.variant_version_id, rs.seq, rs.stop_point_version_id from transit.route_stop rs
      where rs.variant_version_id = any($1::uuid[]) order by rs.variant_version_id, rs.seq`,
    [matched.map((x) => x.variant.version_id)]);
  const stopsOf = (versionId: string) => stops.rows.filter((s) => s.variant_version_id === versionId);

  // ---------------------------------------------------------------- shapes (identity per variant + versions)
  const shapeIds = await ensureIdentities(c, "transit.shape", "variant_id", matched.map((x) => x.variant.variant_id));
  counts.shape_rows_inserted = shapeIds.inserted;
  const shapeVersions = await reuseOrPlan(c, "transit.shape_version", "shape_id",
    matched.map((x) => ({ owner: shapeIds.ids.get(x.variant.variant_id)!, hash: x.trace.contentHash, row: x })));
  counts.shape_versions_inserted = await insertRows(c, "transit.shape_version",
    shapeVersions.filter((s) => s.isNew).map(({ id, owner, row: { trace: t, variant } }) => {
      const routeStops = stopsOf(variant.version_id);
      const stopMeasures = t.stopMeasures === null ? null : t.stopMeasures.map((m) => {
        const rs = routeStops.find((s) => s.seq === m.seq);
        if (!rs) throw new ImportRefusedError(`${variant.public_code}: no route stop ${m.seq} for its stop measure; nothing written`);
        return { seq: m.seq, stopPointVersionId: rs.stop_point_version_id, measureM: m.measureM, snapM: m.snapM };
      });
      if (t.status !== "untraced" && (stopMeasures?.length ?? 0) !== routeStops.length) {
        throw new ImportRefusedError(`${variant.public_code}: ${stopMeasures?.length ?? 0} stop measures for ${routeStops.length} stops; nothing written`);
      }
      return {
        id, shape_id: owner, variant_version_id: variant.version_id, trace_status: t.status, flag_reason: t.flagReason,
        untraced_reason: t.untracedReason, line: t.status === "untraced" ? null : { type: "LineString", coordinates: t.coords.map((p) => [p.lng, p.lat]) },
        length_m: t.lengthM, stop_measures: stopMeasures, off_list_segments: t.offListSegments, trace_quality: t.quality,
        inputs_hash: t.inputsHash, road_source_code: lines.sourceCode, content_hash: t.contentHash,
      };
    }),
    [["id", "uuid"], ["shape_id", "uuid"], ["variant_version_id", "uuid"], ["trace_status", "text"], ["flag_reason", "text"],
      ["untraced_reason", "text"], ["length_m", "numeric"], ["stop_measures", "jsonb"], ["off_list_segments", "jsonb"],
      ["trace_quality", "jsonb"], ["inputs_hash", "text"], ["road_source_code", "text"], ["content_hash", "text"]],
    { inputs: [["line", "jsonb"]], computed: [["geog",
      `case when x.line is null then null else
         extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(x.line::text), 4326)::extensions.geography end`]] });

  // ---------------------------------------------------------------- walk graph
  const wg = lines.walkGraph!;
  const graphIds = await ensureIdentities(c, "transit.walk_graph", "key", [wg.key]);
  const graphVersions = await reuseOrPlan(c, "transit.walk_graph_version", "walk_graph_id",
    [{ owner: graphIds.ids.get(wg.key)!, hash: wg.contentHash, row: wg }]);
  counts.walk_graph_versions_inserted = await insertRows(c, "transit.walk_graph_version",
    graphVersions.filter((g) => g.isNew).map(({ id, owner, row: g }) => ({
      id, walk_graph_id: owner, format_version: g.formatVersion, payload: g.payload, bytes: g.bytes, gzip_bytes: g.gzipBytes,
      sha256: g.sha256, node_count: g.nodeCount, edge_count: g.edgeCount, road_source_code: lines.sourceCode,
      builder_version: g.builderVersion, content_hash: g.contentHash,
    })), [["id", "uuid"], ["walk_graph_id", "uuid"], ["format_version", "integer"], ["payload", "text"], ["bytes", "integer"],
      ["gzip_bytes", "integer"], ["sha256", "text"], ["node_count", "integer"], ["edge_count", "integer"],
      ["road_source_code", "text"], ["builder_version", "text"], ["content_hash", "text"]]);

  // ---------------------------------------------------------------- time-estimate parameters
  const paramIds = await ensureIdentities(c, "transit.eta_param", "key", lines.etaParams.map((p) => p.key));
  const paramVersions = await reuseOrPlan(c, "transit.eta_param_version", "eta_param_id",
    lines.etaParams.map((p) => ({ owner: paramIds.ids.get(p.key)!, hash: p.contentHash, row: p })));
  counts.eta_param_versions_inserted = await insertRows(c, "transit.eta_param_version",
    paramVersions.filter((p) => p.isNew).map(({ id, owner, row: p }) => ({
      id, eta_param_id: owner, value_low: p.valueLow, value_high: p.valueHigh, unit: p.unit, windows: p.windows, days: p.days,
      applies_to: p.appliesTo, is_assumption: p.isAssumption, assumption_note: p.assumptionNote, basis: p.basis,
      source_codes: p.sourceCodes, content_hash: p.contentHash,
    })), [["id", "uuid"], ["eta_param_id", "uuid"], ["value_low", "numeric"], ["value_high", "numeric"], ["unit", "text"],
      ["windows", "jsonb"], ["days", "text"], ["applies_to", "jsonb", textArrayNotNull("applies_to")], ["is_assumption", "boolean"],
      ["assumption_note", "text"], ["basis", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")],
      ["content_hash", "text"]]);

  // ---------------------------------------------------------------- route notes (E-J7): every note's route must be a member
  const memberRoutes = await c.query<{ id: string; public_code: string }>(
    `select t.id, t.public_code from transit.revision_member m join transit.route t on t.id = m.entity_id
      where m.revision_id = $1 and m.entity_kind = 'route'`, [base.id]);
  const routeIdByCode = new Map(memberRoutes.rows.map((r) => [r.public_code, r.id]));
  const noteItems = lines.routeNotes.map((n) => {
    const owner = routeIdByCode.get(n.routeCode);
    if (!owner) throw new ImportRefusedError(`route note ${n.noteCode}: route ${n.routeCode} is not in the published revision; nothing written`);
    return { owner, hash: n.contentHash, row: n };
  });
  const noteVersions = await reuseOrPlan(c, "transit.route_note", "route_id", noteItems);
  counts.route_notes_inserted = await insertRows(c, "transit.route_note",
    noteVersions.filter((n) => n.isNew).map(({ id, owner, row: n }) => ({
      id, route_id: owner, note_code: n.noteCode, text: n.text, evidence: n.evidence, near_radius_m: n.nearRadiusM,
      source_codes: n.sourceCodes, content_hash: n.contentHash, lon: n.nearLng, lat: n.nearLat,
    })), [["id", "uuid"], ["route_id", "uuid"], ["note_code", "text"], ["text", "text"], ["evidence", "text"],
      ["near_radius_m", "integer"], ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"]],
    { inputs: [["lon", "float8"], ["lat", "float8"]], computed: [["near_geog", point("lon", "lat")]] });

  // ---------------------------------------------------------------- regional services: distance versions
  const services = await c.query<{ id: string; code: string }>(
    `select s.id, s.code from transit.revision_member m join transit.regional_service s on s.id = m.entity_id
      where m.revision_id = $1 and m.entity_kind = 'regional_service'`, [base.id]);
  const serviceId = new Map(services.rows.map((s) => [s.code, s.id]));
  const distances = lines.regionalDistances.filter((d) => serviceId.has(d.service.code));
  const distanceVersions = await reuseOrPlan(c, "transit.regional_service_version", "regional_service_id",
    distances.map((d) => ({ owner: serviceId.get(d.service.code)!, hash: d.contentHash, row: d })));
  counts.regional_service_versions_inserted = await insertRows(c, "transit.regional_service_version",
    distanceVersions.filter((d) => d.isNew).map(({ id, owner, row: { service: r, ...d } }) => ({
      id, regional_service_id: owner, mode: r.mode, name: r.name, operators: r.operators, terminal_code: r.terminalCode,
      terminal_note: r.terminalNote, destination: r.destination, osm_relation_ids: r.osmRelationIds,
      osm_relation_versions: d.relationVersions, distance_km: d.distanceKm, distance_basis: d.distanceBasis, status: r.status,
      fare_rule_codes: r.fareRuleCodes, notes: r.notes, source_codes: [...new Set([...r.sourceCodes, lines.sourceCode])],
      content_hash: d.contentHash,
    })), [["id", "uuid"], ["regional_service_id", "uuid"], ["mode", "text"], ["name", "text"],
      ["operators", "jsonb", textArrayNotNull("operators")], ["terminal_code", "text"], ["terminal_note", "text"],
      ["destination", "text"], ["osm_relation_ids", "jsonb", numberArray("osm_relation_ids", "bigint")],
      ["osm_relation_versions", "jsonb", numberArray("osm_relation_versions", "integer")], ["distance_km", "numeric"],
      ["distance_basis", "text"], ["status", "text"], ["fare_rule_codes", "jsonb", textArrayNotNull("fare_rule_codes")],
      ["notes", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"]]);

  // ---------------------------------------------------------------- revision: carry forward + road members
  const revisionId = randomUUID();
  // Revision labels are unique: a later batch on the same roads date gets .2, .3 …
  const taken = await c.query<{ n: number }>(
    `select count(*)::int as n from transit.revision where label = $1 or label like $1 || '.%'`, [lines.revisionLabel]);
  const revisionLabel = taken.rows[0]!.n === 0 ? lines.revisionLabel : `${lines.revisionLabel}.${taken.rows[0]!.n + 1}`;
  await c.query(
    `insert into transit.revision (id, label, kind, status, created_by, parent_revision_id, content_hash)
     values ($1, $2, $3, 'draft', $4, $5, $6)`,
    [revisionId, revisionLabel, base.kind, IMPORT_ACTOR, base.id, lines.inputsHash],
  );
  const added: Member[] = [
    ...shapeVersions.map((s) => ({ entity_kind: "shape", entity_id: s.owner, version_id: s.id })),
    ...graphVersions.map((g) => ({ entity_kind: "walk_graph", entity_id: g.owner, version_id: g.id })),
    ...paramVersions.map((p) => ({ entity_kind: "eta_param", entity_id: p.owner, version_id: p.id })),
    ...noteVersions.map((n) => ({ entity_kind: "route_note", entity_id: n.id, version_id: n.id })),
    ...distanceVersions.map((d) => ({ entity_kind: "regional_service", entity_id: d.owner, version_id: d.id })),
  ];
  const carried = await carryForwardRevision(c, base.id, revisionId, {
    dropKinds: [...LINES_OWNED_KINDS], replace: added, dropVariantsOfRoutes: [],
  });
  await insertRows(c, "transit.revision_member", added.map((m) => ({ ...m, revision_id: revisionId })),
    [["revision_id", "uuid"], ["entity_kind", "text"], ["entity_id", "uuid"], ["version_id", "uuid"]]);

  // Refuses synthetic rows and any member that breaks a 0006/0007 rule (shape ↔ member variant
  // version, stop measures ↔ member stops, one walk graph, all five parameters).
  await c.query("select transit.publish_revision($1)", [revisionId]);

  counts.carried_members = carried;
  counts.road_members = added.length;
  counts.revision_members = carried + added.length;
  await c.query(
    `update ingest.batch set status = 'committed', finished_at = now(), counts = $2::jsonb where id = $1`,
    [batchId, JSON.stringify({
      ...counts, inputs_hash: lines.inputsHash, document_sha256: lines.roadsSha256, file: lines.roadsFileName,
      source_code: lines.sourceCode, osm_base_timestamp: lines.osmBaseTimestamp, aliases_hash: lines.aliasesHash,
      revision_id: revisionId, revision_label: revisionLabel, parent_revision_id: base.id, parent_revision_label: base.label,
      walk_graph_sha256: wg.sha256,
      // Review decisions that live in code (route-landmarks.ts, trace-context.ts), with their resolution.
      trace_rules: lines.traceRules,
      traces: lines.traces.map((t) => ({
        route: t.routeCode, direction: t.direction, kind: t.kind, name: t.name, status: t.status,
        reason: t.untracedReason ?? t.flagReason, length_m: t.lengthM, gate_off_list_share: t.quality.gateOffListShare,
        unmatched: t.quality.unmatchedStreets, anchors_unresolved: t.quality.anchorsUnresolved,
      })),
      regional_without_distance: lines.regionalWithoutDistance,
    })],
  );
  return { outcome: "committed", batchId, revisionId, revisionLabel, counts };
}

/** The OSMR-<date> source row (D2): inserted once; an existing row must be the same. */
async function writeRoadSource(c: pg.ClientBase, lines: LinesPlan) {
  const row = {
    title: OSMR_TITLE, url: OSM_COPYRIGHT_URL, evidence_type: "open_data",
    published_or_enacted: lines.osmBaseTimestamp === null ? null : `OSM data as of ${lines.osmBaseTimestamp}`,
    checked_on: lines.roadsDate, publisher: "OpenStreetMap contributors", licence: "ODbL 1.0",
  };
  const found = await c.query<Row>(
    `select title, url, evidence_type, published_or_enacted, checked_on::text as checked_on, publisher, licence
       from ingest.source where code = $1`, [lines.sourceCode]);
  if (found.rows[0]) {
    if (JSON.stringify(found.rows[0]) !== JSON.stringify(row)) {
      throw new ImportRefusedError(`source ${lines.sourceCode} differs from the committed ingest.source row; nothing written`);
    }
    return;
  }
  await c.query(
    `insert into ingest.source (code, title, url, evidence_type, published_or_enacted, checked_on, publisher, licence)
     values ($1, $2, $3, $4, $5, $6::date, $7, $8)`,
    [lines.sourceCode, row.title, row.url, row.evidence_type, row.published_or_enacted, row.checked_on, row.publisher, row.licence],
  );
}

/** Identity rows by a unique key: existing ids are reused (a synthetic one refuses), missing ones inserted. */
async function ensureIdentities(c: pg.ClientBase, table: string, key: string, keys: string[]) {
  const existing = await c.query<{ id: string; k: string; is_synthetic: boolean }>(
    `select id, ${key}::text as k, is_synthetic from ${table} where ${key}::text = any($1::text[])`, [keys]);
  const bad = existing.rows.filter((r) => r.is_synthetic);
  if (bad.length > 0) throw new ImportRefusedError(`${table} ${bad.map((r) => r.k).join(", ")} exist(s) as synthetic test data; nothing written`);
  const ids = new Map(existing.rows.map((r) => [r.k, r.id]));
  const fresh = keys.filter((k) => !ids.has(k)).map((k) => ({ id: randomUUID(), k }));
  const keyType = key === "variant_id" ? "uuid" : "text";
  const inserted = await insertRows(c, table, fresh.map((f) => ({ id: f.id, [key]: f.k })), [["id", "uuid"], [key, keyType]]);
  for (const f of fresh) ids.set(f.k, f.id);
  return { ids, inserted };
}

/** Rows keyed by (owner, content_hash): an existing (non-synthetic) row is reused, otherwise a new id is planned. */
async function reuseOrPlan<T>(c: pg.ClientBase, table: string, ownerColumn: string, items: { owner: string; hash: string; row: T }[]) {
  const existing = await c.query<{ id: string; owner: string; content_hash: string; is_synthetic: boolean }>(
    `select id, ${ownerColumn} as owner, content_hash, is_synthetic from ${table} where ${ownerColumn} = any($1::uuid[])`,
    [[...new Set(items.map((i) => i.owner))]]);
  const byKey = new Map(existing.rows.map((r) => [`${r.owner}:${r.content_hash}`, r]));
  return items.map((i) => {
    const found = byKey.get(`${i.owner}:${i.hash}`);
    if (found?.is_synthetic) throw new ImportRefusedError(`${table} ${found.id} is synthetic test data; nothing written`);
    return { id: found?.id ?? randomUUID(), owner: i.owner, row: i.row, isNew: !found };
  });
}

async function checkLinesUnchanged(
  c: pg.ClientBase,
  lines: LinesPlan,
  last: { id: string; snapshot_version: string; counts: Row },
): Promise<LinesOutcome> {
  if (last.counts.inputs_hash !== lines.inputsHash) {
    throw new ImportRefusedError(
      `batch ${last.id} (${last.snapshot_version}) has the same key but another inputs hash (a hash-prefix collision); ` +
        "nothing was written.",
    );
  }
  const pointer = await c.query<{ label: string }>(
    `select r.label from transit.published_pointer p join transit.revision r on r.id = p.revision_id`,
  );
  const batchRevision = typeof last.counts.revision_id === "string" ? last.counts.revision_id : null;
  return {
    outcome: "unchanged",
    batchId: last.id,
    revisionLabel: typeof last.counts.revision_label === "string" ? last.counts.revision_label : null,
    publishedRevisionLabel: pointer.rows[0]?.label ?? null,
    publishedIncludesBatch: batchRevision !== null && (await publishedIncludes(c, batchRevision, [...LINES_OWNED_KINDS])),
    counts: lines.counts,
  };
}
