// Candidate review, stops and curbs, reconciliation and imports (N5b, migration 0024) against a
// migrated Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// Role matrix on every new definer function (guest, commuter, community moderator, complaint
// reviewer refused; admin and transport reviewer allowed), the app role's lack of any direct path,
// and AC-8 end to end through the real functions: a draft → the changed-data import (moved pin,
// new pin, missing pin; a rerun is unchanged) → evidence → promotion (refused without evidence and
// on a stale version) → relocation of a stop in a route's stop order (the variant version and its
// route stops follow) → retirement (refused while in a stop order) → curb edit (refused without
// curb evidence) → reconciliation link → validation (database checks pass after every repoint,
// the moved stop is flagged) → publish with step-up → the public views show it → audit rows.
// Puts the previously published revision back at the end.
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validationFactsSchema } from "@/domain/admin/schemas";
import { validateRevision } from "@/domain/admin/validation";
import { runInRequestContext, type Db } from "@/server/db/run-in-context";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Pin = { key: string; layer: string; code: string; label: string; lon: string; lat: string };

describe.skipIf(!ownerUrl || !appUrl || !importUrl)("admin stops, reconciliation and imports (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  const map = `TESTMAP${run}`;
  const admin = `test-adm5b-${run}`;
  const reviewer = `test-trev5b-${run}`;
  const commuter = `test-com5b-${run}`;
  const moderator = `test-mod5b-${run}`;
  const complaintReviewer = `test-crev5b-${run}`;
  const requestId = `adm5b-${run}`;
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;
  let previous: string | null = null;
  let base = "";
  let baseBatch = "";
  const stop: Record<string, string> = {};
  const pins: Pin[] = [
    { key: "S1", layer: "Loop Service A", code: "A1", label: "Plaza Rizal", lon: "123.1846726", lat: "13.6233869" },
    { key: "S2", layer: "Loop Service A", code: "A2", label: "Plaza Quince Martires", lon: "123.1861778", lat: "13.6244338" },
    { key: "S3", layer: "Loop Service C", code: "C1", label: "Plaza Quince Martires", lon: "123.1861778", lat: "13.6244338" },
    { key: "S4", layer: "Loop Service D", code: "D1", label: "Naga Cathedral", lon: "123.1897000", lat: "13.6261000" },
  ];
  const identity = (p: Pin) => sha(`${map}|${p.layer}|${p.code}|${p.label.toLowerCase()}`);
  const content = (p: Pin) => sha(JSON.stringify([p.layer, p.code, p.label, p.lon, p.lat]));
  const feature = (p: Pin) => ({
    source_identity: identity(p), identity_method: "layer_code_label", source_layer: p.layer, source_code_raw: p.code, label_raw: p.label,
    description_raw: p.label, coordinates_raw: `${p.lon},${p.lat},0`, lon: p.lon, lat: p.lat, properties: {}, content_hash: content(p), stop_name: p.label,
  });
  const plan = (list: Pin[], expected: string, date: string) => ({
    mapId: map, snapshotVersion: `mymaps:${map}:${date}`, retrievedOn: date, fileName: `test-${run}.kml`, sha256: sha(`${run}${date}${list.length}`),
    bytes: 1000, expectedBaselineBatchId: expected, features: list.map(feature), conflicts: [],
  });

  const as = <T>(userId: string | null, fn: (db: Db) => Promise<T>, opts: { stepUp?: boolean } = {}) =>
    runInRequestContext<T>(app, { userId, requestId }, async (db) => {
      if (opts.stepUp) await db.execute(sql`select set_config('app.step_up_at', now()::text, true)`);
      return fn(db);
    });
  const one = async <T = Record<string, unknown>>(userId: string | null, query: ReturnType<typeof sql>, opts: { stepUp?: boolean } = {}) =>
    (await as(userId, async (db) => (await db.execute(query)).rows, opts))[0] as T;
  const value = async <T = unknown>(userId: string | null, query: ReturnType<typeof sql>) => Object.values((await one(userId, query)) as object)[0] as T;
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
  const member = async (revision: string, kind: string, entity: string) =>
    (await owner.query<{ v: string }>("select version_id as v from transit.revision_member where revision_id = $1 and entity_kind = $2 and entity_id = $3", [revision, kind, entity])).rows[0]?.v ?? null;
  const stops = async (userId: string) => (await value<{ revision: { id: string; status: string }; stops: Record<string, unknown>[] }>(userId, sql`select transit.admin_stops(null) as d`));
  const versionOf = async (key: string) => (await stops(reviewer)).stops.find((s) => s.stopPointId === stop[key])!.versionId as string;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    await owner.query("begin");
    await owner.query("set local role paranaga_definer");
    for (const [id, roles] of [
      [admin, ["commuter", "admin"]],
      [reviewer, ["commuter", "transport_reviewer"]],
      [commuter, ["commuter"]],
      [moderator, ["commuter", "community_moderator"]],
      [complaintReviewer, ["commuter", "complaint_reviewer"]],
    ] as const) {
      await owner.query("insert into core.profile (user_id, display_name) values ($1, $1)", [id]);
      for (const role of roles) await owner.query("insert into core.user_role (user_id, role_code, reason) values ($1, $2, 'test seed')", [id, role]);
    }
    await owner.query("update transit.revision set status = 'superseded' where status in ('draft', 'validating')");
    await owner.query("commit");

    // A small published base as the importer writes it: one committed My Maps batch with four pins,
    // one candidate stop per pin, a Loop A circuit whose provisional stop order uses S1 and S2.
    previous = await pointer();
    const q = (text: string, params: unknown[] = []) => importer.query(text, params);
    const src = (await q("select code from ingest.source where code = 'S40'")).rows[0];
    if (!src) await q("insert into ingest.source (code, title) values ('S40', 'My Maps export (test)')");
    const doc = (await q("insert into ingest.source_document (source_code, file_name, sha256, bytes) values ('S40', $1, $2, 1000) returning id", [`base-${run}.kml`, sha(`base${run}`)])).rows[0].id;
    baseBatch = (await q(
      "insert into ingest.batch (source_document_id, snapshot_version, mode, status, started_by, finished_at) values ($1, $2, 'commit', 'committed', 'test', now()) returning id",
      [doc, `mymaps:${map}:2026-10-15`],
    )).rows[0].id;
    const rev = (await q("insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id", [`adm5b-${run}-base`])).rows[0].id;
    const route = (await q("insert into transit.route (public_code, name) values ($1, 'Admin 5b loop') returning id", [`ADM5B-${run}`])).rows[0].id;
    const variant = (await q("insert into transit.variant (route_id, direction, kind) values ($1, 'clockwise', 'permanent') returning id", [route])).rows[0].id;
    const vv = (await q("insert into transit.variant_version (variant_id, evidence_level, is_circular) values ($1, 'provisional', true) returning id", [variant])).rows[0].id;
    await q("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'route', $2, $2), ($1, 'variant', $3, $4)", [rev, route, variant, vv]);
    for (const p of pins) {
      const raw = (await q(
        `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw, label_raw, coordinates_raw, lon, lat, content_hash)
         values ($1, $2, 'layer_code_label', $3, $4, $5, $6, $7, $8, $9) returning id`,
        [baseBatch, identity(p), p.layer, p.code, p.label, `${p.lon},${p.lat},0`, p.lon, p.lat, content(p)],
      )).rows[0].id;
      const sp = (await q("insert into transit.stop_point (name) values ($1) returning id", [p.label])).rows[0].id;
      const spv = (await q(
        `insert into transit.stop_point_version (stop_point_id, geog, source_layer, source_code_raw, label_raw, content_hash)
         values ($1, extensions.ST_SetSRID(extensions.ST_MakePoint($2::float8, $3::float8), 4326)::extensions.geography, $4, $5, $6, $7) returning id`,
        [sp, p.lon, p.lat, p.layer, p.code, p.label, content(p)],
      )).rows[0].id;
      await q("insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id) values ($1, $2, $3)", [sp, spv, raw]);
      await q("insert into ingest.raw_feature_lineage (source_identity, stop_point_id) values ($1, $2)", [identity(p), sp]);
      await q("insert into ingest.change (batch_id, source_identity, kind) values ($1, $2, 'added')", [baseBatch, identity(p)]);
      await q("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'stop_point', $2, $3)", [rev, sp, spv]);
      stop[p.key] = sp;
      if (p.key === "S1" || p.key === "S2") {
        await q("insert into transit.route_stop (variant_version_id, stop_point_version_id, seq, evidence_level) values ($1, $2, $3, 'provisional')", [vv, spv, p.key === "S1" ? 1 : 2]);
      }
    }
    await q("select transit.publish_revision($1)", [rev]);
    base = rev;
  }, 120_000);

  afterAll(async () => {
    if (previous && importer && (await pointer()) !== previous) await importer.query("select transit.publish_revision($1)", [previous]);
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  it("matrix: every N5b function refuses guests, commuters, moderators and complaint reviewers (42501)", async () => {
    const x = randomUUID();
    const calls = [
      sql`select transit.admin_stops(null)`,
      sql`select transit.admin_promote_stop(${x}::uuid, ${x}::uuid, 'documentary', null)`,
      sql`select transit.admin_attach_stop_evidence(${x}::uuid, ${x}::uuid, 'document', 'legal_designation', 'n', null, null, null)`,
      sql`select transit.admin_retire_stop(${x}::uuid, ${x}::uuid, 'reason')`,
      sql`select transit.admin_relocate_stop(${x}::uuid, ${x}::uuid, 13.62, 123.18, 'reason')`,
      sql`select transit.admin_edit_stop(${x}::uuid, ${x}::uuid, '{"name":"n"}'::jsonb)`,
      sql`select transit.admin_reconciliation()`,
      sql`select transit.admin_reconcile(${x}::uuid, ${x}::uuid, ${randomUUID()}::uuid, ${x}::uuid, 'keep_separate', null, null)`,
      sql`select ingest.admin_import_batches(5)`,
      sql`select ingest.admin_import_baseline()`,
      sql`select ingest.admin_import_commit('{}'::jsonb)`,
    ];
    for (const userId of [null, commuter, moderator, complaintReviewer]) {
      for (const q of calls) expect((await failure(one(userId, q))).code, String(userId)).toBe("42501");
    }
  });

  it("the app role has no direct path: helpers, evidence tables, membership and ingest writes are refused", async () => {
    const x = randomUUID();
    for (const q of [
      sql`select transit.admin_repoint_stop(${base}::uuid, ${x}::uuid, ${x}::uuid, ${x}::uuid)`,
      sql`select transit.admin_copy_stop_version(${x}::uuid, '{}'::jsonb, null, null)`,
      sql`select transit.admin_open_draft()`,
      sql`select count(*) from transit.evidence`,
      sql`select count(*) from transit.evidence_link`,
      sql`select count(*) from transit.reconciliation_decision`,
      sql`update transit.revision_member set version_id = version_id where revision_id = ${base}::uuid`,
      sql`insert into ingest.batch (snapshot_version, mode, started_by) values ('mymaps:x:2026-01-01', 'commit', 'x')`,
      sql`insert into transit.stop_point (name) values ('x')`,
    ]) {
      expect((await failure(one(admin, q))).code).toBe("42501");
    }
  });

  it("AC-8: import → evidence → promote → relocate → retire → curb → reconcile → validate → publish, all audited", async () => {
    // Without a draft every write is refused.
    expect((await failure(one(reviewer, sql`select transit.admin_retire_stop(${stop.S4}::uuid, ${randomUUID()}::uuid, 'reason')`))).message).toMatch(/no draft revision is open/);
    const draft = await value<string>(reviewer, sql`select transit.admin_create_draft() as id`);
    const listed = await stops(admin);
    expect(listed.revision).toMatchObject({ id: draft, status: "draft" });
    expect(listed.stops.filter((s) => Object.values(stop).includes(s.stopPointId as string))).toHaveLength(4);

    // ---------------------------------------------------------------- C2: changed-data import
    const baseline = await value<{ batchId: string; mapId: string; features: unknown[] }>(reviewer, sql`select ingest.admin_import_baseline() as b`);
    expect(baseline).toMatchObject({ batchId: baseBatch, mapId: map });
    const batches = async () => Number((await owner.query("select count(*) as n from ingest.batch where snapshot_version like $1", [`mymaps:${map}:%`])).rows[0].n);
    // Same pins again: unchanged, nothing written (AC-1 on this path).
    const same = await value<Record<string, unknown>>(reviewer, sql`select ingest.admin_import_commit(${JSON.stringify(plan(pins, baseBatch, "2026-10-20"))}::jsonb) as r`);
    expect(same).toMatchObject({ outcome: "unchanged", batchId: baseBatch, counts: { unchanged: 4, added: 0, changed: 0, missing: 0 } });
    expect(await batches()).toBe(1);
    // S3 moved 5 m, S4 gone, a new pin.
    const moved: Pin = { ...pins[2]!, lat: "13.6244788" };
    const added: Pin = { key: "S5", layer: "Loop Service D", code: "D2", label: "Bagumbayan", lon: "123.1950000", lat: "13.6300000" };
    const s3before = await member(draft, "stop_point", stop.S3!);
    const commit = await value<{ outcome: string; batchId: string; counts: Record<string, unknown> }>(
      reviewer, sql`select ingest.admin_import_commit(${JSON.stringify(plan([pins[0]!, pins[1]!, moved, added], baseBatch, "2026-10-20"))}::jsonb) as r`);
    expect(commit).toMatchObject({ outcome: "committed", counts: { added: 1, changed: 1, unchanged: 2, missing: 1, new_candidate_stops: 1, new_stop_versions: 1 } });
    const kinds = (await owner.query("select kind, count(*)::int as n from ingest.change where batch_id = $1 group by kind order by kind", [commit.batchId])).rows;
    expect(kinds).toEqual([{ kind: "added", n: 1 }, { kind: "changed", n: 1 }, { kind: "missing", n: 1 }, { kind: "unchanged", n: 2 }]);
    expect(await member(draft, "stop_point", stop.S3!)).not.toBe(s3before);
    // The rerun of the new file is unchanged; the old dry run's baseline is stale.
    const again = await value<Record<string, unknown>>(reviewer, sql`select ingest.admin_import_commit(${JSON.stringify(plan([pins[0]!, pins[1]!, moved, added], commit.batchId, "2026-10-21"))}::jsonb) as r`);
    expect(again).toMatchObject({ outcome: "unchanged", counts: { unchanged: 4 } });
    expect((await failure(one(reviewer, sql`select ingest.admin_import_commit(${JSON.stringify(plan(pins, baseBatch, "2026-10-22"))}::jsonb)`))).message).toMatch(/another import was committed since the dry run/);

    // ---------------------------------------------------------------- C3: evidence and promotion
    const s4v0 = await versionOf("S4");
    expect((await failure(one(reviewer, sql`select transit.admin_promote_stop(${stop.S4}::uuid, ${s4v0}::uuid, 'documentary', null)`))).message).toMatch(/needs evidence for legal_designation/);
    const s4v1 = await value<string>(reviewer, sql`select transit.admin_attach_stop_evidence(${stop.S4}::uuid, ${s4v0}::uuid, 'document', 'legal_designation', 'Ordinance list, item 4.', '2026-10-01'::date, null, null) as v`);
    expect((await failure(one(reviewer, sql`select transit.admin_promote_stop(${stop.S4}::uuid, ${s4v0}::uuid, 'documentary', null)`))).message).toMatch(/changed since the page was loaded/);
    const s4v2 = await value<string>(reviewer, sql`select transit.admin_promote_stop(${stop.S4}::uuid, ${s4v1}::uuid, 'documentary', 'ok') as v`);
    expect((await owner.query("select status from transit.stop_point_version where id = $1", [s4v2])).rows[0].status).toBe("documentary");
    // A photo must be the caller's own verified stop photo.
    expect((await failure(one(reviewer, sql`select transit.admin_attach_stop_evidence(${stop.S4}::uuid, ${s4v2}::uuid, 'photo', 'sign_installed', null, null, null, ${randomUUID()}::uuid)`))).message).toMatch(/not a verified stop photo/);

    // ---------------------------------------------------------------- relocation of a sequenced stop
    const variant = (await owner.query<{ entity_id: string; version_id: string }>(
      "select m.entity_id, m.version_id from transit.revision_member m join transit.variant v on v.id = m.entity_id join transit.route r on r.id = v.route_id where m.revision_id = $1 and m.entity_kind = 'variant' and r.public_code = $2",
      [draft, `ADM5B-${run}`])).rows[0]!;
    const s1v0 = await versionOf("S1");
    const s1v1 = await value<string>(admin, sql`select transit.admin_relocate_stop(${stop.S1}::uuid, ${s1v0}::uuid, 13.6239269, 123.1846726, 'Pin was in the plaza; the curb is north.') as v`);
    const vvNow = await member(draft, "variant", variant.entity_id);
    expect(vvNow).not.toBe(variant.version_id);
    const order = (await owner.query("select seq, stop_point_version_id as v from transit.route_stop where variant_version_id = $1 order by seq", [vvNow])).rows;
    expect(order).toEqual([{ seq: 1, v: s1v1 }, { seq: 2, v: await member(draft, "stop_point", stop.S2!) }]);
    expect((await failure(one(admin, sql`select transit.admin_retire_stop(${stop.S1}::uuid, ${s1v1}::uuid, 'not a stop')`))).message).toMatch(/stop order of ADM5B/);
    await value(admin, sql`select transit.admin_retire_stop(${stop.S4}::uuid, ${s4v2}::uuid, 'Pin removed from the map.') as v`);

    // ---------------------------------------------------------------- curb edit needs curb evidence
    const s2v0 = await versionOf("S2");
    expect((await failure(one(reviewer, sql`select transit.admin_edit_stop(${stop.S2}::uuid, ${s2v0}::uuid, '{"curbSide":"right_of_travel"}'::jsonb)`))).message).toMatch(/need curb position evidence/);
    const s2v1 = await value<string>(reviewer, sql`select transit.admin_attach_stop_evidence(${stop.S2}::uuid, ${s2v0}::uuid, 'field_survey', 'curb_position', 'Surveyed: shelter on the right of travel.', null, null, null) as v`);
    const s2v2 = await value<string>(reviewer, sql`select transit.admin_edit_stop(${stop.S2}::uuid, ${s2v1}::uuid, ${JSON.stringify({ curbSide: "right_of_travel", name: "Quince Martires stop", aliases: ["Plaza 15"] })}::jsonb) as v`);
    expect((await owner.query("select curb_side, name, aliases from transit.stop_point_version where id = $1", [s2v2])).rows[0]).toEqual({ curb_side: "right_of_travel", name: "Quince Martires stop", aliases: ["Plaza 15"] });

    // ---------------------------------------------------------------- reconciliation: link S3 into S2
    const rec = await value<{ pairs: { a: { stopPointId: string }; b: { stopPointId: string }; distanceM: number }[] }>(reviewer, sql`select transit.admin_reconciliation() as d`);
    const pair = rec.pairs.find((p) => [p.a.stopPointId, p.b.stopPointId].sort().join() === [stop.S2, stop.S3].sort().join());
    expect(pair).toBeTruthy();
    const s3v = await versionOf("S3");
    const linked = await value<{ keptVersionId: string; retiredVersionId: string }>(admin,
      sql`select transit.admin_reconcile(${stop.S2}::uuid, ${s2v2}::uuid, ${stop.S3}::uuid, ${s3v}::uuid, 'link', ${stop.S2}::uuid, 'One stop, two layers.') as r`);
    const keptPins = (await owner.query("select count(*)::int as n from transit.stop_point_source where stop_point_version_id = $1", [linked.keptVersionId])).rows[0].n;
    expect(keptPins).toBe(2);
    expect((await owner.query("select status from transit.stop_point_version where id = $1", [linked.retiredVersionId])).rows[0].status).toBe("retired");
    expect((await failure(one(admin, sql`select transit.admin_reconcile(${stop.S2}::uuid, ${linked.keptVersionId}::uuid, ${stop.S3}::uuid, ${linked.retiredVersionId}::uuid, 'keep_separate', null, null)`))).code).toBe("55000");

    // ---------------------------------------------------------------- validate and publish
    const facts = validationFactsSchema.parse(await value(reviewer, sql`select transit.admin_validation_facts(${draft}::uuid) as f`));
    expect(facts.dbCheck).toEqual({ ok: true });
    const s1 = facts.stops.find((s) => s.stopPointId === stop.S1)!;
    expect(s1.movedM).toBeGreaterThan(50);
    expect(s1.inSequence).toBe(true);
    expect(facts.stops.find((s) => s.stopPointId === stop.S2)!).toMatchObject({ curbSide: "right_of_travel", evidenceClaims: ["curb_position"], name: "Quince Martires stop" });
    const report = validateRevision(facts);
    expect(report.ok).toBe(true);
    expect(report.issues.map((i) => i.rule)).toContain("stop_moved_far");
    expect(report.issues.map((i) => i.rule)).not.toContain("curb_without_evidence");
    await as(reviewer, (db) => db.execute(sql`select transit.admin_record_validation(${draft}::uuid, ${facts.membershipHash}, ${JSON.stringify(report)}::jsonb)`));
    await one(admin, sql`select transit.admin_publish_revision(${draft}::uuid, ${base}::uuid, 'publish')`, { stepUp: true });
    expect(await pointer()).toBe(draft);
    const pub = await one<{ name: string; status: string; curb_side: string }>(null, sql`select name, status, curb_side from transit.v_published_stops where stop_point_id = ${stop.S2}::uuid`);
    expect(pub).toEqual({ name: "Quince Martires stop", status: "candidate", curb_side: "right_of_travel" });
    const ride = await one<{ v: string }>(null, sql`select stop_point_version_id as v from transit.v_published_route_stops where stop_point_id = ${stop.S1}::uuid`);
    expect(ride.v).toBe(s1v1);
    // Edits need a draft again.
    expect((await failure(one(admin, sql`select transit.admin_retire_stop(${stop.S1}::uuid, ${s1v1}::uuid, 'reason')`))).message).toMatch(/no draft revision is open/);

    const audit = (await owner.query<{ action: string }>("select action from core.audit_event where request_id = $1 order by at", [requestId])).rows.map((r) => r.action);
    expect(audit).toEqual([
      "revision.draft_create",
      "import.commit",
      "stop.evidence_attach",
      "stop.promote",
      "stop.relocate",
      "stop.retire",
      "stop.evidence_attach",
      "stop.edit",
      "stop.reconcile",
      "revision.validate",
      "revision.publish",
    ]);
  });
});
