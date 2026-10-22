// RLS integration tests (spec §5.5, §5.13). Run against a throwaway Neon branch
// that has had `pnpm db:migrate` applied:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
// OWNER = branch owner role (direct endpoint); APP = paranaga_app (pooled endpoint).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("RLS on core (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const alice = `test-alice-${run}`;
  const bob = `test-bob-${run}`;
  const admin = `test-admin-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;

  const as = <T>(userId: string | null, fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId, requestId: `test-${run}` }, fn);

  const rows = async (userId: string | null, query: ReturnType<typeof sql>) =>
    as(userId, async (db) => (await db.execute(query)).rows);

  // Since 0026 role changes need a fresh step-up; the setting by hand tests the gate alone (the
  // record that fills it is step-up-rls.test.ts).
  const stepped = async (userId: string, query: ReturnType<typeof sql>) =>
    as(userId, async (db) => {
      await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return (await db.execute(query)).rows;
    });

  // Drizzle wraps Postgres errors ("Failed query: …"); the original is error.cause.
  const pgError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      return { code: cause?.code, message: cause?.message ?? "" };
    }
    throw new Error("expected the query to fail");
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    // Seed through the definer role, which the owner is a member of.
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, role] of [
      [alice, "commuter"],
      [bob, "commuter"],
      [admin, "admin"],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      await owner.query("insert into core.preference (user_id) values ($1)", [id]);
      await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("commit");
    // max: 1 forces every request onto the same pooled connection (leak test).
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("guests see no role rows and no preferences", async () => {
    expect(await rows(null, sql`select * from core.user_role`)).toHaveLength(0);
    expect(await rows(null, sql`select * from core.preference`)).toHaveLength(0);
  });

  it("a user sees only their own roles and preferences", async () => {
    const roles = await rows(alice, sql`select user_id from core.user_role`);
    expect(roles.map((r) => r.user_id)).toEqual([alice]);
    const prefs = await rows(alice, sql`select user_id from core.preference`);
    expect(prefs.map((r) => r.user_id)).toEqual([alice]);
  });

  it("a user cannot change someone else's preferences", async () => {
    const updated = await rows(
      alice,
      sql`update core.preference set low_data = true where user_id = ${bob} returning user_id`,
    );
    expect(updated).toHaveLength(0);
  });

  it("the app role cannot write roles directly", async () => {
    await expect(
      rows(alice, sql`insert into core.user_role (user_id, role_code, reason) values (${alice}, 'admin', 'x')`),
    ).rejects.toThrow();
  });

  it("non-admins cannot grant roles", async () => {
    const error = await pgError(rows(alice, sql`select core.grant_role(${bob}, 'contributor', 'test')`));
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/only admins/);
  });

  it("admins cannot grant roles to themselves", async () => {
    const error = await pgError(stepped(admin, sql`select core.grant_role(${admin}, 'complaint_reviewer', 'test')`));
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/themselves/);
  });

  it("admins can grant a role (after a fresh step-up), and the grant is audited", async () => {
    const noStepUp = await pgError(rows(admin, sql`select core.grant_role(${bob}, 'contributor', 'integration test')`));
    expect(noStepUp).toEqual({ code: "42501", message: "step-up required" });
    await stepped(admin, sql`select core.grant_role(${bob}, 'contributor', 'integration test')`);
    const bobRoles = await rows(bob, sql`select role_code from core.user_role order by role_code`);
    expect(bobRoles.map((r) => r.role_code)).toEqual(["commuter", "contributor"]);
    const audit = await rows(
      admin,
      sql`select action from core.audit_event where entity_id = ${bob} and action = 'role.grant'`,
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it("context never leaks between users on the same pooled connection", async () => {
    const first = await rows(alice, sql`select core.current_user_id() as id`);
    const second = await rows(bob, sql`select core.current_user_id() as id`);
    const guest = await rows(null, sql`select core.current_user_id() as id`);
    expect(first[0]?.id).toBe(alice);
    expect(second[0]?.id).toBe(bob);
    expect(guest[0]?.id).toBeNull();

    // Outside any request transaction the setting is gone.
    const client = await app.connect();
    try {
      const { rows: bare } = await client.query("select core.current_user_id() as id");
      expect(bare[0]?.id).toBeNull();
    } finally {
      client.release();
    }
  });

  it("audit events are not readable by non-admins", async () => {
    expect(await rows(alice, sql`select * from core.audit_event`)).toHaveLength(0);
  });

  it("the app role cannot forge audit rows directly", async () => {
    await expect(
      rows(alice, sql`insert into core.audit_event (actor_user_id, actor_role, action, entity_type)
                      values (${admin}, 'admin', 'role.grant', 'user')`),
    ).rejects.toThrow();
  });

  it("core.audit() takes the actor from the request context", async () => {
    await rows(alice, sql`select core.audit('test.event', 'test', ${run})`);
    const audit = await rows(admin, sql`select actor_user_id from core.audit_event where entity_id = ${run}`);
    expect(audit.map((r) => r.actor_user_id)).toEqual([alice]);
  });

  it("revoked roles are not re-granted on the next sign-in", async () => {
    await stepped(admin, sql`select core.revoke_role(${bob}, 'commuter', 'integration test')`);
    await rows(bob, sql`select core.ensure_commuter('Bob')`);
    const active = await rows(
      bob,
      sql`select role_code from core.user_role where role_code = 'commuter' and revoked_at is null`,
    );
    expect(active).toHaveLength(0);
  });

  it("users cannot mark their own uploads verified", async () => {
    await expect(
      rows(alice, sql`insert into core.media_object (bucket, object_key, expected_bytes, owner_id, purpose, status)
                      values ('quarantine', ${`k-${run}-1`}, 10, ${alice}, 'community_photo', 'verified')`),
    ).rejects.toThrow();
    await rows(alice, sql`insert into core.media_object (bucket, object_key, expected_bytes, owner_id, purpose)
                          values ('quarantine', ${`k-${run}-2`}, 10, ${alice}, 'community_photo')`);
    await expect(
      rows(alice, sql`update core.media_object set status = 'verified' where object_key = ${`k-${run}-2`}`),
    ).rejects.toThrow();
  });
});
