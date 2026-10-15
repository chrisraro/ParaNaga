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

type Loop = { revisionId: string; variantVersionId: string };

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
    opts: { syntheticStop?: boolean; seqs?: number[]; variantEvidence?: string } = {},
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
      const members: [string, unknown, unknown][] = [
        ["route", route.id, route.id],
        ["variant", variant.id, vv.id],
      ];
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
        members.push(["stop_point", sp.id, spv.id]);
      }
      for (const [kind, entityId, versionId] of members) {
        await c.query(
          `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, $2, $3, $4)`,
          [rev.id, kind, entityId, versionId]);
      }
      return { revisionId: rev.id as string, variantVersionId: vv.id as string };
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
                                       label_raw, lon, lat, properties, content_hash)
       values ($1, $2, 'layer_code_label', 'Loop Service A', 'A1', 'Plaza Rizal', 123.1846726, 13.6233869, '{}', 'h1')`,
      [batchId, `id-${run}-1`]);
    await asImportRole((c) =>
      c.query(
        `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw,
                                         label_raw, lon, lat, properties, content_hash)
         values ($1, $2, 'layer_code_label', 'Loop Service A', 'A2', 'Second', 123.18, 13.62, '{}', 'h2')`,
        [batchId, `id-${run}-2`]));
    const stored = await appRows(null,
      sql`select lon::text, lat::text from ingest.raw_feature where source_identity = ${`id-${run}-1`}`);
    expect(stored).toEqual([{ lon: "123.18467260", lat: "13.62338690" }]);
    const dup = await pgCode(importer.query(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, label_raw, lon, lat, properties, content_hash)
       values ($1, $2, 'layer_code_label', 'Loop Service A', 'dup', 123.18, 13.62, '{}', 'h')`, [batchId, `id-${run}-1`]));
    expect(dup.code).toBe("23505");
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
});
