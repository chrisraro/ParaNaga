// Transit + ingest schema (0001) integration tests. Run on a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// OWNER = branch owner (direct); APP = paranaga_app (pooled); IMPORT = paranaga_import (direct).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;

const TABLES = [
  "ingest.source", "ingest.source_document", "ingest.batch", "ingest.raw_feature",
  "ingest.raw_feature_lineage", "ingest.change", "ingest.conflict", "ingest.error",
  "transit.revision", "transit.revision_member", "transit.published_pointer", "transit.route",
  "transit.route_alias", "transit.variant", "transit.variant_version", "transit.stop_point",
  "transit.stop_point_version", "transit.stop_point_source", "transit.route_stop", "transit.terminal",
  "transit.fare_rule", "transit.fare_rule_version", "transit.fare_observation", "transit.fare_conflict",
  "transit.barangay", "transit.coverage_audit", "transit.feeder_lead", "transit.provider_presence",
  "transit.rail_status", "transit.designated_stop_candidate", "transit.external_destination_category",
  "transit.dataset_note",
];

type Loop = {
  revisionId: string;
  routeId: string;
  variantVersionId: string;
  stopPointIds: string[];
  stopVersionIds: string[];
};

describe.skipIf(!ownerUrl || !appUrl || !importUrl)("transit and ingest schema (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const admin = `test-admin-${run}`;
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;

  const asApp = <T>(userId: string | null, fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId, requestId: `test-${run}` }, fn);
  const appRows = async (userId: string | null, query: ReturnType<typeof sql>) =>
    asApp(userId, async (db) => (await db.execute(query)).rows);

  const pgCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      return { code: e.cause?.code ?? e.code, message: e.cause?.message ?? e.message ?? "" };
    }
    throw new Error("expected the query to fail");
  };

  /** Runs fn in a transaction on the owner connection as paranaga_import (SET ROLE path). */
  const asImportRole = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      const result = await fn(owner);
      await owner.query("commit");
      return result;
    } catch (error) {
      await owner.query("rollback");
      throw error;
    }
  };

  const one = async (c: pg.Client, text: string, values: unknown[] = []) => {
    const { rows } = await c.query(text, values);
    return rows[0] as Record<string, unknown>;
  };

  /** Seeds a draft provisional revision with a 3-stop circular variant through paranaga_import. */
  const seedLoop = async (
    tag: string,
    opts: {
      syntheticStop?: boolean;
      seqs?: number[];
      variantEvidence?: string;
      skipRouteMember?: boolean;
      skipLastStopMember?: boolean;
    } = {},
  ): Promise<Loop> =>
    asImportRole(async (c) => {
      const seqs = opts.seqs ?? [1, 2, 3];
      const rev = await one(c,
        `insert into transit.revision (label, kind, status, created_by)
         values ($1, 'provisional', 'draft', 'test') returning id`, [`rev-${run}-${tag}`]);
      const route = await one(c,
        `insert into transit.route (public_code, official_group_number, name, mode_code, legal_status)
         values ($1, 8, 'Test loop', 'puj', 'approved_plan') returning id`, [`T-${run}-${tag}`]);
      const variant = await one(c,
        `insert into transit.variant (route_id, direction, kind) values ($1, 'clockwise', 'permanent') returning id`,
        [route.id]);
      const vv = await one(c,
        `insert into transit.variant_version (variant_id, legal_streets, operating_status, evidence_level, is_circular, source_codes)
         values ($1, '{"circuit":["Gen. Luna St"]}', 'unverified', $2, true, '{S39}') returning id`,
        [variant.id, opts.variantEvidence ?? "provisional"]);
      const members: [string, unknown, unknown][] = [["variant", variant.id, vv.id]];
      if (!opts.skipRouteMember) members.push(["route", route.id, route.id]);
      const stopPointIds: string[] = [];
      const stopVersionIds: string[] = [];
      for (const [i, seq] of seqs.entries()) {
        const sp = await one(c, `insert into transit.stop_point (name) values ($1) returning id`, [`Stop ${tag} ${i}`]);
        const spv = await one(c,
          `insert into transit.stop_point_version
             (stop_point_id, geog, source_layer, source_code_raw, label_raw, is_synthetic)
           values ($1, extensions.ST_SetSRID(extensions.ST_MakePoint($2, $3), 4326)::extensions.geography,
                   'Loop Service A', $4, $5, $6) returning id`,
          [sp.id, 123.18 + i * 0.001, 13.62, `A${i + 1}`, `Stop ${tag} ${i}`, opts.syntheticStop === true && i === 0]);
        await c.query(
          `insert into transit.route_stop (variant_version_id, stop_point_version_id, seq, evidence_level)
           values ($1, $2, $3, 'provisional')`, [vv.id, spv.id, seq]);
        stopPointIds.push(sp.id as string);
        stopVersionIds.push(spv.id as string);
        if (!(opts.skipLastStopMember && i === seqs.length - 1)) members.push(["stop_point", sp.id, spv.id]);
      }
      for (const [kind, entityId, versionId] of members) {
        await c.query(
          `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, $2, $3, $4)`,
          [rev.id, kind, entityId, versionId]);
      }
      return {
        revisionId: rev.id as string,
        routeId: route.id as string,
        variantVersionId: vv.id as string,
        stopPointIds,
        stopVersionIds,
      };
    });

  const publishAsImport = (revisionId: string) =>
    importer.query("select transit.publish_revision($1)", [revisionId]);

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [admin]);
    await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, 'admin', 'test seed')", [admin]);
    await owner.query("commit");
  });

  afterAll(async () => {
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  it("creates every table with row level security enabled and forced", async () => {
    const { rows } = await owner.query<{ name: string; rls: boolean; forced: boolean }>(
      `select n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname in ('ingest', 'transit')`);
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const table of TABLES) {
      expect(byName.get(table), table).toMatchObject({ rls: true, forced: true });
    }
  });

  it("adds is_synthetic to every transit entity table", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'transit' and column_name = 'is_synthetic'`);
    const withFlag = new Set(rows.map((r) => r.table_name));
    for (const table of TABLES.filter((t) => t.startsWith("transit."))) {
      const name = table.slice("transit.".length);
      if (name === "revision_member" || name === "published_pointer") continue;
      expect(withFlag.has(name), name).toBe(true);
    }
  });

  it("paranaga_app can read transit.route but cannot write it", async () => {
    await asImportRole((c) =>
      c.query(`insert into transit.route (public_code, name, mode_code, legal_status) values ($1, 'Read test', 'puj', 'approved_plan')`,
        [`READ-${run}`]));
    const routes = await appRows(null, sql`select public_code from transit.route where public_code = ${`READ-${run}`}`);
    expect(routes).toHaveLength(1);
    const error = await pgCode(
      appRows(null, sql`insert into transit.route (public_code, name, mode_code, legal_status) values ('X', 'x', 'puj', 'x')`));
    expect(error.code).toBe("42501");
  });

  it("paranaga_app cannot read internal ingest tables", async () => {
    expect((await pgCode(appRows(null, sql`select * from ingest.batch`))).code).toBe("42501");
    // 0002: only the link columns behind v_published_stop_sources are readable.
    expect((await pgCode(appRows(null, sql`select started_by from ingest.batch`))).code).toBe("42501");
    expect(await appRows(null, sql`select id, source_document_id from ingest.batch`)).toEqual(expect.any(Array));
    expect((await pgCode(appRows(null, sql`select * from ingest.error`))).code).toBe("42501");
    expect(await appRows(null, sql`select * from ingest.source`)).toEqual(expect.any(Array));
  });

  it("paranaga_import can insert raw features (login and SET ROLE)", async () => {
    const batch = await importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by)
       values ($1, 'commit', 'running', 'test') returning id`, [`mymaps:test:${run}`]);
    const batchId = batch.rows[0].id as string;
    await importer.query(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw,
                                       label_raw, coordinates_raw, lon, lat, properties, content_hash)
       values ($1, $2, 'layer_code_label', 'Loop Service A', 'A1', 'Plaza Rizal', '123.1846726,13.6233869,0',
               123.1846726, 13.6233869, '{}', 'h1')`,
      [batchId, `id-${run}-1`]);
    await asImportRole((c) =>
      c.query(
        `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw,
                                         label_raw, coordinates_raw, lon, lat, properties, content_hash)
         values ($1, $2, 'layer_code_label', 'Loop Service A', 'A2', 'Second', '123.18,13.62', 123.18, 13.62, '{}', 'h2')`,
        [batchId, `id-${run}-2`]));
    const stored = await appRows(null,
      sql`select lon::text, lat::text from ingest.raw_feature where source_identity = ${`id-${run}-1`}`);
    expect(stored).toEqual([{ lon: "123.18467260", lat: "13.62338690" }]);
    const dup = await pgCode(importer.query(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, label_raw, coordinates_raw, lon, lat, properties, content_hash)
       values ($1, $2, 'layer_code_label', 'Loop Service A', 'dup', '123.18,13.62', 123.18, 13.62, '{}', 'h')`, [batchId, `id-${run}-1`]));
    expect(dup.code).toBe("23505");
  });

  it("raw_feature requires the verbatim coordinate text", async () => {
    const batch = await importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'dry_run', 'running', 'test') returning id`,
      [`mymaps:coords:${run}`]);
    const missing = await pgCode(importer.query(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, label_raw, lon, lat, content_hash)
       values ($1, 'no-coords', 'layer_code_label', 'Loop Service A', 'x', 123.18, 13.62, 'h')`, [batch.rows[0].id]));
    expect(missing.code).toBe("23502");
  });

  it("ingest provenance is append-only for paranaga_import; batch outcome and conflict review stay editable", async () => {
    const batch = await importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'dry_run', 'running', 'test') returning id`,
      [`mymaps:append:${run}`]);
    const batchId = batch.rows[0].id as string;
    const doc = await importer.query(
      `insert into ingest.source_document (file_name, sha256, bytes) values ($1, repeat('a', 64), 1) returning id`,
      [`append-${run}.kml`]);
    const raw = await importer.query(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, label_raw, coordinates_raw, lon, lat, content_hash)
       values ($1, $2, 'layer_code_label', 'Loop Service A', 'x', '123.18,13.62', 123.18, 13.62, 'h') returning id`,
      [batchId, `append-${run}`]);
    const sp = await importer.query(`insert into transit.stop_point (name) values ('lineage test') returning id`);
    await importer.query(`insert into ingest.raw_feature_lineage (source_identity, stop_point_id) values ($1, $2)`,
      [`append-${run}`, sp.rows[0].id]);
    await importer.query(`insert into ingest.change (batch_id, source_identity, kind) values ($1, $2, 'added')`,
      [batchId, `append-${run}`]);
    await importer.query(`insert into ingest.source (code, title) values ('S998', 'append test')`);
    const conflict = await importer.query(
      `insert into ingest.conflict (batch_id, kind, refs) values ($1, 'near_duplicate', $2) returning id`,
      [batchId, [`append-${run}`]]);

    const refused: [string, unknown[]][] = [
      [`update ingest.raw_feature set label_raw = 'y' where id = $1`, [raw.rows[0].id]],
      [`update ingest.source_document set bytes = 2 where id = $1`, [doc.rows[0].id]],
      [`update ingest.raw_feature_lineage set stop_point_id = stop_point_id where source_identity = $1`, [`append-${run}`]],
      [`update ingest.batch set snapshot_version = 'x' where id = $1`, [batchId]],
      [`update ingest.change set kind = 'changed' where batch_id = $1`, [batchId]],
      [`update ingest.source set title = 'x' where code = 'S998'`, []],
      [`delete from ingest.raw_feature where id = $1`, [raw.rows[0].id]],
    ];
    for (const [text, values] of refused) {
      expect((await pgCode(importer.query(text, values))).code, text).toBe("42501");
    }
    const finished = await importer.query(
      `update ingest.batch set status = 'committed', counts = '{"n":1}', finished_at = now() where id = $1`, [batchId]);
    expect(finished.rowCount).toBe(1);
    const reviewed = await importer.query(
      `update ingest.conflict set resolution = 'kept_both', resolved_by = 'test', resolved_at = now() where id = $1`,
      [conflict.rows[0].id]);
    expect(reviewed.rowCount).toBe(1);
  });

  it("unknown values are stored as NULL instead of invented defaults", async () => {
    const rollback = new Error("rollback");
    await asImportRole(async (c) => {
      await c.query(`insert into ingest.source (code, title) values ('S997', 'No evidence type stated')`);
      const route = await one(c,
        `insert into transit.route (public_code, name) values ($1, 'Unknown mode')
         returning id, mode_code, legal_status, allocation_is_active_fleet_count, properties`, [`NULL-${run}`]);
      expect(route).toMatchObject({ mode_code: null, legal_status: null, allocation_is_active_fleet_count: null, properties: {} });
      const variant = await one(c,
        `insert into transit.variant (route_id, direction, kind) values ($1, 'inbound', 'permanent') returning id`, [route.id]);
      const vv = await one(c,
        `insert into transit.variant_version (variant_id, evidence_level) values ($1, 'documentary') returning operating_status`,
        [variant.id]);
      expect(vv.operating_status).toBeNull();
      const feeder = await one(c,
        `insert into transit.feeder_lead (code, name) values ($1, 'Unknown status') returning operating_status`, [`SF-${run}`]);
      expect(feeder.operating_status).toBeNull();
      const source = await one(c, `select evidence_type from ingest.source where code = 'S997'`);
      expect(source.evidence_type).toBeNull();
      throw rollback;
    }).catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
  });

  it("only one committed batch per snapshot", async () => {
    const snap = `mymaps:unique:${run}`;
    await importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'commit', 'committed', 'test')`, [snap]);
    const error = await pgCode(importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'commit', 'running', 'test')`, [snap]));
    expect(error.code).toBe("23505");
  });

  it("paranaga_import cannot publish by writing the pointer or a published revision directly", async () => {
    const { revisionId } = await seedLoop("direct");
    expect((await pgCode(importer.query(
      `insert into transit.published_pointer (revision_id) values ($1)`, [revisionId]))).code).toBe("42501");
    expect((await pgCode(importer.query(
      `insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'published', 'x')`,
      [`forged-${run}`]))).code).toBe("42501");
    expect((await pgCode(importer.query(
      `update transit.revision set status = 'published' where id = $1`, [revisionId]))).code).toBe("42501");
  });

  it("paranaga_app cannot execute publish_revision", async () => {
    const { revisionId } = await seedLoop("appexec");
    const error = await pgCode(appRows(null, sql`select transit.publish_revision(${revisionId}::uuid)`));
    expect(error.code).toBe("42501");
  });

  it("publish_revision refuses a revision with a synthetic member", async () => {
    const { revisionId } = await seedLoop("synthetic", { syntheticStop: true });
    const error = await pgCode(publishAsImport(revisionId));
    expect(error.message).toMatch(/synthetic/);
    const rev = await appRows(null, sql`select status from transit.revision where id = ${revisionId}::uuid`);
    expect(rev[0]?.status).toBe("draft");
  });

  it("publish_revision refuses non-contiguous stop sequences", async () => {
    const { revisionId } = await seedLoop("gap", { seqs: [1, 2, 4] });
    const error = await pgCode(publishAsImport(revisionId));
    expect(error.message).toMatch(/seq/);
  });

  it("publish_revision refuses provisional stops on a documentary variant", async () => {
    const { revisionId } = await seedLoop("docvariant", { variantEvidence: "documentary" });
    const error = await pgCode(publishAsImport(revisionId));
    expect(error.message).toMatch(/provisional/);
  });

  it("publish_revision publishes a valid revision, moves the pointer and audits", async () => {
    const first = await seedLoop("valid1");
    await publishAsImport(first.revisionId);
    let pointer = await appRows(null, sql`select revision_id from transit.published_pointer`);
    expect(pointer).toEqual([{ revision_id: first.revisionId }]);

    const second = await seedLoop("valid2");
    await publishAsImport(second.revisionId);
    pointer = await appRows(null, sql`select revision_id from transit.published_pointer`);
    expect(pointer).toEqual([{ revision_id: second.revisionId }]);

    const statuses = await appRows(null,
      sql`select id, status, published_at is not null as stamped from transit.revision
           where id in (${first.revisionId}::uuid, ${second.revisionId}::uuid)`);
    const byId = new Map(statuses.map((r) => [r.id, r]));
    expect(byId.get(first.revisionId)).toMatchObject({ status: "superseded" });
    expect(byId.get(second.revisionId)).toMatchObject({ status: "published", stamped: true });

    const audit = await appRows(admin,
      sql`select action from core.audit_event where entity_type = 'transit.revision' and entity_id = ${second.revisionId}`);
    expect(audit.map((r) => r.action)).toEqual(["revision.publish"]);

    // Rollback = re-publishing the superseded revision through the same function.
    await publishAsImport(first.revisionId);
    pointer = await appRows(null, sql`select revision_id from transit.published_pointer`);
    expect(pointer).toEqual([{ revision_id: first.revisionId }]);
  });

  it("records the database role of the publisher in the audit row", async () => {
    const loop = await seedLoop("auditrole");
    await publishAsImport(loop.revisionId);
    const audit = await appRows(admin,
      sql`select after->>'db_role' as db_role from core.audit_event
           where entity_type = 'transit.revision' and entity_id = ${loop.revisionId}`);
    expect(audit).toEqual([{ db_role: "paranaga_import" }]);
  });

  it("publish_revision refuses a variant whose route is not a member", async () => {
    const { revisionId } = await seedLoop("noroute", { skipRouteMember: true });
    const error = await pgCode(publishAsImport(revisionId));
    expect(error.message).toMatch(/route/);
  });

  it("publish_revision refuses a route stop using a non-member stop version", async () => {
    const { revisionId } = await seedLoop("nonmember", { skipLastStopMember: true });
    const error = await pgCode(publishAsImport(revisionId));
    expect(error.message).toMatch(/not a member/);
  });

  it("published content is immutable for paranaga_import; new versions can still be added", async () => {
    const loop = await seedLoop("immutable");
    await publishAsImport(loop.revisionId);

    expect((await pgCode(importer.query(
      `update transit.route_stop set seq = seq where variant_version_id = $1`, [loop.variantVersionId]))).code).toBe("42501");
    expect((await pgCode(importer.query(
      `update transit.stop_point_version set label_raw = 'x' where id = $1`, [loop.stopVersionIds[0]]))).code).toBe("42501");
    expect((await pgCode(importer.query(
      `update transit.variant_version set notes = 'x' where id = $1`, [loop.variantVersionId]))).code).toBe("42501");
    expect((await pgCode(importer.query(
      `delete from transit.route where id = $1`, [loop.routeId]))).code).toBe("42501");

    // Stable rows referenced by a published revision are frozen (0 rows), drafts are not.
    const frozen = await importer.query(`update transit.route set notes = 'edited' where id = $1`, [loop.routeId]);
    expect(frozen.rowCount).toBe(0);
    const frozenStop = await importer.query(`update transit.stop_point set name = 'x' where id = $1`, [loop.stopPointIds[0]]);
    expect(frozenStop.rowCount).toBe(0);
    const draft = await seedLoop("immutable-draft");
    const editable = await importer.query(`update transit.route set notes = 'edited' where id = $1`, [draft.routeId]);
    expect(editable.rowCount).toBe(1);

    // No new stops can be attached to a published variant version.
    expect((await pgCode(importer.query(
      `insert into transit.route_stop (variant_version_id, stop_point_version_id, seq, evidence_level)
       values ($1, $2, 99, 'provisional')`, [loop.variantVersionId, loop.stopVersionIds[0]]))).code).toBe("42501");

    // A new version of a published stop point is fine.
    const added = await importer.query(
      `insert into transit.stop_point_version (stop_point_id, geog, label_raw)
       values ($1, extensions.ST_SetSRID(extensions.ST_MakePoint(123.19, 13.62), 4326)::extensions.geography, 'moved')`,
      [loop.stopPointIds[0]]);
    expect(added.rowCount).toBe(1);
  });

  it("membership of published or superseded revisions cannot change", async () => {
    const first = await seedLoop("frozen1");
    await publishAsImport(first.revisionId);
    const second = await seedLoop("frozen2");
    await publishAsImport(second.revisionId); // first is now superseded

    for (const revisionId of [first.revisionId, second.revisionId]) {
      const insert = await pgCode(importer.query(
        `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'route', $2, $2)`,
        [revisionId, randomUUID()]));
      expect(insert.code).toBe("42501");
      const removed = await importer.query(`delete from transit.revision_member where revision_id = $1`, [revisionId]);
      expect(removed.rowCount).toBe(0);
      const moved = await importer.query(
        `update transit.revision_member set version_id = version_id where revision_id = $1`, [revisionId]);
      expect(moved.rowCount).toBe(0);
    }
  });

  it("the membership trigger refuses edits once a revision leaves draft", async () => {
    // Exercise the trigger itself, bypassing the RLS policy: owner, with RLS unforced in a
    // rolled-back transaction.
    const loop = await seedLoop("trigger");
    await publishAsImport(loop.revisionId);
    await owner.query("begin");
    try {
      await owner.query("alter table transit.revision_member no force row level security");
      await owner.query("alter table transit.revision no force row level security");
      const error = await pgCode(owner.query(
        `delete from transit.revision_member where revision_id = $1`, [loop.revisionId]));
      expect(error.message).toMatch(/not a draft/);
    } finally {
      await owner.query("rollback");
    }
  });

  it("paranaga_app cannot read lineage or change rows", async () => {
    expect((await pgCode(appRows(null, sql`select * from ingest.raw_feature_lineage`))).code).toBe("42501");
    expect((await pgCode(appRows(null, sql`select * from ingest.change`))).code).toBe("42501");
  });

  it("paranaga_import cannot read or write core tables", async () => {
    expect((await pgCode(importer.query(`select * from core.profile`))).code).toBe("42501");
    expect((await pgCode(importer.query(`select * from core.user_role`))).code).toBe("42501");
    expect((await pgCode(importer.query(
      `insert into core.audit_event (action, entity_type) values ('x', 'y')`))).code).toBe("42501");
  });

  it("conflict refs must be sorted and distinct", async () => {
    const batch = await importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'dry_run', 'running', 'test') returning id`,
      [`mymaps:refs:${run}`]);
    const batchId = batch.rows[0].id as string;
    const insert = (refs: string[]) => importer.query(
      `insert into ingest.conflict (batch_id, kind, refs) values ($1, 'exact_coordinate_shared', $2)`, [batchId, refs]);
    await insert(["a1", "b2"]);
    expect((await pgCode(insert(["b2", "a1"]))).code).toBe("23514");
    expect((await pgCode(insert(["a1", "a1"]))).code).toBe("23514");
  });

  it("published views show only published, non-synthetic rows", async () => {
    const published = await seedLoop("view-pub");
    await publishAsImport(published.revisionId);
    const draft = await seedLoop("view-draft");

    const stops = await appRows(null, sql`select stop_point_id, lon, lat from transit.v_published_stops`);
    const ids = new Set(stops.map((r) => r.stop_point_id));
    for (const id of published.stopPointIds) expect(ids.has(id)).toBe(true);
    for (const id of draft.stopPointIds) expect(ids.has(id)).toBe(false);
    expect(stops.find((r) => r.stop_point_id === published.stopPointIds[0])).toMatchObject({ lon: 123.18, lat: 13.62 });

    const routeStops = await appRows(null,
      sql`select seq from transit.v_published_route_stops where variant_version_id = ${published.variantVersionId}::uuid order by seq`);
    expect(routeStops.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(await appRows(null,
      sql`select 1 from transit.v_published_route_stops where variant_version_id = ${draft.variantVersionId}::uuid`)).toHaveLength(0);
    expect(await appRows(null,
      sql`select public_code from transit.v_published_routes where id = ${published.routeId}::uuid`)).toHaveLength(1);
    expect(await appRows(null,
      sql`select 1 from transit.v_published_variants where variant_version_id = ${published.variantVersionId}::uuid`)).toHaveLength(1);
    expect(await appRows(null, sql`select id from transit.v_published_revision`))
      .toEqual([{ id: published.revisionId }]);

    // A synthetic row inside the published revision (only possible by bypassing RLS and
    // publish validation) is still hidden by the views.
    await owner.query("begin");
    try {
      for (const t of ["published_pointer", "revision_member", "stop_point", "stop_point_version", "route_stop"]) {
        await owner.query(`alter table transit.${t} no force row level security`);
      }
      await owner.query(`update transit.stop_point_version set is_synthetic = true where id = $1`, [published.stopVersionIds[0]]);
      const visible = await owner.query(
        `select stop_point_id from transit.v_published_stops where stop_point_id = any($1)`, [published.stopPointIds]);
      expect(visible.rows.map((r) => r.stop_point_id).sort()).toEqual(published.stopPointIds.slice(1).sort());
      const visibleRouteStops = await owner.query(
        `select seq from transit.v_published_route_stops where variant_version_id = $1 order by seq`,
        [published.variantVersionId]);
      expect(visibleRouteStops.rows.map((r) => r.seq)).toEqual([2, 3]);
    } finally {
      await owner.query("rollback");
    }
  });

  it("published route stops hide synthetic variants, variant versions and stop points", async () => {
    const loop = await seedLoop("view-synth");
    await publishAsImport(loop.revisionId);
    const seqs = async () => (await owner.query(
      `select seq from transit.v_published_route_stops where variant_version_id = $1 order by seq`,
      [loop.variantVersionId])).rows.map((r) => r.seq);

    const tables = ["published_pointer", "revision_member", "stop_point", "stop_point_version", "route_stop",
      "variant", "variant_version"];
    const bypass = async (fn: () => Promise<void>) => {
      await owner.query("begin");
      try {
        for (const t of tables) await owner.query(`alter table transit.${t} no force row level security`);
        await fn();
      } finally {
        await owner.query("rollback");
      }
    };
    await bypass(async () => expect(await seqs()).toEqual([1, 2, 3]));
    await bypass(async () => {
      await owner.query(`update transit.stop_point set is_synthetic = true where id = $1`, [loop.stopPointIds[1]]);
      expect(await seqs()).toEqual([1, 3]);
    });
    await bypass(async () => {
      await owner.query(`update transit.variant_version set is_synthetic = true where id = $1`, [loop.variantVersionId]);
      expect(await seqs()).toEqual([]);
    });
    await bypass(async () => {
      await owner.query(
        `update transit.variant set is_synthetic = true where id = (select variant_id from transit.variant_version where id = $1)`,
        [loop.variantVersionId]);
      expect(await seqs()).toEqual([]);
    });
  });
});
