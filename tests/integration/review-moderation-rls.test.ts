// Corrections review (C9) and community moderation (C10), N6, migration 0025, against a migrated
// Neon branch:
//   bash scripts/with-neon-branch.sh pnpm vitest run --project integration tests/integration/review-moderation-rls.test.ts
// Role matrix on every new definer function (guest, commuter, moderator, transport reviewer,
// complaint reviewer, admin), the app role's lack of any direct path to decisions and Jev evidence,
// and the acceptance checks through the real functions:
//   AC-13  a stop report accepted with a relocation lands in the open draft only; the public stop
//          does not move until the draft is validated and published, which incorporates it; a fare
//          report is an accepted proposal that names the fare rule version (traceable) and changes
//          nothing; request-info and reject leave a templated reason the reporter can read.
//   AC-11  stored states from recorded Jev answers (publish pending, spam/threat rejected, unclear
//          pending), edits as new pending versions while the live one stays, a photo public only
//          after approval.
//   AC-12  criticism stays pending while a threat is rejected; overriding Jev needs a note and is
//          audited; appeals go to a different moderator (function and CHECK constraint), once.
// Puts the previously published revision back at the end.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validationFactsSchema } from "@/domain/admin/schemas";
import { validateRevision } from "@/domain/admin/validation";
import { DEFAULT_FLAGS, decideModeration } from "@/domain/moderation/policy";
import { runInRequestContext, type Db } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Obj = Record<string, unknown>;

