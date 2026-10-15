// Database half of the reviewed modes seed import (Increment D, Task 2), run by commitImport
// after the transit and OpenStreetMap places stages, in the same transaction, as paranaga_import,
// under pg_advisory_xact_lock(hashtext(<modes snapshot_version>)).
//
//   - no committed batch for this seed date  -> a new draft revision `modes-<date>` that carries the
//       published revision forward (carryForwardRevision): every member is copied by id except the
//       ones this seed replaces (its terminals, the fare rules it touches, its feeder routes and
//       their variants, and every per-route record and regional service), which are added again
//       from the seed. Stop, LPTRP route and variant ids are unchanged, so saved trips stay valid.
//       Rows are inserted only where the content is new (content hash); released rows are never
//       updated. Then transit.publish_revision.
//   - committed batch with the same file hash -> "unchanged", nothing written;
//   - same date with another file, or older than a committed seed -> refused.
// A synthetic seed (header.synthetic) is written with every row flagged is_synthetic (its X-coded
// sources are not written) and handed to transit.publish_revision, which refuses it; the caller
// rolls the whole transaction back.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ModesPlan } from "./modes-plan";
import {
  IMPORT_ACTOR,
  ImportRefusedError,
  insertRows,
  numberArray,
  point,
  publishedIncludes,
  textArray,
  textArrayNotNull,
  type Row,
} from "./sql-rows";

export type ModesOutcome =
  | { outcome: "committed"; batchId: string; revisionId: string; revisionLabel: string; counts: Record<string, number> }
  | {
      outcome: "unchanged";
      batchId: string;
      revisionLabel: string | null;
      publishedRevisionLabel: string | null;
      /** True when the published revision holds every seed-owned member of the batch's revision. */
      publishedIncludesBatch: boolean;
      counts: Record<string, number>;
    };

/** Member kinds whose whole set comes from the modes seed (replaced, never carried). */
export const MODES_OWNED_KINDS = [
  "route_vehicle_class", "route_cooperative", "route_operating_status", "route_fare_observation", "regional_service",
] as const;

type Member = { entity_kind: string; entity_id: string; version_id: string };

