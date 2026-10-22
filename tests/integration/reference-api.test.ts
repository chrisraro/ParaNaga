// Reference read model (migrations 0004 and 0008, search index, terminals, sources) against a
// throwaway Neon branch with the Naga transit import, the committed OpenStreetMap snapshot AND the
// reviewed modes seed applied (the full `pnpm db:import --commit`); the modes revision is published:
//   bash scripts/with-neon-branch.sh pnpm test:integration
// The handlers run as in production (withRequestContext → pool on PARANAGA_DATABASE_URL as
// paranaga_app). Restores the previously published revision afterwards.
// CAPTURE_E2E_FIXTURES=1 also writes the real responses to tests/e2e/fixtures/network/: the new
// reference fixtures AND the older stop/route fixtures, so every e2e fixture names one revision.
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorSchema, searchIndexSchema, searchPlacesSchema, sourceListSchema, terminalDetailSchema } from "@/domain/api/schemas";
import { runInRequestContext } from "@/server/db/run-in-context";
import { getPool } from "@/server/db/client";
import { GET as searchIndexGET } from "@/app/api/v1/network/search-index/[revisionId]/route";
import { GET as searchPlacesGET } from "@/app/api/v1/network/search-places/[revisionId]/route";
import { GET as snapshotGET } from "@/app/api/v1/network/snapshot/[revisionId]/route";
import { GET as linesGET } from "@/app/api/v1/network/lines/[revisionId]/route";
import { GET as terminalGET } from "@/app/api/v1/terminals/[code]/route";
import { GET as sourcesGET } from "@/app/api/v1/sources/route";
import { GET as stopsGET } from "@/app/api/v1/stops/route";
import { GET as stopGET } from "@/app/api/v1/stops/[id]/route";
import { GET as routesGET } from "@/app/api/v1/routes/route";
import { GET as routeGET } from "@/app/api/v1/routes/[code]/route";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";
import {
  buildImportPlan,
  readDataFiles,
  readNewestModesSeed,
  readNewestOsmSnapshot,
  readPinnedRoadsSnapshot,
} from "../../scripts/lib/import-plan";
import { commitImport } from "../../scripts/lib/import-writer";
import { writeFixture } from "./fixture-capture";

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

