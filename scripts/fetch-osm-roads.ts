// One-off, owner-run: fetches the OpenStreetMap road snapshot for Naga City.
//
//   pnpm exec tsx scripts/fetch-osm-roads.ts            # writes data/source/osm/naga-roads-<UTC date>.osm.json
//   pnpm exec tsx scripts/fetch-osm-roads.ts --dry-run  # prints the queries, sends nothing
//
// Sends TWO Overpass queries (each retried at most twice, only on HTTP 429/5xx):
//   1. Roads: `way[highway]` and the named feeder-anchor place nodes
//      (`place~village|hamlet|neighbourhood|locality|quarter`) in the area of OSM relation 3084673
//      (the city, data/geo/naga-city-boundary.json) plus a 300 m band around its boundary ways
//      (`around`), with `out meta; >; out skel qt;`. `out meta` (not `out body`) because the
//      snapshot keeps each way's version and timestamp; the contributor fields it also returns are
//      removed below.
//   2. Regional routes (D5): the RS01–RS07 relations of the reviewed modes seed with
//      `out meta geom`. Only { relationId, version, timestamp, name, ref, from, to, lengthKm } is
//      kept (header.regionalRelations); the geometry is discarded.
//
// Contributor data is removed BEFORE anything is written (stripRoadsResponse): ways keep type, id,
// version, timestamp, nodes and the road tags (highway, name, alt_name, old_name, official_name,
// ref, oneway, junction, access, foot, area, and for jeepney access motor_vehicle, vehicle, psv,
// bus, oneway:psv, service); nodes keep type, id, lat, lon, and place nodes their
// name and place. user, uid, changeset and every other tag are dropped. Both responses' sha256 are
// recorded as received, before the removal. The file is deterministic: the header pretty-printed,
// then one element per line.
//
// The app and the importer only read committed files: no network call at import, build or runtime.
// A refresh is a new dated file. Never run this in CI or at build time.
//
// Data © OpenStreetMap contributors, ODbL 1.0 (see data/source/osm/README.md).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRoadGraph } from "../src/domain/geo/road-graph";
import { OSM_ATTRIBUTION, OSM_BOUNDARY_RELATION, OSM_LICENCE } from "../src/domain/import/osm-places";
import {
  ANCHOR_PLACE_CLASSES,
  ROAD_BUFFER_M,
  parseOsmRoads,
  regionalRelationSummary,
  resolvePlaceName,
  stripRoadsResponse,
} from "../src/domain/import/osm-roads";
import { OSM_DIR } from "./lib/import-plan";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const MODES_SEED = "data/source/research/naga-modes-seed-2026-10-16.json";
const AREA_ID = 3_600_000_000 + OSM_BOUNDARY_RELATION;
const PLACE_RE = `^(${ANCHOR_PLACE_CLASSES.join("|")})$`;
const FEEDER_PLACE_NAMES = ["Langon", "Vistansa", "Salunguigui", "Deca Vistansa"];

const ROADS_QUERY = `[out:json][timeout:300];
rel(${OSM_BOUNDARY_RELATION})->.boundary;
way(r.boundary)->.edge;
area(id:${AREA_ID})->.naga;
(
  way["highway"](area.naga);
  way["highway"](around.edge:${ROAD_BUFFER_M});
  node["place"~"${PLACE_RE}"]["name"](area.naga);
  node["place"~"${PLACE_RE}"]["name"](around.edge:${ROAD_BUFFER_M});
);
out meta;
>;
out skel qt;`;

/** RS01–RS07 relation ids from the reviewed seed (imported records only). */
function regionalRelationIds(): number[] {
  const seed = JSON.parse(readFileSync(MODES_SEED, "utf8")) as {
    regionalServices: { code: string; osm_relation_ids: number[]; review: { decision: string } }[];
  };
  const ids = seed.regionalServices
    .filter((s) => /^RS0[1-7]$/.test(s.code) && s.review.decision === "import")
    .flatMap((s) => s.osm_relation_ids);
  return [...new Set(ids)].sort((a, b) => a - b);
}

const regionalQuery = (ids: readonly number[]) => `[out:json][timeout:180];
relation(id:${ids.join(",")});
out meta geom;`;

type OverpassBody = { version?: unknown; generator?: unknown; osm3s?: { timestamp_osm_base?: unknown }; elements?: unknown; remark?: unknown };

