// 0029 (IC1) intercity schema on a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh npx vitest run --project integration tests/integration/intercity-schema.test.ts
// OWNER = branch owner (direct); APP = paranaga_app (pooled); IMPORT = paranaga_import (direct).
// Every write runs in a transaction that is rolled back, so nothing is left on the branch.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;

const NEW_TABLES = ["transit.regional_destination", "transit.regional_destination_version", "transit.regional_departure"];
const HASH = "a".repeat(64);

type Version = {
  status: string;
  statusSince?: string | null;
  statusNoteCode?: string | null;
  asOf?: string | null;
  reviewBy?: string | null;
};

describe.skipIf(!ownerUrl || !appUrl || !importUrl)("intercity schema (0029, Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;

  const pgCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      return { code: e.cause?.code ?? e.code, message: e.cause?.message ?? e.message ?? "" };
    }
    throw new Error("expected the query to fail");
  };

  /** Runs fn as paranaga_import (login role) in a transaction that is always rolled back. */
  const rolledBack = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    await importer.query("begin");
    try {
      return await fn(importer);
    } finally {
      await importer.query("rollback");
    }
  };

  const one = async (c: pg.Client, text: string, values: unknown[] = []) =>
    (await c.query(text, values)).rows[0] as Record<string, unknown>;

  /** A regional service (RS9x, rolled back with its transaction) and one version of it. */
  const serviceVersion = async (c: pg.Client, code: string, v: Version) => {
    const s = await one(c, "insert into transit.regional_service (code) values ($1) returning id", [code]);
    return one(c,
      `insert into transit.regional_service_version
         (regional_service_id, mode, name, terminal_code, destination, osm_relation_ids, status, status_since,
          status_note_code, as_of, review_by, source_codes, content_hash)
       values ($1, 'rail', 'Test rail', 'T06', 'Test', '{}', $2, $3, $4, $5, $6, '{IC01}', $7) returning id`,
      [s.id, v.status, v.statusSince ?? null, v.statusNoteCode ?? null, v.asOf ?? null, v.reviewBy ?? null, HASH]);
  };

  const departure = (c: pg.Client, versionId: unknown) =>
    c.query(
      `insert into transit.regional_departure
         (regional_service_version_id, pattern, trips_per_day, day_type, basis, observed_on, source_codes)
       values ($1, 'daily_unspecified', 3, 'daily', 'at_launch', '2025-11-01', '{IC01}')`, [versionId]);

  const observation = (c: pg.Client, versionId: unknown, observedAt: string | null) =>
    c.query(
      `insert into transit.fare_observation
         (code, mode_code, amount_centavos, category, kind, observed_at, source_codes, regional_service_version_id, basis)
       values ($1, 'bus', 50000, 'regular', 'operator_listing', $2, '{IC01}', $3, 'booking_site')`,
      [`ICT-${run}`, observedAt, versionId]);

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
  });

  afterAll(async () => {
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  it("creates the new tables with row level security enabled and forced", async () => {
    const { rows } = await owner.query<{ name: string; rls: boolean; forced: boolean }>(
      `select n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname = 'transit'`);
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const t of NEW_TABLES) expect(byName.get(t), t).toMatchObject({ rls: true, forced: true });
  });

  it("keeps the existing regional services valid (community_mapped, no dates)", async () => {
    const { rows } = await owner.query("select count(*)::int as n from transit.regional_service_version where status <> 'community_mapped'");
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("accepts departures and a dated fare observation under an operating service", async () => {
    await rolledBack(async (c) => {
      const v = await serviceVersion(c, "RS91", { status: "operating_limited", asOf: "2026-10-01", reviewBy: "2027-01-01" });
      await departure(c, v.id);
      await observation(c, v.id, "2026-09-01");
      const n = await one(c, "select count(*)::int as n from transit.regional_departure where regional_service_version_id = $1", [v.id]);
      expect(n.n).toBe(1);
    });
  });

  it("refuses a departure or a fare under a suspended service (23514, AC-IC2)", async () => {
    for (const child of ["departure", "observation"]) {
      const error = await pgCode(rolledBack(async (c) => {
        const v = await serviceVersion(c, "RS92", {
          status: "suspended", statusSince: "2025-11-10", statusNoteCode: "bridge_damage_no_reopening_date",
          asOf: "2026-10-01", reviewBy: "2026-12-01" });
        await (child === "departure" ? departure(c, v.id) : observation(c, v.id, "2026-09-01"));
      }));
      expect(error.code, child).toBe("23514");
      expect(error.message, child).toContain("suspended or discontinued services carry no fares or departures");
    }
  });

  it("refuses a review date before the as-of date", async () => {
    const error = await pgCode(rolledBack((c) =>
      serviceVersion(c, "RS93", { status: "operating", asOf: "2026-10-01", reviewBy: "2026-09-30" })));
    expect(error.code).toBe("23514");
    expect(error.message).toContain("rsv_review_after_as_of");
  });

  it("refuses a booking-site observation without the month it was seen", async () => {
    const error = await pgCode(rolledBack(async (c) => {
      const v = await serviceVersion(c, "RS94", { status: "operating", asOf: "2026-10-01", reviewBy: "2027-01-01" });
      await observation(c, v.id, null);
    }));
    expect(error.code).toBe("23514");
    expect(error.message).toContain("fo_regional_month");
  });

  it("refuses planned_not_funded as a service status note (AC-IC3)", async () => {
    const error = await pgCode(rolledBack((c) =>
      serviceVersion(c, "RS95", { status: "unconfirmed", statusNoteCode: "planned_not_funded", asOf: "2026-10-01", reviewBy: "2027-01-01" })));
    expect(error.code).toBe("23514");
    expect(error.message).toContain("rsv_status_note_code");
  });

  it("paranaga_app reads the new tables but cannot insert into them", async () => {
    const asApp = <T>(fn: Parameters<typeof runInRequestContext<T>>[2]) =>
      runInRequestContext<T>(app, { userId: null, requestId: `test-${run}` }, fn);
    for (const t of NEW_TABLES) {
      await asApp(async (db) => db.execute(sql.raw(`select count(*) from ${t}`)));
    }
    const inserts = [
      sql`insert into transit.regional_destination (code) values (${`D-T${run.toUpperCase()}`})`,
      sql`insert into transit.regional_destination_version (regional_destination_id, name, group_code, kind, source_codes, content_hash)
          values (${randomUUID()}, 'x', 'albay', 'town', '{IC01}', ${HASH})`,
      sql`insert into transit.regional_departure (regional_service_version_id, pattern, day_type, basis, observed_on, source_codes)
          values (${randomUUID()}, 'when_full', 'daily', 'news', '2026-10-01', '{IC01}')`,
    ];
    for (const q of inserts) {
      expect((await pgCode(asApp(async (db) => db.execute(q)))).code).toBe("42501");
    }
  });

  it("paranaga_import cannot change the children of a released service version", async () => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      const v = await serviceVersion(owner, "RS96", { status: "operating", asOf: "2026-10-01", reviewBy: "2027-01-01" });
      await departure(owner, v.id);
      await observation(owner, v.id, "2026-09-01");
      const bump = "update transit.fare_observation set amount_centavos = amount_centavos + 1 where regional_service_version_id = $1";
      expect((await owner.query(bump, [v.id])).rowCount).toBe(1);
      const rev = await one(owner,
        "insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id",
        [`ic-released-${run}`]);
      await owner.query(
        "insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) select $1, 'regional_service', regional_service_id, id from transit.regional_service_version where id = $2",
        [rev.id, v.id]);
      await owner.query("set local role paranaga_definer");
      await owner.query("update transit.revision set status = 'superseded' where id = $1", [rev.id]);
      await owner.query("set local role paranaga_import");
      expect((await owner.query(bump, [v.id])).rowCount).toBe(0);
      expect((await pgCode(owner.query("delete from transit.fare_observation where regional_service_version_id = $1", [v.id]))).code).toBe("42501");
    } finally {
      await owner.query("rollback");
    }
    for (const q of ["update transit.regional_departure set trips_per_day = 4", "delete from transit.regional_departure"]) {
      expect((await pgCode(rolledBack((c) => c.query(q)))).code, q).toBe("42501");
    }
  });
});
