// Migration 0032 read as text, and its browser-side mirrors in src/domain/admin/moderation.ts.
// The live checks run against a Neon branch: tests/integration/moderation-takedown-rls.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moderationQueueSchema, REJECT_REASONS, reportReasonsText, resolveReportsPayloadSchema, takeDownPayloadSchema } from "@/domain/admin/moderation";

const RAW = readFileSync(path.resolve("db/migrations/0032_moderation_takedown.sql"), "utf8").replace(/\r\n/g, "\n");
const SQL = RAW.replace(/--[^\n]*/g, "");
const fn = (name: string) => {
  const m = new RegExp(`create or replace function ${name.replace(".", "\\.")}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`).exec(SQL);
  if (!m) throw new Error(`${name} not found`);
  return { head: m[1]!, body: m[2]!.replace(/\s+/g, " ") };
};
const granted = (sig: string) => SQL.includes(`grant execute on function ${sig} to paranaga_app;`);
const T = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
/** A report time as jsonb writes a timestamptz: microseconds and an offset. */
const LAST = "2026-11-24T03:00:00.123456+00:00";

describe("0032: shape of the migration", () => {
  it("the header states the order (migrate first) and a manual rollback", () => {
    expect(RAW).toMatch(/MIGRATE FIRST, then deploy the code/);
    expect(RAW).toMatch(/-- Manual rollback/);
    expect(RAW).toMatch(/The app running before this migration keeps working/);
  });

  it("waits at most 5 s for a lock, before anything else", () => {
    expect(SQL.trimStart().startsWith("set local lock_timeout = '5s';")).toBe(true);
  });

  it("drops only the per-item appeal index and the old resolve_report, creates no table, and adds three nullable columns with a CHECK each", () => {
    expect([...SQL.matchAll(/drop [^;]+;/g)].map((m) => m[0])).toEqual(["drop index community.appeal_target_uq;", "drop function community.resolve_report(uuid, text);"]);
    expect(SQL).not.toMatch(/\bcreate (table|policy|trigger)\b/);
    for (const table of ["post_version", "comment", "post_photo"]) {
      expect(SQL).toMatch(new RegExp(`alter table community\\.${table}\\s+add column taken_down_at timestamptz,\\s+add constraint ${table}_taken_down check \\(taken_down_at is null or moderation_status = 'rejected'\\);`));
    }
    expect(SQL).toContain("create index reaction_target_idx on community.reaction (target_type, target_id);");
    expect(SQL).toContain("create index content_report_open_target_idx on community.content_report (target_type, target_id) where status = 'open';");
  });

  it("decisions and appeals are stamped with the clock, so their order follows the commits under the row lock", () => {
    for (const table of ["moderation_decision", "appeal"]) {
      expect(SQL).toContain(`alter table community.${table} alter column created_at set default clock_timestamp();`);
    }
  });

  it("the header covers a code rollback (two appeals on one item break the previous app's thread) and the schema_migrations row", () => {
    expect(RAW).toMatch(/-- Rolling back the CODE only/);
    expect(RAW).toMatch(/from community\.appeal group by 1, 2 having count\(\*\) > 1/);
    expect(RAW).toMatch(/delete from public\.schema_migrations where name = '0032_moderation_takedown\.sql';/);
  });

  it("grants: the app may call the seven entry points; the two helpers stay closed to it", () => {
    for (const sig of [
      "community.admin_take_down(text, uuid, text, text, timestamptz)",
      "community.admin_report_queue(integer)",
      "community.resolve_report(uuid, text, timestamptz, uuid)",
      "community.report_content(text, uuid, text, text)",
      "community.submit_appeal(text, uuid, text)",
      "community.toggle_reaction(text, uuid)",
      "community.toggle_bookmark(uuid)",
    ]) {
      expect(granted(sig), sig).toBe(true);
    }
    expect(granted("community.content_target(text, uuid)")).toBe(false);
    expect(granted("community.apply_content_outcome(text, uuid, text, text, text)")).toBe(false);
    // The only new privilege on a table is the one column the photo take-down writes.
    expect([...SQL.matchAll(/grant (?!execute|create)[^;]+;/g)].map((m) => m[0])).toEqual(["grant update (taken_down_at) on community.post_photo to paranaga_definer;"]);
  });
});

