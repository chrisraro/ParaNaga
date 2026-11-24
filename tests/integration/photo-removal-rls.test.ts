// Photos of deleted and taken-down posts (migration 0036), against a migrated Neon branch:
//   bash scripts/with-neon-branch.sh pnpm exec vitest run --project integration tests/integration/photo-removal-rls.test.ts
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext, type Db } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
type Obj = Record<string, unknown>;

describe.skipIf(!ownerUrl || !appUrl)("photo removal (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const author = `test-ph-author-${run}`;
  const mod = `test-ph-mod-${run}`;
  const mod2 = `test-ph-mod2-${run}`;
  const requestId = `n36-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;

  const as = <T>(userId: string | null, fn: (db: Db) => Promise<T>) => runInRequestContext<T>(app, { userId, requestId }, fn);
  const rows = async (userId: string | null, q: ReturnType<typeof sql>) => (await as(userId, async (db) => (await db.execute(q)).rows)) as Obj[];
  const value = async <T = unknown>(userId: string | null, q: ReturnType<typeof sql>) => Object.values((await rows(userId, q))[0] as object)[0] as T;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      return e.cause?.code ?? e.code;
    }
    return "ok";
  };
  /** As the definer role on the owner connection: only to move dates back. */
  const past = async (q: string, params: unknown[]) => {
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query(q, params);
    await owner.query("commit");
  };

  const due = async () =>
    new Map((await rows(null, sql`select id, action from community.photo_removal_due(200, false) union all select id, action from community.photo_removal_due(200, true)`)).map((r) => [r.id as string, r.action as string]));
  const begin = (id: string, action: string, userId: string | null = null) => value<Obj | null>(userId, sql`select community.photo_removal_begin(${id}::uuid, ${action}) as r`);
  const finish = (id: string, action: string, claim: unknown, userId: string | null = null) =>
    value<boolean>(userId, sql`select community.photo_removal_finish(${id}::uuid, ${action}, ${claim as string}::timestamptz) as r`);
  /** Both halves, as the worker does when storage answers; without the claim, for comparing. */
  const apply = async (id: string, action: string) => {
    const step = await begin(id, action);
    if (!step) return null;
    expect(await finish(id, action, step.claim)).toBe(true);
    const { claim: _claim, ...rest } = step;
    void _claim;
    return rest;
  };
  /** As if the worker that began it had died long ago. */
  const expireClaim = (f: Fixture) => past("update community.post_photo set removal_claimed_at = removal_claimed_at - interval '6 minutes' where id = $1", [f.photoId]);
  const takeDown = (type: string, id: string) => value(mod, sql`select community.admin_take_down(${type}, ${id}::uuid, 'spam', null, null)`);
  const appeal = (type: string, id: string) => value<string>(author, sql`select community.submit_appeal(${type}, ${id}::uuid, 'Please look at this again.')`);
  const resolve = (id: string, outcome: string) => value(mod2, sql`select community.admin_resolve_appeal(${id}::uuid, ${outcome}, 'Looked again.', 'public-media')`);
  const exists = async (f: Fixture) =>
    (await owner.query<{ p: boolean; m: boolean }>("select exists (select 1 from community.post_photo where id = $1) p, exists (select 1 from core.media_object where id = $2) m", [f.photoId, f.mediaId])).rows[0];

  type Fixture = { postId: string; versionId: string; photoId: string; mediaId: string; key: string };
  /** A published post with one published photo, uploaded 90 days ago. */
  async function live(): Promise<Fixture> {
    const p = (await rows(author, sql`select * from community.create_post(${randomUUID()}::uuid, 'commute_tips', 'A post with a photo', 'A test body that is long enough.', '{}'::text[], null, 'pending', null)`))[0]!;
    const versionId = p.version_id as string;
    await rows(mod, sql`select community.admin_moderate('post_version', ${versionId}::uuid, 'published', 'meets_guidelines', null, null)`);
    const mediaId = (await rows(author, sql`select id from core.create_media_slot('community_photo', 1000, 'image/jpeg')`))[0]!.id as string;
    const key = `community_photo/${mediaId}.jpeg`;
    await rows(author, sql`select core.verify_and_promote_media(${mediaId}::uuid, 'evidence-private', ${key}, ${createHash("sha256").update(mediaId).digest("hex")}, 1000, 'image/jpeg')`);
    await rows(author, sql`select community.add_post_photos(${p.post_id as string}::uuid, ${`{${mediaId}}`}::uuid[])`);
    const photoId = (await rows(author, sql`select id from community.post_photo where post_id = ${p.post_id as string}::uuid`))[0]!.id as string;
    await rows(mod, sql`select community.admin_moderate('photo', ${photoId}::uuid, 'published', 'meets_guidelines', null, 'public-media')`);
    await asTableOwner("core.media_object", "update core.media_object set created_at = now() - interval '90 days' where id = $1", [mediaId]);
    return { postId: p.post_id as string, versionId, photoId, mediaId, key };
  }
  /** created_at is in no role's update grant: the table owner moves it, forced RLS lifted for this transaction. */
  async function asTableOwner(table: string, q: string, params: unknown[]) {
    await owner.query("begin");
    await owner.query(`alter table ${table} no force row level security`);
    await owner.query(q, params);
    await owner.query(`alter table ${table} force row level security`);
    await owner.query("commit");
  }
  const ageDecisions = (id: string, days: number) =>
    asTableOwner("community.moderation_decision", "update community.moderation_decision set created_at = created_at - make_interval(days => $2::int) where target_id = $1", [id, days]);
  const ageVersions = async (f: Fixture, days: number) => {
    for (const v of (await owner.query("select id from community.post_version where post_id = $1", [f.postId])).rows) await ageDecisions(v.id as string, days);
    await past("update community.post_version set submitted_at = now() - make_interval(days => $2::int), decided_at = now() - make_interval(days => $2::int), taken_down_at = case when taken_down_at is not null then now() - make_interval(days => $2::int) end where post_id = $1", [f.postId, days]);
  };
  const agePhoto = async (f: Fixture, days: number) => {
    await ageDecisions(f.photoId, days);
    await past("update community.post_photo set taken_down_at = now() - make_interval(days => $2::int), decided_at = now() - make_interval(days => $2::int) where id = $1", [f.photoId, days]);
  };
  const ageDelete = (f: Fixture, days: number) => past("update community.post set deleted_at = now() - make_interval(days => $2::int) where id = $1", [f.postId, days]);

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [[author, ["commuter"]], [mod, ["commuter", "community_moderator"]], [mod2, ["commuter", "community_moderator"]]] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 4 });
  }, 120_000);
  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("only the system lists or applies; the app role has no direct path", async () => {
    const f = await live();
    for (const userId of [author, mod]) {
      expect(await code(rows(userId, sql`select * from community.photo_removal_due(10, true)`))).toBe("42501");
      expect(await code(begin(f.photoId, "purge", userId))).toBe("42501");
      expect(await code(finish(f.photoId, "purge", new Date().toISOString(), userId))).toBe("42501");
    }
    for (const q of [
      sql`delete from community.post_photo where id = ${f.photoId}::uuid`,
      sql`delete from core.media_object where id = ${f.mediaId}::uuid`,
      sql`update community.post_photo set public_copy = 'removed'`,
      sql`select community.photo_action(${f.photoId}::uuid)`,
    ]) expect(await code(rows(null, q))).toBe("42501");
  });

  it("a live photo is never due, whatever its age", async () => {
    const f = await live();
    await ageVersions(f, 400);
    expect((await due()).has(f.photoId)).toBe(false);
    for (const action of ["purge", "remove", "restore", "other"]) expect(await apply(f.photoId, action)).toBeNull();
    expect(await exists(f)).toEqual({ p: true, m: true });
    // The definer role itself cannot delete it either (policies).
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    expect((await owner.query("delete from community.post_photo where id = $1", [f.photoId])).rowCount).toBe(0);
    expect((await owner.query("delete from core.media_object where id = $1", [f.mediaId])).rowCount).toBe(0);
    await owner.query("rollback");
  });

  it("a deleted post: the copy at once, everything after 30 days; an appeal left open does not block", async () => {
    const f = await live();
    await takeDown("photo", f.photoId);
    await appeal("photo", f.photoId);
    await rows(author, sql`select community.delete_post(${f.postId}::uuid)`);
    expect((await due()).get(f.photoId)).toBe("remove");
    expect(await apply(f.photoId, "purge")).toBeNull();
    expect(await apply(f.photoId, "remove")).toEqual({ bucket: "evidence-private", key: f.key, publicBucket: null });
    expect((await due()).has(f.photoId)).toBe(false);
    await ageDelete(f, 29);
    expect((await due()).has(f.photoId)).toBe(false);
    await ageDelete(f, 31);
    expect((await due()).get(f.photoId)).toBe("purge");
    expect(await apply(f.photoId, "purge")).toEqual({ bucket: "evidence-private", key: f.key, publicBucket: null });
    expect(await exists(f)).toEqual({ p: false, m: false });
    expect((await owner.query("select actor_role, entity_id, after from core.audit_event where request_id = $1 and action = 'retention.purge_photo'", [requestId])).rows).toContainEqual({ actor_role: "system", entity_id: f.photoId, after: { post_id: f.postId } });
    expect(await apply(f.photoId, "purge")).toBeNull();
  });

  it("a photo taken down: kept while its appeal is open, purged once it is upheld and 30 days old", async () => {
    const f = await live();
    await takeDown("photo", f.photoId);
    expect((await due()).get(f.photoId)).toBe("remove");
    await apply(f.photoId, "remove");
    const a = await appeal("photo", f.photoId);
    await agePhoto(f, 31);
    expect((await due()).has(f.photoId)).toBe(false);
    expect(await apply(f.photoId, "purge")).toBeNull();
    await resolve(a, "upheld");
    expect((await due()).has(f.photoId)).toBe(false); // decided just now: 30 more days
    await ageDecisions(f.photoId, 31);
    expect((await due()).get(f.photoId)).toBe("purge");
    await apply(f.photoId, "purge");
    expect(await exists(f)).toEqual({ p: false, m: false });
    // The post is still there for everyone.
    expect(await rows(null, sql`select id from community.post where id = ${f.postId}::uuid`)).toHaveLength(1);
  });

  it("a photo restored on appeal is live again and a later take-down removes the new copy", async () => {
    const f = await live();
    await takeDown("photo", f.photoId);
    await apply(f.photoId, "remove");
    await resolve(await appeal("photo", f.photoId), "overturned");
    expect((await due()).has(f.photoId)).toBe(false);
    await takeDown("photo", f.photoId);
    expect((await due()).get(f.photoId)).toBe("remove");
  });

  it("a taken-down post: the copy goes, comes back when the post does, and the original waits for appeals and edits", async () => {
    const f = await live();
    await takeDown("post_version", f.versionId);
    expect((await due()).get(f.photoId)).toBe("remove");
    expect(await apply(f.photoId, "remove")).toEqual({ bucket: "evidence-private", key: f.key, publicBucket: "public-media" });
    const a = await appeal("post_version", f.versionId);
    await ageVersions(f, 31);
    expect((await due()).has(f.photoId)).toBe(false);
    await resolve(a, "overturned");
    expect((await due()).get(f.photoId)).toBe("restore");
    expect(await apply(f.photoId, "restore")).toEqual({ bucket: "evidence-private", key: f.key, publicBucket: "public-media" });
    expect((await due()).has(f.photoId)).toBe(false);

    await takeDown("post_version", f.versionId);
    await apply(f.photoId, "remove");
    await ageVersions(f, 31);
    expect((await due()).has(f.photoId)).toBe(false); // the photo itself was approved just now
    await past("update community.post_photo set decided_at = now() - interval '31 days' where id = $1", [f.photoId]);
    await ageDecisions(f.photoId, 31);
    expect((await due()).get(f.photoId)).toBe("purge");
    // An edit waiting for review keeps it, however old.
    await rows(author, sql`select * from community.edit_post(${f.postId}::uuid, ${randomUUID()}::uuid, 'A better title', 'A test body that is long enough, edited.', '{}'::text[], 'pending', null)`);
    await ageVersions(f, 31);
    expect((await due()).has(f.photoId)).toBe(false);
    const v2 = (await owner.query("select id from community.post_version where post_id = $1 order by n desc limit 1", [f.postId])).rows[0].id as string;
    await rows(mod2, sql`select community.admin_moderate('post_version', ${v2}::uuid, 'rejected', 'off_topic', null, null)`);
    expect((await due()).has(f.photoId)).toBe(false); // decided just now: 30 more days
    await ageVersions(f, 31);
    expect((await due()).get(f.photoId)).toBe("purge");
    await apply(f.photoId, "purge");
    expect(await exists(f)).toEqual({ p: false, m: false });
  });

  it("a purge and an appeal at the same moment: the purge waits for the post lock and sees the appeal", async () => {
    const f = await live();
    await takeDown("photo", f.photoId);
    await apply(f.photoId, "remove");
    await agePhoto(f, 31);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const appealing = as(author, async (db) => {
      await db.execute(sql`select community.submit_appeal('photo', ${f.photoId}::uuid, 'Please look at this again.')`);
      locked();
      await hold;
    });
    await isLocked;
    const purging = begin(f.photoId, "purge");
    await new Promise((r) => setTimeout(r, 1_000));
    release();
    await appealing;
    expect(await purging).toBeNull();
    expect(await exists(f)).toEqual({ p: true, m: true });
  });

  it("one worker at a time; a step that never finished is taken again after 5 minutes; a stale claim cannot finish", async () => {
    const f = await live();
    await takeDown("post_version", f.versionId);
    const first = (await begin(f.photoId, "remove"))!;
    expect(await begin(f.photoId, "remove")).toBeNull();
    expect((await due()).has(f.photoId)).toBe(false);
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("remove");
    const second = (await begin(f.photoId, "remove"))!;
    expect(await finish(f.photoId, "remove", first.claim)).toBe(false);
    expect(await finish(f.photoId, "restore", second.claim)).toBe(false);
    expect(await finish(f.photoId, "remove", second.claim)).toBe(true);
    expect((await due()).has(f.photoId)).toBe(false);
  });

  it("a remove interrupted before the post came back ends in a restore; a restore interrupted before it went ends in a remove", async () => {
    const f = await live();
    await takeDown("post_version", f.versionId);
    await begin(f.photoId, "remove");
    await resolve(await appeal("post_version", f.versionId), "overturned");
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("restore");
    await begin(f.photoId, "restore");
    await rows(author, sql`select community.delete_post(${f.postId}::uuid)`);
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("remove");
  });

  it("a decision while a step is under way: the step's result is ignored and the copy is settled later", async () => {
    const f = await live();
    await takeDown("photo", f.photoId);
    const step = (await begin(f.photoId, "remove"))!;
    await resolve(await appeal("photo", f.photoId), "overturned");
    expect(await finish(f.photoId, "remove", step.claim)).toBe(false);
    expect((await due()).has(f.photoId)).toBe(false);
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("restore");
  });

  it("once a purge started the photo is gone for everyone: no reading, no appeal, no decision; only the purge is left", async () => {
    const f = await live();
    await takeDown("photo", f.photoId);
    await apply(f.photoId, "remove");
    await agePhoto(f, 31);
    const step = (await begin(f.photoId, "purge"))!;
    for (const userId of [null, author, mod]) expect(await rows(userId, sql`select id from community.post_photo where id = ${f.photoId}::uuid`)).toEqual([]);
    expect(await code(appeal("photo", f.photoId))).toBe("P0002");
    expect(await code(rows(mod, sql`select community.admin_moderate('photo', ${f.photoId}::uuid, 'published', 'meets_guidelines', null, 'public-media')`))).not.toBe("ok");
    expect(await exists(f)).toEqual({ p: true, m: true });
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("purge");
    expect(await finish(f.photoId, "purge", step.claim)).toBe(false);
    await apply(f.photoId, "purge");
    expect(await exists(f)).toEqual({ p: false, m: false });
  });

  it("an upheld appeal on a taken-down post restarts the 30 days", async () => {
    const f = await live();
    await takeDown("post_version", f.versionId);
    await apply(f.photoId, "remove");
    const a = await appeal("post_version", f.versionId);
    await resolve(a, "upheld");
    await past("update community.post_photo set decided_at = now() - interval '40 days' where id = $1", [f.photoId]);
    await ageDecisions(f.photoId, 40);
    await past("update community.post_version set submitted_at = now() - interval '40 days', decided_at = now() - interval '40 days', taken_down_at = now() - interval '40 days' where post_id = $1", [f.postId]);
    expect(await begin(f.photoId, "purge")).toBeNull();
    await ageVersions(f, 31);
    expect((await due()).get(f.photoId)).toBe("purge");
  });

  it("0037: a direct delete is settled later, whatever happened to the photo meanwhile; system only", async () => {
    const f = await live();
    const recheck = (userId: string | null, key = f.key) => value<boolean>(userId, sql`select community.photo_recheck(${key})`);
    for (const userId of [author, mod]) expect(await code(recheck(userId))).toBe("42501");
    expect(await recheck(null, "community_photo/none.jpeg")).toBe(false);
    // Live and approved: the copy is made again once the delete has certainly ended.
    expect(await recheck(null)).toBe(true);
    expect((await due()).has(f.photoId)).toBe(false);
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("restore");
    await apply(f.photoId, "restore");
    expect((await due()).has(f.photoId)).toBe(false);
    // Failed approval of a waiting photo: an orphan copy goes; an approval in between keeps the mark.
    await past("update community.post_photo set moderation_status = 'pending', public_bucket = null, public_key = null, decided_at = null where id = $1", [f.photoId]);
    await recheck(null);
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("remove");
    await recheck(null);
    await rows(mod, sql`select community.admin_moderate('photo', ${f.photoId}::uuid, 'published', 'meets_guidelines', null, 'public-media')`);
    expect((await due()).has(f.photoId)).toBe(false);
    await expireClaim(f);
    expect((await due()).get(f.photoId)).toBe("restore");
  });

  it("a photo still waiting for review is kept while its taken-down post is not deleted", async () => {
    const f = await live();
    await takeDown("post_version", f.versionId);
    await past("update community.post_photo set moderation_status = 'pending', public_bucket = null, public_key = null, decided_at = null where id = $1", [f.photoId]);
    await ageVersions(f, 400);
    expect((await due()).get(f.photoId)).not.toBe("purge");
    await rows(author, sql`select community.delete_post(${f.postId}::uuid)`);
    await ageDelete(f, 31);
    expect((await due()).get(f.photoId)).toBe("purge");
  });
});
