// Admin revisions and publication (N5a, migration 0023) against a migrated Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// Role matrix on every admin definer function (guest, commuter, community moderator, complaint
// reviewer refused; admin and transport reviewer allowed), the app role's lack of any direct path,
// and the full C8 flow through the real functions: draft from published → validate (dry run +
// report bound to the membership) → publish with step-up → the public head moves → rollback →
// audit rows. Publishes test revisions and puts the previously published revision back at the end.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validationFactsSchema } from "@/domain/admin/schemas";
import { validateRevision } from "@/domain/admin/validation";
import { runInRequestContext, type Db } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl || !importUrl)("admin revisions and publication (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const admin = `test-adm-${run}`;
  const reviewer = `test-trev-${run}`;
  const commuter = `test-com-${run}`;
  const moderator = `test-mod-${run}`;
  const complaintReviewer = `test-crev-${run}`;
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;
  let previous: string | null = null;
  let base = "";

  const as = <T>(userId: string | null, fn: (db: Db) => Promise<T>, opts: { stepUp?: boolean } = {}) =>
    runInRequestContext<T>(app, { userId, requestId: `adm-${run}` }, async (db) => {
      // The real handler calls core.step_up_apply; the setting by hand tests the gate (step-up-rls.test.ts covers the record).
      if (opts.stepUp) await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return fn(db);
    });
  const one = async <T = Record<string, unknown>>(userId: string | null, query: ReturnType<typeof sql>, opts: { stepUp?: boolean } = {}) =>
    (await as(userId, async (db) => (await db.execute(query)).rows, opts))[0] as T;
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      return { code: e.cause?.code ?? e.code, message: e.cause?.message ?? e.message ?? "" };
    }
    throw new Error("expected the query to fail");
  };
  const pointer = async () => (await owner.query<{ id: string }>("select revision_id as id from transit.published_pointer where singleton")).rows[0]?.id ?? null;
  const validate = (userId: string, revisionId: string) =>
    as(userId, async (db) => {
      const f = validationFactsSchema.parse((await db.execute(sql`select transit.admin_validation_facts(${revisionId}::uuid) as f`)).rows[0]!.f);
      const report = validateRevision(f);
      await db.execute(sql`select transit.admin_record_validation(${revisionId}::uuid, ${f.membershipHash}, ${JSON.stringify(report)}::jsonb)`);
      return { facts: f, report };
    });
  const publish = (userId: string, revisionId: string, expected: string | null, mode: "publish" | "rollback", stepUp = true) =>
    one(userId, sql`select transit.admin_publish_revision(${revisionId}::uuid, ${expected}::uuid, ${mode}) as p`, { stepUp });

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [admin, ["commuter", "admin"]],
      [reviewer, ["commuter", "transport_reviewer"]],
      [commuter, ["commuter"]],
      [moderator, ["commuter", "community_moderator"]],
      [complaintReviewer, ["commuter", "complaint_reviewer"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    // One open draft at a time: drafts other files left on this throwaway branch are closed first.
    await owner.query("update transit.revision set status = 'superseded' where status in ('draft', 'validating')");
    await owner.query("commit");

    // A small publishable base revision (one route), published by the import role as the scripts do.
    previous = await pointer();
    const rev = (await importer.query<{ id: string }>(
      "insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id", [`adm-${run}-base`])).rows[0]!;
    const route = (await importer.query<{ id: string }>(
      "insert into transit.route (public_code, name) values ($1, 'Admin test route') returning id", [`ADM-${run}`])).rows[0]!;
    await importer.query("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'route', $2, $2)", [rev.id, route.id]);
    await importer.query("select transit.publish_revision($1)", [rev.id]);
    base = rev.id;
  }, 60_000);

  afterAll(async () => {
    if (previous && importer && (await pointer()) !== previous) await importer.query("select transit.publish_revision($1)", [previous]);
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  it("matrix: every admin function refuses guests, commuters, moderators and complaint reviewers (42501)", async () => {
    const calls = [
      sql`select transit.admin_dashboard()`,
      sql`select * from transit.admin_revisions(10)`,
      sql`select transit.admin_create_draft()`,
      sql`select transit.admin_validation_facts(${base}::uuid)`,
      sql`select transit.admin_record_validation(${base}::uuid, ${"0".repeat(64)}, '{"ok":true,"errorCount":0,"warningCount":0}'::jsonb)`,
      sql`select transit.admin_publish_revision(${base}::uuid, ${base}::uuid, 'rollback')`,
      sql`select * from transit.admin_coverage(${base}::uuid)`,
    ];
    for (const userId of [null, commuter, moderator, complaintReviewer]) {
      for (const q of calls) expect((await failure(one(userId, q, { stepUp: true }))).code, String(userId)).toBe("42501");
    }
  });

  it("admins and transport reviewers read the dashboard and the list", async () => {
    for (const userId of [admin, reviewer]) {
      const d = (await one<{ d: Record<string, unknown> }>(userId, sql`select transit.admin_dashboard() as d`)).d;
      expect((d.published as { id: string }).id).toBe(base);
      const list = await as(userId, async (db) => (await db.execute(sql`select * from transit.admin_revisions(200)`)).rows);
      expect(list.find((r) => r.id === base)).toMatchObject({ is_published: true, member_count: "1" });
    }
  });

  it("the app role has no direct path: publish_revision, the helpers and revision writes are refused", async () => {
    for (const q of [
      sql`select transit.publish_revision(${base}::uuid)`,
      sql`select transit.admin_assert_staff()`,
      sql`select transit.revision_membership_hash(${base}::uuid)`,
      sql`update transit.revision set status = 'superseded' where id = ${base}::uuid`,
      sql`insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values (${base}::uuid, 'route', ${base}::uuid, ${base}::uuid)`,
    ]) {
      expect((await failure(one(admin, q))).code).toBe("42501");
    }
  });

  it("C8 flow: draft → validate → publish (step-up) → head moves → rollback, all audited", async () => {
    // Draft: an exact copy of the published membership; only one open at a time.
    const draft = (await one<{ id: string }>(reviewer, sql`select transit.admin_create_draft() as id`)).id;
    expect((await failure(one(admin, sql`select transit.admin_create_draft()`))).code).toBe("55000");
    const members = await owner.query("select count(*)::int as n from transit.revision_member where revision_id = $1", [draft]);
    expect(members.rows[0].n).toBe(1);

    // Not validated yet: refused even with step-up.
    expect((await failure(publish(admin, draft, base, "publish"))).message).toMatch(/validate the revision first/);

    // Validation: the dry run passes (and leaves nothing behind), the report is stored.
    const v = await validate(reviewer, draft);
    expect(v.facts.dbCheck).toEqual({ ok: true });
    expect(v.report.ok).toBe(true);
    expect(await pointer()).toBe(base);
    expect((await owner.query("select status from transit.revision where id = $1", [draft])).rows[0].status).toBe("draft");

    // A report for another membership is refused.
    expect((await failure(one(admin, sql`select transit.admin_record_validation(${draft}::uuid, ${"0".repeat(64)}, '{"ok":true,"errorCount":0,"warningCount":0}'::jsonb)`))).code).toBe("55000");

    // Step-up is required, and the caller must name the pointer it saw.
    expect((await failure(publish(admin, draft, base, "publish", false))).message).toMatch(/step-up required/);
    expect((await failure(publish(admin, draft, draft, "publish"))).code).toBe("55000");

    // The membership changes after validation: refused until validated again.
    const note = (await importer.query<{ id: string }>("insert into transit.dataset_note (key, value) values ($1, '{}') returning id", [`adm-${run}`])).rows[0]!;
    await importer.query("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'dataset_note', $2, $2)", [draft, note.id]);
    expect((await failure(publish(admin, draft, base, "publish"))).message).toMatch(/changed since it was validated/);
    await validate(admin, draft);

    const p = (await publish(admin, draft, base, "publish")).p as Record<string, unknown>;
    expect(p).toMatchObject({ revisionId: draft, previousRevisionId: base, mode: "publish" });
    expect(await pointer()).toBe(draft);
    const head = await one<{ id: string }>(null, sql`select id from transit.v_published_revision`);
    expect(head.id).toBe(draft);

    // A published revision cannot be published again; the old one is now a rollback target.
    expect((await failure(publish(admin, draft, draft, "publish"))).code).toBe("55000");
    expect((await failure(publish(admin, base, draft, "rollback"))).message).toMatch(/validate the revision first/);
    await validate(reviewer, base);
    await publish(reviewer, base, draft, "rollback");
    expect(await pointer()).toBe(base);

    const audit = await owner.query<{ action: string; actor_user_id: string; entity_id: string; request_id: string }>(
      "select action, actor_user_id, entity_id, request_id from core.audit_event where request_id = $1 order by at", [`adm-${run}`]);
    const actions = audit.rows.map((r) => `${r.action}:${r.entity_id === draft ? "draft" : r.entity_id === base ? "base" : "?"}:${r.actor_user_id}`);
    expect(actions).toEqual([
      `revision.draft_create:draft:${reviewer}`,
      `revision.validate:draft:${reviewer}`,
      `revision.validate:draft:${admin}`,
      `revision.publish:draft:${admin}`,
      `revision.validate:base:${reviewer}`,
      `revision.rollback:base:${reviewer}`,
    ]);
  });

  it("a synthetic revision validates with errors and can never be published", async () => {
    const rev = (await importer.query<{ id: string }>(
      "insert into transit.revision (label, kind, status, created_by, is_synthetic) values ($1, 'provisional', 'draft', 'test', true) returning id", [`adm-${run}-fx`])).rows[0]!;
    const route = (await importer.query<{ id: string }>(
      "insert into transit.route (public_code, name, is_synthetic) values ($1, 'Fixture Loop X', true) returning id", [`FX-${run}`])).rows[0]!;
    await importer.query("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'route', $2, $2)", [rev.id, route.id]);
    const v = await validate(admin, rev.id);
    expect(v.facts.dbCheck.ok).toBe(false);
    expect(v.report.ok).toBe(false);
    expect(v.report.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(["synthetic", "database_checks"]));
    expect((await failure(publish(admin, rev.id, base, "publish"))).message).toMatch(/validate the revision first/);
    // Close it so later tests can open a draft.
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query("update transit.revision set status = 'superseded' where id = $1", [rev.id]);
    await owner.query("commit");
  });

  it("two-person rule: with the flag on, the draft's author cannot publish it; another reviewer can", async () => {
    // An admin flips the flag through the app role, as the policy feature_flag_admin allows.
    const flag = (on: boolean) =>
      as(admin, (db) => db.execute(sql`update ops.feature_flag set enabled = ${on}, updated_at = now(), updated_by = ${admin} where key = 'publish_requires_second_reviewer'`));
    await flag(true);
    try {
      const draft = (await one<{ id: string }>(reviewer, sql`select transit.admin_create_draft() as id`)).id;
      await validate(reviewer, draft);
      expect((await failure(publish(reviewer, draft, base, "publish"))).message).toMatch(/second reviewer/);
      await publish(admin, draft, base, "publish");
      expect(await pointer()).toBe(draft);
      await validate(admin, base);
      await publish(admin, base, draft, "rollback");
    } finally {
      await flag(false);
    }
  });

  it("bootstrap (scripts/bootstrap-admin.ts → core.bootstrap_admin): grants the first admin once, refuses a second", async () => {
    const first = `test-boot-${run}`;
    // Refused while any admin exists (this file seeded one).
    expect((await failure(owner.query("select core.bootstrap_admin($1)", [first]))).code).toBe("42501");
    // With every admin revoked (inside a transaction that is rolled back), the first bootstrap works
    // and the new admin passes the same database check the console uses.
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_definer");
      await owner.query("update core.user_role set revoked_at = now(), revoked_by = 'test' where role_code = 'admin' and revoked_at is null");
      await owner.query("reset role");
      await owner.query("select core.bootstrap_admin($1)", [first]);
      await owner.query("set local role paranaga_definer");
      await owner.query("select set_config('app.user_id', $1, true)", [first]);
      const ok = await owner.query<{ ok: boolean }>("select core.has_role('admin') and transit.admin_assert_staff() = $1 as ok", [first]);
      expect(ok.rows[0]!.ok).toBe(true);
      await owner.query("reset role");
      await owner.query("savepoint second");
      expect((await failure(owner.query("select core.bootstrap_admin($1)", [`${first}-2`]))).code).toBe("42501");
      await owner.query("rollback to savepoint second");
    } finally {
      await owner.query("rollback");
    }
  });

  it("coverage lists the barangay rows of a revision (none in the test base)", async () => {
    const rows = await as(reviewer, async (db) => (await db.execute(sql`select * from transit.admin_coverage(${base}::uuid)`)).rows);
    expect(rows).toEqual([]);
  });
});