async function overpass(query: string, label: string): Promise<{ text: string; body: OverpassBody & { elements: Record<string, unknown>[] } }> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(360_000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "ParaNaga-roads-snapshot/1 (one-off owner-run fetch; Naga City commuter app)",
      },
      body: new URLSearchParams({ data: query }).toString(),
    });
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt <= 2) {
      console.error(`${label}: HTTP ${res.status}; retry ${attempt}/2 in 60 s`);
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }
    if (!res.ok) throw new Error(`${label}: Overpass answered HTTP ${res.status}\n${text.slice(0, 500)}`);
    let body: OverpassBody;
    try {
      body = JSON.parse(text) as OverpassBody;
    } catch {
      throw new Error(`${label}: Overpass did not return JSON\n${text.slice(0, 500)}`);
    }
    // Timeouts and memory errors come back as a "remark" with HTTP 200 and partial data.
    if (typeof body.remark === "string" && body.remark.trim() !== "") throw new Error(`${label}: Overpass remark (partial result?): ${body.remark}`);
    if (!Array.isArray(body.elements) || !body.elements.every((e) => e !== null && typeof e === "object")) {
      throw new Error(`${label}: no elements array of objects`);
    }
    return { text, body: body as OverpassBody & { elements: Record<string, unknown>[] } };
  }
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Header pretty-printed, one element per line: deterministic and diff-friendly. */
function serializeRoadsSnapshot(header: Record<string, unknown>, response: Record<string, unknown>): string {
  const { elements, ...meta } = response as { elements: unknown[] } & Record<string, unknown>;
  const metaJson = JSON.stringify(meta).slice(1, -1);
  return (
    `{"header":${JSON.stringify(header, null, 1)},\n"response":{${metaJson}${metaJson ? "," : ""}"elements":[\n` +
    `${elements.map((e) => JSON.stringify(e)).join(",\n")}\n]}}\n`
  );
}

async function main(): Promise<number> {
  if (process.env.CI) {
    console.error("fetch-osm-roads is owner-run only; refusing to run in CI.");
    return 2;
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.some((a) => a !== "--dry-run")) {
    console.error("usage: pnpm exec tsx scripts/fetch-osm-roads.ts [--dry-run]");
    return 2;
  }
  const relationIds = regionalRelationIds();
  const REGIONAL_QUERY = regionalQuery(relationIds);
  console.log(`endpoint ${OVERPASS_ENDPOINT}\nroads query:\n${ROADS_QUERY}\n\nregional query:\n${REGIONAL_QUERY}`);
  if (args.includes("--dry-run")) {
    console.log("\ndry run: nothing sent");
    return 0;
  }

  const fetchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const date = fetchedAt.slice(0, 10);
  const out = path.join(OSM_DIR, `naga-roads-${date}.osm.json`);
  if (existsSync(out)) {
    console.error(`${out} already exists; a refresh is a new dated file (fetch on another day or remove it first).`);
    return 1;
  }
  console.log(`\ndate (UTC): ${date}  ->  ${out}`);

  const roads = await overpass(ROADS_QUERY, "roads");
  const regional = await overpass(REGIONAL_QUERY, "regional relations");
  const relations = regional.body.elements.filter((e) => e.type === "relation");
  const regionalRelations = relations.map(regionalRelationSummary).sort((a, b) => a.relationId - b.relationId);
  const missing = relationIds.filter((id) => !regionalRelations.some((r) => r.relationId === id));
  if (missing.length > 0) console.warn(`regional relations not returned (deleted in OSM?): ${missing.join(", ")}`);

  const { response, removedFields } = stripRoadsResponse(roads.body);
  const header = {
    query: ROADS_QUERY,
    regionalQuery: REGIONAL_QUERY,
    endpoint: OVERPASS_ENDPOINT,
    fetchedAt,
    osmBaseTimestamp: typeof roads.body.osm3s?.timestamp_osm_base === "string" ? roads.body.osm3s.timestamp_osm_base : null,
    boundaryRelation: OSM_BOUNDARY_RELATION,
    bufferM: ROAD_BUFFER_M,
    licence: OSM_LICENCE,
    attribution: OSM_ATTRIBUTION,
    // Of the bodies as received, before contributor data was removed (and geometry discarded).
    responseSha256: sha256(roads.text),
    regionalResponseSha256: sha256(regional.text),
    removedFields,
    regionalRelations,
  };
  const file = serializeRoadsSnapshot(header, response);

  const parsed = parseOsmRoads(JSON.parse(file));
  if (parsed.problems.length > 0) {
    console.error(`the snapshot would not parse; nothing written:\n  ${parsed.problems.slice(0, 20).join("\n  ")}`);
    return 1;
  }
  mkdirSync(OSM_DIR, { recursive: true });
  writeFileSync(out, file, { flag: "wx" });
  const fileSha = createHash("sha256").update(file, "utf8").digest("hex");
  console.log(`\nwrote ${out} (${Buffer.byteLength(file)} bytes, sha256 ${fileSha}, OSM base ${header.osmBaseTimestamp})`);
  console.log(`elements ${roads.body.elements.length}: ways ${parsed.ways.length}, nodes ${parsed.nodes.size}, places ${parsed.places.length}`);
  for (const profile of ["vehicle", "walk"] as const) {
    const g = buildRoadGraph(parsed, { profile });
    console.log(`${profile} graph: ${g.nodes.length} nodes, ${g.edges.length} directed edges`);
  }
  for (const name of FEEDER_PLACE_NAMES) console.log(`place_name ${name}: ${JSON.stringify(resolvePlaceName(parsed.places, name))}`);
  for (const r of regionalRelations) console.log(`relation ${r.relationId} ${r.ref ?? ""} ${r.name ?? ""}: ${r.lengthKm} km`);
  console.log("next: review the file, update data/source/osm/README.md, commit");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