describe.skipIf(!ownerUrl || !appUrl || !importUrl)("corrections review and moderation (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const author = `test-auth6-${run}`;
  const other = `test-oth6-${run}`;
  const reviewer = `test-trev6-${run}`;
  const reviewerAuthor = `test-trva6-${run}`;
  const admin = `test-adm6-${run}`;
  const moderator = `test-mod6-${run}`;
  const moderator2 = `test-mod6b-${run}`;
  const complaintReviewer = `test-crev6-${run}`;
  const requestId = `n6-${run}`;
  const routeCode = `N6-${run}`.toUpperCase();
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;
  let previous: string | null = null;
  let base = "";
  let s1 = "";
  let s1v = "";
  let fareVersion = "";

  const as = <T>(userId: string | null, fn: (db: Db) => Promise<T>, opts: { stepUp?: boolean } = {}) =>
    runInRequestContext<T>(app, { userId, requestId }, async (db) => {
      if (opts.stepUp) await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return fn(db);
    });
  const rows = async (userId: string | null, query: ReturnType<typeof sql>, opts: { stepUp?: boolean } = {}) =>
    (await as(userId, async (db) => (await db.execute(query)).rows, opts)) as Obj[];
  const value = async <T = unknown>(userId: string | null, query: ReturnType<typeof sql>, opts: { stepUp?: boolean } = {}) =>
    Object.values((await rows(userId, query, opts))[0] as object)[0] as T;
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
  const audits = async () => (await owner.query<{ action: string; after: Obj | null }>("select action, after from core.audit_event where request_id = $1 order by at, id", [requestId])).rows;

  /** A verified upload of `purpose` owned by `userId`, through the same definer functions the server uses. */
  const media = async (userId: string, purpose: string) => {
    const slot = (await rows(userId, sql`select id from core.create_media_slot(${purpose}, 1000, 'image/jpeg')`))[0]!.id as string;
    await rows(userId, sql`select core.verify_and_promote_media(${slot}::uuid, 'evidence-private', ${`${purpose}/${slot}.jpeg`}, ${sha(slot)}, 1000, 'image/jpeg')`);
    return slot;
  };
  const correction = (userId: string, kind: string, entityType: string, entityId: string, opts: { lat?: number; lng?: number; media?: string[] } = {}) =>
    value<string>(
      userId,
      sql`select id from community.submit_correction(${randomUUID()}::uuid, ${kind}, ${entityType}, ${entityId}, 'Test entity',
            'Something about this is not right here.', ${opts.lat ?? null}::double precision, ${opts.lng ?? null}::double precision,
            ${opts.lat ? 6 : null}::numeric, ${`{${(opts.media ?? []).join(",")}}`}::uuid[], 'auto_publish_disabled')`,
    );
  const review = (userId: string, id: string, expected: string, action: string, o: { reason?: string; note?: string; dup?: string; version?: string; fare?: string } = {}) =>
    value<Obj>(
      userId,
      sql`select community.admin_review_correction(${id}::uuid, ${expected}, ${action}, ${o.reason ?? null}, ${o.note ?? null},
            ${o.dup ?? null}::uuid, ${o.version ?? null}::uuid, ${o.fare ?? null}::uuid) as r`,
    );
  const queue = async (userId: string, scope = "open") => (await value<{ draft: Obj | null; corrections: Obj[] }>(userId, sql`select community.admin_corrections(${scope}, 200) as d`));
  const post = async (userId: string, status: string, reason: string, title = "A test title here") =>
    (await rows(userId, sql`select * from community.create_post(${randomUUID()}::uuid, 'commute_tips', ${title}, 'A test body that is long enough.', '{}'::text[], null, ${status}, ${reason})`))[0]!;
  const evidence = (userId: string, type: string, id: string, rec: string | null, conf: number | null, unavailable: string | null = null) =>
    rows(userId, sql`select community.record_jev_evidence(${type}, ${id}::uuid, ${rec}, ${conf}::numeric, ${unavailable}, 'paranaga-community-v1', 'typesafe/jev-1.13-20260917')`);
  const modQueue = async (userId: string) => value<{ items: Obj[]; appeals: Obj[]; history: Obj[] }>(userId, sql`select community.admin_moderation_queue(200) as d`);
  const moderate = (userId: string, type: string, id: string, outcome: string, reason: string, note: string | null = null, bucket: string | null = null) =>
    value<Obj>(userId, sql`select community.admin_moderate(${type}, ${id}::uuid, ${outcome}, ${reason}, ${note}, ${bucket}) as r`);
  const guestTitle = async (postId: string) =>
    ((await rows(null, sql`select v.title from community.post p join community.post_version v on v.id = p.published_version_id where p.id = ${postId}::uuid`))[0]?.title as string | undefined) ?? null;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [author, ["commuter"]],
      [other, ["commuter"]],
      [reviewer, ["commuter", "transport_reviewer"]],
      [reviewerAuthor, ["commuter", "transport_reviewer"]],
      [admin, ["commuter", "admin"]],
      [moderator, ["commuter", "community_moderator"]],
      [moderator2, ["commuter", "community_moderator"]],
      [complaintReviewer, ["commuter", "complaint_reviewer"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("update transit.revision set status = 'superseded' where status in ('draft', 'validating')");
    await owner.query("commit");

    // A small published base: two candidate stops and one jeepney fare rule, as the importer writes it.
    previous = await pointer();
    const q = (text: string, params: unknown[] = []) => importer.query(text, params);
    const rev = (await q("insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id", [`n6-${run}-base`])).rows[0].id;
    await q("insert into transit.route (public_code, name, mode) values ($1, 'N6 test route', 'jeepney')", [routeCode]);
    for (const [name, lon, lat] of [["N6 Plaza", 123.1846726, 13.6233869], ["N6 Cathedral", 123.1897, 13.6261]] as const) {
      const sp = (await q("insert into transit.stop_point (name) values ($1) returning id", [`${name} ${run}`])).rows[0].id;
      const spv = (await q(
        "insert into transit.stop_point_version (stop_point_id, geog) values ($1, extensions.ST_SetSRID(extensions.ST_MakePoint($2::float8, $3::float8), 4326)::extensions.geography) returning id",
        [sp, lon, lat],
      )).rows[0].id;
      await q("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'stop_point', $2, $3)", [rev, sp, spv]);
      if (!s1) {
        s1 = sp;
        s1v = spv;
      }
    }
    const fr = (await q("insert into transit.fare_rule (code, mode_code) values ($1, 'jeepney') returning id", [`FN6${run}`])).rows[0].id;
    fareVersion = (await q("insert into transit.fare_rule_version (fare_rule_id, base_centavos, base_km, status, source_codes) values ($1, 1300, 4, 'draft', '{S40}') returning id", [fr])).rows[0].id;
    await q("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'fare_rule', $2, $3)", [rev, fr, fareVersion]);
    await q("select transit.publish_revision($1)", [rev]);
    base = rev;
  }, 120_000);

  afterAll(async () => {
    if (previous && importer && (await pointer()) !== previous) await importer.query("select transit.publish_revision($1)", [previous]);
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  // ================================================================ role matrix
  it("matrix: corrections functions refuse guests, commuters, moderators and complaint reviewers; moderation functions refuse guests, commuters, transport reviewers and complaint reviewers (42501)", async () => {
    const x = randomUUID();
    const correctionCalls = [
      sql`select community.admin_corrections('open', 10)`,
      sql`select community.admin_review_correction(${x}::uuid, 'submitted', 'start_review', null, null, null, null, null)`,
    ];
    const moderationCalls = [
      sql`select community.admin_moderation_queue(10)`,
      sql`select community.admin_moderate('comment', ${x}::uuid, 'published', 'meets_guidelines', null, null)`,
      sql`select community.admin_resolve_appeal(${x}::uuid, 'upheld', 'note', null)`,
    ];
    for (const userId of [null, author, moderator, complaintReviewer]) {
      for (const q of correctionCalls) expect((await failure(rows(userId, q))).code, String(userId)).toBe("42501");
    }
    for (const userId of [null, author, reviewer, complaintReviewer]) {
      for (const q of moderationCalls) expect((await failure(rows(userId, q))).code, String(userId)).toBe("42501");
    }
    expect(Array.isArray((await queue(admin)).corrections)).toBe(true);
    expect(Array.isArray((await modQueue(admin)).items)).toBe(true);
  });

  it("the app role has no direct path: helpers, Jev evidence, decisions and photo decisions are refused", async () => {
    const x = randomUUID();
    for (const q of [
      sql`select community.assert_moderator()`,
      sql`select community.assert_correction_reviewer()`,
      sql`select * from community.content_target('comment', ${x}::uuid)`,
      sql`select community.apply_content_outcome('comment', ${x}::uuid, 'published', 'x', null)`,
      sql`select count(*) from community.jev_evidence`,
      sql`select count(*) from community.moderation_decision`,
      sql`insert into community.moderation_decision (target_type, target_id, author_id, outcome, decided_by, decider_role, reason_code) values ('comment', ${x}::uuid, 'a', 'published', 'b', 'admin', 'meets_guidelines')`,
      sql`update community.post_photo set moderation_status = 'published'`,
      sql`update community.correction set status = 'accepted'`,
      sql`insert into community.appeal (decision_id, target_type, target_id, author_id, note, original_decider) values (${x}::uuid, 'comment', ${x}::uuid, 'a', 'long enough note', 'b')`,
    ]) {
      expect((await failure(rows(admin, q))).code).toBe("42501");
    }
  });

  // ================================================================ C9 corrections (AC-13)
  it("AC-13: review in the draft only; nothing public changes until publication, which incorporates the stop change; fares stay traceable", async () => {
    const photo = await media(author, "correction_evidence");
    const stopReport = await correction(author, "stop_moved_removed", "stop", s1, { lat: 13.62355, lng: 123.18485, media: [photo] });
    const fareReport = await correction(author, "fare_mismatch", "fare", routeCode);
    const infoReport = await correction(author, "other", "stop", s1);
    const rejectReport = await correction(other, "other", "route", routeCode);
    const ownReport = await correction(reviewerAuthor, "other", "stop", s1);

    // The queue: evidence, the stop, the fare rules with their sources; never the reviewer's own report.
    const q = await queue(reviewer);
    const item = q.corrections.find((c) => c.id === stopReport)!;
    expect(item).toMatchObject({ status: "submitted", entityType: "stop", media: [{ id: photo, mime: "image/jpeg" }] });
    expect(item.stop).toMatchObject({ stopPointId: s1, versionId: s1v, inDraft: false, changedInDraft: false });
    expect((item.location as Obj).lat).toBeCloseTo(13.62355, 5);
    expect((item.similar as Obj[]).map((s) => s.id)).toEqual(expect.arrayContaining([infoReport, ownReport]));
    const fares = q.corrections.find((c) => c.id === fareReport)!.fares as Obj[];
    expect(fares).toEqual([expect.objectContaining({ versionId: fareVersion, baseCentavos: 1300, sourceCodes: ["S40"], openConflicts: 0 })]);
    expect((await queue(reviewerAuthor)).corrections.some((c) => c.id === ownReport)).toBe(false);
    expect((await failure(review(reviewerAuthor, ownReport, "submitted", "start_review"))).code).toBe("42501");

    // Private evidence: the reviewer may read the photo (audited); a moderator or the public may not.
    expect(await rows(reviewer, sql`select * from core.admin_review_media(${photo}::uuid)`)).toEqual([
      { bucket: "evidence-private", object_key: `correction_evidence/${photo}.jpeg`, mime: "image/jpeg" },
    ]);
    for (const userId of [null, other, moderator]) expect((await failure(rows(userId, sql`select * from core.admin_review_media(${photo}::uuid)`))).code).toBe("42501");

    // Stale page, wrong transition, templated reasons only.
    expect((await failure(review(reviewer, stopReport, "under_review", "start_review"))).code).toBe("55000");
    expect((await failure(review(reviewer, stopReport, "submitted", "accept"))).code).toBe("55000");
    expect((await failure(review(reviewer, infoReport, "submitted", "request_info", { reason: "spam" }))).code).toBe("22023");
    expect(await review(reviewer, stopReport, "submitted", "start_review")).toMatchObject({ status: "under_review" });
    expect(await review(reviewer, fareReport, "submitted", "start_review")).toMatchObject({ status: "under_review" });
    expect(await review(reviewer, infoReport, "submitted", "request_info", { reason: "need_photo", note: "reviewer-only note" })).toMatchObject({ status: "needs_evidence" });
    expect(await review(admin, rejectReport, "submitted", "reject", { reason: "out_of_scope" })).toMatchObject({ status: "rejected" });

    // The reporter sees the status and the templated reason; never the reviewer's identity is needed.
    const own = await rows(author, sql`select e.to_status, e.reason_code, e.actor_role from community.correction_event e where e.correction_id = ${infoReport}::uuid order by e.at`);
    expect(own.at(-1)).toEqual({ to_status: "needs_evidence", reason_code: "need_photo", actor_role: "transport_reviewer" });
    expect(await rows(other, sql`select id from community.correction where id = ${infoReport}::uuid`)).toEqual([]);

    // Accept needs an open draft; then the change is a new stop version in that draft only.
    expect((await failure(review(reviewer, stopReport, "under_review", "accept", { note: "x" }))).message).toMatch(/no draft revision is open/);
    const draft = await value<string>(reviewer, sql`select transit.admin_create_draft() as id`);
    expect((await failure(review(reviewer, stopReport, "under_review", "accept", { version: s1v }))).message).toMatch(/already published/);
    expect((await failure(review(reviewer, stopReport, "under_review", "accept"))).message).toMatch(/proposal needs a note/);
    const moved = await as(reviewer, async (db) => {
      const v = (await db.execute(sql`select transit.admin_relocate_stop(${s1}::uuid, ${s1v}::uuid, 13.62355::float8, 123.18485::float8, 'Commuter correction') as v`)).rows[0]!.v as string;
      await db.execute(sql`select community.admin_review_correction(${stopReport}::uuid, 'under_review', 'accept', null, null, null, ${v}::uuid, null)`);
      return v;
    });
    const accepted = (await rows(author, sql`select status, draft_revision_id, draft_change from community.correction where id = ${stopReport}::uuid`))[0]!;
    expect(accepted).toMatchObject({ status: "accepted", draft_revision_id: draft, draft_change: { kind: "draft_version", entityKind: "stop_point", versionId: moved } });
    expect((await queue(reviewer)).corrections.find((c) => c.id === infoReport)!.stop).toMatchObject({ inDraft: true, changedInDraft: true, versionId: moved });

    // The fare report: a proposal naming the fare rule version it is about; nothing about fares changes.
    expect(await review(reviewer, fareReport, "under_review", "accept", { note: "Base fare seen at ₱15", fare: fareVersion })).toMatchObject({
      status: "accepted",
      draftChange: { kind: "proposal", fareRuleVersionId: fareVersion },
    });

    // AC-13: the public stop has not moved; the fare rule is unchanged.
    const lat = async () => Number((await rows(null, sql`select lat from transit.v_published_stops where stop_point_id = ${s1}::uuid`))[0]!.lat);
    expect(await lat()).toBeCloseTo(13.6233869, 6);
    expect((await owner.query("select base_centavos from transit.fare_rule_version where id = $1", [fareVersion])).rows[0].base_centavos).toBe(1300);
    expect(await pointer()).toBe(base);

    // Validate and publish the draft: the stop moves, the stop report becomes incorporated, the proposal stays accepted.
    const facts = validationFactsSchema.parse(await value(reviewer, sql`select transit.admin_validation_facts(${draft}::uuid) as f`));
    const report = validateRevision(facts);
    expect(report.ok).toBe(true);
    await as(reviewer, (db) => db.execute(sql`select transit.admin_record_validation(${draft}::uuid, ${facts.membershipHash}, ${JSON.stringify(report)}::jsonb)`));
    await rows(admin, sql`select transit.admin_publish_revision(${draft}::uuid, ${base}::uuid, 'publish')`, { stepUp: true });
    expect(await lat()).toBeCloseTo(13.62355, 5);
    const after = await rows(author, sql`select id, status, incorporated_revision_id from community.correction where id in (${stopReport}::uuid, ${fareReport}::uuid) order by status`);
    expect(after).toEqual([
      { id: fareReport, status: "accepted", incorporated_revision_id: null },
      { id: stopReport, status: "incorporated", incorporated_revision_id: draft },
    ]);
    const events = await rows(author, sql`select to_status, actor_role from community.correction_event where correction_id = ${stopReport}::uuid order by at`);
    expect(events.map((e) => e.to_status)).toEqual(["submitted", "under_review", "accepted", "incorporated"]);
    expect(events.at(-1)!.actor_role).toBe("publication");

    const a = await audits();
    const reviews = a.filter((r) => r.action === "correction.review");
    expect(reviews.length).toBe(6);
    expect(reviews.some((r) => (r.after?.draft_change as Obj | undefined)?.fareRuleVersionId === fareVersion)).toBe(true);
    expect(a.some((r) => r.action === "media.review_view")).toBe(true);
    expect(a.map((r) => r.action)).toEqual(expect.arrayContaining(["revision.draft_create", "stop.relocate", "revision.validate", "revision.publish"]));
  }, 120_000);

  // ================================================================ C10 moderation (AC-11, AC-12)
  it("AC-11: recorded Jev answers become the stored states; the queue shows the evidence; your own content never reaches you", async () => {
    const tip = await post(author, "pending", "auto_publish_disabled", "Tip from the recorded fixture");
    await evidence(author, "post_version", tip.version_id as string, "publish", 0.93);
    const spam = await post(author, "rejected", "jev_high_certainty_reject", "Spam from the recorded fixture");
    await evidence(author, "post_version", spam.version_id as string, "reject", 0.99);
    const unclear = await post(author, "pending", "needs_human_review", "Unclear from the recorded fixture");
    await evidence(author, "post_version", unclear.version_id as string, "human_review", 0.58);
    const down = await post(author, "pending", "jev_unavailable", "Outage from the recorded fixture");
    await evidence(author, "post_version", down.version_id as string, null, null, "server_error");
    // Evidence is only for the caller's own, fresh content, once.
    expect((await failure(evidence(other, "post_version", tip.version_id as string, "publish", 0.99))).code).toBe("P0002");
    expect((await rows(author, sql`select community.record_jev_evidence('post_version', ${tip.version_id as string}::uuid, 'reject', 0.99, null, 'v', 'm') as ok`))[0]!.ok).toBe(false);
    const mine = await post(moderator, "pending", "auto_publish_disabled", "The moderator's own post");

    const items = (await modQueue(moderator)).items;
    const byId = (id: unknown) => items.find((i) => i.id === id);
    expect(byId(tip.version_id)).toMatchObject({ kind: "post_version", status: "pending", jev: { recommendation: "publish", confidence: 0.93 } });
    expect(byId(unclear.version_id)).toMatchObject({ jev: { recommendation: "human_review" } });
    expect(byId(down.version_id)).toMatchObject({ jev: { recommendation: null, unavailableReason: "server_error" } });
    expect(byId(spam.version_id)).toBeUndefined(); // rejected by policy, not waiting
    expect(byId(mine.version_id)).toBeUndefined();
    expect((await failure(moderate(moderator, "post_version", mine.version_id as string, "published", "meets_guidelines"))).code).toBe("42501");
    expect((await modQueue(moderator2)).items.find((i) => i.id === mine.version_id)).toBeTruthy();

    // Nothing pending is public.
    for (const p of [tip, unclear, down, spam]) expect(await guestTitle(p.post_id as string)).toBeNull();
    expect(await moderate(moderator, "post_version", tip.version_id as string, "published", "meets_guidelines")).toMatchObject({ isOverride: false });
    expect(await guestTitle(tip.post_id as string)).toBe("Tip from the recorded fixture");
    expect((await failure(moderate(moderator2, "post_version", tip.version_id as string, "rejected", "spam"))).code).toBe("55000");

    // Edits are re-reviewed: a new pending version; the live one stays until it is approved.
    const edit = (await rows(author, sql`select * from community.edit_post(${tip.post_id as string}::uuid, ${randomUUID()}::uuid, 'Tip, edited by the author', 'A test body that is long enough, edited.', '{}'::text[], 'pending', 'auto_publish_disabled')`))[0]!;
    expect(edit).toMatchObject({ status: "pending", is_live: false });
    expect(await guestTitle(tip.post_id as string)).toBe("Tip from the recorded fixture");
    expect((await modQueue(moderator2)).items.find((i) => i.id === edit.version_id)).toMatchObject({ isEdit: true, liveTitle: "Tip from the recorded fixture" });
    await moderate(moderator2, "post_version", edit.version_id as string, "published", "meets_guidelines");
    expect(await guestTitle(tip.post_id as string)).toBe("Tip, edited by the author");
  });

  it("AC-11: a photo is public only after a moderator approves it, which records the public copy", async () => {
    const p = await post(author, "pending", "auto_publish_disabled", "Post with a photo");
    await moderate(moderator, "post_version", p.version_id as string, "published", "meets_guidelines");
    const m = await media(author, "community_photo");
    expect((await failure(rows(other, sql`select community.add_post_photos(${p.post_id as string}::uuid, ${`{${m}}`}::uuid[])`))).code).toBe("P0002");
    const wrongPurpose = await media(author, "correction_evidence");
    expect((await failure(rows(author, sql`select community.add_post_photos(${p.post_id as string}::uuid, ${`{${wrongPurpose}}`}::uuid[])`))).code).toBe("22023");
    expect(await value(author, sql`select community.add_post_photos(${p.post_id as string}::uuid, ${`{${m}}`}::uuid[])`)).toBe(1);
    const photoId = (await rows(author, sql`select id, moderation_status from community.post_photo where post_id = ${p.post_id as string}::uuid`))[0]!;
    expect(photoId.moderation_status).toBe("pending");
    expect(await rows(null, sql`select id from community.post_photo where id = ${photoId.id as string}::uuid`)).toEqual([]);
    expect(await rows(other, sql`select id from community.post_photo where id = ${photoId.id as string}::uuid`)).toEqual([]);

    // The moderator sees it (private stream, audited); approval without the public bucket is refused.
    expect((await modQueue(moderator)).items.find((i) => i.id === photoId.id)).toMatchObject({ kind: "photo", mediaId: m });
    expect(await rows(moderator, sql`select bucket from core.admin_review_media(${m}::uuid)`)).toEqual([{ bucket: "evidence-private" }]);
    expect((await failure(rows(reviewer, sql`select * from core.admin_review_media(${m}::uuid)`))).code).toBe("42501");
    expect((await failure(moderate(moderator, "photo", photoId.id as string, "published", "meets_guidelines"))).code).toBe("22023");
    const r = await moderate(moderator, "photo", photoId.id as string, "published", "meets_guidelines", null, "public-media");
    expect(r.copy).toEqual({ sourceBucket: "evidence-private", key: `community_photo/${m}.jpeg`, mime: "image/jpeg", publicBucket: "public-media" });
    expect(await rows(null, sql`select public_bucket, public_key from community.post_photo where id = ${photoId.id as string}::uuid`)).toEqual([
      { public_bucket: "public-media", public_key: `community_photo/${m}.jpeg` },
    ]);
  });

  it("AC-12: criticism stays pending while a threat is rejected; overriding Jev needs a note and is audited", async () => {
    const sample = JSON.parse(readFileSync("tests/fixtures/jev/labelled-sample.json", "utf8")) as { items: { id: string; recorded: { recommendation: "publish" | "reject" | "human_review"; confidence: number } }[] };
    const decide = (id: string) => {
      const rec = sample.items.find((i) => i.id === id)!.recorded;
      return { rec, d: decideModeration({ kind: "community", jev: { status: "ok", verdict: rec }, flags: DEFAULT_FLAGS }) };
    };
    const criticism = decide("c04"); // harsh criticism Jev leaned to reject at 0.84
    const threat = decide("t01");
    const c = await post(author, criticism.d.status, criticism.d.reason, "Harsh criticism of the fare increase");
    await evidence(author, "post_version", c.version_id as string, criticism.rec.recommendation, criticism.rec.confidence);
    const t = await post(author, threat.d.status, threat.d.reason, "A threat against a driver");
    await evidence(author, "post_version", t.version_id as string, threat.rec.recommendation, threat.rec.confidence);
    const stored = async (versionId: unknown) => (await rows(author, sql`select moderation_status from community.post_version where id = ${versionId as string}::uuid`))[0]!.moderation_status;
    expect(await stored(c.version_id)).toBe("pending");
    expect(await stored(t.version_id)).toBe("rejected");

    // Publishing what Jev would reject is an override: refused without a note, audited with one.
    expect((await failure(moderate(moderator, "post_version", c.version_id as string, "published", "meets_guidelines"))).message).toMatch(/needs a note/);
    expect(await moderate(moderator, "post_version", c.version_id as string, "published", "meets_guidelines", "Criticism of a policy, not abuse.")).toMatchObject({ isOverride: true });
    // Rejecting what Jev would publish is an override too.
    const praise = await post(author, "pending", "auto_publish_disabled", "Looks fine to Jev");
    await evidence(author, "post_version", praise.version_id as string, "publish", 0.9);
    expect(await moderate(moderator, "post_version", praise.version_id as string, "rejected", "personal_info", "Names a private person.")).toMatchObject({ isOverride: true });
    const a = await audits();
    const overrides = a.filter((r) => r.action === "community.override");
    expect(overrides.length).toBeGreaterThanOrEqual(2);
    expect(overrides[0]!.after).toMatchObject({ is_override: true, jev_recommendation: "reject" });
  });

  it("AC-12: appeals go to a different moderator (function, queue and CHECK constraint), once per item; overturning a policy decision is an audited override", async () => {
    // A moderator's rejection, appealed.
    const p = await post(author, "pending", "auto_publish_disabled", "Rejected by a moderator");
    await moderate(moderator, "post_version", p.version_id as string, "rejected", "off_topic");
    expect((await failure(rows(other, sql`select community.submit_appeal('post_version', ${p.version_id as string}::uuid, 'I think this was on topic.')`))).code).toBe("P0002");
    const appeal = await value<string>(author, sql`select community.submit_appeal('post_version', ${p.version_id as string}::uuid, 'It was about the route, please look again.')`);
    expect((await failure(rows(author, sql`select community.submit_appeal('post_version', ${p.version_id as string}::uuid, 'Second try at an appeal here.')`))).code).toBe("23505");
    expect(await rows(author, sql`select status from community.appeal where id = ${appeal}::uuid`)).toEqual([{ status: "open" }]);
    expect(await rows(other, sql`select status from community.appeal where id = ${appeal}::uuid`)).toEqual([]);

    expect((await modQueue(moderator)).appeals.some((x) => x.id === appeal)).toBe(false);
    expect((await modQueue(moderator2)).appeals.find((x) => x.id === appeal)).toMatchObject({ decidedBy: "moderator", reasonCode: "off_topic" });
    expect((await failure(rows(moderator, sql`select community.admin_resolve_appeal(${appeal}::uuid, 'upheld', 'My own decision stands.', null)`))).code).toBe("42501");
    // The table refuses it too, whoever writes.
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    const check = await owner
      .query("update community.appeal set status = 'upheld', resolved_by = original_decider, resolved_at = now(), resolution_decision_id = decision_id where id = $1", [appeal])
      .then(() => null, (e: { code?: string }) => e.code);
    await owner.query("rollback");
    expect(check).toBe("23514");

    expect(await value<Obj>(moderator2, sql`select community.admin_resolve_appeal(${appeal}::uuid, 'overturned', 'On topic: it is about the route.', null) as r`)).toMatchObject({ isOverride: false });
    expect(await guestTitle(p.post_id as string)).toBe("Rejected by a moderator");
    expect(await rows(author, sql`select status from community.appeal where id = ${appeal}::uuid`)).toEqual([{ status: "overturned" }]);
    expect((await failure(rows(moderator2, sql`select community.admin_resolve_appeal(${appeal}::uuid, 'upheld', 'again', null)`))).code).toBe("55000");

    // A policy (Jev) rejection, appealed: any moderator may decide; overturning it is an override.
    const j = await post(author, "rejected", "jev_high_certainty_reject", "Rejected by the policy");
    await evidence(author, "post_version", j.version_id as string, "reject", 0.96);
    const jAppeal = await value<string>(author, sql`select community.submit_appeal('post_version', ${j.version_id as string}::uuid, 'This is criticism, not a threat at all.')`);
    expect((await modQueue(moderator)).appeals.find((x) => x.id === jAppeal)).toMatchObject({ decidedBy: "policy", jevRecommendation: "reject" });
    expect(await value<Obj>(moderator, sql`select community.admin_resolve_appeal(${jAppeal}::uuid, 'overturned', 'Criticism of service.', null) as r`)).toMatchObject({ isOverride: true });
    expect(await guestTitle(j.post_id as string)).toBe("Rejected by the policy");

    const actions = (await audits()).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["community.moderate", "community.appeal", "community.appeal_resolve", "community.override", "media.review_view"]));
    const history = (await modQueue(moderator2)).history;
    expect(history.some((h) => h.reasonCode === "appeal_overturned" && h.isOverride === true && h.deciderRole === "community_moderator")).toBe(true);
  });
});
