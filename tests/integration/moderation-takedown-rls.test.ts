// Taking down published content and resolving content reports (migration 0032), against a
// migrated Neon branch:
//   bash scripts/with-neon-branch.sh pnpm exec vitest run --project integration tests/integration/moderation-takedown-rls.test.ts
// Every role (guest, commuter, the author, moderator, admin, transport reviewer, complaint
// reviewer) on the new and changed definer functions; what each of them can read afterwards; an
// appeal that restores the item and a second take-down that can be appealed again; an appeal
// overturned after a later edit was rejected; reports closing together, never one the moderator
// did not see, never over changed content, and reported again after closing; two moderators
// deciding at once; an edit racing a take-down (ERD C3); the helpful
// count under concurrent taps (C4) and a double tap (C5); the two indexes (I1, I2).
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext, type Db } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Obj = Record<string, unknown>;

describe.skipIf(!ownerUrl || !appUrl)("take-down and content reports (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const author = `test-auth32-${run}`;
  const other = `test-oth32-${run}`;
  const third = `test-thr32-${run}`;
  const moderator = `test-mod32-${run}`;
  const moderator2 = `test-mod32b-${run}`;
  const admin = `test-adm32-${run}`;
  const transport = `test-trev32-${run}`;
  const complaintReviewer = `test-crev32-${run}`;
  const tappers = Array.from({ length: 6 }, (_, i) => `test-tap32-${i}-${run}`);
  const requestId = `n32-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;

  const as = <T>(userId: string | null, fn: (db: Db) => Promise<T>) => runInRequestContext<T>(app, { userId, requestId }, fn);
  const rows = async (userId: string | null, query: ReturnType<typeof sql>) => (await as(userId, async (db) => (await db.execute(query)).rows)) as Obj[];
  const value = async <T = unknown>(userId: string | null, query: ReturnType<typeof sql>) => Object.values((await rows(userId, query))[0] as object)[0] as T;
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      return { code: e.cause?.code ?? e.code, message: e.cause?.message ?? e.message ?? "" };
    }
    throw new Error("expected the query to fail");
  };
  const codeOf = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? "ok" : ((r.reason as { cause?: { code?: string }; code?: string }).cause?.code ?? (r.reason as { code?: string }).code ?? "?");
  const audits = async (action: string) =>
    (await owner.query<{ entity_type: string; entity_id: string; after: Obj | null }>("select entity_type, entity_id, after from core.audit_event where request_id = $1 and action = $2 order by at, id", [requestId, action])).rows;

  const post = async (userId: string, title: string, status = "pending") =>
    (await rows(userId, sql`select * from community.create_post(${randomUUID()}::uuid, 'commute_tips', ${title}, 'A test body that is long enough.', '{}'::text[], null, ${status}, 'auto_publish_disabled')`))[0]!;
  const approve = (userId: string, type: string, id: string, bucket: string | null = null) =>
    value<Obj>(userId, sql`select community.admin_moderate(${type}, ${id}::uuid, 'published', 'meets_guidelines', null, ${bucket}) as r`);
  /** A post by `userId`, published by `by`. */
  const livePost = async (userId: string, title: string, by = moderator) => {
    const p = await post(userId, title);
    await approve(by, "post_version", p.version_id as string);
    return { postId: p.post_id as string, versionId: p.version_id as string };
  };
  const liveComment = async (userId: string, postId: string, body: string, by = moderator) => {
    const id = (await rows(userId, sql`select * from community.create_comment(${randomUUID()}::uuid, ${postId}::uuid, null, ${body}, 'pending', null)`))[0]!.comment_id as string;
    await approve(by, "comment", id);
    return id;
  };
  const report = (userId: string, type: string, id: string, reason: string, note: string | null = null) =>
    value<boolean>(userId, sql`select community.report_content(${type}, ${id}::uuid, ${reason}, ${note}) as ok`);
  /** `seen`: the newest report the moderator's page showed ('infinity': all of them; null: none). */
  const takeDown = (userId: string | null, type: string, id: string, reason: string, note: string | null = null, seen: string | null = "infinity") =>
    value<Obj>(userId, sql`select community.admin_take_down(${type}, ${id}::uuid, ${reason}, ${note}, ${seen}::timestamptz) as r`);
  const reportQueue = (userId: string | null) => value<Obj[]>(userId, sql`select community.admin_report_queue(200) as r`);
  const resolve = (userId: string | null, id: string, status: string, contentId: string | null = null, seen: string | null = "infinity") =>
    value<boolean>(userId, sql`select community.resolve_report(${id}::uuid, ${status}, ${seen}::timestamptz, ${contentId}::uuid) as ok`);
  const reject = (userId: string, type: string, id: string) =>
    value<Obj>(userId, sql`select community.admin_moderate(${type}, ${id}::uuid, 'rejected', 'off_topic', null, null) as r`);
  const edit = async (userId: string, postId: string, title: string) =>
    (await rows(userId, sql`select * from community.edit_post(${postId}::uuid, ${randomUUID()}::uuid, ${title}, 'A test body that is long enough, edited.', '{}'::text[], 'pending', 'auto_publish_disabled')`))[0]!.version_id as string;
  const appeal = (userId: string, type: string, id: string) => value<string>(userId, sql`select community.submit_appeal(${type}, ${id}::uuid, 'Please look at this again, it follows the rules.') as id`);
  const resolveAppeal = (userId: string, id: string, outcome: string, bucket: string | null = null) =>
    value<Obj>(userId, sql`select community.admin_resolve_appeal(${id}::uuid, ${outcome}, 'Looked at it again.', ${bucket}) as r`);
  const guestTitle = async (postId: string) =>
    ((await rows(null, sql`select v.title from community.post p join community.post_version v on v.id = p.published_version_id where p.id = ${postId}::uuid`))[0]?.title as string | undefined) ?? null;
  const reportsOn = async (id: string) => (await owner.query<{ status: string; resolved_by: string | null }>("select status, resolved_by from community.content_report where target_id = $1 order by created_at", [id])).rows;
  const media = async (userId: string) => {
    const slot = (await rows(userId, sql`select id from core.create_media_slot('community_photo', 1000, 'image/jpeg')`))[0]!.id as string;
    await rows(userId, sql`select core.verify_and_promote_media(${slot}::uuid, 'evidence-private', ${`community_photo/${slot}.jpeg`}, ${sha(slot)}, 1000, 'image/jpeg')`);
    return slot;
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [author, ["commuter"]],
      [other, ["commuter"]],
      [third, ["commuter"]],
      [moderator, ["commuter", "community_moderator"]],
      [moderator2, ["commuter", "community_moderator"]],
      [admin, ["commuter", "admin"]],
      [transport, ["commuter", "transport_reviewer"]],
      [complaintReviewer, ["commuter", "complaint_reviewer"]],
      ...tappers.map((t) => [t, ["commuter"]] as const),
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 6 });
  }, 120_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("matrix: guests, commuters, transport and complaint reviewers are refused by every moderation function of 0032 (42501); moderators and admins pass", async () => {
    const x = randomUUID();
    for (const userId of [null, author, other, transport, complaintReviewer]) {
      for (const q of [
        sql`select community.admin_take_down('comment', ${x}::uuid, 'spam', null, now())`,
        sql`select community.admin_report_queue(10)`,
        sql`select community.resolve_report(${x}::uuid, 'dismissed', now(), null)`,
      ]) {
        expect((await failure(rows(userId, q))).code, String(userId)).toBe("42501");
      }
    }
    for (const userId of [moderator, admin]) {
      expect(Array.isArray(await reportQueue(userId))).toBe(true);
      expect(await resolve(userId, x, "dismissed")).toBe(false); // no such report
      expect(await failure(takeDown(userId, "comment", x, "spam"))).toMatchObject({ code: "22023", message: "unknown item" });
    }
  });

  it("the app role has no direct path: it cannot stamp a take-down, close a report or call the helpers", async () => {
    const x = randomUUID();
    for (const q of [
      sql`update community.post_version set taken_down_at = now()`,
      sql`update community.comment set taken_down_at = null`,
      sql`update community.post_photo set taken_down_at = now()`,
      sql`update community.content_report set status = 'dismissed'`,
      sql`select * from community.content_target('comment', ${x}::uuid)`,
      sql`select community.apply_content_outcome('comment', ${x}::uuid, 'rejected', 'spam', null)`,
    ]) {
      expect((await failure(rows(admin, q))).code).toBe("42501");
    }
  });

  it("a post: reason rules, never your own, only while published; the take-down hides it, closes its reports as actioned, records a decision that is not a Jev override, and is audited", async () => {
    const p = await livePost(author, "A post that gets reported");
    await rows(author, sql`select community.record_jev_evidence('post_version', ${p.versionId}::uuid, 'publish', 0.91::numeric, null, 'paranaga-community-v1', 'test-model')`);
    const commentId = await liveComment(other, p.postId, "A comment under it.");
    expect(await report(other, "post", p.postId, "spam", "Looks like an advert to me.")).toBe(true);
    expect(await report(third, "post", p.postId, "harassment")).toBe(true);

    // The queue: grouped, with the content, the reasons and the notes, and never who reported.
    const group = (await reportQueue(moderator)).find((r) => r.targetId === p.postId)!;
    expect(group).toMatchObject({
      targetType: "post", postId: p.postId, state: "published", count: 2, reasons: { spam: 1, harassment: 1 },
      notes: ["Looks like an advert to me."], contentKind: "post_version", contentId: p.versionId, title: "A post that gets reported", photos: [],
    });
    expect(JSON.stringify(group)).not.toContain(other);
    expect(JSON.stringify(group)).not.toContain(third);

    // Reason rules and state rules.
    expect((await failure(takeDown(moderator, "post_version", p.versionId, "meets_guidelines"))).code).toBe("22023");
    expect((await failure(takeDown(moderator, "post_version", p.versionId, "other"))).message).toMatch(/needs a note/);
    expect((await failure(takeDown(moderator, "post_version", p.versionId, "spam", "x".repeat(1001)))).code).toBe("22023");
    expect((await failure(takeDown(moderator, "post", p.postId, "spam"))).code).toBe("22023");
    const waiting = await post(author, "Still waiting for review");
    expect(await failure(takeDown(moderator, "post_version", waiting.version_id as string, "spam"))).toMatchObject({ code: "55000", message: expect.stringMatching(/not published/) });
    const mine = await livePost(moderator, "The moderator's own post", moderator2);
    expect(await failure(takeDown(moderator, "post_version", mine.versionId, "spam"))).toMatchObject({ code: "42501", message: "you cannot moderate your own content" });

    const overridesBefore = (await audits("community.override")).length;
    const r = await takeDown(moderator, "post_version", p.versionId, "spam");
    expect(r).toMatchObject({ isOverride: false, reportsClosed: 2, removed: null });

    // Gone for everyone but the author, with its comments; the author sees the stamp.
    expect(await guestTitle(p.postId)).toBeNull();
    for (const userId of [null, other, moderator]) {
      expect(await rows(userId, sql`select id from community.post where id = ${p.postId}::uuid`), String(userId)).toEqual([]);
      expect(await rows(userId, sql`select id from community.post_version where id = ${p.versionId}::uuid`), String(userId)).toEqual([]);
    }
    expect(await rows(null, sql`select id from community.comment where id = ${commentId}::uuid`)).toEqual([]);
    const own = (await rows(author, sql`select v.moderation_status, v.moderation_reason, v.taken_down_at is not null as down, p.published_version_id
                                          from community.post_version v join community.post p on p.id = v.post_id where v.id = ${p.versionId}::uuid`))[0]!;
    expect(own).toEqual({ moderation_status: "rejected", moderation_reason: "spam", down: true, published_version_id: null });

    // Reports: both closed together as actioned; each reporter still sees only their own.
    expect(await reportsOn(p.postId)).toEqual([{ status: "actioned", resolved_by: moderator }, { status: "actioned", resolved_by: moderator }]);
    expect(await rows(other, sql`select status from community.content_report where target_id = ${p.postId}::uuid`)).toEqual([{ status: "actioned" }]);
    expect((await reportQueue(moderator)).some((x) => x.targetId === p.postId)).toBe(false);

    // The decision: a person's, with Jev's stored answer on record but not an override.
    const decision = (await owner.query("select outcome, decided_by, decider_role, reason_code, jev_recommendation, is_override from community.moderation_decision where id = $1", [r.decisionId])).rows[0];
    expect(decision).toEqual({ outcome: "rejected", decided_by: moderator, decider_role: "community_moderator", reason_code: "spam", jev_recommendation: "publish", is_override: false });
    expect((await audits("community.override")).length).toBe(overridesBefore);
    expect((await audits("community.take_down")).at(-1)).toMatchObject({
      entity_type: "community.post_version", entity_id: p.versionId,
      after: { decision_id: r.decisionId, reason_code: "spam", post_id: p.postId, reports_closed: 2, jev_recommendation: "publish" },
    });

    // Not twice, and it can no longer be reported.
    expect(await failure(takeDown(moderator2, "post_version", p.versionId, "off_topic"))).toMatchObject({ code: "55000", message: expect.stringMatching(/already unpublished/) });
    expect((await failure(report(tappers[0]!, "post", p.postId, "spam"))).code).toBe("P0002");
  });

  it("appeals: the author appeals a take-down, another moderator restores it; a second take-down is a new decision and can be appealed once more; an upheld appeal is final", async () => {
    const p = await livePost(author, "Taken down, then restored");
    const commentId = await liveComment(other, p.postId, "Still here after the appeal.");
    await takeDown(moderator, "post_version", p.versionId, "off_topic");

    expect((await failure(appeal(other, "post_version", p.versionId))).code).toBe("P0002");
    const a1 = await appeal(author, "post_version", p.versionId);
    expect((await failure(appeal(author, "post_version", p.versionId))).code).toBe("23505");
    // Routed away from the moderator who took it down.
    const seen = async (userId: string, id: string) => (await value<{ appeals: Obj[] }>(userId, sql`select community.admin_moderation_queue(200) as d`)).appeals.find((x) => x.id === id);
    expect(await seen(moderator, a1)).toBeUndefined();
    expect(await seen(moderator2, a1)).toMatchObject({ decidedBy: "moderator", reasonCode: "off_topic", targetType: "post_version" });
    expect((await failure(resolveAppeal(moderator, a1, "overturned"))).code).toBe("42501");

    expect(await resolveAppeal(moderator2, a1, "overturned")).toMatchObject({ isOverride: false });
    expect(await guestTitle(p.postId)).toBe("Taken down, then restored");
    expect(await rows(null, sql`select id from community.comment where id = ${commentId}::uuid`)).toHaveLength(1);
    expect((await rows(author, sql`select moderation_status, taken_down_at from community.post_version where id = ${p.versionId}::uuid`))[0]).toEqual({ moderation_status: "published", taken_down_at: null });

    // Taken down again, by the other moderator: one more appeal, decided by someone else, final.
    await report(third, "post", p.postId, "misleading");
    expect(await takeDown(moderator2, "post_version", p.versionId, "misleading")).toMatchObject({ reportsClosed: 1 });
    const a2 = await appeal(author, "post_version", p.versionId);
    expect(a2).not.toBe(a1);
    expect((await failure(appeal(author, "post_version", p.versionId))).code).toBe("23505");
    expect((await failure(resolveAppeal(moderator2, a2, "upheld"))).code).toBe("42501");
    await resolveAppeal(moderator, a2, "upheld");
    expect(await guestTitle(p.postId)).toBeNull();
    expect((await failure(appeal(author, "post_version", p.versionId))).code).toBe("23505");
    // The author reads both of their appeals; nobody else reads them.
    expect((await rows(author, sql`select status from community.appeal where target_id = ${p.versionId}::uuid order by created_at`)).map((x) => x.status)).toEqual(["overturned", "upheld"]);
    expect(await rows(other, sql`select status from community.appeal where target_id = ${p.versionId}::uuid`)).toEqual([]);
  });

  it("a newer live version: taking down the superseded one is refused with a plain message; the live one can be taken down", async () => {
    const p = await livePost(author, "First version");
    const edit = (await rows(author, sql`select * from community.edit_post(${p.postId}::uuid, ${randomUUID()}::uuid, 'Second version', 'A test body that is long enough, edited.', '{}'::text[], 'pending', 'auto_publish_disabled')`))[0]!;
    await approve(moderator2, "post_version", edit.version_id as string);
    expect(await failure(takeDown(moderator, "post_version", p.versionId, "spam"))).toMatchObject({ code: "55000", message: expect.stringMatching(/newer version/) });
    expect(await guestTitle(p.postId)).toBe("Second version");
    await takeDown(moderator, "post_version", edit.version_id as string, "spam");
    expect(await guestTitle(p.postId)).toBeNull();
  });

  it("a comment: taken down on its own; the post stays; its reports close; the commenter sees it and can appeal", async () => {
    const p = await livePost(author, "A post with a bad comment");
    const commentId = await liveComment(other, p.postId, "A comment that breaks the rules.");
    await report(author, "comment", commentId, "harassment");
    await report(third, "post", p.postId, "off_topic"); // about the post, not the comment
    expect((await reportQueue(moderator)).find((r) => r.targetId === commentId)).toMatchObject({ targetType: "comment", contentKind: "comment", contentId: commentId, postId: p.postId, count: 1, body: "A comment that breaks the rules." });

    expect(await takeDown(admin, "comment", commentId, "harassment")).toMatchObject({ reportsClosed: 1, removed: null });
    for (const userId of [null, author, third]) expect(await rows(userId, sql`select id from community.comment where id = ${commentId}::uuid`), String(userId)).toEqual([]);
    expect((await rows(other, sql`select moderation_status, taken_down_at is not null as down from community.comment where id = ${commentId}::uuid`))[0]).toEqual({ moderation_status: "rejected", down: true });
    expect(await guestTitle(p.postId)).toBe("A post with a bad comment");
    expect(await reportsOn(commentId)).toEqual([{ status: "actioned", resolved_by: admin }]);
    expect(await reportsOn(p.postId)).toEqual([{ status: "open", resolved_by: null }]);
    expect((await owner.query("select decider_role from community.moderation_decision where target_id = $1 and outcome = 'rejected'", [commentId])).rows).toEqual([{ decider_role: "admin" }]);

    const a = await appeal(other, "comment", commentId);
    await resolveAppeal(moderator, a, "overturned");
    expect(await rows(null, sql`select id from community.comment where id = ${commentId}::uuid`)).toHaveLength(1);
  });

  it("a photo: the row forgets its public copy and names it for deletion after the commit; the private original stays, and an overturned appeal publishes it again", async () => {
    const p = await livePost(author, "A post with a photo");
    const m = await media(author);
    await rows(author, sql`select community.add_post_photos(${p.postId}::uuid, ${`{${m}}`}::uuid[])`);
    const photoId = (await rows(author, sql`select id from community.post_photo where post_id = ${p.postId}::uuid`))[0]!.id as string;
    expect(await failure(takeDown(moderator, "photo", photoId, "unsafe_photo"))).toMatchObject({ code: "55000", message: expect.stringMatching(/not published/) });
    await approve(moderator, "photo", photoId, "public-media");
    expect(await rows(null, sql`select id from community.post_photo where id = ${photoId}::uuid`)).toHaveLength(1);
    await report(other, "post", p.postId, "personal_info", "A face is visible in the photo.");
    expect((await reportQueue(moderator2)).find((r) => r.targetId === p.postId)!.photos).toEqual([{ id: photoId, mediaId: m }]);

    const key = `community_photo/${m}.jpeg`;
    expect(await takeDown(moderator2, "photo", photoId, "unsafe_photo")).toMatchObject({ removed: { bucket: "public-media", key }, reportsClosed: 1, isOverride: false });
    // No read path serves it: guests and other riders get no row; the author sees the state only.
    for (const userId of [null, other]) expect(await rows(userId, sql`select id from community.post_photo where id = ${photoId}::uuid`), String(userId)).toEqual([]);
    expect((await rows(author, sql`select moderation_status, public_bucket, public_key, taken_down_at is not null as down from community.post_photo where id = ${photoId}::uuid`))[0]).toEqual({
      moderation_status: "rejected", public_bucket: null, public_key: null, down: true,
    });
    expect(await guestTitle(p.postId)).toBe("A post with a photo");
    expect(await reportsOn(p.postId)).toEqual([{ status: "actioned", resolved_by: moderator2 }]);
    expect((await owner.query("select status, bucket from core.media_object where id = $1", [m])).rows[0]).toEqual({ status: "verified", bucket: "evidence-private" });

    const a = await appeal(author, "photo", photoId);
    const back = await resolveAppeal(moderator, a, "overturned", "public-media");
    expect(back.copy).toEqual({ sourceBucket: "evidence-private", key, mime: "image/jpeg", publicBucket: "public-media" });
    expect(await rows(null, sql`select public_key from community.post_photo where id = ${photoId}::uuid`)).toEqual([{ public_key: key }]);

    // A post taken down hides its photos too (no row for a guest), though the photo row stays published.
    await takeDown(moderator, "post_version", p.versionId, "personal_info");
    expect(await rows(null, sql`select id from community.post_photo where id = ${photoId}::uuid`)).toEqual([]);
  });

  it("reports: dismissing closes every open report on the item together and is audited; actioned needs the content gone; never on your own content; deleted content can still be closed", async () => {
    const p = await livePost(author, "Reported, but fine");
    await report(other, "post", p.postId, "off_topic");
    await report(third, "post", p.postId, "other", "I just do not like it.");
    const group = (await reportQueue(moderator)).find((r) => r.targetId === p.postId)!;
    const reportId = group.reportId as string;

    expect((await failure(resolve(moderator, reportId, "closed"))).code).toBe("22023");
    expect(await failure(resolve(moderator, reportId, "actioned", p.versionId))).toMatchObject({ code: "55000", message: expect.stringMatching(/still public/) });
    expect((await failure(resolve(moderator, reportId, "dismissed", p.versionId, null))).code).toBe("22023"); // nothing seen
    expect(await resolve(moderator, reportId, "dismissed", p.versionId)).toBe(true);
    expect(await reportsOn(p.postId)).toEqual([{ status: "dismissed", resolved_by: moderator }, { status: "dismissed", resolved_by: moderator }]);
    expect(await guestTitle(p.postId)).toBe("Reported, but fine");
    expect(await resolve(moderator2, reportId, "dismissed")).toBe(false); // already closed
    expect((await audits("community.report_resolve")).at(-1)).toEqual({ entity_type: "community.post", entity_id: p.postId, after: { status: "dismissed", reports_closed: 2 } });
    // The reporter sees the outcome of their own report only.
    expect(await rows(third, sql`select status from community.content_report where target_id = ${p.postId}::uuid`)).toEqual([{ status: "dismissed" }]);

    // A moderator's own content: hidden from their queue, refused when named, open to another moderator.
    const mine = await livePost(moderator, "The moderator's reported post", moderator2);
    await report(other, "post", mine.postId, "spam");
    expect((await reportQueue(moderator)).some((r) => r.targetId === mine.postId)).toBe(false);
    const theirs = (await reportQueue(moderator2)).find((r) => r.targetId === mine.postId)!;
    expect((await failure(resolve(moderator, theirs.reportId as string, "dismissed", mine.versionId))).code).toBe("42501");
    expect(await resolve(moderator2, theirs.reportId as string, "dismissed", mine.versionId)).toBe(true);

    // The author deleted what was reported: no content is shown, and the reports can be closed.
    const gone = await livePost(author, "Deleted by its author");
    await report(other, "post", gone.postId, "misleading");
    await rows(author, sql`select community.delete_post(${gone.postId}::uuid)`);
    const deleted = (await reportQueue(moderator)).find((r) => r.targetId === gone.postId)!;
    expect(deleted).toMatchObject({ state: "deleted", contentId: null, title: null, body: null, count: 1 });
    expect(await resolve(moderator, deleted.reportId as string, "dismissed")).toBe(true);
  });

  it("an appeal of a take-down is overturned after the author's later edit was rejected; an edit still waiting blocks it", async () => {
    const p = await livePost(author, "First, taken down");
    await takeDown(moderator, "post_version", p.versionId, "off_topic");
    const v2 = await edit(author, p.postId, "Second, never published");
    const a = await appeal(author, "post_version", p.versionId);
    // The edit is waiting: it is reviewed on its own first.
    expect(await failure(resolveAppeal(moderator2, a, "overturned"))).toMatchObject({ code: "55000", message: expect.stringMatching(/review the newer version/) });
    await reject(moderator, "post_version", v2);
    expect(await resolveAppeal(moderator2, a, "overturned")).toMatchObject({ isOverride: false });
    expect(await guestTitle(p.postId)).toBe("First, taken down");
    expect((await rows(author, sql`select moderation_status from community.post_version where post_id = ${p.postId}::uuid order by n`)).map((v) => v.moderation_status)).toEqual(["published", "rejected"]);
  });

  it("reports a moderator did not see are never closed: a newer report refuses dismissing and taking down; changed content refuses dismissing; a closed report can be filed again", async () => {
    const p = await livePost(author, "Reported while the moderator reads");
    await report(other, "post", p.postId, "spam");
    const shown = (await reportQueue(moderator)).find((r) => r.targetId === p.postId)!;
    // To the microsecond, as text: exactly the row's created_at.
    expect(shown.lastAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$/);
    expect((await owner.query("select count(*)::int as n from community.content_report where target_id = $1 and created_at = $2::timestamptz", [p.postId, shown.lastAt])).rows[0].n).toBe(1);

    await report(third, "post", p.postId, "harassment", "This one names a person.");
    const unseen = { code: "55000", message: expect.stringMatching(/a new report came in/) };
    expect(await failure(resolve(moderator, shown.reportId as string, "dismissed", p.versionId, shown.lastAt as string))).toMatchObject(unseen);
    expect(await failure(takeDown(moderator, "post_version", p.versionId, "spam", null, shown.lastAt as string))).toMatchObject(unseen);
    expect(await reportsOn(p.postId)).toEqual([{ status: "open", resolved_by: null }, { status: "open", resolved_by: null }]);
    expect(await guestTitle(p.postId)).toBe("Reported while the moderator reads");

    // The content changed under the reports: an approved edit is not what the moderator read.
    const fresh = (await reportQueue(moderator)).find((r) => r.targetId === p.postId)!;
    expect(fresh).toMatchObject({ count: 2, contentId: p.versionId });
    const v2 = await edit(author, p.postId, "Edited after the reports");
    await approve(moderator2, "post_version", v2);
    expect(await failure(resolve(moderator, fresh.reportId as string, "dismissed", p.versionId, fresh.lastAt as string))).toMatchObject({ code: "55000", message: expect.stringMatching(/content changed/) });
    expect(await resolve(moderator, fresh.reportId as string, "dismissed", v2, fresh.lastAt as string)).toBe(true);
    expect((await reportsOn(p.postId)).map((r) => r.status)).toEqual(["dismissed", "dismissed"]);

    // Reported again after closing: the same row, open again, with the new reason; once while it is open.
    expect(await report(other, "post", p.postId, "misleading", "Still wrong after the edit.")).toBe(true);
    expect(await report(other, "post", p.postId, "off_topic")).toBe(false);
    expect((await owner.query("select status, reason, note, resolved_by, resolved_at from community.content_report where target_id = $1 and reporter_id = $2", [p.postId, other])).rows).toEqual([
      { status: "open", reason: "misleading", note: "Still wrong after the edit.", resolved_by: null, resolved_at: null },
    ]);
    const again = (await reportQueue(moderator)).find((r) => r.targetId === p.postId)!;
    expect(again).toMatchObject({ count: 1, reasons: { misleading: 1 }, contentId: v2 });

    // A take-down that saw no report closes none; one that saw them closes them.
    const q = await livePost(author, "Taken down without reading reports");
    await report(other, "post", q.postId, "spam");
    expect(await takeDown(moderator, "post_version", q.versionId, "spam", null, null)).toMatchObject({ reportsClosed: 0 });
    expect(await reportsOn(q.postId)).toEqual([{ status: "open", resolved_by: null }]);
    expect(await takeDown(moderator, "post_version", v2, "misleading", null, again.lastAt as string)).toMatchObject({ reportsClosed: 1 });
  });

  it("decisions and appeals are stamped with the clock, not the start of the transaction", async () => {
    const defaults = (await owner.query<{ table_name: string; column_default: string }>(
      "select table_name, column_default from information_schema.columns where table_schema = 'community' and table_name in ('moderation_decision', 'appeal') and column_name = 'created_at' order by table_name",
    )).rows;
    expect(defaults).toEqual([{ table_name: "appeal", column_default: "clock_timestamp()" }, { table_name: "moderation_decision", column_default: "clock_timestamp()" }]);
  });

  it("concurrency: two moderators taking the same comment down at once make one decision; an author's edit racing a take-down never deadlocks (C3)", async () => {
    const p = await livePost(author, "A post under a race");
    const commentId = await liveComment(other, p.postId, "Two moderators see this at once.");
    await report(author, "comment", commentId, "spam");
    const both = await Promise.allSettled([takeDown(moderator, "comment", commentId, "spam"), takeDown(moderator2, "comment", commentId, "harassment")]);
    expect(both.map(codeOf).sort()).toEqual(["55000", "ok"]);
    expect((await owner.query("select count(*)::int as n from community.moderation_decision where target_id = $1 and outcome = 'rejected'", [commentId])).rows[0].n).toBe(1);
    expect((await reportsOn(commentId)).map((r) => r.status)).toEqual(["actioned"]);

    // The same two rows from both sides, several times: the post row is locked first by both.
    for (let i = 0; i < 4; i++) {
      const q = await livePost(author, `Edit against take-down ${i}`);
      const race = await Promise.allSettled([
        rows(author, sql`select * from community.edit_post(${q.postId}::uuid, ${randomUUID()}::uuid, 'Edited during the race', 'A test body that is long enough, edited.', '{}'::text[], 'pending', 'auto_publish_disabled')`),
        takeDown(moderator, "post_version", q.versionId, "off_topic"),
      ]);
      expect(race.map(codeOf)).toEqual(["ok", "ok"]);
      expect(await guestTitle(q.postId)).toBeNull();
    }
  });

  it("helpful count and bookmark: concurrent taps count every reaction (C4) and a double tap never fails (C5); the indexes of I1 and I2 exist and appeals are no longer unique per item", async () => {
    const p = await livePost(author, "Helpful to many riders");
    const taps = await Promise.allSettled(tappers.map((t) => rows(t, sql`select * from community.toggle_reaction('post', ${p.postId}::uuid)`)));
    expect(taps.map(codeOf)).toEqual(tappers.map(() => "ok"));
    expect((await rows(null, sql`select helpful_count from community.post where id = ${p.postId}::uuid`))[0]!.helpful_count).toBe(tappers.length);
    expect((await owner.query("select count(*)::int as n from community.reaction where target_id = $1", [p.postId])).rows[0].n).toBe(tappers.length);

    const double = await Promise.allSettled([1, 2, 3].map(() => rows(other, sql`select community.toggle_bookmark(${p.postId}::uuid) as on`)));
    expect(double.map(codeOf)).toEqual(["ok", "ok", "ok"]);
    expect((await owner.query("select count(*)::int as n from community.bookmark where post_id = $1 and user_id = $2", [p.postId, other])).rows[0].n).toBeLessThanOrEqual(1);
    const twice = await Promise.allSettled([1, 2].map(() => rows(other, sql`select * from community.toggle_reaction('post', ${p.postId}::uuid)`)));
    expect(twice.map(codeOf)).toEqual(["ok", "ok"]);

    const idx = (await owner.query<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where schemaname = 'community' and tablename in ('reaction', 'content_report', 'appeal')")).rows;
    const def = (name: string) => idx.find((i) => i.indexname === name)?.indexdef ?? "";
    expect(def("reaction_target_idx")).toMatch(/\(target_type, target_id\)$/);
    expect(def("content_report_open_target_idx")).toMatch(/\(target_type, target_id\) WHERE \(status = 'open'::text\)$/);
    expect(def("appeal_target_idx")).toMatch(/^CREATE INDEX /);
    expect(def("appeal_target_uq")).toBe("");
  });
});
