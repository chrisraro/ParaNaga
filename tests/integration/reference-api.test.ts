// Reference read model (migration 0004, search index, terminals, sources) against a throwaway
// Neon branch with the Naga transit import AND the committed OpenStreetMap snapshot applied:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// The handlers run as in production (withRequestContext → pool on PARANAGA_DATABASE_URL as
// paranaga_app). Restores the previously published revision afterwards.
// CAPTURE_E2E_FIXTURES=1 also writes the real responses to tests/e2e/fixtures/network/: the new
// reference fixtures AND the older stop/route fixtures, so every e2e fixture names one revision.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorSchema, searchIndexSchema, sourceListSchema, terminalDetailSchema } from "@/domain/api/schemas";
import { runInRequestContext } from "@/server/db/run-in-context";
import { getPool } from "@/server/db/client";
import { GET as searchIndexGET } from "@/app/api/v1/network/search-index/[revisionId]/route";
import { GET as terminalGET } from "@/app/api/v1/terminals/[code]/route";
import { GET as sourcesGET } from "@/app/api/v1/sources/route";
import { GET as stopsGET } from "@/app/api/v1/stops/route";
import { GET as stopGET } from "@/app/api/v1/stops/[id]/route";
import { GET as routesGET } from "@/app/api/v1/routes/route";
import { GET as routeGET } from "@/app/api/v1/routes/[code]/route";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import { buildImportPlan, readDataFiles, readNewestOsmSnapshot } from "../../scripts/lib/import-plan";
import { commitImport } from "../../scripts/lib/import-writer";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;
const importUrl = process.env.TEST_IMPORT_DATABASE_URL;
const runtimeUrl = process.env.PARANAGA_DATABASE_URL;
const capture = process.env.CAPTURE_E2E_FIXTURES === "1";

const base = "http://localhost/api/v1";
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
const get = (path: string) => new Request(`${base}${path}`);
const REFERENCE_CACHE = "public, s-maxage=300, stale-while-revalidate=600";

const VIEWS = [
  "v_published_barangays", "v_published_designated_stop_candidates",
  "v_published_destination_categories", "v_published_feeder_leads", "v_published_source_catalog",
] as const;

async function okText(response: Response, cache: string): Promise<string> {
  const raw = await response.clone().text();
  expect(response.status, raw.slice(0, 300)).toBe(200);
  expect(response.headers.get("cache-control")).toBe(cache);
  return raw;
}

async function notFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe("not_found");
}

function saveFixture(name: string, raw: string) {
  if (capture) writeFileSync(`tests/e2e/fixtures/network/${name}`, JSON.stringify(JSON.parse(raw), null, 1) + "\n");
}

