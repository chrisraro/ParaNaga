// Road outputs import (Increment D, Task 7: migration 0007 + views 0009, approximate paths, walk
// graph, time-estimate parameters, regional distances; Increment E, Task 4: migration 0010, street
// graph v2, route notes) and the lines / walk-graph endpoints,
// against a throwaway Neon branch:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// Named so it runs after import-modes-seed (which needs to commit the modes seed itself). The start
// revision is the real modes-<date> revision (the transit, places and modes seed import is run
// first; "unchanged" on a branch that has it); it is published before the tests and again
// afterwards, so later files see the state they expect.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorSchema, linesSchema, networkSnapshotSchema, routeDetailSchema } from "@/domain/api/schemas";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import { decodePolyline } from "@/domain/geo/polyline";
import { walkGraphPayloadSchema } from "@/domain/walk/format";
import { runInRequestContext } from "@/server/db/run-in-context";
import { getPool } from "@/server/db/client";
import { GET as linesGET } from "@/app/api/v1/network/lines/[revisionId]/route";
import { GET as walkGET } from "@/app/api/v1/network/walk-graph/[revisionId]/route";
import { GET as snapshotGET } from "@/app/api/v1/network/snapshot/[revisionId]/route";
import { GET as routeGET } from "@/app/api/v1/routes/[code]/route";
import {
  buildImportPlan,
  readDataFiles,
  readNewestModesSeed,
  readNewestOsmSnapshot,
  readPinnedRoadsSnapshot,
  type ModesFile,
} from "../../scripts/lib/import-plan";
import { commitImport, ImportRefusedError } from "../../scripts/lib/import-writer";
import { checkRoadsSnapshot } from "../../scripts/lib/roads-snapshot";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const runtimeUrl = process.env.PARANAGA_DATABASE_URL;

/**
 * The base label of the real road import. A database that holds earlier imports of the same date (main
 * does, after in-place seed edits) has it as "<base>.N", so the actual label is taken from the import
 * result in the first import test; this is only the fallback for tests that run before it.
 */
const BASE = "anywhere-alight-2026-10-16";
const LABEL_PATTERN = new RegExp(`^${BASE}(\\.\\d+)?$`);
let LABEL = BASE;
/** The Increment D road revision a database that already holds the earlier import still has (graph format v1). */
const OLD_LABEL = "modes-lines-2026-10-16";
const TABLES = [
  "ingest.source", "ingest.source_document", "ingest.batch", "transit.revision", "transit.revision_member",
  "transit.shape", "transit.shape_version", "transit.walk_graph", "transit.walk_graph_version", "transit.eta_param",
  "transit.eta_param_version", "transit.regional_service_version", "transit.route_note",
];
const ROAD_KINDS = ["shape", "walk_graph", "eta_param", "regional_service", "route_note"];
const IMMUTABLE = "public, s-maxage=31536000, immutable";

type Member = { entity_kind: string; entity_id: string; version_id: string };

