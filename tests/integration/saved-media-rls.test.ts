// core.saved_place / core.saved_trip (B2, 0013) and core.media_object with the B4 definer
// functions (0015, made usable by the definer policies in 0018) against a migrated Neon branch:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
// IDOR/RLS matrix (task B10): owner, other commuter, community moderator, admin and guest.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("RLS on core.saved_* and core.media_object (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const alice = `test-salice-${run}`;
  const bob = `test-sbob-${run}`;
  const moderator = `test-smod-${run}`;
  const admin = `test-sadmin-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;
  let revisionId: string | null = null;
  let slotId = "";

  const as = <T>(userId: string | null, fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId, requestId: `test-${run}` }, fn);
  const rows = async (userId: string | null, query: ReturnType<typeof sql>) => as(userId, async (db) => (await db.execute(query)).rows);
  const pgError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code ?? (error as { code?: string }).code;
    }
    throw new Error("expected the query to fail");
  };
  const others = () =>
    [
      ["guest", null],
      ["other commuter", bob],
      ["community moderator", moderator],
      ["admin", admin],
    ] as const;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [alice, ["commuter"]],
      [bob, ["commuter"]],
      [moderator, ["commuter", "community_moderator"]],
      [admin, ["commuter", "admin"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) {
        await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
      }
    }
    revisionId = ((await owner.query("select id from transit.revision limit 1")).rows[0]?.id as string | undefined) ?? null;
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    await rows(
      alice,
      sql`insert into core.saved_place (user_id, client_id, label, point, source)
          values (${alice}, ${`p-${run}`}, 'Home',
                  extensions.ST_SetSRID(extensions.ST_MakePoint(123.18, 13.62), 4326)::extensions.geography, 'pin')`,
    );
    if (revisionId) {
      await rows(
        alice,
        sql`insert into core.saved_trip (user_id, client_id, revision_id, revision_label, revision_kind,
              start_label, start_point, dest_label, dest_point, option)
            values (${alice}, ${`t-${run}`}, ${revisionId}::uuid, 'test', 'provisional',
              'A', extensions.ST_SetSRID(extensions.ST_MakePoint(123.18, 13.62), 4326)::extensions.geography,
              'B', extensions.ST_SetSRID(extensions.ST_MakePoint(123.19, 13.63), 4326)::extensions.geography, '{}'::jsonb)`,
      );
    }
    slotId = (await rows(alice, sql`select id from core.create_media_slot('correction_evidence', 100, 'image/jpeg')`))[0]!.id as string;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("saved places: only the owner reads them; nobody else changes or deletes them", async () => {
    expect(await rows(alice, sql`select 1 from core.saved_place where client_id = ${`p-${run}`}`)).toHaveLength(1);
    for (const [name, userId] of others()) {
      expect(await rows(userId, sql`select 1 from core.saved_place where client_id = ${`p-${run}`}`), name).toHaveLength(0);
      if (userId === null) continue;
      // RLS hides the row: the statement succeeds but touches nothing.
      await rows(userId, sql`update core.saved_place set label = 'Hacked' where client_id = ${`p-${run}`}`);
      await rows(userId, sql`delete from core.saved_place where client_id = ${`p-${run}`}`);
    }
    const kept = await rows(alice, sql`select label from core.saved_place where client_id = ${`p-${run}`}`);
    expect(kept).toEqual([{ label: "Home" }]);
  });

  it("saved places: nobody inserts a row for someone else", async () => {
    expect(
      await pgError(
        rows(
          bob,
          sql`insert into core.saved_place (user_id, client_id, label, point, source)
              values (${alice}, ${`x-${run}`}, 'Planted',
                      extensions.ST_SetSRID(extensions.ST_MakePoint(123.18, 13.62), 4326)::extensions.geography, 'pin')`,
        ),
      ),
    ).toBe("42501");
  });

  it("saved trips: only the owner reads them", async () => {
    if (!revisionId) return; // no revision on this branch: nothing to save against
    expect(await rows(alice, sql`select 1 from core.saved_trip where client_id = ${`t-${run}`}`)).toHaveLength(1);
    for (const [name, userId] of others()) {
      expect(await rows(userId, sql`select 1 from core.saved_trip where client_id = ${`t-${run}`}`), name).toHaveLength(0);
    }
  });

  it("media: only the owner sees a slot; guests cannot create one", async () => {
    expect(await rows(alice, sql`select id from core.media_object where id = ${slotId}::uuid`)).toHaveLength(1);
    for (const [name, userId] of others()) {
      expect(await rows(userId, sql`select id from core.media_object where id = ${slotId}::uuid`), name).toHaveLength(0);
    }
    expect(await pgError(rows(null, sql`select * from core.create_media_slot('community_photo', 100, 'image/jpeg')`))).toBe("28000");
  });

  it("media: nobody else confirms or rejects someone's slot (spec 5.8: no claiming another upload)", async () => {
    for (const userId of [bob, moderator, admin]) {
      expect(
        await pgError(
          rows(userId, sql`select core.verify_and_promote_media(${slotId}::uuid, 'public-media', ${`stolen/${run}.jpg`}, ${"b".repeat(64)}, 100, 'image/jpeg')`),
        ),
        userId,
      ).toBe("42501");
      expect(await pgError(rows(userId, sql`select core.reject_media(${slotId}::uuid)`)), userId).toBe("42501");
    }
    const ok = await rows(
      alice,
      sql`select core.verify_and_promote_media(${slotId}::uuid, 'public-media', ${`correction_evidence/${slotId}.jpg`}, ${"c".repeat(64)}, 100, 'image/jpeg') as ok`,
    );
    expect(ok[0]!.ok).toBe(true);
    // A verified row can no longer be changed by its owner through the app role.
    await expect(rows(alice, sql`update core.media_object set status = 'slot' where id = ${slotId}::uuid`)).rejects.toThrow();
  });
});
