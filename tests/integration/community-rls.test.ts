// Community data (tasks B6/B7, migrations 0016, 0017, 0020) against a migrated Neon branch:
//   TEST_OWNER_DATABASE_URL=... TEST_APP_DATABASE_URL=... pnpm test:integration
// Multi-role IDOR/RLS matrix (task B10): guest, author, other commuter, contributor, community
// moderator, transport reviewer, complaint reviewer and admin across community.correction*,
// community.post*, comments, reactions, bookmarks, blocks and content reports.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("RLS on community (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const author = `test-author-${run}`;
  const other = `test-other-${run}`;
  const contributor = `test-contrib-${run}`;
  const moderator = `test-mod-${run}`;
  const moderator2 = `test-mod2-${run}`;
  const transport = `test-transport-${run}`;
  const complaintReviewer = `test-crev-${run}`;
  const admin = `test-admin-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;
  let correctionId = "";
  let postId = "";
  let versionId = "";
  let commentId = "";
  let modPostId = "";

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

  const everyone = () =>
    [
      ["guest", null],
      ["author", author],
      ["other commuter", other],
      ["contributor", contributor],
      ["community moderator", moderator],
      ["transport reviewer", transport],
      ["complaint reviewer", complaintReviewer],
      ["admin", admin],
    ] as const;

  const createPost = (userId: string, status: "pending" | "published") =>
    rows(
      userId,
      sql`select * from community.create_post(${randomUUID()}::uuid, 'commute_tips', 'A test title here',
            'A test body that is long enough.', '{}'::text[], null, ${status}, null)`,
    );

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [author, ["commuter"]],
      [other, ["commuter"]],
      [contributor, ["commuter", "contributor"]],
      [moderator, ["commuter", "community_moderator"]],
      [moderator2, ["commuter", "community_moderator"]],
      [transport, ["commuter", "transport_reviewer"]],
      [complaintReviewer, ["commuter", "complaint_reviewer"]],
      [admin, ["commuter", "admin"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) {
        await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
      }
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    correctionId = (
      await rows(
        author,
        sql`select * from community.submit_correction(${randomUUID()}::uuid, 'stop_moved_removed', 'stop', ${`S-${run}`},
              'Test stop', 'The stop sign was moved across the road.', null::double precision, null::double precision,
              null::numeric, '{}'::uuid[], null)`,
      )
    )[0]!.id as string;

    const created = (await createPost(author, "pending"))[0]!;
    postId = created.post_id as string;
    versionId = created.version_id as string;
    modPostId = (await createPost(moderator, "published"))[0]!.post_id as string;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  // ---------------------------------------------------------------- corrections (0016)
  it("corrections: only the author reads their correction and its history directly", async () => {
    for (const [name, userId] of everyone()) {
      const n = userId === author ? 1 : 0;
      expect(await rows(userId, sql`select id from community.correction where id = ${correctionId}::uuid`), name).toHaveLength(n);
      expect(
        await rows(userId, sql`select id from community.correction_event where correction_id = ${correctionId}::uuid`),
        name,
      ).toHaveLength(n);
    }
  });

  it("corrections: only transport reviewers and admins reach the review queue", async () => {
    for (const [name, userId] of everyone()) {
      if (userId === null) continue;
      if (userId === transport || userId === admin) {
        const queue = await rows(userId, sql`select id from community.review_queue(200)`);
        expect(queue.some((r) => r.id === correctionId), name).toBe(true);
      } else {
        expect(await pgError(rows(userId, sql`select * from community.review_queue(10)`)), name).toBe("42501");
      }
    }
  });

  it("corrections: no role writes the table directly; moderators cannot change a status", async () => {
    for (const [, userId] of everyone()) {
      if (userId === null) continue;
      expect(await pgError(rows(userId, sql`update community.correction set status = 'accepted' where id = ${correctionId}::uuid`))).toBe("42501");
    }
    expect(
      await pgError(rows(moderator, sql`select community.set_correction_status(${correctionId}::uuid, 'under_review')`)),
    ).toBe("42501");
    expect(
      (await rows(transport, sql`select community.set_correction_status(${correctionId}::uuid, 'under_review') as ok`))[0]!.ok,
    ).toBe(true);
  });

  // ---------------------------------------------------------------- posts (0017)
  it("posts: a pending post is visible to its author only, moderators included", async () => {
    for (const [name, userId] of everyone()) {
      const n = userId === author ? 1 : 0;
      expect(await rows(userId, sql`select id from community.post where id = ${postId}::uuid`), name).toHaveLength(n);
      expect(await rows(userId, sql`select id from community.post_version where id = ${versionId}::uuid`), name).toHaveLength(n);
    }
  });

  it("posts: only moderators and admins reach the content queue, never for their own content", async () => {
    for (const userId of [author, other, contributor, transport, complaintReviewer]) {
      expect(await pgError(rows(userId, sql`select * from community.content_review_queue(10)`)), userId).toBe("42501");
      expect(
        await pgError(rows(userId, sql`select community.set_content_status('post_version', ${versionId}::uuid, 'published')`)),
        userId,
      ).toBe("42501");
    }
    const queue = await rows(moderator, sql`select id from community.content_review_queue(200)`);
    expect(queue.some((r) => r.id === versionId)).toBe(true);
  });

  it("posts: once a moderator publishes, everyone reads the post; nobody writes it directly", async () => {
    expect(
      (await rows(moderator, sql`select community.set_content_status('post_version', ${versionId}::uuid, 'published') as ok`))[0]!.ok,
    ).toBe(true);
    for (const [name, userId] of everyone()) {
      expect(await rows(userId, sql`select id from community.post where id = ${postId}::uuid`), name).toHaveLength(1);
      if (userId === null) continue;
      expect(await pgError(rows(userId, sql`update community.post set deleted_at = now() where id = ${postId}::uuid`)), name).toBe("42501");
    }
  });

  it("comments: pending comments are the commenter's own until published", async () => {
    commentId = (
      await rows(
        other,
        sql`select * from community.create_comment(${randomUUID()}::uuid, ${postId}::uuid, null, 'Thanks for this.', 'pending', null)`,
      )
    )[0]!.comment_id as string;
    for (const [name, userId] of everyone()) {
      const n = userId === other ? 1 : 0;
      expect(await rows(userId, sql`select id from community.comment where id = ${commentId}::uuid`), name).toHaveLength(n);
    }
    expect(
      await pgError(rows(other, sql`select community.set_content_status('comment', ${commentId}::uuid, 'published')`)),
    ).toBe("42501");
    await rows(moderator, sql`select community.set_content_status('comment', ${commentId}::uuid, 'published')`);
    expect(await rows(null, sql`select id from community.comment where id = ${commentId}::uuid`)).toHaveLength(1);
  });

  it("reactions, bookmarks and blocks are private to the user who made them", async () => {
    await rows(other, sql`select * from community.toggle_reaction('post', ${postId}::uuid)`);
    await rows(other, sql`select community.toggle_bookmark(${postId}::uuid)`);
    await rows(other, sql`select * from community.block_author('post', ${postId}::uuid)`);
    for (const [name, userId] of everyone()) {
      const n = userId === other ? 1 : 0;
      expect(await rows(userId, sql`select 1 from community.reaction where target_id = ${postId}::uuid`), name).toHaveLength(n);
      expect(await rows(userId, sql`select 1 from community.bookmark where post_id = ${postId}::uuid`), name).toHaveLength(n);
      expect(await rows(userId, sql`select 1 from community.user_block where blocked_id = ${author}`), name).toHaveLength(n);
    }
  });

  it("content reports: reporters see their own; only moderators/admins see the queue, without reporter ids", async () => {
    expect((await rows(other, sql`select community.report_content('post', ${postId}::uuid, 'spam', null) as ok`))[0]!.ok).toBe(true);
    for (const [name, userId] of everyone()) {
      const n = userId === other ? 1 : 0;
      expect(await rows(userId, sql`select id from community.content_report where target_id = ${postId}::uuid`), name).toHaveLength(n);
    }
    for (const userId of [author, other, contributor, transport, complaintReviewer]) {
      expect(await pgError(rows(userId, sql`select * from community.report_queue(10)`)), userId).toBe("42501");
    }
    const queue = await rows(moderator, sql`select * from community.report_queue(200)`);
    const mine = queue.find((r) => r.target_id === postId);
    expect(mine).toBeDefined();
    expect(Object.keys(mine!)).not.toContain("reporter_id");
  });

  it("0020: a moderator never sees or resolves reports on their own content", async () => {
    await rows(other, sql`select community.report_content('post', ${modPostId}::uuid, 'off_topic', null)`);
    const own = await rows(moderator, sql`select id, target_id from community.report_queue(200)`);
    expect(own.some((r) => r.target_id === modPostId)).toBe(false);
    const theirs = await rows(moderator2, sql`select id, target_id from community.report_queue(200)`);
    const report = theirs.find((r) => r.target_id === modPostId);
    expect(report).toBeDefined();
    expect(await pgError(rows(moderator, sql`select community.resolve_report(${report!.id as string}::uuid, 'dismissed')`))).toBe("42501");
    expect((await rows(moderator2, sql`select community.resolve_report(${report!.id as string}::uuid, 'dismissed') as ok`))[0]!.ok).toBe(true);
  });

  it("no community role reaches priv", async () => {
    for (const userId of [moderator, transport, admin]) {
      expect(await rows(userId, sql`select id from priv.complaint`)).toHaveLength(0);
    }
  });
});
