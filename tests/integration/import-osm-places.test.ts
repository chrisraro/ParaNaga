// OpenStreetMap places import (Task 3) against a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// Uses only the synthetic fixture (tests/fixtures/osm, fake names). As-is it is flagged synthetic,
// so publish_revision must refuse it; a copy with the flag removed stands in for a real snapshot
// to exercise the new-revision path (transit carried forward, then "unchanged" on re-run).
// Leaves the Naga transit revision published again afterwards (other files expect it).
import { readFileSync } from "node:fs";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { osmPlaceSchema } from "@/domain/api/schemas";
import { runInRequestContext } from "@/server/db/run-in-context";
import { listPlaces } from "@/server/repos/places-repo";
import { buildImportPlan, readDataFiles, type ImportPlan, type OsmFile } from "../../scripts/lib/import-plan";
import { commitImport, ImportRefusedError } from "../../scripts/lib/import-writer";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

const FIXTURE = "tests/fixtures/osm/naga-places-2026-10-15.osm.json";
const LABEL = "osm-places-2026-10-15";

const TABLES = [
  "ingest.source", "ingest.source_document", "ingest.batch", "ingest.raw_feature", "ingest.change",
  "transit.revision", "transit.revision_member", "transit.place", "transit.place_version",
];

/** The fixture with the synthetic flag removed: stands in for a real snapshot (fake names, test branch only). */
function realLikeFixture(): OsmFile {
  const json = JSON.parse(readFileSync(FIXTURE, "utf8")) as { header: Record<string, unknown> };
  delete json.header.synthetic;
  return { fileName: "naga-places-2026-10-15.osm.json", bytes: Buffer.from(JSON.stringify(json, null, 1) + "\n") };
}

