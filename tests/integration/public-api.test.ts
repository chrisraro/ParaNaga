// Public read API (/api/v1) against a throwaway Neon branch with the Naga import applied:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// The handlers run as in production: withRequestContext → pool on PARANAGA_DATABASE_URL
// (paranaga_app, set by with-neon-branch.sh). Every body is validated with the shared schemas.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  networkHeadSchema,
  networkSnapshotSchema,
  routeDetailSchema,
  routeListSchema,
  stopDetailSchema,
  stopsInBboxSchema,
} from "@/domain/api/schemas";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import { runInRequestContext } from "@/server/db/run-in-context";
import { getPool } from "@/server/db/client";
import { GET as headGET } from "@/app/api/v1/network/head/route";
import { GET as snapshotGET } from "@/app/api/v1/network/snapshot/[revisionId]/route";
import { GET as stopsGET } from "@/app/api/v1/stops/route";
import { GET as stopGET } from "@/app/api/v1/stops/[id]/route";
import { GET as routesGET } from "@/app/api/v1/routes/route";
import { GET as routeGET } from "@/app/api/v1/routes/[code]/route";
import { buildImportPlan, readDataFiles, readNewestModesSeed, readNewestOsmSnapshot } from "../../scripts/lib/import-plan";
import { commitImport } from "../../scripts/lib/import-writer";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;
const runtimeUrl = process.env.PARANAGA_DATABASE_URL;

const base = "http://localhost/api/v1";
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
const get = (path: string) => new Request(`${base}${path}`);

async function ok<T>(response: Response, schema: { parse: (v: unknown) => T }, cache: string): Promise<T> {
  const raw = await response.clone().text();
  expect(response.status, raw.slice(0, 300)).toBe(200);
  expect(response.headers.get("cache-control")).toBe(cache);
  return schema.parse(JSON.parse(raw));
}

async function notFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe("not_found");
}

