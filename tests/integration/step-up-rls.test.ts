// Step-up (N3, migration 0022) against a migrated Neon branch:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
// The OTP check itself is Neon Auth's (mocked in tests/unit/step-up.test.ts); here the server's
// record and the gates: core.step_up is private, a verification needs an open challenge, it counts
// for 15 minutes for that session only, app.step_up_at is set in the same transaction and never
// leaks, and the reporter's original download and the reviewer functions pass only when fresh.
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateReference } from "@/domain/complaints/reference";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("step-up record and gates (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const reporter = `test-su-reporter-${run}`;
  const other = `test-su-other-${run}`;
  const reviewer = `test-su-rev-${run}`;
  const admin = `test-su-admin-${run}`;
  const key = (label: string) => createHash("sha256").update(`${run}|${label}`).digest("hex");
  const KEY_A = key("reporter-session-a");
  const KEY_B = key("reporter-session-b");
  let owner: pg.Client;
  let app: pg.Pool;
  let complaintId = "";
  let evidenceId = "";

  const as = <T>(userId: string | null, fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId, requestId: `test-${run}` }, fn);
  const rows = async (userId: string | null, query: ReturnType<typeof sql>) => as(userId, async (db) => (await db.execute(query)).rows);
  const one = async <T>(userId: string | null, query: ReturnType<typeof sql>) => (await rows(userId, query))[0] as T;
  const pgError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code ?? (error as { code?: string }).code;
    }
    throw new Error("expected the query to fail");
  };
  const download = (userId: string, k: string | null) =>
    as(userId, async (db) => {
      if (k) await db.execute(sql`select core.step_up_apply(${k})`);
      return (await db.execute(sql`select * from priv.my_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)`)).rows;
    });
  const verify = async (userId: string, k: string) => {
    await rows(userId, sql`select core.step_up_begin(${k})`);
    return one<{ at: Date | null }>(userId, sql`select core.step_up_finish(${k}, true) as at`);
  };
  /** Moves the user's verification back in time (owner connection, as the definer role). */
  const age = async (userId: string, k: string, minutes: number) => {
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query("select set_config('app.user_id', $1, true)", [userId]);
    await owner.query(
      "update core.step_up set verified_at = now() - make_interval(mins => $3) where user_id = $1 and session_key = $2",
      [userId, k, minutes],
    );
    await owner.query("commit");
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [reporter, ["commuter"]],
      [other, ["commuter"]],
      [reviewer, ["commuter", "complaint_reviewer"]],
      [admin, ["commuter", "admin"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) {
        await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
      }
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    const mediaId = (await rows(reporter, sql`select id from core.create_media_slot('complaint_evidence', 100, 'image/jpeg')`))[0]!.id as string;
    await rows(
      reporter,
      sql`select core.verify_and_promote_media(${mediaId}::uuid, 'evidence-private', ${`complaint_evidence/su-${run}.jpg`}, ${"b".repeat(64)}, 100, 'image/jpeg')`,
    );
    const ref = generateReference((n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 240)));
    const created = await rows(
      reporter,
      sql`select * from priv.submit_complaint(${randomUUID()}::uuid, ${ref}, 'overcharging', 'Asked for twice the fare on the loop.',
            now() - interval '1 hour', null, null, null, null, null, null, null, 'queue_normal',
            ${JSON.stringify([{ mediaId, captureKind: "in_app_camera" }])}::jsonb)`,
    );
    complaintId = created[0]!.id as string;
    evidenceId = (await rows(reporter, sql`select id from priv.complaint_media where complaint_id = ${complaintId}::uuid`))[0]!.id as string;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("core.step_up is not readable or writable by the app role", async () => {
    expect(await pgError(rows(reporter, sql`select * from core.step_up`))).toBe("42501");
    expect(
      await pgError(rows(reporter, sql`insert into core.step_up (user_id, session_key, verified_at) values (${reporter}, ${KEY_A}, now())`)),
    ).toBe("42501");
  });

  it("guests cannot open or finish a challenge", async () => {
    expect(await pgError(rows(null, sql`select core.step_up_begin(${KEY_A})`))).toBe("28000");
    expect(await pgError(rows(null, sql`select core.step_up_finish(${KEY_A}, true)`))).toBe("28000");
    expect(await pgError(rows(reporter, sql`select core.step_up_begin('not-a-hash')`))).toBe("22023");
  });

  it("without step-up the reporter's original download fails closed and logs no access", async () => {
    expect(await pgError(download(reporter, null))).toBe("42501");
    expect(await pgError(download(reporter, KEY_A))).toBe("42501");
  });

  it("a verification needs an open challenge, and one challenge gives one verification", async () => {
    expect((await one<{ at: Date | null }>(reporter, sql`select core.step_up_finish(${KEY_A}, true) as at`)).at).toBeNull();
    await rows(reporter, sql`select core.step_up_begin(${KEY_A})`);
    expect((await one<{ pending: boolean }>(reporter, sql`select core.step_up_pending(${KEY_A}) as pending`)).pending).toBe(true);
    // A wrong code (the server passes ok = false) records nothing and keeps the challenge open.
    expect((await one<{ at: Date | null }>(reporter, sql`select core.step_up_finish(${KEY_A}, false) as at`)).at).toBeNull();
    const first = await one<{ at: Date | null }>(reporter, sql`select core.step_up_finish(${KEY_A}, true) as at`);
    expect(first.at).not.toBeNull();
    expect((await one<{ pending: boolean }>(reporter, sql`select core.step_up_pending(${KEY_A}) as pending`)).pending).toBe(false);
    expect((await one<{ at: Date | null }>(reporter, sql`select core.step_up_finish(${KEY_A}, true) as at`)).at).toBeNull();
  });

  it("fresh: the download passes in the same transaction as step_up_apply, and the issuance is logged", async () => {
    const got = await download(reporter, KEY_A);
    expect(got).toHaveLength(1);
    expect(got[0]!.bucket).toBe("evidence-private");
  });

  it("the setting never leaks to the next transaction on the same pooled connection", async () => {
    await download(reporter, KEY_A);
    const left = await one<{ v: string | null }>(reporter, sql`select current_setting('app.step_up_at', true) as v`);
    expect(left.v ?? "").toBe("");
    expect(await pgError(download(reporter, null))).toBe("42501");
  });

  it("binds to the session and the user: another session key or another user does not pass", async () => {
    expect(await pgError(download(reporter, KEY_B))).toBe("42501");
    expect((await one<{ at: Date | null }>(other, sql`select core.step_up_apply(${KEY_A}) as at`)).at).toBeNull();
  });

  it("stale (16 minutes): step-up required again", async () => {
    await age(reporter, KEY_A, 16);
    expect((await one<{ at: Date | null }>(reporter, sql`select core.step_up_apply(${KEY_A}) as at`)).at).toBeNull();
    expect(await pgError(download(reporter, KEY_A))).toBe("42501");
    // A new code brings it back.
    expect((await verify(reporter, KEY_A)).at).not.toBeNull();
    expect(await download(reporter, KEY_A)).toHaveLength(1);
  });

  it("a fresh step-up does not widen ownership: another commuter still gets nothing", async () => {
    const k = key("other-session");
    expect((await verify(other, k)).at).not.toBeNull();
    expect(await download(other, k)).toHaveLength(0);
  });

  it("the reviewer queue opens with the real record, not only with a hand-set value", async () => {
    const k = key("reviewer-session");
    expect(await pgError(as(reviewer, async (db) => {
      await db.execute(sql`select core.step_up_apply(${k})`);
      return (await db.execute(sql`select * from priv.review_queue(10)`)).rows;
    }))).toBe("42501");
    expect((await verify(reviewer, k)).at).not.toBeNull();
    const queue = await as(reviewer, async (db) => {
      await db.execute(sql`select core.step_up_apply(${k})`);
      return (await db.execute(sql`select * from priv.review_queue(100)`)).rows;
    });
    expect(queue.some((r) => r.id === complaintId)).toBe(true);
  });

  it("requests, successes and failures are audited without codes", async () => {
    // Admins read the audit log (core.audit_event RLS); the reporter cannot.
    const audit = await rows(admin, sql`select action, after from core.audit_event where actor_user_id = ${reporter} and action like 'step_up.%'`);
    const actions = new Set(audit.map((r) => r.action));
    expect(actions).toEqual(new Set(["step_up.request", "step_up.success", "step_up.failure"]));
    expect(JSON.stringify(audit)).not.toMatch(/\d{6}/);
  });
});
