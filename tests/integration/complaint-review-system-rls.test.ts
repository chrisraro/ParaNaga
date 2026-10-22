// N7 (migration 0026) against a migrated Neon branch:
//   bash scripts/with-neon-branch.sh pnpm vitest run --project integration tests/integration/complaint-review-system-rls.test.ts
// C11 (AC-14): only complaint reviewers, after a fresh step-up, read the queue, open a report and
// get evidence; guests, commuters, moderators, transport reviewers and admins never do; the
// reviewer's own reports are hidden; every read is audited and every evidence issuance logged.
// Retention: system callers only, legal hold respected, rows and media purged together, the
// delete policies refuse rows that are not due. C12: role changes need admin + step-up + reason,
// never your own roles; lookup by exact email; staff read their own audit rows only.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateReference } from "@/domain/complaints/reference";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

type Obj = Record<string, unknown>;

describe.skipIf(!ownerUrl || !appUrl)("N7: complaint review, retention, roles, audit (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const requestId = `n7-${run}`;
  const reporter = `test-n7-reporter-${run}`;
  const reviewer = `test-n7-reviewer-${run}`;
  const moderator = `test-n7-mod-${run}`;
  const transport = `test-n7-transport-${run}`;
  const admin = `test-n7-admin-${run}`;
  const commuter = `test-n7-commuter-${run}`;
  let owner: pg.Client;
  let app: pg.Pool;
  let complaintId = "";
  let evidenceId = "";
  let mediaId = "";
  let ownComplaintId = "";

  const as = <T>(userId: string | null, fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId, requestId }, fn);
  const rows = async (userId: string | null, query: ReturnType<typeof sql>) => as(userId, async (db) => (await db.execute(query)).rows as Obj[]);
  /** The query after a fresh step-up in the same transaction (the gate alone; step-up-rls.test.ts covers the record). */
  const stepped = async (userId: string, query: ReturnType<typeof sql>) =>
    as(userId, async (db) => {
      await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return (await db.execute(query)).rows as Obj[];
    });
  const pgError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      return { code: cause?.code ?? (error as { code?: string }).code, message: cause?.message ?? "" };
    }
    throw new Error("expected the query to fail");
  };
  const ref = () => generateReference((n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 240)));
  const audits = async (action: string) =>
    (await owner.query<{ action: string; actor_user_id: string | null; actor_role: string; entity_id: string | null; after: Obj | null }>(
      "select action, actor_user_id, actor_role, entity_id, after from core.audit_event where request_id = $1 and action = $2 order by at, id",
      [requestId, action],
    )).rows;

  async function submit(userId: string, withEvidence: boolean): Promise<{ id: string; media: string | null }> {
    let media: string | null = null;
    if (withEvidence) {
      media = (await rows(userId, sql`select id from core.create_media_slot('complaint_evidence', 100, 'image/jpeg')`))[0]!.id as string;
      await rows(userId, sql`select core.verify_and_promote_media(${media}::uuid, 'evidence-private', ${`complaint_evidence/${run}-${media}.jpg`}, ${"b".repeat(64)}, 100, 'image/jpeg')`);
    }
    const evidence = JSON.stringify(media ? [{ mediaId: media, captureKind: "file_upload" }] : []);
    const created = await rows(
      userId,
      sql`select * from priv.submit_complaint(${randomUUID()}::uuid, ${ref()}, 'overcharging', 'Asked for twice the fare on the loop today.',
            now() - interval '1 hour', 13.6234::double precision, 123.1847::double precision, 12::numeric,
            null, null, ${"ABC 1234"}, null, 'queue_normal', ${evidence}::jsonb)`,
    );
    return { id: created[0]!.id as string, media };
  }

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [reporter, ["commuter"]],
      [reviewer, ["commuter", "complaint_reviewer"]],
      [moderator, ["commuter", "community_moderator"]],
      [transport, ["commuter", "transport_reviewer"]],
      [admin, ["commuter", "admin"]],
      [commuter, ["commuter"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    const a = await submit(reporter, true);
    complaintId = a.id;
    mediaId = a.media!;
    evidenceId = (await rows(reporter, sql`select id from priv.complaint_media where complaint_id = ${complaintId}::uuid`))[0]!.id as string;
    ownComplaintId = (await submit(reviewer, false)).id;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  // ---------------------------------------------------------------- C11

  const reviewerCalls = () => [
    sql`select priv.review_list('open', 50) as d`,
    sql`select priv.review_complaint(${complaintId}::uuid) as d`,
    sql`select * from priv.reviewer_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)`,
    sql`select priv.set_complaint_status(${complaintId}::uuid, 'under_review') as ok`,
    sql`select priv.set_complaint_legal_hold(${complaintId}::uuid, true, 'test hold') as ok`,
  ];

  it("AC-14 matrix: guests, commuters, the reporter, moderators, transport reviewers and admins are refused, even with a step-up", async () => {
    for (const [name, userId] of [["guest", null], ["commuter", commuter], ["reporter", reporter], ["moderator", moderator], ["transport reviewer", transport], ["admin", admin]] as const) {
      for (const q of reviewerCalls()) {
        const e = await pgError(userId ? stepped(userId, q) : rows(null, q));
        expect(e, name).toEqual({ code: "42501", message: "forbidden" });
      }
      // And no direct read of the evidence rows or the access log.
      expect(await rows(userId, sql`select id from priv.complaint_media where complaint_id = ${complaintId}::uuid`), name).toHaveLength(userId === reporter ? 1 : 0);
    }
  });

  it("a complaint reviewer without a fresh step-up is refused; nothing is audited", async () => {
    for (const q of reviewerCalls()) expect(await pgError(rows(reviewer, q))).toEqual({ code: "42501", message: "step-up required" });
    expect(await audits("complaint.queue.read")).toHaveLength(0);
  });

  it("the queue: no text, no reporter, never the reviewer's own report; audited", async () => {
    const list = (await stepped(reviewer, sql`select priv.review_list('open', 200) as d`))[0]!.d as Obj[];
    const mine = list.find((c) => c.id === complaintId);
    expect(mine).toMatchObject({ category: "overcharging", status: "submitted", evidenceCount: 1 });
    expect(Object.keys(mine!)).not.toEqual(expect.arrayContaining(["description"]));
    expect(JSON.stringify(list)).not.toMatch(/reporter|object_key|description/i);
    expect(list.some((c) => c.id === ownComplaintId)).toBe(false);
    expect(await audits("complaint.queue.read")).toEqual([expect.objectContaining({ actor_user_id: reviewer, after: { scope: "open" } })]);
  });

  it("opening a report: text and metadata, no reporter id or storage key; own report is null; audited", async () => {
    const d = (await stepped(reviewer, sql`select priv.review_complaint(${complaintId}::uuid) as d`))[0]!.d as Obj;
    expect(d).toMatchObject({ id: complaintId, description: "Asked for twice the fare on the loop today.", plate: "ABC 1234" });
    expect((d.location as Obj).lat).toBeCloseTo(13.6234, 4);
    expect((d.evidence as Obj[])[0]).toMatchObject({ id: evidenceId, available: true, mime: "image/jpeg" });
    expect(JSON.stringify(d)).not.toMatch(/reporter_id|reporterId|object_key|objectKey|complaint_evidence\//);
    expect((await stepped(reviewer, sql`select priv.review_complaint(${ownComplaintId}::uuid) as d`))[0]!.d).toBeNull();
    expect((await audits("complaint.review.open")).map((a) => a.entity_id)).toEqual([complaintId]);
  });

  it("evidence: a 60-second issuance logged in priv.evidence_access and audited; never for the reviewer's own report", async () => {
    const got = await stepped(reviewer, sql`select * from priv.reviewer_evidence_download(${complaintId}::uuid, ${evidenceId}::uuid)`);
    expect(got).toEqual([{ bucket: "evidence-private", object_key: `complaint_evidence/${run}-${mediaId}.jpg`, mime: "image/jpeg" }]);
    const access = (await owner.query("select accessor_id, accessor_role, purpose, extract(epoch from expires_at - issued_at)::int as ttl from priv.evidence_access where complaint_id = $1", [complaintId])).rows;
    expect(access).toEqual([{ accessor_id: reviewer, accessor_role: "complaint_reviewer", purpose: "complaint_review", ttl: 60 }]);
    expect(await audits("complaint.evidence.read")).toEqual([expect.objectContaining({ actor_user_id: reviewer, entity_id: complaintId, after: { evidence: evidenceId } })]);
    // A wrong pairing of report and evidence returns nothing and logs nothing.
    expect(await stepped(reviewer, sql`select * from priv.reviewer_evidence_download(${ownComplaintId}::uuid, ${evidenceId}::uuid)`)).toEqual([]);
    expect((await owner.query("select count(*)::int as n from priv.evidence_access where complaint_id = $1", [complaintId])).rows[0].n).toBe(1);
  });

  it("status and legal hold: transitions checked, reviewer-only notes hidden from the reporter, audited", async () => {
    expect((await stepped(reviewer, sql`select priv.set_complaint_status(${complaintId}::uuid, 'under_review', null, 'Looking into it.', 'reporter') as ok`))[0]!.ok).toBe(true);
    expect((await pgError(stepped(reviewer, sql`select priv.set_complaint_status(${complaintId}::uuid, 'withdrawn') as ok`))).code).toBe("22023");
    expect((await stepped(reviewer, sql`select priv.set_complaint_legal_hold(${complaintId}::uuid, true, 'Kept for a police request.') as ok`))[0]!.ok).toBe(true);
    const seen = await rows(reporter, sql`select to_status, note from priv.complaint_event where complaint_id = ${complaintId}::uuid order by at`);
    expect(seen.map((e) => e.note)).toEqual([null, "Looking into it."]);
    expect(await audits("complaint.legal_hold")).toEqual([expect.objectContaining({ entity_id: complaintId, after: { hold: true } })]);
    // Own report: the hold function answers false, the status function refuses.
    expect((await stepped(reviewer, sql`select priv.set_complaint_legal_hold(${ownComplaintId}::uuid, true, 'mine') as ok`))[0]!.ok).toBe(false);
    expect((await pgError(stepped(reviewer, sql`select priv.set_complaint_status(${ownComplaintId}::uuid, 'under_review') as ok`))).message).toBe("forbidden: own report");
  });

  // ---------------------------------------------------------------- retention

  it("retention functions refuse any signed-in caller", async () => {
    for (const userId of [reviewer, admin, reporter]) {
      for (const q of [sql`select priv.retention_due(10) as d`, sql`select priv.retention_purge_complaint(${complaintId}::uuid) as ok`, sql`select priv.retention_record_run(true, 0, 0, 0, 0)`]) {
        expect(await pgError(stepped(userId, q))).toEqual({ code: "42501", message: "forbidden" });
      }
    }
  });

  it("a closed report is purged only once due and not on legal hold, rows and media together, audited as system; a rerun is a no-op", async () => {
    // Close it (it is on legal hold from the test above), then age it past the retention date.
    await stepped(reviewer, sql`select priv.set_complaint_status(${complaintId}::uuid, 'closed', 'insufficient_detail') as ok`);
    const due = async () => ((await rows(null, sql`select priv.retention_due(200) as d`))[0]!.d as { complaints: Obj[] }).complaints.map((c) => c.id);
    expect(await due()).not.toContain(complaintId); // retention_until is a year away
    await owner.query("update priv.complaint set retention_until = now() - interval '1 day' where id = $1", [complaintId]);
    expect(await due()).not.toContain(complaintId); // legal hold
    expect((await rows(null, sql`select priv.retention_purge_complaint(${complaintId}::uuid) as ok`))[0]!.ok).toBe(false);

    // The delete policies refuse a report that is not due, whatever the caller does directly.
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    expect((await owner.query("delete from priv.complaint where id = $1", [complaintId])).rowCount).toBe(0);
    expect((await owner.query("delete from priv.complaint_media where complaint_id = $1", [complaintId])).rowCount).toBe(0);
    expect((await owner.query("delete from core.media_object where id = $1", [mediaId])).rowCount).toBe(0); // still used by the report
    await owner.query("rollback");

    await stepped(reviewer, sql`select priv.set_complaint_legal_hold(${complaintId}::uuid, false, 'Request withdrawn.') as ok`);
    const listed = ((await rows(null, sql`select priv.retention_due(200) as d`))[0]!.d as { complaints: { id: string; objects: Obj[] }[] }).complaints.find((c) => c.id === complaintId);
    expect(listed?.objects).toEqual([{ bucket: "evidence-private", key: `complaint_evidence/${run}-${mediaId}.jpg` }]);

    // Even when due, a signed-in definer session cannot delete it directly (policy: system callers only).
    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    await owner.query("select set_config('app.user_id', $1, true)", [admin]);
    expect((await owner.query("delete from priv.complaint where id = $1", [complaintId])).rowCount).toBe(0);
    await owner.query("rollback");

    expect((await rows(null, sql`select priv.retention_purge_complaint(${complaintId}::uuid) as ok`))[0]!.ok).toBe(true);
    for (const [table, col] of [["priv.complaint", "id"], ["priv.complaint_media", "complaint_id"], ["priv.complaint_event", "complaint_id"], ["priv.evidence_access", "complaint_id"], ["priv.external_handoff", "complaint_id"]] as const) {
      expect((await owner.query(`select count(*)::int as n from ${table} where ${col} = $1`, [complaintId])).rows[0].n, table).toBe(0);
    }
    expect((await owner.query("select count(*)::int as n from core.media_object where id = $1", [mediaId])).rows[0].n).toBe(0);
    expect(await audits("retention.purge")).toEqual([expect.objectContaining({ actor_user_id: null, actor_role: "system", entity_id: complaintId, after: { media: 1 } })]);
    expect((await rows(null, sql`select priv.retention_purge_complaint(${complaintId}::uuid) as ok`))[0]!.ok).toBe(false);
  });

  it("an evidence upload no report uses is purged after 30 days; the run summary is audited as system", async () => {
    const slot = (await rows(commuter, sql`select id from core.create_media_slot('complaint_evidence', 100, 'image/jpeg')`))[0]!.id as string;
    const listedNow = ((await rows(null, sql`select priv.retention_due(200) as d`))[0]!.d as { uploads: Obj[] }).uploads.map((u) => u.id);
    expect(listedNow).not.toContain(slot);
    expect((await rows(null, sql`select priv.retention_purge_upload(${slot}::uuid) as ok`))[0]!.ok).toBe(false);
    await owner.query("update core.media_object set created_at = now() - interval '31 days' where id = $1", [slot]);
    expect(((await rows(null, sql`select priv.retention_due(200) as d`))[0]!.d as { uploads: Obj[] }).uploads.map((u) => u.id)).toContain(slot);
    expect((await rows(null, sql`select priv.retention_purge_upload(${slot}::uuid) as ok`))[0]!.ok).toBe(true);
    expect((await owner.query("select count(*)::int as n from core.media_object where id = $1", [slot])).rows[0].n).toBe(0);
    await rows(null, sql`select priv.retention_record_run(false, 1, 1, 2, 0)`);
    expect(await audits("retention.run")).toEqual([expect.objectContaining({ actor_role: "system", after: { dryRun: false, complaints: 1, uploads: 1, objects: 2, failed: 0 } })]);
  });

  // ---------------------------------------------------------------- C12 roles

  it("role changes: admin only, after a fresh step-up, with a reason; never your own; known users only; audited with the reason", async () => {
    expect(await pgError(rows(moderator, sql`select core.grant_role(${commuter}, 'contributor', 'because')`))).toEqual({ code: "42501", message: "only admins can grant roles" });
    expect(await pgError(rows(admin, sql`select core.grant_role(${commuter}, 'contributor', 'because')`))).toEqual({ code: "42501", message: "step-up required" });
    expect((await pgError(stepped(admin, sql`select core.grant_role(${admin}, 'complaint_reviewer', 'because')`))).code).toBe("42501");
    expect((await pgError(stepped(admin, sql`select core.grant_role(${commuter}, 'contributor', 'no')`))).code).toBe("22023");
    expect((await pgError(stepped(admin, sql`select core.grant_role(${commuter}, 'commuter', 'because')`))).code).toBe("22023");
    expect((await pgError(stepped(admin, sql`select core.grant_role(${`nobody-${run}`}, 'contributor', 'because')`))).code).toBe("22023");
    await stepped(admin, sql`select core.grant_role(${commuter}, 'complaint_reviewer', 'Named by the owner.')`);
    expect(await audits("role.grant")).toEqual([expect.objectContaining({ actor_user_id: admin, entity_id: commuter, after: { role: "complaint_reviewer", reason: "Named by the owner." } })]);
    expect((await pgError(stepped(admin, sql`select core.revoke_role(${admin}, 'admin', 'leaving')`))).message).toBe("admins cannot change their own roles");
    expect((await pgError(stepped(admin, sql`select core.revoke_role(${commuter}, 'transport_reviewer', 'never had it')`))).code).toBe("22023");
    await stepped(admin, sql`select core.revoke_role(${commuter}, 'complaint_reviewer', 'Test over.')`);
    expect(await audits("role.revoke")).toEqual([expect.objectContaining({ entity_id: commuter, after: { role: "complaint_reviewer", reason: "Test over." } })]);
  });

  it("staff list and exact-email lookup: admins only; partial addresses refused; audited without the address", async () => {
    expect((await pgError(rows(moderator, sql`select core.admin_staff() as d`))).message).toBe("forbidden");
    expect((await pgError(rows(moderator, sql`select core.admin_find_user('x@example.com') as d`))).message).toBe("forbidden");
    const staff = (await rows(admin, sql`select core.admin_staff() as d`))[0]!.d as Obj[];
    expect(staff.find((u) => u.userId === reviewer)).toMatchObject({ self: false });
    expect(staff.find((u) => u.userId === admin)).toMatchObject({ self: true });
    expect(staff.some((u) => u.userId === reporter)).toBe(false);
    expect((await pgError(rows(admin, sql`select core.admin_find_user('example.com') as d`))).code).toBe("22023");
    const none = await pgError(rows(admin, sql`select core.admin_find_user(${`nobody-${run}@example.invalid`}) as d`)).catch(() => null);
    if (none && none.code === "55000") return; // neon_auth absent on this database: the honest "unavailable" answer
    expect((await rows(admin, sql`select core.admin_find_user(${`nobody-${run}@example.invalid`}) as d`))[0]!.d).toBeNull();
    const lookups = await audits("user.lookup");
    expect(lookups.at(-1)).toMatchObject({ entity_id: null, after: { found: false } });
    expect(JSON.stringify(lookups)).not.toContain("example.invalid");
  });

  // ---------------------------------------------------------------- audit log

  it("audit log: admins read every row; staff their own only; commuters none", async () => {
    await rows(moderator, sql`select core.audit('test.n7', 'test', ${run}, null)`);
    const modRows = await rows(moderator, sql`select actor_user_id from core.audit_event where request_id = ${requestId}`);
    expect(modRows.length).toBeGreaterThan(0);
    expect(new Set(modRows.map((r) => r.actor_user_id))).toEqual(new Set([moderator]));
    const revRows = await rows(reviewer, sql`select distinct actor_user_id from core.audit_event where request_id = ${requestId}`);
    expect(revRows.map((r) => r.actor_user_id)).toEqual([reviewer]);
    expect(await rows(commuter, sql`select id from core.audit_event`)).toHaveLength(0);
    expect(await rows(reporter, sql`select id from core.audit_event`)).toHaveLength(0);
    const adminRows = await rows(admin, sql`select distinct actor_user_id from core.audit_event where request_id = ${requestId}`);
    expect(adminRows.map((r) => r.actor_user_id)).toEqual(expect.arrayContaining([moderator, reviewer, admin]));
    expect(await pgError(rows(admin, sql`delete from core.audit_event where request_id = ${requestId}`))).toMatchObject({ code: "42501" });
  });
});