describe("0032: community.admin_take_down", () => {
  const { head, body } = fn("community.admin_take_down");

  it("is a definer function with a pinned search_path that checks the moderator role first", () => {
    expect(head).toMatch(/security definer\s+set search_path = pg_catalog, community, core, pg_temp/);
    expect(body).toMatch(/v_user text := community\.assert_moderator\(\);/);
  });

  it("takes exactly the reasons of a rejection (the list the screen offers)", () => {
    const list = body.match(/p_reason_code not in \(([^)]*)\)/)![1]!;
    expect([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...REJECT_REASONS]);
    expect(body).toMatch(/if p_reason_code = 'other' and v_note is null then/);
  });

  it("locks the item, refuses your own content and anything not published, before it changes a row", () => {
    const at = (s: string) => {
      const i = body.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const lock = at("community.content_target(p_target_type, p_target_id)");
    const own = at("you cannot moderate your own content");
    const apply = at("community.apply_content_outcome(p_target_type, p_target_id, 'rejected', p_reason_code, null)");
    expect(lock).toBeLessThan(own);
    for (const refusal of ["already unpublished", "a newer version of this post is live now", "this item is not published"]) expect(at(refusal)).toBeLessThan(apply);
    expect(own).toBeLessThan(apply);
  });

  it("records a decision that is never a Jev override, closes the open reports as actioned, and audits ids and codes only", () => {
    expect(body).toMatch(/j\.recommendation, j\.confidence, false\) returning id into v_decision;/);
    expect(body).not.toContain("community.override");
    expect(body).toMatch(/update community\.content_report r set status = 'actioned', resolved_by = v_user, resolved_at = now\(\) where r\.status = 'open'/);
    // Only the reports the moderator's page showed; a newer one refuses the call before any row changes.
    expect(body).toMatch(/and r\.target_id = v_rid and r\.created_at <= p_seen_until;/);
    const newer = body.indexOf("r.created_at > p_seen_until) then raise exception 'a new report came in on this item");
    expect(newer).toBeGreaterThan(-1);
    expect(newer).toBeLessThan(body.indexOf("community.apply_content_outcome("));
    const audit = body.match(/perform core\.audit\('community\.take_down'[\s\S]*?\)\);/)![0];
    expect(audit).not.toMatch(/v_note|p_note|body|title/);
  });

  it("touches no bucket object: it only names the public copy for the server to delete after the commit", () => {
    expect(body).not.toMatch(/delete from/);
    expect(body).toMatch(/jsonb_build_object\('bucket', ph\.public_bucket, 'key', ph\.public_key\) into v_removed/);
    expect(body).toMatch(/'removed', v_removed\)/);
  });
});

describe("0032: the functions it replaces", () => {
  it("content_target locks the post row before the version or the photo (ERD C3)", () => {
    const { body } = fn("community.content_target");
    const post = body.indexOf("from community.post p where p.id = o_post and p.deleted_at is null for update");
    expect(post).toBeGreaterThan(-1);
    expect(post).toBeLessThan(body.indexOf("from community.post_version v where v.id = p_id for update"));
    expect(post).toBeLessThan(body.indexOf("from community.post_photo ph where ph.id = p_id for update"));
  });

  it("apply_content_outcome: rejecting the live item stamps it, clears the post's live version and the photo's public copy; publishing clears the stamp", () => {
    const { body } = fn("community.apply_content_outcome");
    expect(body.match(/taken_down_at = case when p_outcome = 'rejected' and moderation_status = 'published' then now\(\) end/g)).toHaveLength(2);
    expect(body).toMatch(/update community\.post set published_version_id = null, updated_at = now\(\) where id = v_post and published_version_id = p_id;/);
    expect(body).toMatch(/set taken_down_at = case when moderation_status = 'published' then now\(\) end, moderation_status = 'rejected', public_bucket = null, public_key = null/);
    expect(body).toMatch(/public_key = v_media\.object_key, taken_down_at = null/);
  });

  it("apply_content_outcome: only a newer version that is live or waiting blocks publishing an older one", () => {
    const { body } = fn("community.apply_content_outcome");
    expect(body).toMatch(/n\.n > \(select v\.n from community\.post_version v where v\.id = p_id\) and n\.moderation_status in \('pending', 'human_review', 'published'\)\) then raise exception/);
  });

  it("report_content: a closed report is reopened as a new one; an open one is left alone", () => {
    const { body } = fn("community.report_content");
    expect(body).toMatch(/on conflict \(reporter_id, target_type, target_id\) do update set reason = excluded\.reason, note = excluded\.note, created_at = excluded\.created_at, status = 'open', resolved_by = null, resolved_at = null where r\.status <> 'open';/);
    expect(body).toMatch(/p_reason, p_note, clock_timestamp\(\)\)/);
  });

  it("submit_appeal: one appeal per decision, not per item", () => {
    const { body } = fn("community.submit_appeal");
    expect(body).toMatch(/elsif v_decision\.appeal_id is not null then raise exception 'this decision was already appealed' using errcode = '23505';/);
    expect(body).not.toMatch(/exists \(select 1 from community\.appeal/);
  });

  it("resolve_report: moderators only, never your own content, every open report on the item, audited; actioned only when the content is gone", () => {
    const { body } = fn("community.resolve_report");
    expect(body).toMatch(/v_actor text := community\.assert_moderator\(\);/);
    expect(body).toMatch(/if v_author = v_actor then raise exception 'you cannot moderate your own content' using errcode = '42501';/);
    expect(body).toMatch(/if p_status = 'actioned' and v_live is not null then raise exception/);
    expect(body).toMatch(/if v_live is distinct from p_content_id then raise exception 'this content changed since you loaded the page; reload' using errcode = '55000';/);
    expect(body).toMatch(/r\.status = 'open' and r\.created_at > p_seen_until\) then raise exception 'a new report came in on this item; reload and read it first' using errcode = '55000';/);
    expect(body).toMatch(/where r\.target_type = v_type and r\.target_id = v_target and r\.status = 'open' and r\.created_at <= p_seen_until;/);
    expect(body).toMatch(/perform core\.audit\('community\.report_resolve'/);
  });

  it("admin_report_queue: moderators only, never the caller's own content, and no reporter id in its answer", () => {
    const { head, body } = fn("community.admin_report_queue");
    expect(head).toMatch(/stable security definer/);
    expect(body).toMatch(/v_user text := community\.assert_moderator\(\);/);
    expect(body).toMatch(/t on t\.author_id <> v_user/);
    expect(body).not.toMatch(/reporter_id/);
  });

  it("toggles: the target row is locked before the reaction is counted (C4) and both inserts tolerate a repeat (C5)", () => {
    const reaction = fn("community.toggle_reaction").body;
    expect(reaction.match(/for no key update;/g)).toHaveLength(2);
    expect(reaction.lastIndexOf("for no key update;")).toBeLessThan(reaction.indexOf("delete from community.reaction"));
    expect(reaction).toMatch(/on conflict \(user_id, target_type, target_id\) do nothing;/);
    expect(fn("community.toggle_bookmark").body).toMatch(/on conflict \(user_id, post_id\) do nothing;/);
  });
});

