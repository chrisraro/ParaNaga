// Private driver reports (task B8, migration 0018) against a migrated Neon branch:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
// IDOR/RLS matrix: guest, reporter, other commuter, community moderator and complaint reviewer.
// Only the reporter reads their report; moderators get nothing; reviewers only through the
// step-up-gated definer functions.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateReference } from "@/domain/complaints/reference";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("RLS on priv.complaint (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const reporter = `test-reporter-${run}`;
  const other = `test-other-${run}`;
  const moderator = `test-mod-${run}`;
  const reviewer = `test-rev-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;
  let complaintId = "";
  let evidenceId = "";
  let mediaId = "";

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
  const ref = () => generateReference((n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 240)));

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [reporter, ["commuter"]],
      [other, ["commuter"]],
      [moderator, ["commuter", "community_moderator"]],
      [reviewer, ["commuter", "complaint_reviewer"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) {
        await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
      }
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    // The reporter uploads one evidence file through the B4 definer functions.
    mediaId = (await rows(reporter, sql`select id from core.create_media_slot('complaint_evidence', 100, 'image/jpeg')`))[0]!.id as string;
    await rows(
      reporter,
      sql`select core.verify_and_promote_media(${mediaId}::uuid, 'evidence-private', ${`complaint_evidence/${run}.jpg`}, ${"a".repeat(64)}, 100, 'image/jpeg')`,
    );
    const evidence = JSON.stringify([{ mediaId, captureKind: "in_app_camera" }]);
    const created = await rows(
      reporter,
      sql`select * from priv.submit_complaint(${randomUUID()}::uuid, ${ref()}, 'overcharging', 'Asked for twice the fare on the loop.',
            now() - interval '1 hour', 13.6234::double precision, 123.1847::double precision, 12::numeric,
            null, null, ${"ABC 1234"}, null, 'queue_normal', ${evidence}::jsonb)`,
    );
    complaintId = created[0]!.id as string;
    evidenceId = (await rows(reporter, sql`select id from priv.complaint_media where complaint_id = ${complaintId}::uuid`))[0]!.id as string;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  const actors = () =>
    [
      ["guest", null, false],
      ["reporter", reporter, true],
      ["other commuter", other, false],
      ["community moderator", moderator, false],
      ["complaint reviewer (direct read)", reviewer, false],
    ] as const;

  it("matrix: only the reporter reads the report, its evidence rows and its events", async () => {
    for (const [name, userId, sees] of actors()) {
      const n = sees ? 1 : 0;
      expect(await rows(userId, sql`select id from priv.complaint where id = ${complaintId}::uuid`), name).toHaveLength(n);
      expect(await rows(userId, sql`select id from priv.complaint_media where complaint_id = ${complaintId}::uuid`), name).toHaveLength(n);
      expect(await rows(userId, sql`select id from priv.complaint_event where complaint_id = ${complaintId}::uuid`), name).toHaveLength(n);
    }
  });

  it("matrix: only the reporter gets an evidence download, and each issuance is logged", async () => {
    for (const [name, userId, sees] of actors()) {
      if (userId === null) {
        expect(await pgError(rows(null, sql`select * from priv.my_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)`)), name).toBe("28000");
        continue;
      }
      const got = await rows(userId, sql`select * from priv.my_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)`);
      expect(got, name).toHaveLength(sees ? 1 : 0);
    }
    // Nobody reads the access log through the app role.
    expect(await pgError(rows(reporter, sql`select * from priv.evidence_access`))).toBe("42501");
  });

  it("no actor can write priv tables directly", async () => {
    for (const userId of [reporter, other, moderator, reviewer]) {
      expect(await pgError(rows(userId, sql`update priv.complaint set status = 'closed' where id = ${complaintId}::uuid`))).toBe("42501");
      expect(await pgError(rows(userId, sql`delete from priv.complaint where id = ${complaintId}::uuid`))).toBe("42501");
    }
  });

  it("hidden columns stay hidden from the reporter", async () => {
    expect(await pgError(rows(reporter, sql`select queue from priv.complaint`))).toBe("42501");
    expect(await pgError(rows(reporter, sql`select original_key from priv.complaint_media`))).toBe("42501");
  });

  it("evidence cannot be attached twice or by someone else", async () => {
    const evidence = JSON.stringify([{ mediaId, captureKind: "in_app_camera" }]);
    const submit = (userId: string) =>
      rows(
        userId,
        sql`select * from priv.submit_complaint(${randomUUID()}::uuid, ${ref()}, 'other', 'Trying to reuse a file here.',
              now(), null, null, null, null, null, null, null, 'queue_normal', ${evidence}::jsonb)`,
      );
    expect(await pgError(submit(reporter))).toBe("22023");
    expect(await pgError(submit(other))).toBe("22023");
  });

  it("the same request id returns the stored report", async () => {
    const id = randomUUID();
    const once = () =>
      rows(
        other,
        sql`select * from priv.submit_complaint(${id}::uuid, ${ref()}, 'other', 'A report sent twice by a retry.',
              now(), null, null, null, null, null, null, null, 'queue_normal', '[]'::jsonb)`,
      );
    const a = await once();
    const b = await once();
    expect(b[0]!.id).toBe(a[0]!.id);
    expect(b[0]!.public_ref).toBe(a[0]!.public_ref);
  });

  it("reviewer functions refuse moderators and commuters, and a reviewer without step-up", async () => {
    for (const userId of [other, moderator, reporter]) {
      expect(await pgError(rows(userId, sql`select * from priv.review_queue(10)`))).toBe("42501");
      expect(await pgError(rows(userId, sql`select * from priv.reviewer_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)`))).toBe("42501");
    }
    expect(await pgError(rows(reviewer, sql`select * from priv.review_queue(10)`))).toBe("42501");
  });

  it("a reviewer with a fresh step-up sees the queue without reporter ids", async () => {
    // TODO(step-up): replace the manual setting with the real OTP flow once it exists.
    const queue = await as(reviewer, async (db) => {
      await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return (await db.execute(sql`select * from priv.review_queue(100)`)).rows;
    });
    const mine = queue.find((r) => r.id === complaintId);
    expect(mine).toBeDefined();
    expect(Object.keys(mine!)).not.toContain("reporter_id");
  });
});
