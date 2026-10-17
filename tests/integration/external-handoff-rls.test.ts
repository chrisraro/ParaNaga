// priv.external_handoff (task B9, migration 0019) against a migrated Neon branch:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
// IDOR/RLS matrix in the style of priv-complaint-rls.test.ts: only the reporter reads or writes
// the self-reported MyNaga handoff of their own report; moderators, reviewers and admins get nothing.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateReference } from "@/domain/complaints/reference";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("RLS on priv.external_handoff (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const reporter = `test-hreporter-${run}`;
  const other = `test-hother-${run}`;
  const moderator = `test-hmod-${run}`;
  const reviewer = `test-hrev-${run}`;
  const admin = `test-hadmin-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;
  let complaintId = "";

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
  const handoff = (userId: string | null, submitted: boolean, reference: string | null) =>
    rows(userId, sql`select * from priv.set_mynaga_handoff(${complaintId}::uuid, ${submitted}, ${reference})`);

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
      [admin, ["commuter", "admin"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) {
        await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
      }
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    complaintId = (
      await rows(
        reporter,
        sql`select * from priv.submit_complaint(${randomUUID()}::uuid, ${ref()}, 'overcharging', 'Asked for twice the fare here.',
              now() - interval '1 hour', null, null, null, null, null, null, null, 'queue_normal', '[]'::jsonb)`,
      )
    )[0]!.id as string;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("only the reporter records a handoff; everyone else gets no row, guests are refused", async () => {
    expect(await pgError(handoff(null, true, null))).toBe("28000");
    for (const userId of [other, moderator, reviewer, admin]) {
      expect(await handoff(userId, true, "STOLEN-1"), userId).toHaveLength(0);
    }
    const mine = await handoff(reporter, true, "  MN-12345  ");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.submitted).toBe(true);
    expect(mine[0]!.reference).toBe("MN-12345");
  });

  it("matrix: only the reporter reads the handoff row", async () => {
    for (const [name, userId, n] of [
      ["guest", null, 0],
      ["reporter", reporter, 1],
      ["other commuter", other, 0],
      ["community moderator", moderator, 0],
      ["complaint reviewer", reviewer, 0],
      ["admin", admin, 0],
    ] as const) {
      expect(
        await rows(userId, sql`select complaint_id from priv.external_handoff where complaint_id = ${complaintId}::uuid`),
        name,
      ).toHaveLength(n);
    }
  });

  it("no actor writes the table directly", async () => {
    for (const userId of [reporter, other, moderator, reviewer, admin]) {
      expect(
        await pgError(rows(userId, sql`update priv.external_handoff set self_reported_reference = 'x' where complaint_id = ${complaintId}::uuid`)),
        userId,
      ).toBe("42501");
      expect(
        await pgError(rows(userId, sql`insert into priv.external_handoff (complaint_id) values (${complaintId}::uuid)`)),
        userId,
      ).toBe("42501");
    }
  });

  it("the reviewer queue never carries the reference", async () => {
    const queue = await as(reviewer, async (db) => {
      await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return (await db.execute(sql`select * from priv.review_queue(100)`)).rows;
    });
    const row = queue.find((r) => r.id === complaintId);
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain("MN-12345");
  });

  it("refuses control characters and clears the reference when taken back", async () => {
    expect(await pgError(handoff(reporter, true, "bad\u0007ref"))).toBe("22023");
    const back = await handoff(reporter, false, "ignored");
    expect(back[0]!.submitted).toBe(false);
    expect(back[0]!.reference).toBeNull();
  });
});
