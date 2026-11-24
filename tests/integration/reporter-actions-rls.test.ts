// A reporter withdraws or answers their own report (migration 0038), against a migrated Neon branch:
//   bash scripts/with-neon-branch.sh pnpm exec vitest run --project integration tests/integration/reporter-actions-rls.test.ts
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateReference } from "@/domain/complaints/reference";
import { runInRequestContext } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
type Obj = Record<string, unknown>;

describe.skipIf(!ownerUrl || !appUrl)("reporter actions (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const requestId = `n38-${run}`;
  const reporter = `test-ra-rep-${run}`;
  const other = `test-ra-oth-${run}`;
  const moderator = `test-ra-mod-${run}`;
  const reviewer = `test-ra-rev-${run}`;
  const transport = `test-ra-tr-${run}`;
  const admin = `test-ra-adm-${run}`;
  const strangers = [other, moderator, reviewer, transport, admin];
  let owner: pg.Client;
  let app: pg.Pool;

  const as = <T>(userId: string | null, fn: Parameters<typeof runInRequestContext<T>>[2]) => runInRequestContext<T>(app, { userId, requestId }, fn);
  const rows = async (userId: string | null, q: ReturnType<typeof sql>) => (await as(userId, async (db) => (await db.execute(q)).rows)) as Obj[];
  const value = async (userId: string | null, q: ReturnType<typeof sql>) => Object.values((await rows(userId, q))[0]!)[0];
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      return e.cause?.code ?? e.code;
    }
    return "ok";
  };
  const stepped = (q: ReturnType<typeof sql>) =>
    as(reviewer, async (db) => {
      await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return (await db.execute(q)).rows as Obj[];
    });
  const media = async (userId: string, purpose = "complaint_evidence") => {
    const id = (await rows(userId, sql`select id from core.create_media_slot(${purpose}, 1000, 'image/jpeg')`))[0]!.id as string;
    await rows(userId, sql`select core.verify_and_promote_media(${id}::uuid, 'evidence-private', ${`${purpose}/${id}.jpeg`}, ${createHash("sha256").update(id).digest("hex")}, 1000, 'image/jpeg')`);
    return id;
  };
  const evidence = (...ids: string[]) => JSON.stringify(ids.map((mediaId) => ({ mediaId, captureKind: "file_upload" })));
  const ref = () => generateReference((n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 240)));
  const complaint = async (ev = "[]") =>
    (await rows(reporter, sql`select * from priv.submit_complaint(${randomUUID()}::uuid, ${ref()}, 'overcharging', 'Asked for twice the fare here.',
      now() - interval '1 hour', null, null, null, null, null, null, null, 'queue_normal', ${ev}::jsonb)`))[0]!.id as string;
  const move = (id: string, to: string, outcome: string | null = null) => stepped(sql`select priv.set_complaint_status(${id}::uuid, ${to}, ${outcome}, 'Which jeep was it?')`);
  const waiting = async (ev = "[]") => {
    const id = await complaint(ev);
    await move(id, "under_review");
    await move(id, "needs_information");
    return id;
  };
  const withdraw = (userId: string | null, id: string) => value(userId, sql`select priv.withdraw_complaint(${id}::uuid)`);
  const answer = (userId: string | null, id: string, text = "It was the one to Pacol.", ev = "[]") =>
    value(userId, sql`select priv.answer_complaint(${id}::uuid, ${text}, ${ev}::jsonb)`);
  const answerCorrection = (userId: string | null, id: string, text = "It moved last week.", ids: string[] = []) =>
    value(userId, sql`select community.answer_correction(${id}::uuid, ${text}, ${`{${ids.join(",")}}`}::uuid[])`);
  const stored = async (id: string) => (await owner.query<Obj>("select status, outcome_code, closed_at is not null closed, round(extract(epoch from retention_until - now()) / 86400)::int days from priv.complaint where id = $1", [id])).rows[0];
  const audits = async (action: string, id: string) => (await owner.query<{ after: Obj }>("select after from core.audit_event where request_id = $1 and action = $2 and entity_id = $3", [requestId, action, id])).rows;

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
      [transport, ["commuter", "transport_reviewer"]],
      [admin, ["commuter", "admin"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("commit");
    app = new pg.Pool({ connectionString: appUrl, max: 3 });
  }, 120_000);
  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it("matrix: only the reporter; everyone else gets the same nothing as for a report that does not exist; guests are refused", async () => {
    const id = await waiting();
    for (const userId of strangers) {
      expect(await withdraw(userId, id), userId).toBeNull();
      expect(await answer(userId, id), userId).toBeNull();
      expect(await answerCorrection(userId, id), userId).toBeNull();
    }
    expect(await withdraw(reporter, randomUUID())).toBeNull();
    expect(await answer(reporter, randomUUID())).toBeNull();
    expect(await code(withdraw(null, id))).toBe("28000");
    expect(await code(answer(null, id))).toBe("28000");
    expect(await code(answerCorrection(null, id))).toBe("28000");
    expect(await stored(id)).toMatchObject({ status: "needs_information" });
    // No direct path, the reporter included.
    expect(await code(rows(reporter, sql`update priv.complaint set status = 'withdrawn' where id = ${id}::uuid`))).toBe("42501");
    expect(await code(rows(reporter, sql`insert into priv.complaint_event (complaint_id, to_status, actor_role) values (${id}::uuid, 'withdrawn', 'reporter')`))).toBe("42501");
  });

  it("withdraw: from submitted and from needs_information, deleted after 30 days; twice is fine; audited without text", async () => {
    for (const id of [await complaint(), await waiting()]) {
      expect(await withdraw(reporter, id)).toBe(true);
      expect(await stored(id)).toEqual({ status: "withdrawn", outcome_code: "reporter_withdrew", closed: true, days: 30 });
      expect(await withdraw(reporter, id)).toBe(true);
      const audit = await audits("complaint.withdraw", id);
      expect(audit).toHaveLength(1);
      expect(Object.keys(audit[0]!.after)).toEqual(["from"]);
      expect((await rows(reporter, sql`select to_status, actor_role from priv.complaint_event where complaint_id = ${id}::uuid order by at desc limit 1`))[0]).toEqual({ to_status: "withdrawn", actor_role: "reporter" });
      // Nothing more happens to it.
      expect(await code(answer(reporter, id))).toBe("55000");
      expect(await code(move(id, "under_review"))).toBe("22023");
    }
  });

  it("withdraw is refused while a reviewer has it and once it is closed", async () => {
    const id = await complaint();
    await move(id, "under_review");
    expect(await code(withdraw(reporter, id))).toBe("55000");
    await move(id, "closed", "outside_scope");
    expect(await code(withdraw(reporter, id))).toBe("55000");
    expect(await stored(id)).toMatchObject({ status: "closed", days: 365 });
  });

  it("the purge takes a withdrawn report after 30 days, not before, and never under legal hold", async () => {
    const m = await media(reporter);
    const id = await complaint(evidence(m));
    await withdraw(reporter, id);
    const dueIds = async () => ((await value(null, sql`select priv.retention_due(200)`)) as { complaints: { id: string }[] }).complaints.map((c) => c.id);
    const shift = async (days: number) => {
      await owner.query("begin");
      await owner.query("set local role paranaga_definer");
      await owner.query("update priv.complaint set retention_until = retention_until - make_interval(days => $2::int) where id = $1", [id, days]);
      await owner.query("commit");
    };
    await shift(29);
    expect(await dueIds()).not.toContain(id);
    expect(await value(null, sql`select priv.retention_purge_complaint(${id}::uuid)`)).toBe(false);
    await shift(2);
    expect(await dueIds()).toContain(id);
    await stepped(sql`select priv.set_complaint_legal_hold(${id}::uuid, true, 'Asked for by a court.')`);
    expect(await dueIds()).not.toContain(id);
    expect(await value(null, sql`select priv.retention_purge_complaint(${id}::uuid)`)).toBe(false);
    await stepped(sql`select priv.set_complaint_legal_hold(${id}::uuid, false, 'Released.')`);
    expect(await value(null, sql`select priv.retention_purge_complaint(${id}::uuid)`)).toBe(true);
    expect((await owner.query("select 1 from core.media_object where id = $1", [m])).rowCount).toBe(0);
  });

  it("answer: back to the reviewer with the text and new files; the reporter sees their words; audited without them", async () => {
    const first = await media(reporter);
    const id = await waiting(evidence(first));
    const added = await media(reporter);
    expect(await answer(reporter, id, "  It was the one to Pacol.  ", evidence(added))).toBe(true);
    expect(await stored(id)).toMatchObject({ status: "under_review", closed: false, days: null });
    const own = await rows(reporter, sql`select to_status, actor_role, note from priv.complaint_event where complaint_id = ${id}::uuid order by at desc limit 1`);
    expect(own).toEqual([{ to_status: "under_review", actor_role: "reporter", note: "It was the one to Pacol." }]);
    const seen = (await stepped(sql`select priv.review_complaint(${id}::uuid) as r`))[0]!.r as { events: Obj[]; evidence: Obj[] };
    expect(seen.events.at(-1)).toMatchObject({ actorRole: "reporter", mine: false, note: "It was the one to Pacol." });
    expect(seen.evidence).toHaveLength(2);
    expect(JSON.stringify(seen)).not.toContain(reporter);
    expect((await audits("complaint.answer", id)).map((a) => a.after)).toEqual([{ evidence: 1 }]);
    expect(await code(answer(reporter, id))).toBe("55000"); // answered already
    await move(id, "needs_information"); // asked again
    expect(await answer(reporter, id, "One more thing.")).toBe(true);
  });

  it("answer: bad texts and files are refused and change nothing", async () => {
    const id = await waiting();
    const mine = await media(reporter);
    const used = await media(reporter);
    await complaint(evidence(used));
    const theirs = await media(other);
    const wrongPurpose = await media(reporter, "correction_evidence");
    for (const [text, ev] of [
      ["   ", "[]"],
      ["x".repeat(1001), "[]"],
      ["ok", "{}"],
      ["ok", evidence(mine, mine)],
      ["ok", evidence(used)],
      ["ok", evidence(theirs)],
      ["ok", evidence(wrongPurpose)],
      ["ok", evidence(mine, randomUUID(), randomUUID(), randomUUID())],
    ] as const) expect(await code(answer(reporter, id, text, ev)), `${text.slice(0, 5)} ${ev}`).toBe("22023");
    expect(await stored(id)).toMatchObject({ status: "needs_information" });
    expect((await owner.query("select 1 from priv.complaint_media where complaint_id = $1", [id])).rowCount).toBe(0);
  });

  it("answer: at most 6 files on a report", async () => {
    const id = await waiting(evidence(await media(reporter), await media(reporter), await media(reporter)));
    expect(await answer(reporter, id, "More.", evidence(await media(reporter), await media(reporter), await media(reporter)))).toBe(true);
    await move(id, "needs_information");
    expect(await code(answer(reporter, id, "Too many.", evidence(await media(reporter))))).toBe("22023");
  });

  it("a withdrawal and a reviewer's decision at the same moment: one wins, the other is told", async () => {
    const id = await complaint();
    const results = await Promise.all([code(withdraw(reporter, id)), code(move(id, "under_review"))]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(["withdrawn", "under_review"]).toContain((await stored(id))!.status);
  });

  it("corrections: needs_evidence goes back to submitted with the text and photos; 3 photos at most", async () => {
    const first = await media(reporter, "correction_evidence");
    const id = (await rows(reporter, sql`select * from community.submit_correction(${randomUUID()}::uuid, 'wrong_curb_side', 'stop', 'stop-1', null,
      'The sign is on the other side.', null, null, null, ${`{${first}}`}::uuid[], 'auto_publish_disabled')`))[0]!.id as string;
    expect(await code(answerCorrection(reporter, id))).toBe("55000");
    const ask = () => rows(transport, sql`select community.admin_review_correction(${id}::uuid, 'submitted', 'request_info', 'need_photo', null, null, null, null)`);
    await ask();
    for (const userId of strangers) expect(await answerCorrection(userId, id), userId).toBeNull();
    const added = await media(reporter, "correction_evidence");
    const theirs = await media(other, "correction_evidence");
    const wrong = await media(reporter);
    for (const ids of [[theirs], [wrong], [added, added], [first], [randomUUID()]]) expect(await code(answerCorrection(reporter, id, "ok", ids))).toBe("22023");
    expect(await code(answerCorrection(reporter, id, " "))).toBe("22023");
    expect(await answerCorrection(reporter, id, "Here is the photo.", [added])).toBe(true);
    expect((await rows(reporter, sql`select status, media_ids from community.correction where id = ${id}::uuid`))[0]).toEqual({ status: "submitted", media_ids: [first, added] });
    const queue = JSON.stringify(await value(transport, sql`select community.admin_corrections('open', 200)`));
    expect(queue).toContain("Here is the photo.");
    expect((await audits("correction.answer", id)).map((a) => a.after)).toEqual([{ photos: 1 }]);
    await ask();
    expect(await code(answerCorrection(reporter, id, "ok", [await media(reporter, "correction_evidence"), await media(reporter, "correction_evidence")]))).toBe("22023");
    expect(await answerCorrection(reporter, id, "No more photos.")).toBe(true);
  });
});
