// Reviewed modes seed import (Increment D, Task 2) against a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// The start revision is resolved by label, never adopted from the pointer (another file may have
// left a throwaway revision published): the newest real osm-places-* revision (on a branch of
// main: osm-places-2026-10-15), else the transit import's revision. It is published before the
// tests and again afterwards, so later files see the state they expect.
// The synthetic fixture (fake names) must be refused by transit.publish_revision; the real
// reviewed seed must publish modes-2026-10-16 with every R1–R8 stop and variant member carried
// unchanged, and a second run must report "unchanged".
import { readFileSync } from "node:fs";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInRequestContext } from "@/server/db/run-in-context";
import { buildImportPlan, readDataFiles, readNewestModesSeed, type ModesFile } from "../../scripts/lib/import-plan";
import { commitImport } from "../../scripts/lib/import-writer";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

const LABEL = "modes-2026-10-16";
const TABLES = [
  "ingest.source", "ingest.source_document", "ingest.batch", "ingest.conflict", "transit.revision",
  "transit.revision_member", "transit.route", "transit.variant", "transit.variant_version", "transit.terminal",
  "transit.terminal_version", "transit.fare_rule", "transit.fare_rule_version", "transit.route_vehicle_class",
  "transit.route_cooperative", "transit.route_operating_status", "transit.route_fare_observation",
  "transit.regional_service", "transit.regional_service_version",
];
const LPTRP = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D"];

type Member = { entity_kind: string; entity_id: string; version_id: string };

