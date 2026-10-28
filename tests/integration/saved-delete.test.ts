// The real SQL behind DELETE /api/v1/me/saved-places and /saved-trips, run as the app role against a
// migrated Neon branch (unit tests mock the DB, so they cannot catch invalid SQL):
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";
import { deleteSavedPlaces, deleteSavedTrips } from "@/server/db/saved-delete";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("saved place/trip DELETE statements (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const alice = `test-dalice-${run}`;
  const bob = `test-dbob-${run}`;
  // Client ids: "shared" exists for both users; "comma" contains a comma.
  const ids = {
    shared: `shared-${run}`,
    comma: `a,b-${run}`,
    keep: `keep-${run}`,
    bobOnly: `bob-only-${run}`,
    single: `single-${run}`,
  };
  let owner: pg.Client;
  let app: pg.Pool;
  let revisionId = "";

  const as = <T>(userId: string, fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId, requestId: `test-${run}` }, fn);
  const rows = async (userId: string, query: ReturnType<typeof sql>) => as(userId, async (db) => (await db.execute(query)).rows);
  const point = sql`extensions.ST_SetSRID(extensions.ST_MakePoint(123.18, 13.62), 4326)::extensions.geography`;
  const seedPlace = (userId: string, clientId: string) =>
    rows(userId, sql`insert into core.saved_place (user_id, client_id, label, point, source) values (${userId}, ${clientId}, 'P', ${point}, 'pin')`);
  const seedTrip = (userId: string, clientId: string) =>
    rows(
      userId,
      sql`insert into core.saved_trip (user_id, client_id, revision_id, revision_label, revision_kind,
            start_label, start_point, dest_label, dest_point, option)
          values (${userId}, ${clientId}, ${revisionId}::uuid, 'test', 'provisional', 'A', ${point}, 'B', ${point}, '{}'::jsonb)`,
    );
  const remaining = async (table: "saved_place" | "saved_trip", userId: string) =>
    (await rows(userId, sql`select client_id from ${sql.raw(`core.${table}`)} where client_id like ${`%${run}`}`))
      .map((r) => r.client_id as string)
      .sort();

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const id of [alice, bob]) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, 'commuter', 'test seed')", [id]);
    }
    revisionId = (await owner.query("select id from transit.revision limit 1")).rows[0]?.id as string;
    await owner.query("commit");
    if (!revisionId) throw new Error("no transit.revision on this branch; saved trips cannot be seeded");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    for (const seed of [seedPlace, seedTrip]) {
      for (const id of [ids.shared, ids.comma, ids.keep, ids.single]) await seed(alice, id);
      for (const id of [ids.shared, ids.comma, ids.bobOnly]) await seed(bob, id);
    }
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  const cases = [
    ["saved_place", deleteSavedPlaces],
    ["saved_trip", deleteSavedTrips],
  ] as const;

  for (const [table, remove] of cases) {
    it(`${table}: deletes only the caller's targeted rows (two ids, one comma id, one of them bob's)`, async () => {
      // bobOnly is not alice's; shared/comma exist for both users but only alice's copies may go.
      await as(alice, (db) => remove(db, alice, [ids.comma, ids.bobOnly]));
      expect(await remaining(table, alice)).toEqual([ids.keep, ids.shared, ids.single].sort());
      expect(await remaining(table, bob)).toEqual([ids.bobOnly, ids.comma, ids.shared].sort());
    });

    it(`${table}: a single-id delete removes exactly that row`, async () => {
      await as(alice, (db) => remove(db, alice, [ids.single]));
      expect(await remaining(table, alice)).toEqual([ids.keep, ids.shared].sort());
      expect(await remaining(table, bob)).toEqual([ids.bobOnly, ids.comma, ids.shared].sort());
    });

    it(`${table}: RLS stops a caller deleting another user's row even with that user's id in the statement`, async () => {
      await as(alice, (db) => remove(db, bob, [ids.bobOnly, ids.comma, ids.shared]));
      expect(await remaining(table, bob)).toEqual([ids.bobOnly, ids.comma, ids.shared].sort());
    });
  }
});
