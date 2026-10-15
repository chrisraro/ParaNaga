// `pnpm db:import` against a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// Commits the real Data_Sets package once (or finds it already committed by another file on the
// shared branch), checks what landed, then commits again and checks that nothing changed. Counts
// are scoped to the import's batch and revision because other integration files share the branch;
// file order does not matter.
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";
import { buildImportPlan, PUBLIC_STOP_MAP_KEYS, readDataFiles, type ImportPlan } from "../../scripts/lib/import-plan";
import { commitImport, ImportRefusedError, type ImportOutcome } from "../../scripts/lib/import-writer";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

const INGEST_AND_TRANSIT = [
  "ingest.source", "ingest.source_document", "ingest.batch", "ingest.raw_feature", "ingest.raw_feature_lineage",
  "ingest.change", "ingest.conflict", "ingest.error", "transit.revision", "transit.revision_member",
  "transit.published_pointer", "transit.route", "transit.route_alias", "transit.variant", "transit.variant_version",
  "transit.stop_point", "transit.stop_point_version", "transit.stop_point_source", "transit.route_stop",
  "transit.terminal", "transit.fare_rule", "transit.fare_rule_version", "transit.fare_observation",
  "transit.fare_conflict", "transit.barangay", "transit.coverage_audit", "transit.feeder_lead",
  "transit.provider_presence", "transit.rail_status", "transit.designated_stop_candidate",
  "transit.external_destination_category", "transit.dataset_note",
];