describe.skipIf(!ownerUrl || !appUrl || !importUrl || !runtimeUrl)("reference read model (Neon branch)", () => {
  const run = randomUUID().slice(0, 8);
  let owner: pg.Client;
  let importer: pg.Client;
  let app: pg.Pool;
  let revisionId: string;
  let transitRevisionId: string;
  let previous: string | undefined;

  const appRun = <T>(fn: Parameters<typeof runInRequestContext<T>>[2]) =>
    runInRequestContext<T>(app, { userId: null, requestId: `reference-${run}` }, fn);
  const appRows = async (query: ReturnType<typeof sql>) => appRun(async (db) => (await db.execute(query)).rows);
  const publish = (id: string) => importer.query("select transit.publish_revision($1)", [id]);
  const pointer = async () => (await appRows(sql`select id from transit.v_published_revision`))[0]?.id as string | undefined;
  const pgCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    }
    throw new Error("expected the statement to fail");
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    importer = new pg.Client({ connectionString: importUrl });
    await importer.connect();
    app = new pg.Pool({ connectionString: appUrl, max: 1 });

    // Transit files plus the committed OSM snapshot (as `pnpm db:import --commit` does). On a
    // branch of main both are usually present already ("unchanged"); then publish the OSM
    // revision (which carries the transit data) if another test file published something else.
    previous = await pointer();
    const plan = buildImportPlan(readDataFiles("Data_Sets"), readNewestOsmSnapshot());
    expect(plan.problems).toEqual([]);
    await commitImport(ownerUrl!, plan);
    const ids = await owner.query<{ id: string; label: string }>(
      "select id, label from transit.revision where label = any($1)", [[plan.osm!.revisionLabel, plan.revisionLabel]]);
    revisionId = ids.rows.find((r) => r.label === plan.osm!.revisionLabel)!.id;
    transitRevisionId = ids.rows.find((r) => r.label === plan.revisionLabel)!.id;
    if ((await pointer()) !== revisionId) await publish(revisionId);
  }, 180_000);

  afterAll(async () => {
    if (previous && (await pointer()) !== previous) await publish(previous);
    await getPool().end();
    await app?.end();
    await importer?.end();
    await owner?.end();
  });

  // ---------------------------------------------------------------- e2e fixture capture

  it.runIf(capture)("captures the stop and route fixtures from the same published revision", async () => {
    const b = NAGA_MAX_BOUNDS;
    const all = await okText(await stopsGET(get(`/stops?bbox=${b.west},${b.south},${b.east},${b.north}`)), "public, s-maxage=300");
    expect(JSON.parse(all).stops).toHaveLength(128);
    saveFixture("stops-all.json", all);
    const stopId = async (layer: string, code: string) =>
      String((await appRows(sql`select stop_point_id from transit.v_published_stops
                                 where source_layer = ${layer} and source_code_raw = ${code}`))[0]!.stop_point_id);
    for (const [file, layer, code] of [
      ["stop-a1.json", "Loop Service A", "A1"], ["stop-b18.json", "Loop Service B", "B18"], ["stop-c-first.json", "Loop Service C", "A1"],
    ] as const) {
      const id = await stopId(layer, code);
      saveFixture(file, await okText(await stopGET(get(`/stops/${id}`), ctx({ id })), "public, s-maxage=300"));
    }
    const list = await okText(await routesGET(get("/routes")), "public, s-maxage=300");
    saveFixture("routes.json", list);
    for (const code of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D"]) {
      saveFixture(`route-${code.toLowerCase()}.json`, await okText(await routeGET(get(`/routes/${code}`), ctx({ code })), "public, s-maxage=300"));
    }
  });

  // ---------------------------------------------------------------- views (0004)

  it("paranaga_app reads the four reference views", async () => {
    const count = async (view: string) =>
      Number((await appRows(sql.raw(`select count(*)::int as n from transit.${view}`)))[0]!.n);
    expect(await count("v_published_barangays")).toBe(27);
    expect(await count("v_published_designated_stop_candidates")).toBe(32);
    expect(await count("v_published_destination_categories")).toBe(5);
    expect(await count("v_published_feeder_leads")).toBe(5);
  });

  it("paranaga_app cannot write through the views", async () => {
    for (const view of VIEWS) {
      const insert = await pgCode(appRows(sql.raw(`insert into transit.${view} (revision_id) values ('${revisionId}')`)));
      const update = await pgCode(appRows(sql.raw(`update transit.${view} set revision_id = revision_id`)));
      const del = await pgCode(appRows(sql.raw(`delete from transit.${view}`)));
      for (const code of [insert, update, del]) expect(["42501", "55000"]).toContain(code);
    }
  });

  // ---------------------------------------------------------------- search index

  it("search index: real data, immutable, within the size budget", async () => {
    const raw = await okText(
      await searchIndexGET(get(`/network/search-index/${revisionId}`), ctx({ revisionId })),
      "public, s-maxage=31536000, immutable",
    );
    const index = searchIndexSchema.parse(JSON.parse(raw));
    expect(index.revision).toMatchObject({ revisionId, label: "osm-places-2026-10-15", kind: "provisional" });
    expect(index.barangays).toHaveLength(27);
    expect(index.studyLabels).toHaveLength(32);
    expect(index.terminals).toHaveLength(6);
    expect(index.routes).toHaveLength(11);
    expect(index.osmPlaces).toHaveLength(233);
    expect(index.destinationCategories).toHaveLength(5);
    expect(index.feederLeads).toHaveLength(5);
    expect(index.legacyNames).toHaveLength(6);
    for (const x of [...index.terminals, ...index.barangays, ...index.studyLabels]) expect(x.location).toBeNull();

    // Every labelled published pin is in exactly one mapped-pin place; blank ones in none.
    const stops = await appRows(sql`select stop_point_id, label_raw from transit.v_published_stops`);
    const labelled = stops.filter((s) => String(s.label_raw ?? "").trim() !== "").map((s) => String(s.stop_point_id));
    const pinned = index.pinPlaces.flatMap((g) => g.pins.map((p) => p.stopId));
    expect(stops).toHaveLength(128);
    expect(pinned.sort()).toEqual(labelled.sort());
    expect(index.pinPlaces.find((g) => g.label === "Plaza Rizal")!.pins.map((p) => p.code).sort()).toEqual(["A1", "A1", "B1", "B1"]);
    expect(index.pinPlaces.some((g) => g.label === "Naga Cathedral")).toBe(true);
    expect(index.routes.find((r) => r.code === "R8-A")!.streets).toContain("Bicol Central Station");

    const bytes = Buffer.byteLength(raw);
    const gzip = gzipSync(raw).byteLength;
    console.log(JSON.stringify({
      event: "search_index_size", rawBytes: bytes, gzipBytes: gzip,
      counts: Object.fromEntries(Object.entries(index).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])),
      pins: pinned.length,
    }));
    expect(gzip).toBeLessThan(150 * 1024);
    saveFixture("search-index.json", raw);
  });

  it("search index: 404 for an unknown or superseded revision", async () => {
    const unknown = randomUUID();
    await notFound(await searchIndexGET(get(`/network/search-index/${unknown}`), ctx({ revisionId: unknown })));
    await notFound(await searchIndexGET(get(`/network/search-index/${transitRevisionId}`), ctx({ revisionId: transitRevisionId })));
  });

  // ---------------------------------------------------------------- terminals

  it("T01 lists R8-A and R8-B on the legal plan and on the trial, with sources and no coordinates", async () => {
    const raw = await okText(await terminalGET(get("/terminals/T01"), ctx({ code: "T01" })), REFERENCE_CACHE);
    const body = terminalDetailSchema.parse(JSON.parse(raw));
    expect(body.terminal).toMatchObject({ code: "T01", name: "Bicol Central Station", lat: null, lng: null, sourceCodes: ["S09"] });
    expect(body.routes.map((r) => [r.routeCode, r.basis])).toEqual([
      ["R8-A", "legal_plan"], ["R8-A", "trial"], ["R8-B", "legal_plan"], ["R8-B", "trial"],
    ]);
    expect(body.routes.find((r) => r.basis === "trial")!.sourceCodes).toContain("S03");
    expect(body.sources.map((s) => s.code)).toEqual(expect.arrayContaining(["S09", "S03"]));
    saveFixture("terminal-t01.json", raw);
  });

  it("T02 has the trial routes and the eastbound category; T06 lists no routes", async () => {
    const t02 = terminalDetailSchema.parse(await (await terminalGET(get("/terminals/T02"), ctx({ code: "T02" }))).json());
    expect(t02.routes.map((r) => [r.routeCode, r.basis])).toEqual([["R8-A", "trial"], ["R8-B", "trial"]]);
    expect(t02.destinationCategories.map((c) => c.category)).toEqual(["eastbound"]);
    const t06 = terminalDetailSchema.parse(await (await terminalGET(get("/terminals/T06"), ctx({ code: "T06" }))).json());
    expect(t06.routes).toEqual([]);
    expect(t06.terminal.lat).toBeNull();
  });

  it("terminals: 404 for an unknown code", async () => {
    await notFound(await terminalGET(get("/terminals/T99"), ctx({ code: "T99" })));
  });

  // ---------------------------------------------------------------- sources

  it("sources register includes S22 (barangays), S33 (study labels), S28 (legacy names) and the OSM snapshot, ordered by code", async () => {
    const raw = await okText(await sourcesGET(get("/sources")), REFERENCE_CACHE);
    const body = sourceListSchema.parse(JSON.parse(raw));
    const codes = body.sources.map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(["S22", "S33", "S34", "S26", "S13", "S28", "OSM-2026-10-15"]));
    // S28 is cited only by the index's legacy-name hints; its row is the imported one, verbatim.
    expect(body.sources.find((s) => s.code === "S28")).toMatchObject({
      title: "Legacy transport code/colors", publishedOrEnacted: "1993", evidenceType: "official_historical",
    });
    // Every source the search index cites is in the register; nothing else is added.
    const index = searchIndexSchema.parse(await (await searchIndexGET(get(`/network/search-index/${revisionId}`), ctx({ revisionId }))).json());
    const indexCodes = new Set([
      ...index.osmPlaces.map((p) => p.sourceCode), ...index.barangays.flatMap((b) => (b.sourceCode ? [b.sourceCode] : [])),
      ...index.studyLabels.flatMap((l) => l.sourceCodes), ...index.legacyNames.map((n) => n.sourceCode),
    ]);
    for (const code of indexCodes) expect(codes).toContain(code);
    const cited = (await appRows(sql`select code from transit.v_published_sources`)).map((r) => String(r.code));
    expect(codes.filter((c) => !cited.includes(c))).toEqual(["S28"]);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    console.log(JSON.stringify({ event: "sources_count", count: codes.length }));
    saveFixture("sources.json", raw);
  });

  // Last: it republishes, which resets published_at (captured fixtures keep main's value).
  it("the views hide rows of a non-published revision (pointer moved to the transit-only revision)", async () => {
    await publish(transitRevisionId);
    try {
      const rev = (await appRows(sql`select distinct revision_id from transit.v_published_barangays`)).map((r) => r.revision_id);
      expect(rev).toEqual([transitRevisionId]);
    } finally {
      await publish(revisionId);
    }
  });
});
