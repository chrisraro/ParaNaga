// Google Places cost guard in Postgres (migration 0012): the daily cap is taken only through
// ops.places_take_call (SECURITY DEFINER), the usage table is closed to the app role, and the
// repository's rate limit and cache work as paranaga_app. Throwaway Neon branch only:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration places-guard
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";
import { countRequest, readCache, takeGoogleCall, writeCache } from "@/server/repos/places-guard-repo";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("Google Places guard (Neon branch)", () => {
  const run = randomUUID().replace(/-/g, "");
  let owner: pg.Client;
  let app: pg.Pool;
  const as = <T>(fn: Parameters<typeof runInRequestContext<T>>[2]) => runInRequestContext<T>(app, { userId: null, requestId: `test-${run}` }, fn);
  const manilaToday = "(now() at time zone 'Asia/Manila')::date";
  const asDefiner = async (statement: string) => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_definer");
      const { rows } = await owner.query(statement);
      await owner.query("commit");
      return rows;
    } catch (error) {
      await owner.query("rollback");
      throw error;
    }
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
  });
  afterAll(async () => {
    if (owner) await asDefiner(`delete from ops.places_daily_usage where day = ${manilaToday}`).catch(() => undefined);
    await owner?.query("delete from ops.places_cache where key_hash like $1", [`${run.slice(0, 16)}%`]).catch(() => undefined);
    await owner?.query("delete from ops.rate_limit_bucket where key_hash like $1", [`places:${run}%`]).catch(() => undefined);
    await owner?.end();
    await app?.end();
  });

  it("both tables have RLS enabled and forced", async () => {
    const { rows } = await owner.query(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where oid in ('ops.places_daily_usage'::regclass, 'ops.places_cache'::regclass) order by 1",
    );
    expect(rows).toEqual([
      { relname: "places_cache", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "places_daily_usage", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("takes calls up to the hard-coded cap of 300, then refuses, for today's Manila date", async () => {
    // Seeded near the cap through the definer role (RLS is forced, even for the owner).
    await asDefiner(`delete from ops.places_daily_usage where day = ${manilaToday}`);
    await asDefiner(`insert into ops.places_daily_usage (day, calls) values (${manilaToday}, 298)`);
    expect(await as((db) => takeGoogleCall(db))).toBe(true);
    expect(await as((db) => takeGoogleCall(db))).toBe(true);
    expect(await as((db) => takeGoogleCall(db))).toBe(false);
    const rows = await asDefiner(`select calls from ops.places_daily_usage where day = ${manilaToday}`);
    expect(rows[0].calls).toBe(300);
  });

  it("the app role cannot read or change the usage table directly", async () => {
    await expect(as((db) => db.execute(sql`select * from ops.places_daily_usage`))).rejects.toThrow();
    await expect(as((db) => db.execute(sql`update ops.places_daily_usage set calls = 0`))).rejects.toThrow();
    await expect(as((db) => db.execute(sql`insert into ops.places_daily_usage (day, calls) values ('2000-01-01', 0)`))).rejects.toThrow();
  });

  it("counts requests per key and window, and caches until expiry", async () => {
    const key = `places:${run}`;
    expect(await as((db) => countRequest(db, key, 600))).toBe(1);
    expect(await as((db) => countRequest(db, key, 600))).toBe(2);
    const cacheKey = `${run.slice(0, 16)}${"0".repeat(48)}`;
    expect(await as((db) => readCache(db, cacheKey))).toBeNull();
    await as((db) => writeCache(db, cacheKey, [{ placeId: "p", title: "T", subtitle: null }], 60));
    expect(await as((db) => readCache(db, cacheKey))).toEqual([{ placeId: "p", title: "T", subtitle: null }]);
    await owner.query("update ops.places_cache set expires_at = now() - interval '1 second' where key_hash = $1", [cacheKey]);
    expect(await as((db) => readCache(db, cacheKey))).toBeNull();
  });

  it("the cache refuses a key that is not a 64-character hex hash", async () => {
    await expect(as((db) => writeCache(db, "plain query text", {}, 60))).rejects.toThrow();
  });
});