describe.skipIf(!ownerUrl || !appUrl)("pnpm db:import (Neon branch)", () => {
  let plan: ImportPlan;
  let first: ImportOutcome;
  let batchIdValue = "";
  let revisionIdValue = "";
  let owner: pg.Client;
  let app: pg.Pool;

  /** Reads as paranaga_import (sees every ingest/transit row) inside a rolled-back transaction. */
  const asImport = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      return await fn(owner);
    } finally {
      await owner.query("rollback");
    }
  };
  const scalar = async (text: string, values: unknown[] = []) =>
    asImport(async (c) => Number((await c.query(text, values)).rows[0].n));
  const tableCounts = () =>
    asImport(async (c) => {
      const out: Record<string, number> = {};
      for (const t of INGEST_AND_TRANSIT) out[t] = Number((await c.query(`select count(*) as n from ${t}`)).rows[0].n);
      return out;
    });
  const appRows = async (query: ReturnType<typeof sql>) =>
    runInRequestContext(app, { userId: null, requestId: "import-test" }, async (db) => (await db.execute(query)).rows);

  beforeAll(async () => {
    plan = buildImportPlan(readDataFiles("Data_Sets"));
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
    first = await commitImport(ownerUrl!, plan);
    batchIdValue = first.batchId;
    revisionIdValue = first.outcome === "committed"
      ? first.revisionId
      : (await owner.query("select id from transit.revision where label = $1", [plan.revisionLabel])).rows[0].id;
    // Another file may have published test revisions since the import; publish (= roll back to)
    // the Naga revision so the published-view checks below see it.
    const current = await owner.query("select revision_id from transit.published_pointer");
    if (current.rows[0]?.revision_id !== revisionIdValue) {
      await owner.query("begin");
      try {
        await owner.query("set local role paranaga_import");
        await owner.query("select transit.publish_revision($1)", [revisionIdValue]);
        await owner.query("commit");
      } catch (error) {
        await owner.query("rollback");
        throw error;
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  const batchId = () => batchIdValue;
  const revisionId = () => revisionIdValue;

  it("commits (or has committed) and publishes provisional-loops-2026-10-15", async () => {
    expect(["committed", "unchanged"]).toContain(first.outcome);
    const pointer = await appRows(sql`select label, kind from transit.v_published_revision`);
    expect(pointer).toEqual([{ label: "provisional-loops-2026-10-15", kind: "provisional" }]);
    const batch = await asImport(async (c) =>
      (await c.query(`select status, mode, snapshot_version, counts->>'documents_sha256' as docs from ingest.batch where id = $1`,
        [batchId()])).rows[0]);
    expect(batch).toEqual({ status: "committed", mode: "commit", snapshot_version: plan.snapshotVersion, docs: plan.documentsHash });
  });

  it("stores 7 hashed documents, 42 sources and 128 raw features with verbatim coordinates", async () => {
    expect(await scalar(`select count(*) as n from ingest.source_document where sha256 = any($1)`,
      [plan.documents.map((d) => d.sha256)])).toBe(7);
    expect(await scalar(`select count(*) as n from ingest.source where code = any($1)`,
      [plan.seed.sources.map((s) => s.code)])).toBe(42);
    const layers = await asImport(async (c) => (await c.query(
      `select source_layer, count(*)::int as n from ingest.raw_feature where batch_id = $1 group by 1 order by 1`,
      [batchId()])).rows);
    expect(layers).toEqual([
      { source_layer: "Loop Service A", n: 30 }, { source_layer: "Loop Service B", n: 31 },
      { source_layer: "Loop Service C", n: 34 }, { source_layer: "Loop Service D", n: 33 },
    ]);
    const a1 = await asImport(async (c) => (await c.query(
      `select coordinates_raw, lon::text, lat::text, label_raw from ingest.raw_feature
        where batch_id = $1 and source_layer = 'Loop Service A' and source_code_raw = 'A1'`, [batchId()])).rows);
    expect(a1).toEqual([{ coordinates_raw: "123.1846726,13.6233869,0", lon: "123.18467260", lat: "13.62338690", label_raw: "Plaza Rizal" }]);
    expect(await scalar(`select count(*) as n from ingest.change where batch_id = $1 and kind = 'added'`, [batchId()])).toBe(128);
    const conflicts = await asImport(async (c) => (await c.query(
      `select kind, count(*)::int as n from ingest.conflict where batch_id = $1 group by 1 order by 1`, [batchId()])).rows);
    expect(conflicts).toEqual([
      { kind: "code_prefix_mismatch", n: 53 }, { kind: "exact_coordinate_shared", n: 14 }, { kind: "near_duplicate", n: 46 },
    ]);
  });

  it("creates one candidate stop per raw feature, linked to its source pin", async () => {
    expect(await scalar(
      `select count(*) as n from transit.revision_member m
         join transit.stop_point_version v on v.id = m.version_id and v.stop_point_id = m.entity_id
        where m.revision_id = $1 and m.entity_kind = 'stop_point' and v.status = 'candidate' and not v.navigation_approved`,
      [revisionId()])).toBe(128);
    expect(await scalar(
      `select count(distinct s.stop_point_id) as n from transit.stop_point_source s
         join ingest.raw_feature r on r.id = s.raw_feature_id where r.batch_id = $1`, [batchId()])).toBe(128);
    expect(await scalar(
      `select count(*) as n from ingest.raw_feature_lineage l join ingest.raw_feature r on r.source_identity = l.source_identity
        where r.batch_id = $1`, [batchId()])).toBe(128);
    const blank = await asImport(async (c) => (await c.query(
      `select sp.name, v.label_raw, v.source_code_raw from transit.revision_member m
         join transit.stop_point sp on sp.id = m.entity_id join transit.stop_point_version v on v.id = m.version_id
        where m.revision_id = $1 and m.entity_kind = 'stop_point' and v.label_raw = '' order by 1`, [revisionId()])).rows);
    expect(blank).toEqual([
      { name: "B18", label_raw: "", source_code_raw: "B18" },
      { name: "B19", label_raw: "", source_code_raw: "B19" },
    ]);
  });

  it("publishes 11 routes, 18 variants and 61 provisional route stops (30 + 31)", async () => {
    const routes = await appRows(sql`select public_code, mode_code from transit.v_published_routes order by public_code`);
    expect(routes.map((r) => r.public_code)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D"]);
    expect(routes.every((r) => r.mode_code === "PUJ_Class_2_plan")).toBe(true);
    const variants = await appRows(sql`select evidence_level, kind, count(*)::int as n from transit.v_published_variants
                                        group by 1, 2 order by 1, 2`);
    expect(variants).toEqual([
      { evidence_level: "documentary", kind: "permanent", n: 14 },
      { evidence_level: "documentary", kind: "trial", n: 2 },
      { evidence_level: "provisional", kind: "permanent", n: 2 },
    ]);
    const loops = await appRows(sql`
      select r.public_code, count(*)::int as n, min(rs.seq) as first, max(rs.seq) as last, bool_and(v.is_circular) as circular
        from transit.v_published_route_stops rs
        join transit.v_published_variants v on v.variant_version_id = rs.variant_version_id
        join transit.v_published_routes r on r.id = v.route_id
       group by 1 order by 1`);
    expect(loops).toEqual([
      { public_code: "R8-A", n: 30, first: 1, last: 30, circular: true },
      { public_code: "R8-B", n: 31, first: 1, last: 31, circular: true },
    ]);
    const firstStop = await appRows(sql`
      select s.source_code_raw from transit.v_published_route_stops rs
        join transit.v_published_stops s on s.stop_point_version_id = rs.stop_point_version_id
        join transit.v_published_variants v on v.variant_version_id = rs.variant_version_id
        join transit.v_published_routes r on r.id = v.route_id
       where r.public_code = 'R8-B' and rs.seq = 1`);
    expect(firstStop).toEqual([{ source_code_raw: "B1" }]);
    const trial = await appRows(sql`select trial_status, effective_from::text, trial_duration_days
                                      from transit.v_published_variants where kind = 'trial'`);
    expect(trial).toEqual([
      { trial_status: "permanence_unconfirmed", effective_from: "2025-11-11", trial_duration_days: 30 },
      { trial_status: "permanence_unconfirmed", effective_from: "2025-11-11", trial_duration_days: 30 },
    ]);
  });

  it("publishes F01–F04 as non-exact draft rules and F05 only as an observation in conflict with F03", async () => {
    const rules = await appRows(sql`select code, base_centavos, publish_exact, status from transit.v_published_fare_rules order by code`);
    expect(rules).toEqual([
      { code: "F01", base_centavos: 1400, publish_exact: false, status: "draft" },
      { code: "F02", base_centavos: 1700, publish_exact: false, status: "draft" },
      { code: "F03", base_centavos: 1500, publish_exact: false, status: "draft" },
      { code: "F04", base_centavos: 1000, publish_exact: false, status: "draft" },
    ]);
    const observation = await asImport(async (c) => (await c.query(
      `select o.code, o.amount_centavos, o.category, o.kind, o.fare_rule_id, r.code as conflict_rule, k.status
         from transit.revision_member m join transit.fare_observation o on o.id = m.entity_id
         join transit.fare_conflict k on k.fare_observation_id = o.id join transit.fare_rule r on r.id = k.fare_rule_id
        where m.revision_id = $1 and m.entity_kind = 'fare_observation'`, [revisionId()])).rows);
    expect(observation).toEqual([{
      code: "F05", amount_centavos: 1300, category: "student", kind: "reported_practice", fare_rule_id: null,
      conflict_rule: "F03", status: "open",
    }]);
  });

  it("publishes 6 terminals without coordinates and the rest of the seed", async () => {
    const terminals = await appRows(sql`select code, lon, lat from transit.v_published_terminals order by code`);
    expect(terminals.map((t) => t.code)).toEqual(["T01", "T02", "T03", "T04", "T05", "T06"]);
    expect(terminals.every((t) => t.lon === null && t.lat === null)).toBe(true);
    const members = await asImport(async (c) => (await c.query(
      `select entity_kind, count(*)::int as n from transit.revision_member where revision_id = $1 group by 1 order by 1`,
      [revisionId()])).rows);
    expect(Object.fromEntries(members.map((m) => [m.entity_kind, m.n]))).toEqual({
      barangay: 27, coverage_audit: 27, dataset_note: 10, designated_stop_candidate: 32,
      external_destination_category: 5, fare_conflict: 1, fare_observation: 1, fare_rule: 4, feeder_lead: 5,
      provider_presence: 3, rail_status: 4, route: 11, stop_point: 128, terminal: 6, variant: 18,
    });
    const notes = await appRows(sql`select value from transit.dataset_note where key = 'public_stop_map'`);
    expect(notes).toHaveLength(1);
    const value = notes[0]!.value as Record<string, unknown>;
    // Nothing beyond the attribution fields spec 04 §4.7 step 8 allows (plus the omission record).
    expect(Object.keys(value).sort()).toEqual([...PUBLIC_STOP_MAP_KEYS].sort());
    expect(value).toMatchObject({
      public_owner_display_name: "Tan Gumba",
      owner_identity_or_official_role_verified: false,
      omitted_keys_count: 12,
    });
  });

  it("stores fare rule version hashes that depend only on content", async () => {
    // The import revision's versions (a later modes seed adds versions of F01–F03 with more sources).
    const stored = await appRows(sql`select f.code, v.content_hash from transit.fare_rule_version v
                                       join transit.fare_rule f on f.id = v.fare_rule_id
                                       join transit.revision_member m on m.entity_kind = 'fare_rule' and m.version_id = v.id
                                      where m.revision_id = ${revisionIdValue}::uuid
                                        and f.code in (${sql.join(plan.fareRules.map((f) => sql`${f.code}`), sql`, `)}) order by f.code`);
    expect(stored).toEqual(plan.fareRules.map((f) => ({ code: f.code, content_hash: f.contentHash })));
  });

  it("paranaga_app reads the published stops", async () => {
    const stops = await appRows(sql`select count(*)::int as n from transit.v_published_stops`);
    expect(stops).toEqual([{ n: 128 }]);
  });

  it("a second commit with the same files writes nothing and keeps the published revision", async () => {
    const before = await tableCounts();
    const second = await commitImport(ownerUrl!, plan);
    expect(second).toMatchObject({ outcome: "unchanged", batchId: batchId(), publishedRevisionLabel: "provisional-loops-2026-10-15" });
    expect(await tableCounts()).toEqual(before);
    expect(await appRows(sql`select label from transit.v_published_revision`)).toEqual([{ label: "provisional-loops-2026-10-15" }]);
  });

  it("refuses changed files for an imported map without writing", async () => {
    const before = await tableCounts();
    const changed = { ...plan, documentsHash: "0".repeat(64) };
    await expect(commitImport(ownerUrl!, changed)).rejects.toBeInstanceOf(ImportRefusedError);
    expect(await tableCounts()).toEqual(before);
  });

  it("refuses a new snapshot of an already-imported map without writing", async () => {
    const before = await tableCounts();
    const later = { ...plan, snapshotVersion: `mymaps:${plan.mapId}:2099-01-01`, revisionLabel: "provisional-loops-2099-01-01" };
    await expect(commitImport(ownerUrl!, later)).rejects.toBeInstanceOf(ImportRefusedError);
    expect(await tableCounts()).toEqual(before);
    expect(await appRows(sql`select label from transit.v_published_revision`)).toEqual([{ label: "provisional-loops-2026-10-15" }]);
  });

  it("refuses a plan with problems before connecting", async () => {
    await expect(commitImport("postgres://invalid.invalid/none", { ...plan, problems: ["x"] }))
      .rejects.toBeInstanceOf(ImportRefusedError);
  });
});