describe.skipIf(!ownerUrl || !appUrl || !runtimeUrl)("road outputs import and endpoints (Neon branch)", () => {
  let owner: pg.Client;
  let app: pg.Pool;
  let startRevisionId = "";
  let linesRevisionId = "";
  const files = readDataFiles("Data_Sets");
  const osm = readNewestOsmSnapshot();
  const seed = readNewestModesSeed()!;
  const roads = readPinnedRoadsSnapshot()!;
  const realPlan = () => buildImportPlan(files, osm, seed, roads);

  const ctx = (revisionId: string) => ({ params: Promise.resolve({ revisionId }) }) as never;
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
    runInRequestContext(app, { userId: null, requestId: "roads-geometry-test" }, async (db) => (await db.execute(query)).rows);
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
  /** A draft copy of `from` minus the members `drop` matches (plus `extra`); returns the publish outcome. */
  const publishCopyWithout = (from: string, tag: string, drop: string, extra: (c: pg.Client, rev: string) => Promise<void> = async () => undefined) =>
    asImport(async (c) => {
      const rev = await c.query<{ id: string }>(
        `insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id`,
        [`lines-test-${tag}-${Date.now()}`]);
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
    // Transit, places and the modes seed (no road snapshot): "unchanged" where already imported.
    const base = buildImportPlan(files, osm, seed);
    expect(base.problems).toEqual([]);
    // A database that holds the earlier seed of this date gets the revised seed as modes-<date>.2.
    const modesResult = (await commitImport(ownerUrl!, base)).modes;
    startRevisionId = (await revisionIdOf((modesResult && "revisionLabel" in modesResult && modesResult.revisionLabel) || base.modes!.revisionLabel))!;
    const current = await owner.query("select revision_id from transit.published_pointer");
    if (current.rows[0]?.revision_id !== startRevisionId) await publish(startRevisionId);
  }, 180_000);

  afterAll(async () => {
    if (owner && startRevisionId) {
      const current = await owner.query("select revision_id from transit.published_pointer");
      if (current.rows[0]?.revision_id !== startRevisionId) await publish(startRevisionId);
    }
    await getPool().end();
    await app?.end();
    await owner?.end();
  });

  it("0007/0009 objects exist; every new table has RLS enabled and forced", async () => {
    const tables = await owner.query<{ name: string; rls: boolean; forced: boolean }>(
      `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'transit' and c.relname = any($1) order by 1`,
      [["eta_param", "eta_param_version", "shape", "shape_version", "walk_graph", "walk_graph_version"]]);
    expect(tables.rows).toHaveLength(6);
    for (const t of tables.rows) expect(t, t.name).toMatchObject({ rls: true, forced: true });
    // The view shows exactly the shape members of the published revision, no more. A branch of main
    // already holds the real road import, so the modes revision carries those shapes forward (the ones
    // of routes the modes seed re-versions are dropped): that count is derived, not assumed to be 0.
    const published = await owner.query<{ n: number }>(
      `select count(*)::int as n from transit.revision_member m
         join transit.published_pointer p on p.revision_id = m.revision_id where m.entity_kind = 'shape'`);
    expect(await appRows(sql`select count(*)::int as n from transit.v_published_shapes`)).toEqual([{ n: published.rows[0]!.n }]);
  });

  it("a synthetic road snapshot with the synthetic seed is refused before anything is written", async () => {
    const bytes = readFileSync("tests/fixtures/osm/roads-synthetic.osm.json");
    const name = "naga-roads-2026-10-16.osm.json";
    const syntheticRoads = checkRoadsSnapshot(name, bytes, { [name]: createHash("sha256").update(bytes).digest("hex") });
    const syntheticSeed: ModesFile = {
      fileName: "naga-modes-seed-2026-10-16.json", bytes: readFileSync("tests/fixtures/modes/modes-seed-synthetic.json"),
    };
    const plan = buildImportPlan(files, osm, syntheticSeed, syntheticRoads);
    expect(plan.problems.join("\n")).toMatch(/synthetic snapshot is never imported/);
    const before = await tableCounts();
    // A branch of main already holds the real lines revision: the refusal must not touch it.
    const existing = await revisionIdOf(LABEL);
    await expect(commitImport(ownerUrl!, plan)).rejects.toBeInstanceOf(ImportRefusedError);
    expect(await tableCounts()).toEqual(before);
    expect(await revisionIdOf(LABEL)).toBe(existing);
  });

  it("the real import publishes modes-lines-2026-10-16: one shape per member variant, the walk graph, five parameters", async () => {
    const plan = realPlan();
    expect(plan.problems).toEqual([]);
    const previous = await members(startRevisionId);
    const existedBefore = (await owner.query("select 1 from transit.revision where label like $1", [`${BASE}%`])).rowCount! > 0;
    const result = await commitImport(ownerUrl!, plan);
    expect(result.modes).toMatchObject({ outcome: "unchanged" });
    // Fresh data commits it; a branch of main (the import is in production) already holds it and
    // reports "unchanged", and publishing it undoes the rollback done in beforeAll.
    expect(result.lines?.outcome).toBe(existedBefore ? "unchanged" : "committed");
    expect(result.lines).toMatchObject({ revisionLabel: expect.stringMatching(LABEL_PATTERN) });
    LABEL = (result.lines as { revisionLabel: string }).revisionLabel;
    linesRevisionId = (await revisionIdOf(LABEL))!;
    if (result.lines?.outcome === "unchanged") {
      expect(result.lines).toMatchObject({ publishedIncludesBatch: false });
      await publish(linesRevisionId);
    }
    expect(await appRows(sql`select label from transit.v_published_revision`)).toEqual([{ label: LABEL }]);

    // Everything but the road kinds is carried by id, unchanged (stop, route and variant ids).
    const after = await members(linesRevisionId);
    const notRoad = (list: Member[]) => list.filter((m) => !ROAD_KINDS.includes(m.entity_kind));
    expect(notRoad(after)).toEqual(notRoad(previous));
    const kinds = (kind: string) => after.filter((m) => m.entity_kind === kind);
    expect(kinds("shape")).toHaveLength(kinds("variant").length);
    expect(kinds("walk_graph")).toHaveLength(1);
    expect(kinds("eta_param")).toHaveLength(5);
    expect(kinds("route_note")).toHaveLength(9);
    expect(kinds("regional_service")).toHaveLength(7);

    const shapes = await appRows(sql`
      select route_code, trace_status, untraced_reason, length_m::float8 as length_m, road_source_code, label,
             jsonb_array_length(coalesce(stop_measures, '[]'::jsonb))::int as measures
        from transit.v_published_shapes order by route_code, trace_status`);
    expect(shapes.filter((s) => s.trace_status === "ok")).toHaveLength(18);
    expect(shapes.filter((s) => s.trace_status === "untraced").map((s) => [s.route_code, s.untraced_reason])).toEqual([
      ["TRI-DECALANGON", "anchor_unresolved"], ["TRI-VISTODA", "anchor_unresolved"], ["TRI-VISTODA", "anchor_unresolved"],
    ]);
    for (const s of shapes) {
      expect(s).toMatchObject({ road_source_code: "OSMR-2026-10-16", label: "Approximate path, not a verified route shape" });
    }
    expect(shapes.filter((s) => (s.measures as number) > 0).map((s) => [s.route_code, s.measures])).toEqual([["R8-A", 30], ["R8-B", 31]]);

    // Stop measures name the member stop point versions of the member variant version.
    const stray = await asImport(async (c) => (await c.query(
      `select m.entity_id, e.value from transit.revision_member m
         join transit.shape_version sv on sv.id = m.version_id
        cross join lateral jsonb_array_elements(coalesce(sv.stop_measures, '[]'::jsonb)) e
        where m.revision_id = $1 and m.entity_kind = 'shape'
          and not exists (select 1 from transit.revision_member sm
                           where sm.revision_id = m.revision_id and sm.entity_kind = 'stop_point'
                             and sm.version_id::text = e.value->>'stopPointVersionId')`, [linesRevisionId])).rows);
    expect(stray).toEqual([]);

    const params = await appRows(sql`
      select key, value_low::float8 as low, value_high::float8 as high, is_assumption, source_codes::text[] as sources
        from transit.v_published_eta_params order by key`);
    expect(params).toEqual([
      { key: "jeepney_speed_offpeak_kmh", low: 10, high: 15, is_assumption: false, sources: ["N16", "N29"] },
      { key: "jeepney_speed_peak_kmh", low: 7, high: 13, is_assumption: true, sources: ["N29"] },
      { key: "peak_windows", low: null, high: null, is_assumption: true, sources: ["N04"] },
      { key: "walk_slowdown_factor", low: 1, high: 1.25, is_assumption: true, sources: [] },
      { key: "walk_speed_kmh", low: 4.238, high: 4.238, is_assumption: false, sources: ["N28"] },
    ]);
    const rs05 = await appRows(sql`
      select distance_km::float8 as km, osm_relation_versions::int[] as versions from transit.v_published_regional_services where code = 'RS05'`);
    expect(rs05).toEqual([{ km: 94.278, versions: [13, 14] }]);
    expect(await appRows(sql`select code from transit.v_published_sources where code = 'OSMR-2026-10-16'`)).toEqual([{ code: "OSMR-2026-10-16" }]);

    // The review decisions that live in code are recorded with the batch.
    const batch = await asImport(async (c) => (await c.query(
      `select counts->'trace_rules' as rules, counts->>'revision_label' as label from ingest.batch
        where snapshot_version like 'modes-lines:2026-10-16:2026-10-16:%' and status = 'committed'
          and counts->>'revision_label' = $1`, [LABEL])).rows);
    expect(batch).toHaveLength(1);
    expect(batch[0].rules.landmarks.map((l: { item: string }) => l.item)).toContain("Naga–Pili boundary, Del Rosario");
    expect(batch[0].rules.termini.map((t: { routeCode: string }) => t.routeCode)).toEqual(["R1", "R2", "R5", "R6", "R7"]);
  });

  it("a second run with the same files reports unchanged and writes nothing", async () => {
    const before = await tableCounts();
    const result = await commitImport(ownerUrl!, realPlan());
    expect(result.lines).toMatchObject({ outcome: "unchanged", revisionLabel: LABEL, publishedRevisionLabel: LABEL, publishedIncludesBatch: true });
    // The modes seed's records are still published (its regional services as their distance versions).
    expect(result.modes).toMatchObject({ outcome: "unchanged", publishedIncludesBatch: true });
    // Whether the published revision holds this snapshot's places depends on the branch history, not on
    // this re-run: on a branch of main that earlier files already gave a modes-<date>.2 revision (carrying
    // main's older 2026-10-15 places), the 2026-10-16 places revision is committed afterwards and the
    // start revision published here predates it. The re-run itself must still be a no-op.
    expect(result.places).toMatchObject({ outcome: "unchanged", publishedIncludesBatch: expect.any(Boolean) });
    expect(await tableCounts()).toEqual(before);
  });

  it("GET lines: encoded paths decode inside the Naga bounds, labelled and attributed; unknown revision → 404", async () => {
    const response = await linesGET(new Request(`http://localhost/api/v1/network/lines/${linesRevisionId}`), ctx(linesRevisionId));
    const raw = await response.text();
    expect(response.status, raw.slice(0, 300)).toBe(200);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    const body = linesSchema.parse(JSON.parse(raw));
    expect(body.revision.label).toBe(LABEL);
    expect(body.lines).toHaveLength(18);
    expect(body.untraced.map((u) => u.routeCode)).toEqual(["TRI-VISTODA", "TRI-VISTODA", "TRI-DECALANGON"]);
    const b = NAGA_MAX_BOUNDS;
    for (const line of body.lines) {
      const pts = decodePolyline(line.encoded);
      expect(pts.length, line.routeCode).toBeGreaterThan(50);
      expect(pts.every((p) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east), line.routeCode).toBe(true);
      expect(line).toMatchObject({ label: "Approximate path, not a verified route shape", roadSource: "OSMR-2026-10-16" });
    }
    expect(body.lines.find((l) => l.routeCode === "R4")!.colourKey).toBe("mixed_trad_modern");
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(150 * 1024);
    console.info(`lines payload: ${Buffer.byteLength(raw)} B`);

    const unknown = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    const missing = await linesGET(new Request(`http://localhost/api/v1/network/lines/${unknown}`), ctx(unknown));
    expect(missing.status).toBe(404);
    expect(apiErrorSchema.parse(await missing.json()).error.code).toBe("not_found");
    // A superseded revision is not served either.
    const old = await linesGET(new Request(`http://localhost/api/v1/network/lines/${startRevisionId}`), ctx(startRevisionId));
    expect(old.status).toBe(404);
  });

  it("GET walk-graph: the stored payload verbatim, ETag = its sha256; 304 on If-None-Match", async () => {
    const url = `http://localhost/api/v1/network/walk-graph/${linesRevisionId}`;
    const response = await walkGET(new Request(url), ctx(linesRevisionId));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    const sha = createHash("sha256").update(text, "utf8").digest("hex");
    expect(response.headers.get("etag")).toBe(`"${sha}"`);
    const stored = await appRows(sql`select sha256, bytes from transit.v_published_walk_graph`);
    expect(stored).toEqual([{ sha256: sha, bytes: Buffer.byteLength(text) }]);
    expect(walkGraphPayloadSchema.parse(JSON.parse(text)).roadSource).toBe("OSMR-2026-10-16");
    expect(walkGraphPayloadSchema.parse(JSON.parse(text))).toMatchObject({ v: 2 });
    expect(await appRows(sql`select format_version from transit.v_published_walk_graph`)).toEqual([{ format_version: 2 }]);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(800 * 1024);
    console.info(`walk graph payload: ${Buffer.byteLength(text)} B`);
    const again = await walkGET(new Request(url, { headers: { "if-none-match": `"${sha}"` } }), ctx(linesRevisionId));
    expect(again.status).toBe(304);
  });

  it("the snapshot carries path measures for Loops A/B and the time-estimate model", async () => {
    const response = await snapshotGET(new Request(`http://localhost/api/v1/network/snapshot/${linesRevisionId}`), ctx(linesRevisionId));
    expect(response.status).toBe(200);
    const snapshot = networkSnapshotSchema.parse(await response.json());
    for (const v of snapshot.variants) {
      expect(v.measuresM, v.routeCode).toHaveLength(v.stopIds.length);
      expect(v.pathLengthM, v.routeCode).toBeGreaterThan(5000);
    }
    expect(snapshot.etaModel?.params.map((p) => p.key).sort()).toEqual([
      "jeepney_speed_offpeak_kmh", "jeepney_speed_peak_kmh", "peak_windows", "walk_slowdown_factor", "walk_speed_kmh",
    ]);
  });

  it("route detail reports each variant's path status", async () => {
    const detail = async (code: string) => {
      const response = await routeGET(new Request(`http://localhost/api/v1/routes/${code}`), { params: Promise.resolve({ code }) } as never);
      expect(response.status).toBe(200);
      return routeDetailSchema.parse(await response.json());
    };
    const r1 = await detail("R1");
    expect(r1.variants.map((v) => [v.direction, v.pathStatus.status, v.pathStatus.matchedStreets, v.pathStatus.listedStreets])).toEqual([
      ["inbound", "traced", 7, 7], ["outbound", "traced", 5, 5],
    ]);
    const feeder = await detail("TRI-VISTODA");
    for (const v of feeder.variants) expect(v.pathStatus).toMatchObject({ status: "untraced", reason: "anchor_unresolved", listedStreets: null });
  });

  it("the snapshot and route detail carry the reviewed route notes with evidence, sources and the near circle", async () => {
    const response = await snapshotGET(new Request(`http://localhost/api/v1/network/snapshot/${linesRevisionId}`), ctx(linesRevisionId));
    const snapshot = networkSnapshotSchema.parse(await response.json());
    const notesOf = (code: string) => snapshot.routes.find((r) => r.routeCode === code)!.notes;
    expect(snapshot.routes.reduce((n, r) => n + r.notes.length, 0)).toBe(9);
    expect(notesOf("R8-C").map((n) => n.evidence).sort()).toEqual(["community", "owner_report_unverified"]);
    expect(notesOf("R8-C").find((n) => n.near !== null)).toMatchObject({
      text: expect.stringContaining("J. Miranda"), near: { lat: 13.6256, lng: 123.199, radiusM: 450 },
    });
    expect(notesOf("R2")).toEqual([expect.objectContaining({ evidence: "owner_report_unverified", near: null, sourceCodes: expect.arrayContaining(["U02", "RL15"]) })]);
    expect(notesOf("R1")).toEqual([]);

    const detail = await routeGET(new Request("http://localhost/api/v1/routes/R8-C"), { params: Promise.resolve({ code: "R8-C" }) } as never);
    const body = routeDetailSchema.parse(await detail.json());
    expect(body.notes).toEqual(notesOf("R8-C"));
    // The notes' sources are in the register and in the route's own sources.
    for (const n of body.notes) for (const code of n.sourceCodes) expect(body.sources.map((s) => s.code)).toContain(code);
    expect(await appRows(sql`select code from transit.v_published_sources where code in ('RL01', 'U02') order by code`))
      .toEqual([{ code: "RL01" }, { code: "U02" }]);
  });

  it("an older revision still serves its v1 walk graph (databases that hold the earlier import)", async () => {
    const oldId = await revisionIdOf(OLD_LABEL);
    if (!oldId) return; // a database without the earlier import has no v1 graph
    await publish(oldId);
    try {
      const response = await walkGET(new Request(`http://localhost/api/v1/network/walk-graph/${oldId}`), ctx(oldId));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(walkGraphPayloadSchema.parse(JSON.parse(text))).toMatchObject({ v: 1 });
      expect(response.headers.get("etag")).toBe(`"${createHash("sha256").update(text, "utf8").digest("hex")}"`);
      // Its notes-free snapshot still parses: notes default to [].
      const snap = await snapshotGET(new Request(`http://localhost/api/v1/network/snapshot/${oldId}`), ctx(oldId));
      expect(networkSnapshotSchema.parse(await snap.json()).routes.every((r) => r.notes.length === 0)).toBe(true);
    } finally {
      await publish(linesRevisionId);
    }
  });

  it("migration 0010: research source codes, route_note checks and RLS", async () => {
    const rls = await owner.query<{ rls: boolean; forced: boolean }>(
      `select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where oid = 'transit.route_note'::regclass`);
    expect(rls.rows[0]).toEqual({ rls: true, forced: true });
    expect(await appRows(sql`select code from ingest.source where code in ('RT01', 'RL01', 'RP01', 'RH01', 'U02') order by code`))
      .toEqual([{ code: "RH01" }, { code: "RL01" }, { code: "RP01" }, { code: "RT01" }, { code: "U02" }]);
    const code = async (query: string, params: unknown[] = []) => asImport(async (c) => {
      try {
        await c.query(query, params);
        return "inserted";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    const source = (c: string) => code(
      `insert into ingest.source (code, title) values ($1, 'test')`, [c]);
    expect(await source("RT99")).toBe("inserted");
    expect(await source("RX01")).toBe("23514");
    expect(await source("RT1")).toBe("23514");
    const insertNote = (text: string, evidence: string, near: "none" | "both" | "geog_only") => code(
      `insert into transit.route_note (route_id, note_code, text, evidence, source_codes, content_hash, near_geog, near_radius_m)
       select id, 'RN99', $1, $2, '{RL01}', repeat('c', 64),
              ${near === "none" ? "null" : "extensions.ST_SetSRID(extensions.ST_MakePoint(123.19, 13.62), 4326)::extensions.geography"},
              ${near === "both" ? "450" : "null"}
         from transit.route where public_code = 'R1'`, [text, evidence]);
    expect(await insertNote("ok", "community", "none")).toBe("inserted");
    expect(await insertNote("x".repeat(121), "community", "none")).toBe("23514");
    expect(await insertNote("ok", "verified", "none")).toBe("23514");
    expect(await insertNote("ok", "ordinance", "none")).toBe("23514");
    expect(await insertNote("ok", "owner_report_unverified", "geog_only")).toBe("23514");
    expect(await insertNote("ok", "news", "both")).toBe("inserted");
  });

  it("publish_revision refuses a route note whose route is not a member, and a synthetic note", async () => {
    const orphan = await publishCopyWithout(linesRevisionId, "orphannote", "false", async (c, rev) => {
      const route = await c.query<{ id: string }>(
        `insert into transit.route (public_code, name, mode_code, mode, service_status, planning, source_codes, properties)
         select 'TRI-NOTETEST', name, mode_code, mode, service_status, planning, source_codes, properties
           from transit.route where public_code = 'TRI-VISTODA' returning id`);
      const note = await c.query<{ id: string }>(
        `insert into transit.route_note (route_id, note_code, text, evidence, source_codes, content_hash)
         values ($1, 'RN98', 'A note on a route that is not a member.', 'community', '{RL01}', repeat('d', 64)) returning id`,
        [route.rows[0]!.id]);
      await c.query(`insert into transit.revision_member values ($1, 'route_note', $2, $2)`, [rev, note.rows[0]!.id]);
    });
    expect(orphan).toMatch(/^23514 .*route records whose route is not a member: route_note:/);
    const synthetic = await publishCopyWithout(linesRevisionId, "syntheticnote", "false", async (c, rev) => {
      const note = await c.query<{ id: string }>(
        `insert into transit.route_note (route_id, note_code, text, evidence, source_codes, content_hash, is_synthetic)
         select id, 'RN97', 'A synthetic note.', 'community', '{RL01}', repeat('e', 64), true from transit.route where public_code = 'R1'
         returning id`);
      await c.query(`insert into transit.revision_member values ($1, 'route_note', $2, $2)`, [rev, note.rows[0]!.id]);
    });
    expect(synthetic).toMatch(/^23514 .*synthetic or missing members: route_note:/);
  });

  it("publish_revision refuses a shape whose variant is not a member", async () => {
    const outcome = await publishCopyWithout(linesRevisionId, "novariant",
      `m.entity_kind = 'variant' and m.entity_id = (select v.id from transit.variant v join transit.route r on r.id = v.route_id
                                                      where r.public_code = 'R1' and v.direction = 'inbound')`);
    expect(outcome).toMatch(/^23514 .*shapes whose variant \(version\) is not a member/);
  });

  it("publish_revision refuses two walk graphs", async () => {
    const outcome = await publishCopyWithout(linesRevisionId, "twographs", "false", async (c, rev) => {
      const g = await c.query<{ id: string }>(`insert into transit.walk_graph (key) values ('naga-walk-test') returning id`);
      const v = await c.query<{ id: string }>(
        `insert into transit.walk_graph_version (walk_graph_id, format_version, payload, bytes, gzip_bytes, sha256, node_count,
                                                 edge_count, road_source_code, builder_version, content_hash)
         select $1, format_version, payload, bytes, gzip_bytes, sha256, node_count, edge_count, road_source_code,
                builder_version, content_hash
           from transit.walk_graph_version where id = (select version_id from transit.revision_member
                                                        where revision_id = $2 and entity_kind = 'walk_graph')
         returning id`, [g.rows[0]!.id, linesRevisionId]);
      await c.query(`insert into transit.revision_member values ($1, 'walk_graph', $2, $3)`, [rev, g.rows[0]!.id, v.rows[0]!.id]);
    });
    expect(outcome).toMatch(/^23514 .*more than one walk graph/);
  });

  it("publish_revision refuses an incomplete set of time-estimate parameters", async () => {
    const outcome = await publishCopyWithout(linesRevisionId, "noeta",
      `m.entity_kind = 'eta_param' and m.entity_id = (select id from transit.eta_param where key = 'peak_windows')`);
    expect(outcome).toMatch(/^23514 .*incomplete set of time-estimate parameters: peak_windows x0/);
  });

  it("publish_revision refuses stop measures that do not cover the member stops", async () => {
    const outcome = await publishCopyWithout(linesRevisionId, "measures",
      `m.entity_kind = 'shape' and m.entity_id = (select s.id from transit.shape s join transit.variant v on v.id = s.variant_id
                                                    join transit.route r on r.id = v.route_id
                                                   where r.public_code = 'R8-A' and v.kind = 'permanent')`,
      async (c, rev) => {
        const v = await c.query<{ id: string; shape_id: string }>(
          `insert into transit.shape_version (shape_id, variant_version_id, trace_status, geog, length_m, stop_measures,
                                              off_list_segments, trace_quality, inputs_hash, road_source_code, content_hash)
           select sv.shape_id, sv.variant_version_id, sv.trace_status, sv.geog, sv.length_m,
                  jsonb_path_query_array(sv.stop_measures, '$[0 to 1]'), sv.off_list_segments, sv.trace_quality,
                  sv.inputs_hash, sv.road_source_code, repeat('a', 64)
             from transit.revision_member m join transit.shape_version sv on sv.id = m.version_id
             join transit.shape s on s.id = sv.shape_id join transit.variant v on v.id = s.variant_id
             join transit.route r on r.id = v.route_id
            where m.revision_id = $1 and m.entity_kind = 'shape' and r.public_code = 'R8-A' and v.kind = 'permanent'
           returning id, shape_id`, [linesRevisionId]);
        await c.query(`insert into transit.revision_member values ($1, 'shape', $2, $3)`, [rev, v.rows[0]!.shape_id, v.rows[0]!.id]);
      });
    expect(outcome).toMatch(/^23514 .*shape stop measures that do not match the member stops: .* measures 2 of 30/);
  });

  it("the database refuses a walk graph whose stored sha256 or size does not describe its payload", async () => {
    const failure = await asImport(async (c) => {
      try {
        await c.query(
          `insert into transit.walk_graph_version (walk_graph_id, format_version, payload, bytes, gzip_bytes, sha256, node_count,
                                                   edge_count, road_source_code, builder_version, content_hash)
           values ((select id from transit.walk_graph where key = 'naga-walk'), 1, '{}', 2, 10, repeat('0', 64), 1, 1,
                   'OSMR-2026-10-16', 'test', repeat('b', 64))`);
        return "inserted";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    expect(failure).toBe("23514");
  });

  // ---------------------------------------------------------------- follow-up imports (fix round 1)
  // Last in the file: they publish newer revisions (afterAll restores the start revision).

  it("a newer places snapshot with the same roads publishes a new modes-lines revision (not a refusal)", async () => {
    const json = JSON.parse(osm!.bytes.toString("utf8"));
    json.header.fetchedAt = "2099-01-03T00:00:00Z";
    const places = { fileName: "naga-places-2099-01-03.osm.json", bytes: Buffer.from(`${JSON.stringify(json, null, 1)}\n`) };
    const plan = buildImportPlan(files, places, seed, roads);
    expect(plan.problems).toEqual([]);
    const result = await commitImport(ownerUrl!, plan);
    expect(result.places).toMatchObject({ outcome: "committed", revisionLabel: "osm-places-2099-01-03" });
    expect(result.modes).toMatchObject({ outcome: "unchanged" });
    // A new revision after every earlier one of this base label, whatever suffix the database has reached.
    const next = (result.lines as { revisionLabel: string }).revisionLabel;
    expect(result.lines).toMatchObject({ outcome: "committed", revisionLabel: expect.stringMatching(LABEL_PATTERN) });
    expect(next).not.toBe(LABEL);
    expect(await appRows(sql`select label from transit.v_published_revision`)).toEqual([{ label: next }]);
    // Same variants and road snapshot: the shapes are reused (same rows), carried into the new revision.
    const id = (await revisionIdOf(next))!;
    const shapes = (list: Member[]) => list.filter((m) => m.entity_kind === "shape");
    expect(shapes(await members(id))).toEqual(shapes(await members(linesRevisionId)));
    const again = await commitImport(ownerUrl!, buildImportPlan(files, places, seed, roads));
    expect(again.lines).toMatchObject({ outcome: "unchanged", revisionLabel: next });
  });

  it("a newer modes seed that changes a feeder variant publishes: its shape follows the new variant version", async () => {
    const json = JSON.parse(seed.bytes.toString("utf8"));
    json.header.preparedOn = "2026-10-17";
    const route = json.routes.find((r: { code: string }) => r.code === "TRI-DECALANGON");
    route.variants[0].anchors[1] = { kind: "place_name", name: "Sitio Salunguigui" };
    const seed2: ModesFile = { fileName: "naga-modes-seed-2026-10-17.json", bytes: Buffer.from(JSON.stringify(json, null, 1)) };
    const plan = buildImportPlan(files, osm, seed2, roads);
    expect(plan.problems).toEqual([]);
    const result = await commitImport(ownerUrl!, plan);
    expect(result.modes).toMatchObject({ outcome: "committed", revisionLabel: "modes-2026-10-17" });
    expect(result.lines).toMatchObject({ outcome: "committed", revisionLabel: expect.stringMatching(LABEL_PATTERN) });
    const id = (await revisionIdOf((result.lines as { revisionLabel: string }).revisionLabel))!;
    const feeder = await asImport(async (c) => (await c.query(
      `select vv.anchors->1->>'name' as anchor, sv.trace_status
         from transit.revision_member vm
         join transit.variant v on v.id = vm.entity_id
         join transit.route r on r.id = v.route_id
         join transit.variant_version vv on vv.id = vm.version_id
         join transit.shape s on s.variant_id = v.id
         join transit.revision_member sm on sm.revision_id = vm.revision_id and sm.entity_kind = 'shape' and sm.entity_id = s.id
         join transit.shape_version sv on sv.id = sm.version_id and sv.variant_version_id = vm.version_id
        where vm.revision_id = $1 and vm.entity_kind = 'variant' and r.public_code = 'TRI-DECALANGON'`, [id])).rows);
    expect(feeder).toEqual([{ anchor: "Sitio Salunguigui", trace_status: "untraced" }]);
    const response = await linesGET(new Request(`http://localhost/api/v1/network/lines/${id}`), ctx(id));
    expect(response.status).toBe(200);
    expect(linesSchema.parse(await response.json()).untraced).toHaveLength(3);
  });
});