export async function writeModes(c: pg.ClientBase, modes: ModesPlan): Promise<ModesOutcome> {
  const synthetic = modes.synthetic;
  // A synthetic run never commits; its own batch key keeps it apart from a real batch of the same date.
  const snapshotVersion = synthetic ? `${modes.snapshotVersion}:synthetic` : modes.snapshotVersion;
  await c.query("select pg_advisory_xact_lock(hashtext($1))", [modes.snapshotVersion]);

  if (!synthetic) {
    const prior = await c.query<{ id: string; snapshot_version: string; counts: Row }>(
      `select id, snapshot_version, counts from ingest.batch
        where mode = 'commit' and status = 'committed' and split_part(snapshot_version, ':', 1) = 'modes-seed'
        order by split_part(snapshot_version, ':', 2) desc, finished_at desc nulls last`,
    );
    const same = prior.rows.find((b) => b.snapshot_version === snapshotVersion);
    if (same) return checkModesUnchanged(c, modes, same);
    const newer = prior.rows.find((b) => b.snapshot_version > snapshotVersion);
    if (newer) {
      throw new ImportRefusedError(`modes seed ${modes.fileName} is older than the committed ${newer.snapshot_version}; nothing written`);
    }
  }

  // The base must stay the published revision until our publish: take publish_revision's own
  // transaction lock (re-entrant) before reading the pointer, so no other publish can slip in.
  await c.query("select pg_advisory_xact_lock(hashtext('transit.publish_revision'))");
  const published = await c.query<{ id: string; kind: string; label: string }>(
    `select r.id, r.kind, r.label from transit.published_pointer p join transit.revision r on r.id = p.revision_id`,
  );
  const base = published.rows[0];
  if (!base) throw new ImportRefusedError("no published revision to carry forward; import the transit files first");

  // ---------------------------------------------------------------- ingest provenance
  const batchId = randomUUID();
  const documentId = randomUUID();
  await c.query(
    `insert into ingest.source_document (id, source_code, file_name, sha256, bytes, retrieved_on)
     values ($1, null, $2, $3, $4, $5::date)`,
    [documentId, modes.fileName, modes.sha256, modes.bytes, modes.seedDate],
  );
  await c.query(
    `insert into ingest.batch (id, source_document_id, snapshot_version, mode, status, started_by)
     values ($1, $2, $3, 'commit', 'running', $4)`,
    [batchId, documentId, snapshotVersion, IMPORT_ACTOR],
  );
  const counts: Record<string, number> = { ...modes.counts };

  counts.sources_inserted = synthetic ? 0 : await writeSources(c, modes);

  await insertRows(c, "ingest.conflict", modes.conflicts.map((k) => ({
    batch_id: batchId, kind: "research_conflict", refs: [k.code],
    detail: { code: k.code, topic: k.topic, description: k.description, refs: k.refs, source_codes: k.sourceCodes },
  })), [["batch_id", "uuid"], ["kind", "text"], ["refs", "jsonb", textArray("refs")], ["detail", "jsonb"]]);

  // ---------------------------------------------------------------- terminals (identity + versions)
  const terminalIds = await ensureIdentities(c, "transit.terminal", "code", modes.terminals.map((t) => t.code), synthetic,
    (t) => {
      const p = modes.terminals.find((x) => x.code === t)!;
      return {
        code: p.code, name: p.name, location_text: p.locationText, modes: p.modes, evidence_status: p.verification,
        notes: p.notes, source_codes: p.sourceCodes, is_synthetic: synthetic,
      };
    },
    [["code", "text"], ["name", "text"], ["location_text", "text"], ["modes", "jsonb", textArrayNotNull("modes")],
      ["evidence_status", "text"], ["notes", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")],
      ["is_synthetic", "boolean"]]);
  counts.terminal_rows_inserted = terminalIds.inserted;
  const terminalVersions = await reuseOrPlan(c, "transit.terminal_version", "terminal_id",
    modes.terminals.map((t) => ({ owner: terminalIds.ids.get(t.code)!, hash: t.contentHash, row: t })), synthetic);
  counts.terminal_versions_inserted = await insertRows(c, "transit.terminal_version",
    terminalVersions.filter((x) => x.isNew).map(({ id, owner, row: t }) => ({
      id, terminal_id: owner, name: t.name, kind: t.kind, location_text: t.locationText, modes: t.modes,
      modes_raw: t.modesRaw, mode_sources: t.modeSources, lon: t.lng, lat: t.lat, coord_source: t.coordSource,
      osm_type: t.osmType, osm_id: t.osmId, osm_version: t.osmVersion, osm_timestamp: t.osmTimestamp,
      coord_note: t.coordNote, coord_read_from: t.coordReadFrom, verification: t.verification,
      status_note: t.statusNote, notes: t.notes, source_codes: t.sourceCodes, content_hash: t.contentHash,
      is_synthetic: synthetic,
    })), [["id", "uuid"], ["terminal_id", "uuid"], ["name", "text"], ["kind", "text"], ["location_text", "text"],
      ["modes", "jsonb", textArrayNotNull("modes")], ["modes_raw", "jsonb", textArrayNotNull("modes_raw")],
      ["mode_sources", "jsonb"], ["coord_source", "text"], ["osm_type", "text"], ["osm_id", "bigint"],
      ["osm_version", "integer"], ["osm_timestamp", "timestamptz"], ["coord_note", "text"], ["coord_read_from", "text"],
      ["verification", "text"], ["status_note", "text"], ["notes", "text"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"], ["is_synthetic", "boolean"]],
    { inputs: [["lon", "float8"], ["lat", "float8"]], computed: [["geog", point("lon", "lat")]] });

  // ---------------------------------------------------------------- feeder routes, variants, versions
  const seedRouteIds = await ensureRoutes(c, modes, synthetic);
  counts.route_rows_inserted = seedRouteIds.inserted;
  const variantMembers: Member[] = [];
  let variantRows = 0;
  let variantVersionRows = 0;
  for (const r of modes.routes) {
    const routeId = seedRouteIds.ids.get(r.publicCode)!;
    for (const v of r.variants) {
      const existing = await c.query<{ id: string; is_synthetic: boolean }>(
        `select id, is_synthetic from transit.variant
          where route_id = $1 and direction = $2 and kind = $3 and name is not distinct from $4`,
        [routeId, v.direction, v.kind, v.name],
      );
      let variantId = existing.rows[0]?.id;
      if (existing.rows[0] && existing.rows[0].is_synthetic && !synthetic) {
        throw new ImportRefusedError(`variant ${r.publicCode} "${v.name}" exists as synthetic test data; nothing written`);
      }
      if (!variantId) {
        variantId = randomUUID();
        await c.query(
          `insert into transit.variant (id, route_id, direction, kind, name, is_synthetic) values ($1, $2, $3, $4, $5, $6)`,
          [variantId, routeId, v.direction, v.kind, v.name, synthetic],
        );
        variantRows += 1;
      }
      const version = await c.query<{ id: string }>(
        `select id from transit.variant_version where variant_id = $1 and content_hash = $2`, [variantId, v.contentHash]);
      let versionId = version.rows[0]?.id;
      if (!versionId) {
        versionId = randomUUID();
        await c.query(
          `insert into transit.variant_version (id, variant_id, legal_streets, anchors, evidence_level, is_circular,
                                                source_codes, content_hash, is_synthetic)
           values ($1, $2, $3::jsonb, $4::jsonb, $5, false, $6::text[], $7, $8)`,
          [versionId, variantId, JSON.stringify(v.legalStreets), JSON.stringify(v.anchors), v.evidenceLevel,
            v.sourceCodes, v.contentHash, synthetic],
        );
        variantVersionRows += 1;
      }
      variantMembers.push({ entity_kind: "variant", entity_id: variantId, version_id: versionId });
    }
  }
  counts.variant_rows_inserted = variantRows;
  counts.variant_versions_inserted = variantVersionRows;

  // ---------------------------------------------------------------- fare rules
  const ruleCodes = modes.fareRules.map((f) => f.code);
  const existingRules = await c.query<{ id: string; code: string; mode_code: string; is_synthetic: boolean }>(
    `select id, code, mode_code, is_synthetic from transit.fare_rule where code = any($1::text[])`, [ruleCodes]);
  const ruleIdByCode = new Map(existingRules.rows.map((r) => [r.code, r.id]));
  for (const f of modes.fareRules) {
    const found = existingRules.rows.find((r) => r.code === f.code);
    if (!f.isNewRule && !found) throw new ImportRefusedError(`fare rule ${f.code} is not in the database; import the transit files first`);
    if (found && found.mode_code !== f.modeCode) {
      throw new ImportRefusedError(`fare rule ${f.code} has mode ${found.mode_code} in the database, ${f.modeCode} in the seed; nothing written`);
    }
    if (found && found.is_synthetic && !synthetic) throw new ImportRefusedError(`fare rule ${f.code} exists as synthetic test data`);
  }
  const newRuleRows = modes.fareRules.filter((f) => !ruleIdByCode.has(f.code)).map((f) => ({ id: randomUUID(), f }));
  counts.fare_rule_rows_inserted = await insertRows(c, "transit.fare_rule", newRuleRows.map(({ id, f }) => ({
    id, code: f.code, mode_code: f.modeCode, is_synthetic: synthetic,
  })), [["id", "uuid"], ["code", "text"], ["mode_code", "text"], ["is_synthetic", "boolean"]]);
  for (const { id, f } of newRuleRows) ruleIdByCode.set(f.code, id);
  const fareVersions = await reuseOrPlan(c, "transit.fare_rule_version", "fare_rule_id",
    modes.fareRules.map((f) => ({ owner: ruleIdByCode.get(f.code)!, hash: f.contentHash, row: f })), synthetic);
  counts.fare_rule_versions_inserted = await insertRows(c, "transit.fare_rule_version",
    fareVersions.filter((x) => x.isNew).map(({ id, owner, row: f }) => ({
      id, fare_rule_id: owner, base_centavos: f.baseCentavos, base_km: f.baseKm,
      increment_centavos_per_km: f.incrementCentavosPerKm, discount_percent: f.discountPercent,
      discounted_base_centavos: f.discountedBaseCentavos, discount_groups: f.discountGroups, rounding: f.rounding,
      effective_from: f.effectiveFrom, enacted_on: f.enactedOn, evidence_status: f.evidenceStatus,
      publish_exact: f.publishExact, source_codes: f.sourceCodes, rule_text: f.ruleText, notes: f.notes,
      content_hash: f.contentHash, is_synthetic: synthetic,
    })), [["id", "uuid"], ["fare_rule_id", "uuid"], ["base_centavos", "integer"], ["base_km", "numeric"],
      ["increment_centavos_per_km", "integer"], ["discount_percent", "numeric"], ["discounted_base_centavos", "integer"],
      ["discount_groups", "jsonb", textArray("discount_groups")], ["rounding", "text"], ["effective_from", "date"],
      ["enacted_on", "date"], ["evidence_status", "text"], ["publish_exact", "boolean"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["rule_text", "text"], ["notes", "text"],
      ["content_hash", "text"], ["is_synthetic", "boolean"]]);

  // ---------------------------------------------------------------- per-route records
  // LPTRP routes resolve through the published revision's route members; feeder routes are the seed's.
  const memberRoutes = await c.query<{ id: string; public_code: string }>(
    `select t.id, t.public_code from transit.revision_member m join transit.route t on t.id = m.entity_id
      where m.revision_id = $1 and m.entity_kind = 'route'`, [base.id]);
  const routeIdByCode = new Map(memberRoutes.rows.map((r) => [r.public_code, r.id]));
  for (const [code, id] of seedRouteIds.ids) routeIdByCode.set(code, id);
  const routeIdOf = (code: string, what: string) => {
    const id = routeIdByCode.get(code);
    if (!id) throw new ImportRefusedError(`${what}: route ${code} is not in the published revision; nothing written`);
    return id;
  };

  const operating = await reuseOrPlan(c, "transit.route_operating_status", "route_id",
    modes.operatingStatuses.map((s) => ({ owner: routeIdOf(s.routeCode, "operating status"), hash: s.contentHash, row: s })), synthetic);
  counts.route_operating_statuses_inserted = await insertRows(c, "transit.route_operating_status",
    operating.filter((x) => x.isNew).map(({ id, owner, row: s }) => ({
      id, route_id: owner, operating_status: s.operatingStatus, status_note: s.statusNote, confirmed_on: s.confirmedOn,
      source_codes: s.sourceCodes, content_hash: s.contentHash, is_synthetic: synthetic,
    })), [["id", "uuid"], ["route_id", "uuid"], ["operating_status", "text"], ["status_note", "text"],
      ["confirmed_on", "date"], ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"],
      ["is_synthetic", "boolean"]]);

  const vehicleClasses = await reuseOrPlan(c, "transit.route_vehicle_class", "route_id",
    modes.vehicleClasses.map((v) => ({ owner: routeIdOf(v.routeCode, `fleet ${v.code}`), hash: v.contentHash, row: v })), synthetic);
  counts.route_vehicle_classes_inserted = await insertRows(c, "transit.route_vehicle_class",
    vehicleClasses.filter((x) => x.isNew).map(({ id, owner, row: v }) => ({
      id, route_id: owner, code: v.code, vehicle_class: v.vehicleClass, evidence_levels: v.evidenceLevels,
      status: v.status, first_reported_on: v.firstReportedOn, last_reported_on: v.lastReportedOn,
      units_note: v.unitsNote, aircon: v.aircon, aircon_source_codes: v.airconSourceCodes,
      cooperatives: v.cooperatives, conflict_notes: v.conflictNotes, notes: v.notes, source_codes: v.sourceCodes,
      content_hash: v.contentHash, is_synthetic: synthetic,
    })), [["id", "uuid"], ["route_id", "uuid"], ["code", "text"], ["vehicle_class", "text"],
      ["evidence_levels", "jsonb", textArrayNotNull("evidence_levels")], ["status", "text"],
      ["first_reported_on", "date"], ["last_reported_on", "date"], ["units_note", "text"], ["aircon", "boolean"],
      ["aircon_source_codes", "jsonb", textArrayNotNull("aircon_source_codes")],
      ["cooperatives", "jsonb", textArrayNotNull("cooperatives")], ["conflict_notes", "jsonb", textArrayNotNull("conflict_notes")],
      ["notes", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"],
      ["is_synthetic", "boolean"]]);

  const cooperatives = await reuseOrPlan(c, "transit.route_cooperative", "route_id",
    modes.cooperatives.map((k) => ({ owner: routeIdOf(k.routeCode, `cooperative ${k.name}`), hash: k.contentHash, row: k })), synthetic);
  counts.route_cooperatives_inserted = await insertRows(c, "transit.route_cooperative",
    cooperatives.filter((x) => x.isNew).map(({ id, owner, row: k }) => ({
      id, route_id: owner, name: k.name, basis: k.basis, reported_on: k.reportedOn, notes: k.notes,
      source_codes: k.sourceCodes, content_hash: k.contentHash, is_synthetic: synthetic,
    })), [["id", "uuid"], ["route_id", "uuid"], ["name", "text"], ["basis", "text"], ["reported_on", "text"],
      ["notes", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"],
      ["is_synthetic", "boolean"]]);

  const observations = await reuseOrPlan(c, "transit.route_fare_observation", "route_id",
    modes.routeFareObservations.map((o) => ({ owner: routeIdOf(o.routeCode, `fare observation ${o.code}`), hash: o.contentHash, row: o })),
    synthetic);
  counts.route_fare_observations_inserted = await insertRows(c, "transit.route_fare_observation",
    observations.filter((x) => x.isNew).map(({ id, owner, row: o }) => ({
      id, route_id: owner, code: o.code, vehicle_class: o.vehicleClass, kind: o.kind, relative_to: o.relativeTo,
      delta_qualifier: o.deltaQualifier, delta_centavos_low: o.deltaCentavosLow, delta_centavos_high: o.deltaCentavosHigh,
      observed_on: o.observedOn, report_text: o.reportText, notes: o.notes, source_codes: o.sourceCodes,
      content_hash: o.contentHash, is_synthetic: synthetic,
    })), [["id", "uuid"], ["route_id", "uuid"], ["code", "text"], ["vehicle_class", "text"], ["kind", "text"],
      ["relative_to", "text"], ["delta_qualifier", "text"], ["delta_centavos_low", "integer"],
      ["delta_centavos_high", "integer"], ["observed_on", "date"], ["report_text", "text"], ["notes", "text"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"], ["is_synthetic", "boolean"]]);

  // ---------------------------------------------------------------- regional services
  const serviceIds = await ensureIdentities(c, "transit.regional_service", "code", modes.regionalServices.map((r) => r.code),
    synthetic, (code) => ({ code, is_synthetic: synthetic }), [["code", "text"], ["is_synthetic", "boolean"]]);
  counts.regional_service_rows_inserted = serviceIds.inserted;
  const services = await reuseOrPlan(c, "transit.regional_service_version", "regional_service_id",
    modes.regionalServices.map((r) => ({ owner: serviceIds.ids.get(r.code)!, hash: r.contentHash, row: r })), synthetic);
  counts.regional_service_versions_inserted = await insertRows(c, "transit.regional_service_version",
    services.filter((x) => x.isNew).map(({ id, owner, row: r }) => ({
      id, regional_service_id: owner, mode: r.mode, name: r.name, operators: r.operators, terminal_code: r.terminalCode,
      terminal_note: r.terminalNote, destination: r.destination, osm_relation_ids: r.osmRelationIds, status: r.status,
      fare_rule_codes: r.fareRuleCodes, notes: r.notes, source_codes: r.sourceCodes, content_hash: r.contentHash,
      is_synthetic: synthetic,
    })), [["id", "uuid"], ["regional_service_id", "uuid"], ["mode", "text"], ["name", "text"],
      ["operators", "jsonb", textArrayNotNull("operators")], ["terminal_code", "text"], ["terminal_note", "text"],
      ["destination", "text"], ["osm_relation_ids", "jsonb", numberArray("osm_relation_ids", "bigint")], ["status", "text"],
      ["fare_rule_codes", "jsonb", textArrayNotNull("fare_rule_codes")], ["notes", "text"],
      ["source_codes", "jsonb", textArrayNotNull("source_codes")], ["content_hash", "text"], ["is_synthetic", "boolean"]]);

  // ---------------------------------------------------------------- revision: carry forward + seed members
  const revisionId = randomUUID();
  await c.query(
    `insert into transit.revision (id, label, kind, status, created_by, parent_revision_id, content_hash, is_synthetic)
     values ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
    [revisionId, modes.revisionLabel, base.kind, IMPORT_ACTOR, base.id, modes.sha256, synthetic],
  );
  const same = (kind: string, ids: string[]): Member[] => ids.map((id) => ({ entity_kind: kind, entity_id: id, version_id: id }));
  const added: Member[] = [
    ...modes.terminals.map((t) => ({
      entity_kind: "terminal", entity_id: terminalIds.ids.get(t.code)!,
      version_id: terminalVersions.find((x) => x.row === t)!.id,
    })),
    ...same("route", [...seedRouteIds.ids.values()]),
    ...variantMembers,
    ...modes.fareRules.map((f) => ({
      entity_kind: "fare_rule", entity_id: ruleIdByCode.get(f.code)!, version_id: fareVersions.find((x) => x.row === f)!.id,
    })),
    ...same("route_operating_status", operating.map((x) => x.id)),
    ...same("route_vehicle_class", vehicleClasses.map((x) => x.id)),
    ...same("route_cooperative", cooperatives.map((x) => x.id)),
    ...same("route_fare_observation", observations.map((x) => x.id)),
    ...modes.regionalServices.map((r) => ({
      entity_kind: "regional_service", entity_id: serviceIds.ids.get(r.code)!, version_id: services.find((x) => x.row === r)!.id,
    })),
  ];
  const carried = await carryForwardRevision(c, base.id, revisionId, {
    dropKinds: [...MODES_OWNED_KINDS],
    replace: added,
    dropVariantsOfRoutes: [...seedRouteIds.ids.values()],
  });
  await insertRows(c, "transit.revision_member", added.map((m) => ({ ...m, revision_id: revisionId })),
    [["revision_id", "uuid"], ["entity_kind", "text"], ["entity_id", "uuid"], ["version_id", "uuid"]]);

  // Refuses synthetic rows (and a synthetic revision) and any member that breaks a 0006 rule.
  await c.query("select transit.publish_revision($1)", [revisionId]);

  counts.carried_members = carried;
  counts.seed_members = added.length;
  counts.revision_members = carried + added.length;
  await c.query(
    `update ingest.batch set status = 'committed', finished_at = now(), counts = $2::jsonb where id = $1`,
    [batchId, JSON.stringify({
      ...counts, document_sha256: modes.sha256, file: modes.fileName, revision_id: revisionId,
      revision_label: modes.revisionLabel, parent_revision_id: base.id, parent_revision_label: base.label,
    })],
  );
  return { outcome: "committed", batchId, revisionId, revisionLabel: modes.revisionLabel, counts };
}

/**
 * Copies the membership of `fromRevision` into the draft `toRevision` by id (entity and version),
 * except members of `dropKinds`, members whose (kind, entity) is in `replace` (the caller adds
 * those itself), and the variants of `dropVariantsOfRoutes`. Returns the number copied.
 */
export async function carryForwardRevision(
  c: pg.ClientBase,
  fromRevision: string,
  toRevision: string,
  opts: { dropKinds: string[]; replace: Member[]; dropVariantsOfRoutes: string[] },
): Promise<number> {
  const result = await c.query(
    `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id)
     select $1, m.entity_kind, m.entity_id, m.version_id from transit.revision_member m
      where m.revision_id = $2
        and m.entity_kind <> all($3::text[])
        and not exists (select 1 from jsonb_to_recordset($4::jsonb) as r(entity_kind text, entity_id uuid)
                         where r.entity_kind = m.entity_kind and r.entity_id = m.entity_id)
        and not (m.entity_kind = 'variant' and exists (
              select 1 from transit.variant v where v.id = m.entity_id and v.route_id = any($5::uuid[])))`,
    [toRevision, fromRevision, opts.dropKinds,
      JSON.stringify(opts.replace.map((m) => ({ entity_kind: m.entity_kind, entity_id: m.entity_id }))),
      opts.dropVariantsOfRoutes],
  );
  return result.rowCount ?? 0;
}

async function writeSources(c: pg.ClientBase, modes: ModesPlan): Promise<number> {
  const existing = await c.query<Row & { code: string }>(
    `select code, title, url, evidence_type, published_or_enacted, checked_on::text as checked_on, publisher, licence,
            extra_urls::text[] as extra_urls
       from ingest.source where code = any($1::text[])`, [modes.sources.map((s) => s.code)]);
  const byCode = new Map(existing.rows.map((r) => [r.code, r]));
  const fresh = [];
  for (const s of modes.sources) {
    const row = {
      code: s.code, title: s.title, url: s.url, evidence_type: s.evidenceType, published_or_enacted: s.publishedOrEnacted,
      checked_on: s.checkedOn, publisher: s.publisher, licence: s.licence, extra_urls: s.extraUrls,
    };
    const found = byCode.get(s.code);
    if (!found) {
      fresh.push(row);
      continue;
    }
    // ingest.source is append-only: an identical row is skipped, a different one is refused.
    if (stableJson(found) !== stableJson(row)) {
      throw new ImportRefusedError(`source ${s.code} differs from the committed ingest.source row; nothing written`);
    }
  }
  return insertRows(c, "ingest.source", fresh, [["code", "text"], ["title", "text"], ["url", "text"],
    ["evidence_type", "text"], ["published_or_enacted", "text"], ["checked_on", "date"], ["publisher", "text"],
    ["licence", "text"], ["extra_urls", "jsonb", textArrayNotNull("extra_urls")]]);
}

/** Stable identity rows by a unique key (code): existing ids are reused, missing ones inserted. */
async function ensureIdentities(
  c: pg.ClientBase,
  table: string,
  key: string,
  keys: string[],
  synthetic: boolean,
  build: (key: string) => Row,
  columns: Parameters<typeof insertRows>[3],
): Promise<{ ids: Map<string, string>; inserted: number }> {
  const existing = await c.query<{ id: string; k: string; is_synthetic: boolean }>(
    `select id, ${key} as k, is_synthetic from ${table} where ${key} = any($1::text[])`, [keys]);
  const bad = existing.rows.filter((r) => r.is_synthetic && !synthetic);
  if (bad.length > 0) {
    throw new ImportRefusedError(`${table} ${bad.map((r) => r.k).join(", ")} exist(s) as synthetic test data; nothing written`);
  }
  const ids = new Map(existing.rows.map((r) => [r.k, r.id]));
  const fresh: Row[] = keys.filter((k) => !ids.has(k)).map((k) => ({ id: randomUUID(), ...build(k) }));
  const inserted = await insertRows(c, table, fresh, [["id", "uuid"], ...columns]);
  for (const r of fresh) ids.set(String(r[key]), String(r.id));
  return { ids, inserted };
}

/** Feeder routes by public code. An existing route must equal the seed (routes are not versioned). */
async function ensureRoutes(c: pg.ClientBase, modes: ModesPlan, synthetic: boolean) {
  const codes = modes.routes.map((r) => r.publicCode);
  const existing = await c.query<Row & { id: string; public_code: string; is_synthetic: boolean }>(
    `select id, public_code, name, mode_code, mode, service_status, planning, allocated_units, notes,
            source_codes::text[] as source_codes, properties, is_synthetic
       from transit.route where public_code = any($1::text[])`, [codes]);
  const rowOf = (r: ModesPlan["routes"][number]) => ({
    public_code: r.publicCode, name: r.name, mode_code: r.modeCode, mode: r.mode, service_status: r.serviceStatus,
    planning: r.planning, allocated_units: r.allocatedUnits, notes: r.notes, source_codes: r.sourceCodes,
    properties: r.properties,
  });
  const ids = new Map<string, string>();
  const fresh: Row[] = [];
  for (const r of modes.routes) {
    const found = existing.rows.find((x) => x.public_code === r.publicCode);
    if (!found) {
      const id = randomUUID();
      ids.set(r.publicCode, id);
      fresh.push({ id, ...rowOf(r), is_synthetic: synthetic });
      continue;
    }
    const { id, is_synthetic: wasSynthetic, ...stored } = found;
    if (wasSynthetic !== synthetic) {
      throw new ImportRefusedError(`route ${r.publicCode} differs in is_synthetic from ${modes.fileName}; nothing written`);
    }
    if (stableJson(stored) !== stableJson(rowOf(r))) {
      throw new ImportRefusedError(
        `route ${r.publicCode} differs from the stored route row; routes are not versioned, so a changed feeder route ` +
          "needs a new code. Nothing written.",
      );
    }
    ids.set(r.publicCode, id);
  }
  const inserted = await insertRows(c, "transit.route", fresh, [["id", "uuid"], ["public_code", "text"], ["name", "text"],
    ["mode_code", "text"], ["mode", "text"], ["service_status", "text"], ["planning", "text"],
    ["allocated_units", "integer"], ["notes", "text"], ["source_codes", "jsonb", textArrayNotNull("source_codes")],
    ["properties", "jsonb"], ["is_synthetic", "boolean"]]);
  return { ids, inserted };
}

/** JSON with object keys sorted (jsonb returns keys in its own order). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

/**
 * Rows keyed by (owner, content_hash): an existing row with that content is reused (its id),
 * otherwise a new id is planned (`isNew`). A reused row must have the same is_synthetic flag.
 */
async function reuseOrPlan<T>(
  c: pg.ClientBase,
  table: string,
  ownerColumn: string,
  items: { owner: string; hash: string; row: T }[],
  synthetic: boolean,
): Promise<{ id: string; owner: string; row: T; isNew: boolean }[]> {
  const existing = await c.query<{ id: string; owner: string; content_hash: string; is_synthetic: boolean }>(
    `select id, ${ownerColumn} as owner, content_hash, is_synthetic from ${table} where ${ownerColumn} = any($1::uuid[])`,
    [[...new Set(items.map((i) => i.owner))]]);
  const byKey = new Map(existing.rows.map((r) => [`${r.owner}:${r.content_hash}`, r]));
  return items.map((i) => {
    const found = byKey.get(`${i.owner}:${i.hash}`);
    if (found && found.is_synthetic !== synthetic) {
      throw new ImportRefusedError(`${table} ${found.id} differs in is_synthetic; nothing written`);
    }
    return { id: found?.id ?? randomUUID(), owner: i.owner, row: i.row, isNew: !found };
  });
}

async function checkModesUnchanged(
  c: pg.ClientBase,
  modes: ModesPlan,
  last: { id: string; snapshot_version: string; counts: Row },
): Promise<ModesOutcome> {
  if (last.counts.document_sha256 !== modes.sha256) {
    throw new ImportRefusedError(
      `${modes.fileName} differs from the committed modes batch ${last.id} of the same date; a revised seed is a ` +
        "new dated file. Nothing was written.",
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
    publishedIncludesBatch: batchRevision !== null &&
      (await publishedIncludes(c, batchRevision, [...MODES_OWNED_KINDS, "terminal"])),
    counts: modes.counts,
  };
}