/** Keeps the committed publishedAt (the branch republish resets it): see fixture-capture.ts. */
function saveFixture(name: string, raw: string) {
  if (capture) writeFixture(name, raw);
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

    // Transit files, the committed OSM snapshot, the reviewed modes seed and the pinned road
    // snapshot (as `pnpm db:import --commit` does). On a branch where they are present already
    // ("unchanged"), publish the modes-lines revision (which carries the transit, OSM and modes
    // data) if another test file published something else.
    previous = await pointer();
    const plan = buildImportPlan(readDataFiles("Data_Sets"), readNewestOsmSnapshot(), readNewestModesSeed(), readPinnedRoadsSnapshot());
    expect(plan.problems).toEqual([]);
    await commitImport(ownerUrl!, plan);
    const ids = await owner.query<{ id: string; label: string }>(
      "select id, label from transit.revision where label = any($1)", [[plan.lines!.revisionLabel, plan.revisionLabel]]);
    revisionId = ids.rows.find((r) => r.label === plan.lines!.revisionLabel)!.id;
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
    // The immutable snapshot the app reads its pins and offline plans from (decision D2, Task 12).
    const snapshot = await okText(
      await snapshotGET(get(`/network/snapshot/${revisionId}`), ctx({ revisionId })), "public, s-maxage=31536000, immutable");
    expect(JSON.parse(snapshot).stops).toHaveLength(128);
    saveFixture("snapshot.json", snapshot);
    // The approximate paths (Task 7), a separate immutable resource (D18).
    const lines = await okText(await linesGET(get(`/network/lines/${revisionId}`), ctx({ revisionId })), "public, s-maxage=31536000, immutable");
    saveFixture("lines.json", lines);
    const list = await okText(await routesGET(get("/routes")), "public, s-maxage=300");
    saveFixture("routes.json", list);
    for (const code of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D", "TRI-VISTODA"]) {
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
    expect(index.revision).toMatchObject({ revisionId, label: "anywhere-alight-2026-10-16", kind: "provisional" });
    expect(index.barangays).toHaveLength(27);
    expect(index.studyLabels).toHaveLength(32);
    expect(index.terminals).toHaveLength(16);
    expect(index.routes).toHaveLength(13);
    // Derived from the revision, not a magic number. Since Task 14 the first-paint index carries only
    // the core (D10) categories; every other place member is in the lazy search-places chunk, so
    // together the two hold every place member exactly once.
    const placeMembers = await owner.query<{ n: number }>(
      "select count(*)::int as n from transit.revision_member where revision_id = $1 and entity_kind = 'place'", [revisionId]);
    expect(placeMembers.rows[0]!.n).toBeGreaterThan(0);
    const lazy = searchPlacesSchema.parse(
      await (await searchPlacesGET(get(`/network/search-places/${revisionId}`), ctx({ revisionId }))).json());
    expect(index.osmPlaces.length).toBeGreaterThan(0);
    expect(lazy.places.length).toBeGreaterThan(0);
    expect(index.osmPlaces.length + lazy.places.length).toBe(placeMembers.rows[0]!.n);
    expect(new Set([...index.osmPlaces, ...lazy.places].map((p) => p.key)).size).toBe(placeMembers.rows[0]!.n);
    expect(index.destinationCategories).toHaveLength(5);
    expect(index.feederLeads).toHaveLength(5);
    expect(index.legacyNames).toHaveLength(6);
    for (const x of [...index.barangays, ...index.studyLabels]) expect(x.location).toBeNull();
    // Terminals carry only their OpenStreetMap coordinate; T02 (street conflict) and the two
    // tricycle waiting areas have none.
    const terminal = (code: string) => index.terminals.find((t) => t.code === code)!;
    expect(terminal("T01").location).toEqual({ lat: 13.6192359, lng: 123.1897426, source: "osm" });
    for (const code of ["T02", "T05", "T15", "T16"]) expect(terminal(code).location, code).toBeNull();
    expect(terminal("T14")).toMatchObject({ name: "Balatas Tricycle Terminal", kind: "terminal", modes: ["tricycle"] });
    // The feeders are searchable, with their mode, branch street text and fleet sentence.
    const vistoda = index.routes.find((r) => r.code === "TRI-VISTODA")!;
    expect(vistoda).toMatchObject({ mode: "tricycle", fleetLabel: "Tricycle (special trimobile) · authorized 2025 · operation not verified" });
    expect(vistoda.streets).toEqual(expect.arrayContaining(["Langon – Vistansa Subd – Ateneo de Naga"]));
    expect(index.routes.find((r) => r.code === "R4")!.fleetLabel).toBe("Traditional and modern jeepneys");
    expect(index.routes.find((r) => r.code === "R1")!.fleetLabel).toBe("Traditional jeepneys");
    expect(raw).not.toMatch(/e[-_ ]?jeep/i);

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
    if (capture) console.log(JSON.stringify({
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

  it("T01: the BCS OpenStreetMap coordinate with provenance, R8-A/R8-B, and the regional services with fare estimates", async () => {
    const raw = await okText(await terminalGET(get("/terminals/T01"), ctx({ code: "T01" })), REFERENCE_CACHE);
    const body = terminalDetailSchema.parse(JSON.parse(raw));
    expect(body.terminal).toMatchObject({
      code: "T01", name: "Bicol Central Station", kind: "terminal", lat: 13.6192359, lng: 123.1897426,
      modes: ["bus", "uv_express"], modeSources: { bus: ["S09", "N02"], uv_express: ["N01"] },
      coordinate: {
        source: "osm_way_centroid", osmType: "way", osmId: 293702439, osmVersion: 6, licence: "ODbL 1.0",
        attribution: "Map data © OpenStreetMap contributors", attributionUrl: "https://www.openstreetmap.org/copyright",
      },
    });
    expect(body.routes.map((r) => [r.routeCode, r.basis])).toEqual([
      ["R8-A", "legal_plan"], ["R8-A", "trial"], ["R8-B", "legal_plan"], ["R8-B", "trial"],
    ]);
    expect(body.routes.find((r) => r.basis === "trial")!.sourceCodes).toContain("S03");
    expect(body.regionalServices.map((s) => s.code)).toEqual(["RS02", "RS03", "RS05", "RS06", "RS07"]);
    for (const s of body.regionalServices) {
      expect(s.sourceCodes.length, s.code).toBeGreaterThan(0);
      expect(s.fareEstimate.isEstimate).toBe(true);
      expect(s.fareEstimate.text, s.code).toMatch(/operator prices may differ$/);
      // Task 7 (D5): the OSM relation length (shorter direction), labelled as an approximate path length.
      expect(s.distanceKm, s.code).toBeGreaterThan(0);
      expect(s.distanceBasis, s.code).toMatch(/OpenStreetMap route relation.*not a measured trip distance/);
      expect(s.sourceCodes, s.code).toContain("OSMR-2026-10-16");
    }
    const uv = body.regionalServices.find((s) => s.code === "RS05")!;
    expect(uv).toMatchObject({ mode: "uv_express", fareRuleCodes: ["F06", "F07"], distanceKm: 94.278 });
    expect(uv.fareEstimate).toMatchObject({ lowCentavos: 24500, highCentavos: 28300 });
    const codes = body.sources.map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(["S09", "S03", "N01", "N02", "N17"]));
    for (const s of body.regionalServices) for (const c of s.sourceCodes) expect(codes, c).toContain(c);
    saveFixture("terminal-t01.json", raw);
  });

  it("T14 (Balatas tricycle terminal) has its OSM node; T15/T16 have no coordinate", async () => {
    const raw = await okText(await terminalGET(get("/terminals/T14"), ctx({ code: "T14" })), REFERENCE_CACHE);
    const body = terminalDetailSchema.parse(JSON.parse(raw));
    expect(body.terminal).toMatchObject({ code: "T14", kind: "terminal", modes: ["tricycle"], coordinate: { source: "osm_node", osmType: "node" } });
    expect(body.regionalServices).toEqual([]);
    saveFixture("terminal-t14.json", raw);
    for (const code of ["T15", "T16"]) {
      const t = terminalDetailSchema.parse(await (await terminalGET(get(`/terminals/${code}`), ctx({ code }))).json());
      expect(t.terminal, code).toMatchObject({ kind: "waiting_area", lat: null, lng: null, coordinate: null });
    }
  });

  it("T02 has the trial routes and the eastbound category; T06 lists no routes", async () => {
    const t02 = terminalDetailSchema.parse(await (await terminalGET(get("/terminals/T02"), ctx({ code: "T02" }))).json());
    expect(t02.routes.map((r) => [r.routeCode, r.basis])).toEqual([["R8-A", "trial"], ["R8-B", "trial"]]);
    expect(t02.destinationCategories.map((c) => c.category)).toEqual(["eastbound"]);
    const t06Raw = await okText(await terminalGET(get("/terminals/T06"), ctx({ code: "T06" })), REFERENCE_CACHE);
    const t06 = terminalDetailSchema.parse(JSON.parse(t06Raw));
    expect(t06.routes).toEqual([]);
    expect(t06.terminal).toMatchObject({ kind: "station", coordinate: { source: "osm_way_centroid" } });
    saveFixture("terminal-t06.json", t06Raw);
  });

  it("terminals: 404 for an unknown code", async () => {
    await notFound(await terminalGET(get("/terminals/T99"), ctx({ code: "T99" })));
  });

  // ---------------------------------------------------------------- sources

  it("sources register includes S22 (barangays), S33 (study labels), S28 (legacy names), S39/S40 (stop snapshot) and the OSM snapshot, ordered by code", async () => {
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
    // Added from code: S28 (legacy names) and, because stops are published, the My Maps snapshot
    // behind every stop pin (S39 viewer, S40 KML export). S41/S42 are cited by nothing published.
    expect(codes.filter((c) => !cited.includes(c))).toEqual(["S28", "S39", "S40"]);
    expect(codes).not.toContain("S41");
    expect(codes).not.toContain("S42");
    expect(body.sources.find((s) => s.code === "S39")).toMatchObject({
      title: "Naga City Designated Stops – public Google My Maps",
      url: "https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4",
      checkedOn: "2026-10-15",
    });
    expect(body.sources.find((s) => s.code === "S40")).toMatchObject({ title: "Public Google My Maps KML export", checkedOn: "2026-10-15" });
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    if (capture) console.log(JSON.stringify({ event: "sources_count", count: codes.length }));
    saveFixture("sources.json", raw);
  });

  // Draft-only and synthetic rows never reach the new views. Everything is written in one owner
  // transaction that is rolled back, and read in that same transaction (the owner is not a member
  // of paranaga_app, and the uncommitted rows are invisible to other connections): the base tables
  // show all three rows, the views only the control. The hiding is the views' own filter
  // (published pointer → revision_member, not is_synthetic); paranaga_app's grants on these views
  // are covered by the "cannot write" test above and db:check-rls. The published
  // revision's membership is frozen by a trigger, which the owner disables inside the transaction
  // only (rolled back with it) to add the synthetic and control members.
  it("the views hide draft-only and synthetic barangays and study labels", async () => {
    const tag = `zz-it-${run}`;
    await owner.query("begin");
    try {
      const draft = (await owner.query<{ id: string }>(
        "insert into transit.revision (label, kind, created_by) values ($1, 'provisional', 'reference-api test') returning id", [`${tag}-draft`],
      )).rows[0]!.id;
      const barangay = async (name: string, synthetic: boolean) =>
        (await owner.query<{ id: string }>("insert into transit.barangay (name, is_synthetic) values ($1, $2) returning id", [name, synthetic])).rows[0]!.id;
      const label = async (code: string, synthetic: boolean) =>
        (await owner.query<{ id: string }>(
          "insert into transit.designated_stop_candidate (code, label_raw, is_synthetic) values ($1, $1, $2) returning id", [code, synthetic],
        )).rows[0]!.id;
      const member = (rev: string, kind: string, id: string) =>
        owner.query("insert into transit.revision_member (revision_id, entity_kind, entity_id, version_id) values ($1, $2, $3, $3)", [rev, kind, id]);

      await member(draft, "barangay", await barangay(`${tag} draft`, false));
      await member(draft, "designated_stop_candidate", await label(`${tag}-DRAFT`, false));
      // NOTE: ALTER TABLE takes an ACCESS EXCLUSIVE lock on transit.revision_member until the
      // rollback. Safe only because integration files never run in parallel (fileParallelism:
      // false in vitest.config.ts); enabling parallelism would block or deadlock other files.
      await owner.query("alter table transit.revision_member disable trigger revision_member_guard");
      await member(revisionId, "barangay", await barangay(`${tag} synthetic`, true));
      await member(revisionId, "designated_stop_candidate", await label(`${tag}-SYNTH`, true));
      // Control: a real member of the published revision does show, so the test can fail.
      await member(revisionId, "barangay", await barangay(`${tag} control`, false));
      await member(revisionId, "designated_stop_candidate", await label(`${tag}-CONTROL`, false));

      const names = async (query: string) => (await owner.query<{ v: string }>(query, [`${tag}%`])).rows.map((r) => r.v).sort();
      expect(await names("select name as v from transit.barangay where name like $1")).toEqual([`${tag} control`, `${tag} draft`, `${tag} synthetic`]);
      expect(await names("select name as v from transit.v_published_barangays where name like $1")).toEqual([`${tag} control`]);
      expect(await names("select code as v from transit.v_published_designated_stop_candidates where code like $1")).toEqual([`${tag}-CONTROL`]);
    } finally {
      await owner.query("rollback");
    }
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