describe.skipIf(!ownerUrl || !appUrl)("reviewed modes seed import (Neon branch)", () => {
  let owner: pg.Client;
  let app: pg.Pool;
  let startRevisionId = "";
  const files = readDataFiles("Data_Sets");
  const realSeed = readNewestModesSeed()!;

  const asImport = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      return await fn(owner);
    } finally {
      await owner.query("rollback");
    }
  };
  const tableCounts = () =>
    asImport(async (c) => {
      const out: Record<string, number> = {};
      for (const t of TABLES) out[t] = Number((await c.query(`select count(*) as n from ${t}`)).rows[0].n);
      return out;
    });
  const appRows = async (query: ReturnType<typeof sql>) =>
    runInRequestContext(app, { userId: null, requestId: "modes-seed-test" }, async (db) => (await db.execute(query)).rows);
  const publish = async (revisionId: string) => {
    await owner.query("begin");
    try {
      await owner.query("set local role paranaga_import");
      await owner.query("select transit.publish_revision($1)", [revisionId]);
      await owner.query("commit");
    } catch (error) {
      await owner.query("rollback");
      throw error;
    }
  };
  const members = (revisionId: string) =>
    asImport(async (c) => (await c.query<Member>(
      `select entity_kind, entity_id, version_id from transit.revision_member where revision_id = $1
        order by entity_kind, entity_id`, [revisionId])).rows);
  const revisionIdOf = async (label: string) =>
    (await owner.query<{ id: string }>("select id from transit.revision where label = $1", [label])).rows[0]?.id;
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return { code: (error as { code?: string }).code, message: (error as Error).message };
    }
    throw new Error("expected a failure");
  };
  /** Members of R1–R8 routes and their variants, plus every stop point member. */
  const lptrpMembers = async (revisionId: string) =>
    asImport(async (c) => (await c.query<Member>(
      `select m.entity_kind, m.entity_id, m.version_id from transit.revision_member m
         left join transit.route r on m.entity_kind = 'route' and r.id = m.entity_id
         left join transit.variant v on m.entity_kind = 'variant' and v.id = m.entity_id
         left join transit.route vr on vr.id = v.route_id
        where m.revision_id = $1
          and (m.entity_kind = 'stop_point' or r.public_code = any($2::text[]) or vr.public_code = any($2::text[]))
        order by m.entity_kind, m.entity_id`, [revisionId, LPTRP])).rows);
  /** A draft copy of `from` minus the members `drop` matches; returns the publish failure. */
  const publishCopyWithout = (from: string, tag: string, drop: string, extra: (c: pg.Client, rev: string) => Promise<void> = async () => undefined) =>
    asImport(async (c) => {
      const rev = await c.query<{ id: string }>(
        `insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id`,
        [`modes-test-${tag}-${Date.now()}`]);
      const id = rev.rows[0]!.id;
      await c.query(
        `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id)
         select $1, m.entity_kind, m.entity_id, m.version_id from transit.revision_member m
          where m.revision_id = $2 and not (${drop})`, [id, from]);
      await extra(c, id);
      try {
        await c.query("select transit.publish_revision($1)", [id]);
        return "published";
      } catch (error) {
        return `${(error as { code?: string }).code} ${(error as Error).message}`;
      }
    });

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
    const transitPlan = buildImportPlan(files);
    await commitImport(ownerUrl!, transitPlan);
    const realOsm = await owner.query<{ id: string }>(
      `select id from transit.revision
        where label like 'osm-places-%' and label not like 'osm-places-2099-%' and not is_synthetic
        order by seq desc limit 1`,
    );
    startRevisionId = realOsm.rows[0]?.id ?? (await revisionIdOf(transitPlan.revisionLabel))!;
    const current = await owner.query("select revision_id from transit.published_pointer");
    if (current.rows[0]?.revision_id !== startRevisionId) await publish(startRevisionId);
  }, 120_000);

  afterAll(async () => {
    if (owner && startRevisionId) {
      const current = await owner.query("select revision_id from transit.published_pointer");
      if (current.rows[0]?.revision_id !== startRevisionId) await publish(startRevisionId);
    }
    await app?.end();
    await owner?.end();
  });

  it("the synthetic seed is written flagged and refused by publish_revision; nothing remains", async () => {
    // Dated 2099 so it never collides with the real seed already on a branch of main (a same-dated
    // synthetic seed would fail on the unique batch/source rows, proving nothing about the refusal).
    const json = JSON.parse(readFileSync("tests/fixtures/modes/modes-seed-synthetic.json", "utf8"));
    json.header.preparedOn = "2099-01-01";
    const fixture: ModesFile = { fileName: "naga-modes-seed-2099-01-01.json", bytes: Buffer.from(JSON.stringify(json, null, 1)) };
    const plan = buildImportPlan(files, null, fixture);
    expect(plan.problems).toEqual([]);
    expect(plan.modes?.synthetic).toBe(true);
    const before = await tableCounts();
    // A branch of main already holds the real modes revision: the refusal must not touch it.
    const existing = await revisionIdOf(LABEL);
    const refused = await failure(commitImport(ownerUrl!, plan));
    expect(refused.code).toBe("23514");
    expect(refused.message).toMatch(/synthetic/);
    expect(await tableCounts()).toEqual(before);
    expect(await revisionIdOf(LABEL)).toBe(existing);
  });

  it("publishes modes-2026-10-16 with every R1–R8 stop and variant membership of the previous revision", async () => {
    const previous = await members(startRevisionId);
    const result = await commitImport(ownerUrl!, buildImportPlan(files, null, realSeed));
    // A branch of fresh data commits it; a branch of main (the import is in production) already
    // holds it, reports "unchanged", and the rollback done in beforeAll is undone by publishing it.
    expect(["committed", "unchanged"]).toContain(result.modes?.outcome);
    expect(result.modes).toMatchObject({ revisionLabel: LABEL });
    const revisionId = (await revisionIdOf(LABEL))!;
    if (result.modes?.outcome === "unchanged") {
      expect(result.modes).toMatchObject({ publishedIncludesBatch: false });
      await publish(revisionId);
    }
    expect(await appRows(sql`select label, kind from transit.v_published_revision`)).toEqual([{ label: LABEL, kind: "provisional" }]);

    expect(await lptrpMembers(revisionId)).toEqual(await lptrpMembers(startRevisionId));
    const after = await members(revisionId);
    const kinds = (list: Member[], kind: string) => list.filter((m) => m.entity_kind === kind);
    expect(kinds(after, "place")).toEqual(kinds(previous, "place"));
    expect(kinds(after, "stop_point")).toEqual(kinds(previous, "stop_point"));
    // Carried by id: every previous route member is still there; two feeder routes are added.
    expect(kinds(after, "route")).toEqual(expect.arrayContaining(kinds(previous, "route")));
    expect(kinds(after, "route")).toHaveLength(kinds(previous, "route").length + 2);
    expect(kinds(after, "terminal")).toHaveLength(16);
    expect(kinds(after, "route_vehicle_class")).toHaveLength(15);
    expect(kinds(after, "route_cooperative")).toHaveLength(7);
    expect(kinds(after, "route_operating_status")).toHaveLength(11);
    expect(kinds(after, "route_fare_observation")).toHaveLength(2);
    expect(kinds(after, "regional_service")).toHaveLength(7);
    expect(kinds(after, "fare_rule")).toHaveLength(kinds(previous, "fare_rule").length + 7);
    if (result.modes?.outcome === "committed") {
      expect(result.modes.counts).toMatchObject({ carried_members: previous.length - 3 - 6, seed_members: after.length - previous.length + 9 });
    }

    const revision = await asImport(async (c) => (await c.query(
      "select status, parent_revision_id, content_hash from transit.revision where id = $1", [revisionId])).rows[0]);
    expect(revision).toMatchObject({ status: "published", parent_revision_id: startRevisionId });
    // The stops, routes and snapshot read the same ids as before (128 stops on the real data).
    expect(await appRows(sql`select count(*)::int as n from transit.v_published_stops`)).toEqual([{ n: 128 }]);
  });

  it("stores fleets, cooperatives, statuses, observations, regional services, terminals and fares as reviewed", async () => {
    const fleet = await appRows(sql`
      select r.public_code, c.vehicle_class, c.status, c.evidence_levels::text[] as levels, c.aircon,
             c.aircon_source_codes::text[] as aircon_sources
        from transit.route_vehicle_class c join transit.route r on r.id = c.route_id
        join transit.revision_member m on m.entity_kind = 'route_vehicle_class' and m.entity_id = c.id
        join transit.published_pointer p on p.revision_id = m.revision_id
       where c.vehicle_class = 'modern_puj' order by 1`);
    expect(fleet).toEqual([
      { public_code: "R4", vehicle_class: "modern_puj", status: "operating",
        levels: ["official_report", "news_report", "owner_confirmation"], aircon: true, aircon_sources: ["N14", "U01"] },
      { public_code: "R7", vehicle_class: "modern_puj", status: "operating",
        levels: ["official_report", "news_report", "owner_confirmation"], aircon: true, aircon_sources: ["U01"] },
    ]);
    const observations = await appRows(sql`
      select o.code, o.delta_qualifier, o.delta_centavos_low, o.delta_centavos_high from transit.route_fare_observation o
        join transit.revision_member m on m.entity_kind = 'route_fare_observation' and m.entity_id = o.id
        join transit.published_pointer p on p.revision_id = m.revision_id order by 1`);
    expect(observations).toEqual([
      { code: "FO-R4-MOD", delta_qualifier: "range", delta_centavos_low: 300, delta_centavos_high: 500 },
      { code: "FO-R7-MOD", delta_qualifier: "at_least", delta_centavos_low: 500, delta_centavos_high: null },
    ]);
    const statuses = await appRows(sql`
      select distinct s.operating_status, s.source_codes::text[] as sources from transit.route_operating_status s
        join transit.revision_member m on m.entity_kind = 'route_operating_status' and m.entity_id = s.id
        join transit.published_pointer p on p.revision_id = m.revision_id`);
    expect(statuses).toEqual([{ operating_status: "operating", sources: ["U01"] }]);

    const t01 = await appRows(sql`
      select tv.osm_type, tv.osm_id::text as osm_id, tv.coord_source, tv.kind,
             round(extensions.ST_Y(tv.geog::extensions.geometry)::numeric, 7)::text as lat
        from transit.terminal t
        join transit.revision_member m on m.entity_kind = 'terminal' and m.entity_id = t.id
        join transit.published_pointer p on p.revision_id = m.revision_id
        join transit.terminal_version tv on tv.id = m.version_id
       where t.code = 'T01'`);
    expect(t01).toEqual([{ osm_type: "way", osm_id: "293702439", coord_source: "osm_way_centroid", kind: "terminal", lat: "13.6192359" }]);

    const f01 = await appRows(sql`
      select base_centavos, base_km::text as base_km, increment_centavos_per_km, source_codes::text[] as sources
        from transit.v_published_fare_rules where code = 'F01'`);
    expect(f01).toEqual([{ base_centavos: 1400, base_km: "4", increment_centavos_per_km: 200, sources: ["S05", "S06", "N17", "N32"] }]);
    const newRules = await appRows(sql`select code from transit.v_published_fare_rules where code >= 'F06' order by code`);
    expect(newRules.map((r) => r.code)).toEqual(["F06", "F07", "F08", "F09", "F10", "F11", "F12"]);

    const regional = await appRows(sql`
      select s.code, v.terminal_code, v.osm_relation_ids::text[] as relations from transit.regional_service s
        join transit.revision_member m on m.entity_kind = 'regional_service' and m.entity_id = s.id
        join transit.published_pointer p on p.revision_id = m.revision_id
        join transit.regional_service_version v on v.id = m.version_id order by 1`);
    expect(regional).toHaveLength(7);
    expect(regional[0]).toEqual({ code: "RS01", terminal_code: "T03", relations: ["11498944", "11498945"] });

    const feeders = await appRows(sql`
      select t.public_code, t.mode, t.service_status, t.planning from transit.v_published_routes r
        join transit.route t on t.id = r.id where t.mode = 'tricycle' order by 1`);
    expect(feeders).toEqual([
      { public_code: "TRI-DECALANGON", mode: "tricycle", service_status: "authorized_feeder", planning: "none" },
      { public_code: "TRI-VISTODA", mode: "tricycle", service_status: "authorized_feeder", planning: "none" },
    ]);
    const loops = await appRows(sql`select public_code, planning from transit.route where planning = 'provisional' order by 1`);
    expect(loops.map((r) => r.public_code)).toEqual(["R8-A", "R8-B"]);

    const sources = await appRows(sql`select code, publisher, licence from ingest.source where code in ('N01', 'U01') order by code`);
    expect(sources).toEqual([
      { code: "N01", publisher: "OpenStreetMap contributors", licence: "ODbL 1.0" },
      { code: "U01", publisher: "ParaNaga project owner", licence: null },
    ]);
    expect(await appRows(sql`select 1 from ingest.source where code = 'N09'`)).toEqual([]);
    const conflicts = await appRows(sql`select count(*)::int as n from ingest.conflict where kind = 'research_conflict'`);
    expect(conflicts).toEqual([{ n: 9 }]);
    // No cooperative chair name is stored: the conflict text only says the names are swapped.
    const cx01 = await appRows(sql`select detail->>'description' as d from ingest.conflict where refs = '{CX01}'`);
    expect(String(cx01[0]?.d)).toMatch(/Names are not stored/);
  });

  it("a second run with the same files reports unchanged and writes nothing", async () => {
    const before = await tableCounts();
    const result = await commitImport(ownerUrl!, buildImportPlan(files, null, realSeed));
    expect(result.modes).toMatchObject({
      outcome: "unchanged", revisionLabel: LABEL, publishedRevisionLabel: LABEL, publishedIncludesBatch: true,
    });
    expect(await tableCounts()).toEqual(before);
  });

  it("old revisions read their terminals through the legacy row; rollback restores T01 with geog null", async () => {
    const legacy = (revisionId: string) => asImport(async (c) => (await c.query(
      `select m.version_id = m.entity_id as is_legacy, t.geog is null as legacy_geog_null,
              (select tv.geog is null from transit.terminal_version tv where tv.id = m.version_id) as version_geog_null
         from transit.revision_member m join transit.terminal t on t.id = m.entity_id
        where m.revision_id = $1 and m.entity_kind = 'terminal' and t.code = 'T01'`, [revisionId])).rows);
    const modesId = (await revisionIdOf(LABEL))!;
    expect(await legacy(startRevisionId)).toEqual([{ is_legacy: true, legacy_geog_null: true, version_geog_null: null }]);
    expect(await legacy(modesId)).toEqual([{ is_legacy: false, legacy_geog_null: true, version_geog_null: false }]);

    await publish(startRevisionId);
    expect(await appRows(sql`select label from transit.v_published_revision`)).not.toEqual([{ label: LABEL }]);
    expect(await appRows(sql`select lat from transit.v_published_terminals where code = 'T01'`)).toEqual([{ lat: null }]);
    const rerun = await commitImport(ownerUrl!, buildImportPlan(files, null, realSeed));
    expect(rerun.modes).toMatchObject({ outcome: "unchanged", publishedIncludesBatch: false });
    await publish(modesId);
  });

  it("publish_revision refuses a route record whose route is not a member", async () => {
    const modesId = (await revisionIdOf(LABEL))!;
    const outcome = await publishCopyWithout(modesId, "noroute",
      `(m.entity_kind = 'route' and m.entity_id = (select id from transit.route where public_code = 'TRI-DECALANGON'))
       or (m.entity_kind = 'variant' and m.entity_id in (select v.id from transit.variant v join transit.route r on r.id = v.route_id
                                                           where r.public_code = 'TRI-DECALANGON'))`);
    expect(outcome).toMatch(/^23514 .*route records whose route is not a member: route_vehicle_class:/);
  });

  it("publish_revision refuses two vehicle-class records for one route and class", async () => {
    const modesId = (await revisionIdOf(LABEL))!;
    const outcome = await publishCopyWithout(modesId, "dupclass", "false", async (c, rev) => {
      const route = await c.query<{ id: string }>("select id from transit.route where public_code = 'R1'");
      const row = await c.query<{ id: string }>(
        `insert into transit.route_vehicle_class (route_id, code, vehicle_class, evidence_levels, status, source_codes, content_hash)
         values ($1, 'FL-R1-TEST', 'traditional_puj', '{legal_plan}', 'planned', '{N30}', repeat('e', 64)) returning id`,
        [route.rows[0]!.id]);
      await c.query(`insert into transit.revision_member values ($1, 'route_vehicle_class', $2, $2)`, [rev, row.rows[0]!.id]);
    });
    expect(outcome).toMatch(/^23514 .*duplicate route records: .*\/traditional_puj/);
  });

  it("publish_revision refuses a regional service whose terminal is not a member", async () => {
    const modesId = (await revisionIdOf(LABEL))!;
    const outcome = await publishCopyWithout(modesId, "noterminal",
      `m.entity_kind = 'terminal' and m.entity_id = (select id from transit.terminal where code = 'T03')`);
    expect(outcome).toMatch(/^23514 .*regional services whose terminal or fare rule is not a member: .* terminal T03/);
  });

  it("publish_revision refuses a synthetic vehicle-class member in a real revision", async () => {
    const modesId = (await revisionIdOf(LABEL))!;
    const outcome = await publishCopyWithout(modesId, "synthclass",
      `m.entity_kind = 'route_vehicle_class' and m.entity_id in (
         select c.id from transit.route_vehicle_class c join transit.route r on r.id = c.route_id
          where r.public_code = 'R2')`,
      async (c, rev) => {
        const route = await c.query<{ id: string }>("select id from transit.route where public_code = 'R2'");
        const row = await c.query<{ id: string }>(
          `insert into transit.route_vehicle_class (route_id, code, vehicle_class, evidence_levels, status, source_codes,
                                                    content_hash, is_synthetic)
           values ($1, 'FL-SYN', 'traditional_puj', '{legal_plan}', 'planned', '{N30}', repeat('f', 64), true) returning id`,
          [route.rows[0]!.id]);
        await c.query(`insert into transit.revision_member values ($1, 'route_vehicle_class', $2, $2)`, [rev, row.rows[0]!.id]);
      });
    expect(outcome).toMatch(/^23514 .*synthetic or missing members: route_vehicle_class:/);
  });
});
