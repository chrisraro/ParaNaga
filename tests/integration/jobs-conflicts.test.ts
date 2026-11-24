// O1, C5, F1 against a throwaway Neon branch (never production):
//   bash scripts/with-neon-branch.sh pnpm exec vitest run --project integration tests/integration/jobs-conflicts.test.ts
// The real handlers and repos run on the branch; only the session is faked. A second connection holds
// an uncommitted row so the handler's own insert has to wait and then fails with 23505.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { buildSavedTrip } from "@/domain/saved/saved";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/server/auth/authorize", () => ({ authorize: async () => ({ id: session.id, name: "T", roles: ["commuter"] }) }));

const { withRequestContext } = await import("@/server/db/context");
const { getPool } = await import("@/server/db/client");
const { enqueueJob, registerJobHandler, runJobBatch } = await import("@/server/jobs/worker");
const { registerDefaultJobHandlers } = await import("@/server/jobs/handlers");
const { createComment, createPost, toggleBookmark, toggleReaction } = await import("@/server/community/handlers");
const { createCorrection } = await import("@/server/corrections/handlers");
const { POST: postSavedTrips } = await import("@/app/api/v1/me/saved-trips/route");

describe.skipIf(!ownerUrl || !appUrl)("jobs, purge and concurrent duplicates (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const author = `test-cauthor-${run}`;
  const reader = `test-creader-${run}`;
  let owner: pg.Client;
  let holder: pg.Client;
  let postId = "";

  const system = <T>(fn: Parameters<typeof withRequestContext<T>>[1]) => withRequestContext<T>({ userId: null, requestId: `test-${run}` }, fn);
  const send = (handler: (r: Request) => Promise<Response>, body: unknown) =>
    handler(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  /** Runs `request` while `holder` has `insert` uncommitted; commits once the request is waiting on it. */
  async function overlap(insert: () => Promise<unknown>, request: () => Promise<Response>): Promise<Response> {
    await holder.query("begin");
    await holder.query("set local role paranaga_definer");
    await insert();
    const pid = (await holder.query("select pg_backend_pid() as pid")).rows[0].pid;
    const pending = request();
    for (let i = 0; ; i++) {
      const waiting = await owner.query("select 1 from pg_locks l where not l.granted and $1::int = any(pg_blocking_pids(l.pid))", [pid]);
      if (waiting.rows.length > 0) break;
      if (i > 100) throw new Error("the request never waited");
      await new Promise((r) => setTimeout(r, 100));
    }
    await holder.query("commit");
    return pending;
  }

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    holder = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await holder.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const id of [author, reader]) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, 'commuter', 'test seed')", [id]);
    }
    await owner.query("commit");
    postId = await withRequestContext({ userId: author, requestId: `test-${run}` }, async (db) => {
      const res = await db.execute<{ post_id: string }>(sql`select post_id from community.create_post(${randomUUID()}::uuid, 'commute_tips',
        'A test title here', 'A test body that is long enough.', '{}'::text[], null, 'published', null)`);
      return res.rows[0]!.post_id;
    });
  });
  afterAll(async () => {
    await getPool().end();
    await holder?.end();
    await owner?.end();
  });

  it("O1: a fixed key stays single while open, and a finished job can be queued again", async () => {
    const kind = `test_recurring_${run}`;
    let ran = 0;
    registerJobHandler(kind, async () => {
      ran++;
      return { success: true };
    });
    const queue = () => system((db) => enqueueJob(db, kind, {}, { idempotencyKey: kind }));
    const first = await queue();
    expect(await queue()).toBe(first);
    await runJobBatch({ batchSize: 200 });
    expect(ran).toBe(1);
    expect(await queue()).not.toBe(first);
    await runJobBatch({ batchSize: 200 });
    expect(ran).toBe(2);
    expect((await owner.query("select status from ops.job where kind = $1", [kind])).rows).toEqual([{ status: "done" }, { status: "done" }]);
  });

  it("O1: the retention_purge job, run as the app role, deletes every expired bucket whatever its key, and keeps current ones", async () => {
    registerDefaultJobHandlers();
    await owner.query(
      "insert into ops.rate_limit_bucket (key_hash, window_start, count) values ($1, now() - interval '3 days', 1), ($2, now() - interval '30 days', 1), ($3, now() - interval '1 day', 1), ($3, now(), 1)",
      [`old-${run}`, `places:old-${run}`, `live-${run}`],
    );
    await system((db) => enqueueJob(db, "retention_purge", {}, { idempotencyKey: "retention_purge" }));
    await runJobBatch({ batchSize: 200 });
    expect((await owner.query("select count(*)::int as n from ops.rate_limit_bucket where window_start < now() - interval '2 days'")).rows).toEqual([{ n: 0 }]);
    expect((await owner.query("select count(*)::int as n from ops.rate_limit_bucket where key_hash = $1", [`live-${run}`])).rows).toEqual([{ n: 2 }]);
    expect((await owner.query("select status from ops.job where kind = 'retention_purge' order by created_at desc limit 1")).rows).toEqual([{ status: "done" }]);
  });

  it("C5: a post sent twice at once answers the stored post", async () => {
    session.id = author;
    const clientRequestId = randomUUID();
    let stored = "";
    const res = await overlap(
      async () => {
        stored = (await holder.query("insert into community.post (author_id, client_request_id, topic) values ($1, $2, 'commute_tips') returning id", [author, clientRequestId])).rows[0].id;
        await holder.query(
          "insert into community.post_version (post_id, n, author_id, title, body, tags, moderation_status) values ($1, 1, $2, 'A test title here', 'A test body that is long enough.', '{}', 'pending')",
          [stored, author],
        );
      },
      () => send(createPost, { clientRequestId, topic: "commute_tips", title: "A test title here", body: "A test body that is long enough.", guidelinesAccepted: true }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).post.id).toBe(stored);
  });

  it("C5: a comment sent twice at once answers the stored comment", async () => {
    session.id = reader;
    const clientRequestId = randomUUID();
    let stored = "";
    const res = await overlap(
      async () => {
        stored = (
          await holder.query(
            "insert into community.comment (post_id, depth, author_id, client_request_id, body, moderation_status) values ($1, 1, $2, $3, 'Thanks a lot', 'pending') returning id",
            [postId, reader, clientRequestId],
          )
        ).rows[0].id;
      },
      () => send((r) => createComment(r, postId), { clientRequestId, body: "Thanks a lot", guidelinesAccepted: true }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).comment.id).toBe(stored);
  });

  it("C5: a correction sent twice at once answers the stored report", async () => {
    session.id = reader;
    const clientRequestId = randomUUID();
    let stored = "";
    const res = await overlap(
      async () => {
        stored = (
          await holder.query(
            "insert into community.correction (author_id, client_request_id, entity_type, entity_id, kind, description, status, submitted_at) values ($1, $2, 'stop', 'stop-1', 'wrong_curb_side', 'The sign is on the other side.', 'submitted', now()) returning id",
            [reader, clientRequestId],
          )
        ).rows[0].id;
      },
      () =>
        send(createCorrection, {
          clientRequestId,
          category: "wrong_curb_side",
          entityType: "stop",
          entityId: "stop-1",
          description: "The sign is on the other side.",
          aiDisclosureAccepted: true,
        }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).correction.id).toBe(stored);
  });

  it("C5: overlapping taps leave a reaction and a bookmark on (never toggled twice)", async () => {
    session.id = reader;
    const reacted = await overlap(
      async () => {
        await holder.query("insert into community.reaction (user_id, target_type, target_id) values ($1, 'post', $2)", [reader, postId]);
        await holder.query("update community.post set helpful_count = 1 where id = $1", [postId]);
      },
      () => send(toggleReaction, { targetType: "post", targetId: postId }),
    );
    expect(reacted.status).toBe(200);
    expect(await reacted.json()).toEqual({ active: true, count: 1 });
    const saved = await overlap(
      () => holder.query("insert into community.bookmark (user_id, post_id) values ($1, $2)", [reader, postId]),
      () => send(toggleBookmark, { postId }),
    );
    expect(await saved.json()).toEqual({ active: true, count: null });
    for (const table of ["reaction", "bookmark"]) {
      expect((await owner.query(`select count(*)::int as n from community.${table} where user_id = $1`, [reader])).rows).toEqual([{ n: 1 }]);
    }
  });

  it("F1: only the trip on an unknown revision is left out", async () => {
    session.id = reader;
    const known = (await owner.query("select id from transit.revision order by seq limit 1")).rows[0]?.id as string;
    expect(known).toBeTruthy();
    const plan = planResponseSchema.parse(PROVISIONAL_PLAN);
    const trip = (id: string, revisionId: string) => ({
      ...buildSavedTrip({
        id,
        savedAt: "2026-10-16T02:00:00.000Z",
        data: plan,
        option: plan.plan.options[0]!,
        start: { label: "A", point: { lat: 13.6224, lng: 123.1838 } },
        destination: { label: "B", point: { lat: 13.6305, lng: 123.1912 } },
      }),
      revisionId,
    });
    const res = await send(postSavedTrips, { trips: [trip(`bad-${run}`, randomUUID()), trip(`ok-${run}`, known)] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 1, rejected: [`bad-${run}`] });
    expect((await owner.query("select client_id from core.saved_trip where user_id = $1", [reader])).rows).toEqual([{ client_id: `ok-${run}` }]);
  });
});