describe.skipIf(!ownerUrl || !appUrl)("OpenStreetMap places import (Neon branch)", () => {
  let owner: pg.Client;
  let app: pg.Pool;
  let transitPlan: ImportPlan;
  let nagaRevisionId = "";

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
  const appRun = <T>(fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId: null, requestId: "osm-places-test" }, fn);
  const appRows = async (query: ReturnType<typeof sql>) => appRun(async (db) => (await db.execute(query)).rows);
  const pgCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    }
    throw new Error("expected the query to fail");
  };
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
    asImport(async (c) => (await c.query<{ entity_kind: string; entity_id: string; version_id: string }>(
      `select entity_kind, entity_id, version_id from transit.revision_member where revision_id = $1
        order by entity_kind, entity_id`, [revisionId])).rows);
  const revisionIdOf = async (label: string) =>
    (await owner.query<{ id: string }>("select id from transit.revision where label = $1", [label])).rows[0]?.id;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });
    // The transit import may already be on the branch (it is on main); make its revision published.
    transitPlan = buildImportPlan(readDataFiles("Data_Sets"));
    await commitImport(ownerUrl!, transitPlan);
    nagaRevisionId = (await revisionIdOf(transitPlan.revisionLabel))!;
    const current = await owner.query("select revision_id from transit.published_pointer");
    if (current.rows[0]?.revision_id !== nagaRevisionId) await publish(nagaRevisionId);
  }, 120_000);

  afterAll(async () => {
    if (owner && nagaRevisionId) {
      const current = await owner.query("select revision_id from transit.published_pointer");
      if (current.rows[0]?.revision_id !== nagaRevisionId) await publish(nagaRevisionId);
    }
    await app?.end();
    await owner?.end();
  });

  it("refuses to publish the synthetic fixture and writes nothing", async () => {
    const synthetic = buildImportPlan(readDataFiles("Data_Sets"), {
      fileName: "naga-places-2026-10-15.osm.json", bytes: readFileSync(FIXTURE),
    });
    expect(synthetic.problems).toEqual([]);
    expect(synthetic.osm?.synthetic).toBe(true);
    const before = await tableCounts();
    await expect(commitImport(ownerUrl!, synthetic)).rejects.toThrow(/synthetic or missing members: place:/);
    expect(await tableCounts()).toEqual(before);
    expect(await revisionIdOf(LABEL)).toBeUndefined();
  });

  it("publishes osm-places-<date> carrying every transit member of the previous revision forward", async () => {
    const plan = buildImportPlan(readDataFiles("Data_Sets"), realLikeFixture());
    expect(plan.problems).toEqual([]);
    const previous = await members(nagaRevisionId);
    const result = await commitImport(ownerUrl!, plan);
    expect(result).toMatchObject({ outcome: "unchanged", places: { outcome: "committed", revisionLabel: LABEL } });
    expect(result.places?.counts).toMatchObject({
      places: 11, places_added: 11, places_changed: 0, places_unchanged: 0, places_missing: 0,
      place_rows_inserted: 11, place_versions_inserted: 11, carried_members: previous.length,
      dropped_unnamed: 2, dropped_outside_boundary: 1, dropped_other_tags: 1, dropped_no_coordinate: 1,
    });

    const revisionId = (await revisionIdOf(LABEL))!;
    expect(await appRows(sql`select label, kind from transit.v_published_revision`)).toEqual([{ label: LABEL, kind: "provisional" }]);
    const after = await members(revisionId);
    expect(after.filter((m) => m.entity_kind !== "place")).toEqual(previous.filter((m) => m.entity_kind !== "place"));
    expect(after.filter((m) => m.entity_kind === "place")).toHaveLength(11);
    const revision = await asImport(async (c) => (await c.query(
      `select status, parent_revision_id, created_by from transit.revision where id = $1`, [revisionId])).rows[0]);
    expect(revision).toEqual({ status: "published", parent_revision_id: nagaRevisionId, created_by: "scripts/import-naga" });
    expect(await asImport(async (c) => (await c.query(
      `select status from transit.revision where id = $1`, [nagaRevisionId])).rows[0].status)).toBe("superseded");

    // Stops, routes and the snapshot read the same ids as before.
    const stops = await appRows(sql`select count(*)::int as n from transit.v_published_stops`);
    expect(stops).toEqual([{ n: 128 }]);
    const routes = await appRows(sql`select count(*)::int as n from transit.v_published_routes`);
    expect(routes).toEqual([{ n: 11 }]);
  });

  it("records OSM provenance: source, document, batch and raw features", async () => {
    const source = await appRows(sql`select code, title, url, evidence_type, checked_on::text from ingest.source where code = 'OSM-2026-10-15'`);
    expect(source).toEqual([{
      code: "OSM-2026-10-15", title: "OpenStreetMap places snapshot", url: "https://www.openstreetmap.org/copyright",
      evidence_type: "open_data", checked_on: "2026-10-15",
    }]);
    const raw = await asImport(async (c) => (await c.query(
      `select r.identity_method, r.source_layer, count(*)::int as n from ingest.raw_feature r
         join ingest.batch b on b.id = r.batch_id where b.snapshot_version = 'osm:relation/3084673:2026-10-15'
        group by 1, 2`)).rows);
    expect(raw).toEqual([{ identity_method: "osm_id", source_layer: "osm", n: 11 }]);
    const sources = await appRows(sql`select code from transit.v_published_sources where code like 'OSM-%'`);
    expect(sources).toEqual([{ code: "OSM-2026-10-15" }]);
  });

  it("listPlaces reads the published places as paranaga_app", async () => {
    const revisionId = (await revisionIdOf(LABEL))!;
    const places = await appRun((db) => listPlaces(db, revisionId));
    expect(places).toHaveLength(11);
    for (const p of places) expect(osmPlaceSchema.parse(p)).toEqual(p);
    expect(places.find((p) => p.key === "osm:way/999000000003")).toEqual({
      key: "osm:way/999000000003", name: "Fakemart Synthetic Mall", aliases: [], category: "mall",
      lat: 13.625, lng: 123.187, osmType: "way", osmId: 999000000003, osmVersion: 2, sourceCode: "OSM-2026-10-15",
    });
    expect(places.filter((p) => p.name === "Synthetic Twin Name")).toHaveLength(2);
    expect(JSON.stringify(places)).not.toMatch(/opening_hours|phone|website|synthetic-user/);
    // An unknown revision reads nothing.
    expect(await appRun((db) => listPlaces(db, "00000000-0000-4000-8000-000000000000"))).toEqual([]);
  });

  it("paranaga_app cannot write places; paranaga_import cannot update or delete them", async () => {
    expect(await pgCode(appRows(sql`insert into transit.place (osm_type, osm_id) values ('node', 1)`))).toBe("42501");
    expect(await pgCode(appRows(sql`update transit.place_version set name = 'x'`))).toBe("42501");
    expect(await pgCode(appRows(sql`delete from transit.place`))).toBe("42501");
    for (const statement of ["update transit.place_version set name = 'x'", "update transit.place set osm_id = 1",
      "delete from transit.place_version"]) {
      const code = await asImport(async (c) => {
        try {
          await c.query(statement);
        } catch (error) {
          return (error as { code?: string }).code;
        }
        return "no error";
      });
      expect(code).toBe("42501");
    }
  });

  it("a second run with the same files reports unchanged and writes nothing", async () => {
    const before = await tableCounts();
    const result = await commitImport(ownerUrl!, buildImportPlan(readDataFiles("Data_Sets"), realLikeFixture()));
    expect(result).toMatchObject({ outcome: "unchanged", places: { outcome: "unchanged", counts: { places: 11 } } });
    expect(await tableCounts()).toEqual(before);
    expect(await appRows(sql`select label from transit.v_published_revision`)).toEqual([{ label: LABEL }]);
  });

  it("refuses another file with the same date without writing", async () => {
    const file = realLikeFixture();
    const changed = { ...file, bytes: Buffer.concat([file.bytes, Buffer.from("\n")]) };
    const before = await tableCounts();
    await expect(commitImport(ownerUrl!, buildImportPlan(readDataFiles("Data_Sets"), changed)))
      .rejects.toBeInstanceOf(ImportRefusedError);
    expect(await tableCounts()).toEqual(before);
  });

  it("publish_revision refuses a draft whose place member is synthetic", async () => {
    const outcome = await asImport(async (c) => {
      const raw = await c.query<{ id: string }>(
        `select r.id from ingest.raw_feature r join ingest.batch b on b.id = r.batch_id
          where b.snapshot_version = 'osm:relation/3084673:2026-10-15' limit 1`);
      const place = await c.query<{ id: string }>(
        `insert into transit.place (osm_type, osm_id, is_synthetic) values ('node', 999999999999, true) returning id`);
      const version = await c.query<{ id: string }>(
        `insert into transit.place_version (place_id, name, category, geog, osm_version, osm_timestamp, source_code,
                                            raw_feature_id, content_hash, is_synthetic)
         values ($1, 'Synthetic Only', 'park', 'SRID=4326;POINT(123.1846 13.6233)', 1, now(), 'OSM-2026-10-15', $2,
                 repeat('a', 64), true) returning id`, [place.rows[0]!.id, raw.rows[0]!.id]);
      const rev = await c.query<{ id: string }>(
        `insert into transit.revision (label, kind, status, created_by) values ('synthetic-place-test', 'provisional', 'draft', 'test')
         returning id`);
      await c.query(
        `insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id)
         select $1, entity_kind, entity_id, version_id from transit.revision_member where revision_id = $2`,
        [rev.rows[0]!.id, nagaRevisionId]);
      await c.query(`insert into transit.revision_member values ($1, 'place', $2, $3)`,
        [rev.rows[0]!.id, place.rows[0]!.id, version.rows[0]!.id]);
      try {
        await c.query("select transit.publish_revision($1)", [rev.rows[0]!.id]);
        return "published";
      } catch (error) {
        return `${(error as { code?: string }).code} ${(error as Error).message}`;
      }
    });
    expect(outcome).toMatch(/^23514 .*synthetic or missing members: place:/);
  });
});