describe("take-down and report payloads", () => {
  it("a take-down takes a rejection reason; 'other' needs a note; nothing else is accepted", () => {
    const ok = (p: Record<string, unknown>, lastAt: unknown = LAST) => takeDownPayloadSchema.safeParse(lastAt === undefined ? p : { ...p, lastAt }).success;
    expect(ok({ targetType: "post_version", targetId: T, reason: "spam" })).toBe(true);
    expect(ok({ targetType: "photo", targetId: T, reason: "other", note: "Shows a plate number." })).toBe(true);
    expect(ok({ targetType: "comment", targetId: T, reason: "other" })).toBe(false);
    expect(ok({ targetType: "comment", targetId: T, reason: "other", note: "   " })).toBe(false);
    expect(ok({ targetType: "comment", targetId: T, reason: "meets_guidelines" })).toBe(false);
    expect(ok({ targetType: "comment", targetId: T })).toBe(false);
    expect(ok({ targetType: "post", targetId: T, reason: "spam" })).toBe(false);
    expect(ok({ targetType: "comment", targetId: T, reason: "spam", note: "x".repeat(1001) })).toBe(false);
    expect(ok({ targetType: "comment", targetId: T, reason: "spam", outcome: "published" })).toBe(false);
    // The newest report the page showed: required, a timestamp with an offset, microseconds kept.
    expect(takeDownPayloadSchema.parse({ targetType: "comment", targetId: T, reason: "spam", lastAt: LAST }).lastAt).toBe(LAST);
    for (const lastAt of [null, "", "yesterday", "2026-11-24", "2026-11-24T03:00:00.123456", "'; drop table x; --"]) {
      expect(ok({ targetType: "comment", targetId: T, reason: "spam" }, lastAt), String(lastAt)).toBe(false);
    }
    expect(takeDownPayloadSchema.safeParse({ targetType: "comment", targetId: T, reason: "spam" }).success).toBe(false);
  });

  it("closing reports takes a status, the newest report shown and the content shown, and nothing else", () => {
    const ok = (p: unknown) => resolveReportsPayloadSchema.safeParse(p).success;
    expect(ok({ status: "dismissed", lastAt: LAST, contentId: T })).toBe(true);
    expect(ok({ status: "actioned", lastAt: LAST, contentId: null })).toBe(true);
    expect(ok({ status: "open", lastAt: LAST, contentId: T })).toBe(false);
    expect(ok({ status: "dismissed" })).toBe(false);
    expect(ok({ status: "dismissed", lastAt: LAST })).toBe(false);
    expect(ok({ status: "dismissed", lastAt: "soon", contentId: T })).toBe(false);
    expect(ok({ status: "dismissed", lastAt: LAST, contentId: "x" })).toBe(false);
    expect(ok({ status: "dismissed", lastAt: LAST, contentId: T, reportId: T })).toBe(false);
  });

  it("report reasons read most frequent first, with counts only when there is more than one", () => {
    expect(reportReasonsText({ off_topic: 1, spam: 3, other: 1 })).toBe("Spam or advertising ×3, Off topic, Other");
    expect(reportReasonsText({ made_up: 2 })).toBe("made_up ×2");
  });

  it("a queue from a server without the reports key still parses, as no reports", () => {
    expect(moderationQueueSchema.parse({ items: [], appeals: [], history: [] }).reports).toEqual([]);
  });
});