describe.skipIf(!ownerUrl || !appUrl || !importUrl || !runtimeUrl)("public read API (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;
  let revisionId: string;

  const appRows = async (query: ReturnType<typeof sql>) =>
    runInRequestContext(app, { userId: null, requestId: `api-${run}` }, async (db) => (await db.execute(query)).rows);
  const publish = (id: string) => importer.query("select transit.publish_revision($1)", [id]);
  const pointer = async () => (await appRows(sql`select id from transit.v_published_revision`))[0]?.id as string | undefined;
  const stopByCode = async (layer: string, code: string) =>
    (await appRows(sql`select stop_point_id from transit.v_published_stops
                        where source_layer = ${layer} and source_code_raw = ${code}`))[0]!.stop_point_id as string;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    // The import may already have run (import-naga.test.ts); other files may have published
    // test revisions since. Make the Naga revision the published one again (publish = rollback).
    const plan = buildImportPlan(readDataFiles("Data_Sets"));
    await commitImport(ownerUrl!, plan);
    const { rows } = await owner.query<{ id: string }>("select id from transit.revision where label = $1", [plan.revisionLabel]);
    revisionId = rows[0]!.id;
    if ((await pointer()) !== revisionId) await publish(revisionId);
  }, 120_000);

  afterAll(async () => {
    await getPool().end();
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  // ---------------------------------------------------------------- network/head

  it("network/head names the published provisional revision", async () => {
    const body = await ok(await headGET(get("/network/head")), networkHeadSchema, "public, s-maxage=30");
    expect(body).toMatchObject({ revisionId, label: "provisional-loops-2026-10-15", kind: "provisional" });
    expect(body.publishedAt).not.toBeNull();
  });

  // ---------------------------------------------------------------- network/snapshot

  it("network/snapshot returns 128 pins, the A and B loops in pin order, and estimate-only fares", async () => {
    const body = await ok(
      await snapshotGET(get(`/network/snapshot/${revisionId}`), ctx({ revisionId })),
      networkSnapshotSchema,
      "public, s-maxage=31536000, immutable",
    );
    expect(body.revision).toMatchObject({ revisionId, kind: "provisional" });
    expect(body.stops).toHaveLength(128);
    const a1 = body.stops.find((s) => s.source.layer === "Loop Service A" && s.source.code === "A1");
    expect(a1).toMatchObject({ name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726, status: "candidate", navigationApproved: false });

    expect(body.variants.map((v) => [v.routeCode, v.stopIds.length])).toEqual([["R8-A", 30], ["R8-B", 31]]);
    for (const v of body.variants) {
      expect(v).toMatchObject({ evidenceLevel: "provisional", verification: "unverified", isCircular: true, kind: "permanent" });
    }
    const byId = new Map(body.stops.map((s) => [s.id, s]));
    const codes = (i: number) => body.variants[i]!.stopIds.map((id) => byId.get(id)!.source.code);
    expect(codes(0)).toEqual(Array.from({ length: 30 }, (_, i) => `A${i + 1}`));
    expect(codes(1)).toEqual(Array.from({ length: 31 }, (_, i) => `B${i + 1}`));
    expect(body.variants[0]!.stopIds.every((id) => byId.get(id)!.source.layer === "Loop Service A")).toBe(true);

    expect(body.fareRules.map((f) => [f.code, f.baseCentavos, f.publishExact, f.isEstimate])).toEqual([
      ["F01", 1400, false, true], ["F02", 1700, false, true], ["F03", 1500, false, true], ["F04", 1000, false, true],
    ]);
  });

  it("network/snapshot: 404 for an unknown revision", async () => {
    const unknown = randomUUID();
    await notFound(await snapshotGET(get(`/network/snapshot/${unknown}`), ctx({ revisionId: unknown })));
  });

  it("network/snapshot: 404 once the revision is superseded, served again after rollback", async () => {
    const other = await seedDraftRevision("superseding", { publishable: true });
    await publish(other.revisionId);
    try {
      await notFound(await snapshotGET(get(`/network/snapshot/${revisionId}`), ctx({ revisionId })));
      const head = await ok(await headGET(get("/network/head")), networkHeadSchema, "public, s-maxage=30");
      expect(head.revisionId).toBe(other.revisionId);
    } finally {
      await publish(revisionId);
    }
    const again = await snapshotGET(get(`/network/snapshot/${revisionId}`), ctx({ revisionId }));
    expect(again.status).toBe(200);
  });

  // ---------------------------------------------------------------- stops?bbox

  it("stops?bbox returns the candidate pins inside the box", async () => {
    const small = await ok(
      await stopsGET(get("/stops?bbox=123.1840,13.6230,123.1850,13.6240")),
      stopsInBboxSchema,
      "public, s-maxage=300",
    );
    expect(small.revision.kind).toBe("provisional");
    expect(small.stops.length).toBeGreaterThan(0);
    expect(small.stops.every((s) => s.lat >= 13.623 && s.lat <= 13.624 && s.lng >= 123.184 && s.lng <= 123.185)).toBe(true);
    expect(small.stops).toContainEqual(expect.objectContaining({
      name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726, status: "candidate",
      source: { layer: "Loop Service A", code: "A1", label: "Plaza Rizal" },
      routeCodes: ["R8-A"],
    }));
    // Pins of the unsequenced C and D layers are on no route order.
    expect(small.stops.filter((s) => /Loop Service [CD]/.test(s.source.layer ?? "")).every((s) => s.routeCodes.length === 0)).toBe(true);

    const b = NAGA_MAX_BOUNDS;
    const all = await ok(await stopsGET(get(`/stops?bbox=${b.west},${b.south},${b.east},${b.north}`)), stopsInBboxSchema, "public, s-maxage=300");
    expect(all.stops).toHaveLength(128);
    expect(all.stops.filter((s) => s.routeCodes.length > 0)).toHaveLength(61); // A1–A30 and B1–B31
  });

  // ---------------------------------------------------------------- stops/:id

  it("stops/:id for A1 returns the raw source record, its loop, and attribution", async () => {
    const id = await stopByCode("Loop Service A", "A1");
    const body = await ok(await stopGET(get(`/stops/${id}`), ctx({ id })), stopDetailSchema, "public, s-maxage=300");
    expect(body.stop).toMatchObject({
      id, name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726, status: "candidate",
      curbSide: null, boardingAllowed: null, alightingAllowed: null, signInstalled: null,
    });
    expect(body.sourceRecords).toEqual([expect.objectContaining({
      layer: "Loop Service A", code: "A1", label: "Plaza Rizal",
      coordinatesRaw: "123.1846726,13.6233869,0", lat: 13.6233869, lng: 123.1846726,
      retrievedOn: "2026-10-15",
    })]);
    expect(body.servingRoutes).toEqual([expect.objectContaining({
      routeCode: "R8-A", seq: 1, evidenceLevel: "provisional", verification: "unverified", isCircular: true,
    })]);
    expect(body.passingNearby).toEqual([]);
    expect(body.sourceMap).toEqual({ ownerDisplayName: "Tan Gumba", ownerIdentityVerified: false });
  });

  it("stops/:id lists pins of other layers at exactly the same coordinates, never its own layer", async () => {
    const pairs = await appRows(sql`
      select a.stop_point_id as a, b.stop_point_id as b from transit.v_published_stop_sources a
        join transit.v_published_stop_sources b on b.lon = a.lon and b.lat = a.lat and b.stop_point_id <> a.stop_point_id
                                               and b.source_layer <> a.source_layer
       order by a.source_layer, a.source_code_raw limit 1`);
    expect(pairs).toHaveLength(1);
    const { a, b } = pairs[0] as { a: string; b: string };
    const body = await ok(await stopGET(get(`/stops/${a}`), ctx({ id: a })), stopDetailSchema, "public, s-maxage=300");
    expect(body.sharedCoordinate.map((s) => s.stopId)).toContain(b);
    expect(body.sharedCoordinate.map((s) => s.stopId)).not.toContain(a);
    expect(body.sharedCoordinate.every((s) => s.source.layer !== body.stop.source.layer)).toBe(true);
  });

  it("stops/:id for an unsequenced C-layer pin and for B18 (no label)", async () => {
    const [first] = await appRows(sql`select stop_point_id from transit.v_published_stops
                                       where source_layer = 'Loop Service C' order by source_code_raw limit 1`);
    const c = first!.stop_point_id as string;
    const cBody = await ok(await stopGET(get(`/stops/${c}`), ctx({ id: c })), stopDetailSchema, "public, s-maxage=300");
    expect(cBody.servingRoutes).toEqual([]);
    expect(cBody.stop.status).toBe("candidate");

    const b18 = await stopByCode("Loop Service B", "B18");
    const body = await ok(await stopGET(get(`/stops/${b18}`), ctx({ id: b18 })), stopDetailSchema, "public, s-maxage=300");
    expect(body.stop.name).toBe("B18");
    expect(body.sourceRecords[0]).toMatchObject({ code: "B18", label: "" });
  });

  it("stops/:id: 404 for an unknown id", async () => {
    const id = randomUUID();
    await notFound(await stopGET(get(`/stops/${id}`), ctx({ id })));
  });

  // ---------------------------------------------------------------- routes

  it("routes groups the 11 routes by group number with honest badges", async () => {
    const body = await ok(await routesGET(get("/routes")), routeListSchema, "public, s-maxage=300");
    expect(body.groups.map((g) => [g.groupNumber, g.routes.map((r) => r.code)])).toEqual([
      [1, ["R1"]], [2, ["R2"]], [3, ["R3"]], [4, ["R4"]], [5, ["R5"]], [6, ["R6"]], [7, ["R7"]],
      [8, ["R8-A", "R8-B", "R8-C", "R8-D"]],
    ]);
    const routes = body.groups.flatMap((g) => g.routes);
    expect(routes.every((r) => r.verification === "unverified" && r.aliases.length === 0)).toBe(true);
    const byCode = new Map(routes.map((r) => [r.code, r]));
    expect(byCode.get("R3")).toMatchObject({
      allocatedUnits: 28, allocationIsActiveFleetCount: false, groupAllocatedUnits: null,
      evidenceLevel: "documentary", hasProvisionalStops: false, hasTrial: false,
    });
    expect(byCode.get("R8-A")).toMatchObject({
      allocatedUnits: null, groupAllocatedUnits: 71, evidenceLevel: "provisional", hasProvisionalStops: true, hasTrial: true,
    });
    expect(byCode.get("R8-C")).toMatchObject({ groupAllocatedUnits: 71, evidenceLevel: "documentary", hasProvisionalStops: false });
  });

  it("routes/R3 keeps its two street structures separate", async () => {
    const body = await ok(await routeGET(get("/routes/R3"), ctx({ code: "R3" })), routeDetailSchema, "public, s-maxage=300");
    expect(body.route.code).toBe("R3");
    expect(body.route.legalStreets.inbound).toBeNull();
    expect(body.route.legalStreets.circuit).toHaveLength(14);
    expect(body.route.legalStreets.circuit![2]).toBe("Roxas Ave");
    expect(body.route.additionalSourceStructures).toHaveLength(1);
    expect(body.route.additionalSourceStructures[0]).toEqual([
      "Naga–Pili boundary, Del Rosario", "AH26", "Almeda Highway", "Roxas Ave", "AH26", "Mabolo",
      "Camaligan–Gainza Rd", "Felix Plazo St", "Southbound Terminal",
    ]);
    expect(body.route.normalizationNote).toMatch(/Felix Plaxo/);
    expect(body.variants).toHaveLength(1);
    expect(body.variants[0]).toMatchObject({ direction: "circuit", evidenceLevel: "documentary", verification: "unverified", stops: [] });
    expect(body.trials).toEqual([]);
    expect(body.aliases).toEqual([]);
    expect(body.fareEvidence.basis).toBe("route_mode");
    expect(body.fareEvidence.rules.map((r) => r.code)).toEqual(["F01", "F02"]);
    expect(body.fareEvidence.rules.every((r) => r.isEstimate && !r.publishExact)).toBe(true);
    expect(body.sources.map((s) => s.code)).toEqual(["S01", "S02"]);
  });

  it("routes/r8-a returns 30 provisional ordered stops and the unconfirmed trial", async () => {
    const body = await ok(await routeGET(get("/routes/r8-a"), ctx({ code: "r8-a" })), routeDetailSchema, "public, s-maxage=300");
    expect(body.route).toMatchObject({ code: "R8-A", groupAllocatedUnits: 71, hasProvisionalStops: true });
    expect(body.variants).toHaveLength(1);
    const loop = body.variants[0]!;
    expect(loop).toMatchObject({ direction: "clockwise", evidenceLevel: "provisional", verification: "unverified", isCircular: true });
    expect(loop.stops.map((s) => s.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(loop.stops.map((s) => s.source.code)).toEqual(Array.from({ length: 30 }, (_, i) => `A${i + 1}`));
    expect(loop.stops[0]).toMatchObject({ name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726 });
    expect(body.route.legalStreets.circuit?.length).toBeGreaterThan(0);
    expect(body.trials).toEqual([expect.objectContaining({
      kind: "trial", trialStatus: "permanence_unconfirmed", effectiveFrom: "2025-11-11", trialDurationDays: 30,
      sourceCodes: ["S03"], stops: [],
    })]);
    expect(body.sources.map((s) => s.code)).toEqual(["S01", "S02", "S03"]);
    expect(body.sources.find((s) => s.code === "S03")).toMatchObject({ checkedOn: "2026-10-15" });
  });

  it("routes/R8-B has 31 stops; R8-C has none", async () => {
    const b = await ok(await routeGET(get("/routes/R8-B"), ctx({ code: "R8-B" })), routeDetailSchema, "public, s-maxage=300");
    expect(b.variants[0]!.stops).toHaveLength(31);
    const c = await ok(await routeGET(get("/routes/R8-C"), ctx({ code: "R8-C" })), routeDetailSchema, "public, s-maxage=300");
    expect(c.variants.flatMap((v) => v.stops)).toEqual([]);
  });

  it("routes/:code: 404 for an unknown route", async () => {
    await notFound(await routeGET(get("/routes/R99"), ctx({ code: "R99" })));
  });

  // ---------------------------------------------------------------- views added for this API

  it("the new published views hide draft rows that paranaga_app can see in the base tables", async () => {
    const draft = await seedDraftRevision("invisible", { publishable: false });
    // Sanity: the rows exist and are readable by the app role in the base tables.
    expect(await appRows(sql`select id from transit.dataset_note where id = ${draft.noteId}::uuid`)).toHaveLength(1);
    expect(await appRows(sql`select id from ingest.raw_feature where id = ${draft.rawFeatureId}::uuid`)).toHaveLength(1);

    const views: [string, ReturnType<typeof sql>][] = [
      ["stop_sources", sql`select 1 from transit.v_published_stop_sources where raw_feature_id = ${draft.rawFeatureId}::uuid`],
      ["fare_observations", sql`select 1 from transit.v_published_fare_observations where id = ${draft.observationId}::uuid`],
      ["fare_conflicts", sql`select 1 from transit.v_published_fare_conflicts where id = ${draft.conflictId}::uuid`],
      ["dataset_notes", sql`select 1 from transit.v_published_dataset_notes where id = ${draft.noteId}::uuid`],
      ["sources", sql`select 1 from transit.v_published_sources where code = ${draft.sourceCode}`],
    ];
    for (const [name, query] of views) expect(await appRows(query), name).toEqual([]);
  });

  it("a draft source pin attached to published A1 stays invisible; the published version cannot get new pins", async () => {
    const a1 = await stopByCode("Loop Service A", "A1");
    const read = async () =>
      ok(await stopGET(get(`/stops/${a1}`), ctx({ id: a1 })), stopDetailSchema, "public, s-maxage=300");
    const before = await read();
    expect(before.sourceRecords).toHaveLength(1);

    // A later snapshot re-uses A1's stop point: new raw pin (same coordinates, another layer),
    // new draft stop version, draft revision membership.
    const batch = await importer.query(
      `insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'dry_run', 'running', 'test') returning id`,
      [`api:${run}:a1-reimport`]);
    const raw = await importer.query(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw, label_raw,
                                       coordinates_raw, lon, lat, content_hash)
       values ($1, $2, 'layer_code_label', 'Draft re-import', 'A1', 'Plaza Rizal (draft)', '123.1846726,13.6233869,0',
               123.1846726, 13.6233869, 'h') returning id`, [batch.rows[0].id, `api-${run}-a1-reimport`]);
    const spv = await importer.query(
      `insert into transit.stop_point_version (stop_point_id, geog, source_layer, source_code_raw, label_raw)
       values ($1, extensions.ST_SetSRID(extensions.ST_MakePoint(123.1846726, 13.6233869), 4326)::extensions.geography,
               'Draft re-import', 'A1', 'Plaza Rizal (draft)') returning id`, [a1]);
    await importer.query(`insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id) values ($1, $2, $3)`,
      [a1, spv.rows[0].id, raw.rows[0].id]);
    const rev = await importer.query(
      `insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id`,
      [`api-${run}-a1-reimport`]);
    await importer.query(`insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, 'stop_point', $2, $3)`,
      [rev.rows[0].id, a1, spv.rows[0].id]);

    const after = await read();
    expect(after.sourceRecords).toEqual(before.sourceRecords);
    expect(after.sourceRecords).toHaveLength(1);
    expect(after.sharedCoordinate).toEqual(before.sharedCoordinate);
    expect(after.stop).toEqual(before.stop);

    // Attaching the pin to the PUBLISHED version directly is refused by RLS.
    const published = await appRows(sql`select stop_point_version_id from transit.v_published_stops where stop_point_id = ${a1}::uuid`);
    const refused = await importer
      .query(`insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id) values ($1, $2, $3)`,
        [a1, published[0]!.stop_point_version_id, raw.rows[0].id])
      .then(() => null, (e: { code?: string }) => e.code);
    expect(refused).toBe("42501");
  });

  // ---------------------------------------------------------------- modes (0008, Increment D)

  describe("with the modes revision published", () => {
    let modesId: string;
    const json = (v: unknown) => JSON.stringify(v);
    /** Every object key anywhere in the value. */
    const keys = (v: unknown): string[] =>
      Array.isArray(v) ? v.flatMap(keys)
        : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];

    beforeAll(async () => {
      const plan = buildImportPlan(readDataFiles("Data_Sets"), readNewestOsmSnapshot(), readNewestModesSeed());
      expect(plan.problems).toEqual([]);
      await commitImport(ownerUrl!, plan);
      const found = await owner.query<{ id: string }>("select id from transit.revision where label = $1", [plan.modes!.revisionLabel]);
      modesId = found.rows[0]!.id;
      if ((await pointer()) !== modesId) await publish(modesId);
    }, 180_000);

    afterAll(async () => {
      if ((await pointer()) !== revisionId) await publish(revisionId);
    });

    it("snapshot: 16 terminals (T15/T16 without coordinates), fleets on R4/R7, intra-city fares only, no e-jeepney", async () => {
      const raw = await (await snapshotGET(get(`/network/snapshot/${modesId}`), ctx({ revisionId: modesId }))).text();
      const body = networkSnapshotSchema.parse(JSON.parse(raw));
      expect(body.revision.label).toBe("modes-2026-10-16");
      expect(body.stops).toHaveLength(128);
      expect(body.terminals.map((t) => t.code)).toEqual(Array.from({ length: 16 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
      for (const code of ["T15", "T16"]) expect(body.terminals.find((t) => t.code === code), code).toMatchObject({ lat: null, lng: null, coordSource: null });
      expect(body.terminals.find((t) => t.code === "T01")).toMatchObject({ lat: 13.6192359, lng: 123.1897426, coordSource: "osm_way_centroid" });

      const route = (code: string) => body.routes.find((r) => r.routeCode === code)!;
      expect(body.routes).toHaveLength(13);
      for (const code of ["R4", "R7"]) {
        expect(route(code).fleet, code).toMatchObject({
          label: "Traditional and modern jeepneys", chip: "Jeepney · traditional + modern", colourKey: "mixed_trad_modern",
        });
        expect(route(code).fleet.classes.find((c) => c.vehicleClass === "modern_puj"), code).toMatchObject({ status: "operating", aircon: true });
      }
      for (const code of ["R1", "R2", "R3", "R5", "R6", "R8-A", "R8-B", "R8-C", "R8-D"]) {
        expect(route(code).fleet.classes.map((c) => c.vehicleClass), code).toEqual(["traditional_puj"]);
        expect(route(code).fleet.colourKey, code).toBe("traditional_puj");
      }
      expect(route("TRI-VISTODA")).toMatchObject({ mode: "tricycle", serviceStatus: "authorized_feeder", fleet: { colourKey: "tricycle" } });

      // Only R8-A/R8-B have a stop order; their variants carry the mode, and the fleet joins by routeId. Feeders (no stops) are absent.
      expect(body.variants.every((v) => !("fleet" in v))).toBe(true);
      const fleetOf = (routeId: string) => body.routes.find((r) => r.routeId === routeId)!.fleet;
      expect(body.variants.map((v) => [v.routeCode, v.mode, fleetOf(v.routeId).colourKey])).toEqual([
        ["R8-A", "jeepney", "traditional_puj"], ["R8-B", "jeepney", "traditional_puj"],
      ]);
      // Bus and UV rules (F06–F12) never reach the planner.
      expect(body.fareRules.map((f) => f.code)).toEqual(["F01", "F02", "F03", "F04"]);
      expect(raw).not.toMatch(/e[-_ ]?jeep/i);
    });

    it("routes: modes, service status, fleets and owner-confirmed service; feeders listed with their branches", async () => {
      const list = await ok(await routesGET(get("/routes")), routeListSchema, "public, s-maxage=300");
      const routes = list.groups.flatMap((g) => g.routes);
      expect(routes.map((r) => r.code)).toEqual(expect.arrayContaining(["TRI-VISTODA", "TRI-DECALANGON"]));
      expect(list.groups.at(-1)!.groupNumber).toBeNull();
      const r1 = routes.find((r) => r.code === "R1")!;
      expect(r1).toMatchObject({ mode: "jeepney", serviceStatus: "legal_plan", planning: "none", fleet: { label: "Traditional jeepneys" } });
      expect(r1.operatingStatus).toMatchObject({ status: "operating", confirmedOn: "2026-10-16", confirmsServiceOnly: true, sourceCodes: ["U01"] });
      // Service is confirmed; stops and paths are not: the route stays unverified.
      expect(r1.verification).toBe("unverified");
      expect(routes.find((r) => r.code === "R8-A")!.planning).toBe("provisional");

      const tri = await ok(await routeGET(get("/routes/TRI-VISTODA"), ctx({ code: "TRI-VISTODA" })), routeDetailSchema, "public, s-maxage=300");
      expect(tri.variants.map((v) => [v.direction, v.stops.length])).toEqual([["branch", 0], ["branch", 0]]);
      expect(tri.variants.every((v) => v.name !== null && v.legalStreets.branch?.length === 1)).toBe(true);
      expect(tri.route.legalStreets.branch).toHaveLength(2);
      expect(tri.route.fleet.label).toBe("Tricycle (special trimobile) · authorized 2025 · operation not verified");
      expect(tri.route.operatingStatus).toBeNull();
      expect(tri.fareEvidence.rules.map((r) => r.code)).toEqual(["F03"]);
    });

    it("routes/R4: cooperatives with sources and dates, never a chair or an address; fares stay F01/F02", async () => {
      const raw = await (await routeGET(get("/routes/R4"), ctx({ code: "R4" }))).text();
      const body = routeDetailSchema.parse(JSON.parse(raw));
      expect(body.cooperatives.map((c) => [c.name, c.basis])).toEqual([
        ["Naga City Allied Transport Cooperative (NACIATRASCO)", "corridor_reported"],
        ["Centro Panganiban Del Rosario Transport Cooperative", "name_matches_corridor"],
        ["Del Rosario Panganiban Centro Bagong Pag-Asa Transport Cooperative (DCPC-BAPAGTRANSCO)", "name_matches_corridor"],
      ].sort((a, b) => (a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : a[0]! < b[0]! ? -1 : 1)));
      for (const c of body.cooperatives) expect(c.sourceCodes.length).toBeGreaterThan(0);
      expect(body.cooperatives.find((c) => c.basis === "name_matches_corridor")!.label).toMatch(/route not confirmed$/);
      const forbidden = keys(JSON.parse(raw)).filter((k) => /chair|address/i.test(k));
      expect(forbidden).toEqual([]);

      expect(body.route.fleet).toMatchObject({ label: "Traditional and modern jeepneys", colourKey: "mixed_trad_modern" });
      const modern = body.route.fleet.classes.find((c) => c.vehicleClass === "modern_puj")!;
      expect(modern).toMatchObject({ aircon: true, airconSourceCodes: ["N14", "U01"], lastReportedOn: "2026-10-16" });
      expect(body.fareEvidence.rules.map((r) => r.code)).toEqual(["F01", "F02"]);
      expect(body.fareEvidence.reportedPractice).toEqual([expect.objectContaining({
        code: "FO-R4-MOD", vehicleClass: "modern_puj", deltaQualifier: "range", deltaCentavosLow: 300, deltaCentavosHigh: 500,
      })]);
      const codes = body.sources.map((s) => s.code);
      for (const c of [...body.route.fleet.classes.flatMap((x) => [...x.sourceCodes, ...x.airconSourceCodes]),
        ...body.cooperatives.flatMap((x) => x.sourceCodes)]) expect(codes, c).toContain(c);
      expect(json(body)).not.toMatch(/e[-_ ]?jeep/i);
    });

    it("an older revision still reads its terminals through the legacy rows (no coordinates, no kind)", async () => {
      await publish(revisionId);
      try {
        const body = await ok(await snapshotGET(get(`/network/snapshot/${revisionId}`), ctx({ revisionId })), networkSnapshotSchema,
          "public, s-maxage=31536000, immutable");
        expect(body.terminals.map((t) => t.code)).toEqual(["T01", "T02", "T03", "T04", "T05", "T06"]);
        expect(body.terminals.every((t) => t.lat === null && t.kind === null)).toBe(true);
        expect(body.routes.every((r) => r.fleet.label === "Vehicle type not confirmed")).toBe(true);
      } finally {
        await publish(modesId);
      }
    });
  });

  /**
   * A draft revision (through paranaga_import) with one stop + source pin, a fare rule with an
   * observation and conflict citing a source nothing published cites, and a dataset note.
   * `publishable` adds the members publish_revision needs to accept it.
   */
  async function seedDraftRevision(tag: string, opts: { publishable: boolean }) {
    const one = async (text: string, values: unknown[] = []) => (await importer.query(text, values)).rows[0] as Record<string, string>;
    const sourceCode = "S899";
    await importer.query(`insert into ingest.source (code, title) values ($1, 'draft-only source') on conflict do nothing`, [sourceCode]);
    const rev = await one(`insert into transit.revision (label, kind, status, created_by) values ($1, 'provisional', 'draft', 'test') returning id`,
      [`api-${run}-${tag}`]);
    const batch = await one(`insert into ingest.batch (snapshot_version, mode, status, started_by) values ($1, 'dry_run', 'running', 'test') returning id`,
      [`api:${run}:${tag}`]);
    const raw = await one(
      `insert into ingest.raw_feature (batch_id, source_identity, identity_method, source_layer, source_code_raw, label_raw,
                                       coordinates_raw, lon, lat, content_hash)
       values ($1, $2, 'layer_code_label', 'Draft layer', 'Z1', 'Draft pin', '123.19,13.62,0', 123.19, 13.62, 'h') returning id`,
      [batch.id, `api-${run}-${tag}`]);
    const sp = await one(`insert into transit.stop_point (name) values ($1) returning id`, [`Draft ${tag}`]);
    const spv = await one(
      `insert into transit.stop_point_version (stop_point_id, geog, source_layer, source_code_raw, label_raw)
       values ($1, extensions.ST_SetSRID(extensions.ST_MakePoint(123.19, 13.62), 4326)::extensions.geography,
               'Draft layer', 'Z1', 'Draft pin') returning id`, [sp.id]);
    await importer.query(`insert into transit.stop_point_source (stop_point_id, stop_point_version_id, raw_feature_id) values ($1, $2, $3)`,
      [sp.id, spv.id, raw.id]);
    const rule = await one(`insert into transit.fare_rule (code, mode_code) values ($1, 'draft_mode') returning id`, [`FD-${run}-${tag}`]);
    const rv = await one(`insert into transit.fare_rule_version (fare_rule_id, base_centavos, source_codes) values ($1, 999, $2) returning id`,
      [rule.id, [sourceCode]]);
    const obs = await one(
      `insert into transit.fare_observation (code, mode_code, amount_centavos, category, kind, source_codes)
       values ($1, 'draft_mode', 900, 'student', 'reported_practice', $2) returning id`, [`FD-${run}-${tag}`, [sourceCode]]);
    const conflict = await one(`insert into transit.fare_conflict (fare_rule_id, fare_observation_id, note) values ($1, $2, 'draft') returning id`,
      [rule.id, obs.id]);
    const note = await one(`insert into transit.dataset_note (key, value) values ($1, '{"draft":true}') returning id`, [`api-${run}-${tag}`]);
    const members: [string, string, string][] = [
      ["stop_point", sp.id!, spv.id!], ["fare_rule", rule.id!, rv.id!], ["fare_observation", obs.id!, obs.id!],
      ["fare_conflict", conflict.id!, conflict.id!], ["dataset_note", note.id!, note.id!],
    ];
    if (opts.publishable) {
      const route = await one(`insert into transit.route (public_code, name) values ($1, 'Draft route') returning id`, [`D-${run}-${tag}`]);
      members.push(["route", route.id!, route.id!]);
    }
    for (const [kind, entity, version] of members) {
      await importer.query(`insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, $2, $3, $4)`,
        [rev.id, kind, entity, version]);
    }
    return {
      revisionId: rev.id!, rawFeatureId: raw.id!, observationId: obs.id!, conflictId: conflict.id!, noteId: note.id!, sourceCode,
    };
  }
});
