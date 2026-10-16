// One-off, owner-run: fetches the OpenStreetMap places snapshot for Naga City.
//
//   pnpm exec tsx scripts/fetch-osm-places.ts            # writes data/source/osm/naga-places-<UTC date>.osm.json
//   pnpm exec tsx scripts/fetch-osm-places.ts --dry-run  # prints the query, sends nothing
//
// Sends ONE Overpass query for the area of OSM relation 3084673 (the same relation as
// data/geo/naga-city-boundary.json) with the Task 14 tag filters (every named place), `nwr` + `out center meta` (ways and
// relations get a centre; every element has version and timestamp).
//
// Contributor data is removed BEFORE anything is written: each element keeps only type, id, lat,
// lon, center, version, timestamp and tags; user, uid, changeset (personal data, not needed for
// ODbL attribution) and the unused nodes, members, bounds and geometry are dropped, and the tags
// are cut to the ones the importer reads (name, alias tags, category keys; "otherTags")
// (stripOverpassResponse). The file is a deterministic serialization:
//   {"header": {query, endpoint, fetchedAt, osmBaseTimestamp, boundaryRelation, licence,
//               attribution, responseSha256, removedFields},
//    "response": {version, generator, osm3s, elements: [...]}}
// responseSha256 is the sha256 of the Overpass response body as received, before the removal (it
// records what was fetched; it does not match the stored, stripped response).
// The file is then committed and reviewed like any data file. The app and `pnpm db:import` only
// ever read committed files: no network call at import, build or runtime. A refresh is a new
// dated file plus a new import. Never run this in CI or at build time.
//
// Data © OpenStreetMap contributors, ODbL 1.0 (see data/source/osm/README.md).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NAGA_BOUNDARY } from "../src/domain/geo/naga";
import {
  OSM_ATTRIBUTION,
  OSM_BOUNDARY_RELATION,
  OSM_LICENCE,
  parseOsmPlaces,
  stripOverpassResponse,
} from "../src/domain/import/osm-places";
import { OSM_DIR } from "./lib/import-plan";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** Overpass area id of a relation = 3 600 000 000 + relation id. */
const AREA_ID = 3_600_000_000 + OSM_BOUNDARY_RELATION;

// Task 14: every NAMED element with a place key (shop, amenity, tourism, leisure, office, craft,
// healthcare, historic, building), plus the two D10 rules that are not a plain key (bus stations
// tagged public_transport, squares). Unnamed elements are never downloaded (the importer drops
// them anyway). `building` is the largest set; the snapshot keeps only the tags the importer reads.
const OVERPASS_QUERY = `[out:json][timeout:180];
area(id:${AREA_ID})->.naga;
(
  nwr["name"]["shop"](area.naga);
  nwr["name"]["amenity"](area.naga);
  nwr["name"]["tourism"](area.naga);
  nwr["name"]["leisure"](area.naga);
  nwr["name"]["office"](area.naga);
  nwr["name"]["craft"](area.naga);
  nwr["name"]["healthcare"](area.naga);
  nwr["name"]["historic"](area.naga);
  nwr["name"]["building"](area.naga);
  nwr["name"]["public_transport"="station"]["bus"="yes"](area.naga);
  nwr["name"]["place"="square"](area.naga);
);
out center meta;`;

async function main(): Promise<number> {
  if (process.env.CI) {
    console.error("fetch-osm-places is owner-run only; refusing to run in CI.");
    return 2;
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.some((a) => a !== "--dry-run")) {
    console.error("usage: pnpm exec tsx scripts/fetch-osm-places.ts [--dry-run]");
    return 2;
  }
  console.log(`endpoint ${OVERPASS_ENDPOINT}\nquery:\n${OVERPASS_QUERY}`);
  if (args.includes("--dry-run")) {
    console.log("\ndry run: nothing sent");
    return 0;
  }

  const fetchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const date = fetchedAt.slice(0, 10);
  const out = path.join(OSM_DIR, `naga-places-${date}.osm.json`);
  if (existsSync(out)) {
    console.error(`${out} already exists; a refresh is a new dated file (fetch on another day or remove it first).`);
    return 1;
  }

  console.log(`\ndate (UTC): ${date}  ->  ${out}`);
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    // Overpass may hold a connection well past its own [timeout:180].
    signal: AbortSignal.timeout(240_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "ParaNaga-places-snapshot/1 (one-off owner-run fetch; Naga City commuter app)",
    },
    body: new URLSearchParams({ data: OVERPASS_QUERY }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Overpass answered HTTP ${res.status}; nothing written.\n${text.slice(0, 500)}`);
    return 1;
  }
  let body: { version?: unknown; generator?: unknown; osm3s?: { timestamp_osm_base?: unknown }; elements?: unknown; remark?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    console.error(`Overpass did not return JSON; nothing written.\n${text.slice(0, 500)}`);
    return 1;
  }
  // Overpass reports timeouts and memory errors as a "remark" with HTTP 200 and partial data.
  if (typeof body.remark === "string" && body.remark.trim() !== "") {
    console.error(`Overpass remark (partial result?): ${body.remark}\nnothing written.`);
    return 1;
  }
  if (!Array.isArray(body.elements) || !body.elements.every((e) => e !== null && typeof e === "object")) {
    console.error("Overpass response has no elements array of objects; nothing written.");
    return 1;
  }
  const elementCount = body.elements.length;
  const { response, removedFields } = stripOverpassResponse({ ...body, elements: body.elements as Record<string, unknown>[] });

  const header = {
    query: OVERPASS_QUERY,
    endpoint: OVERPASS_ENDPOINT,
    fetchedAt,
    osmBaseTimestamp: typeof body.osm3s?.timestamp_osm_base === "string" ? body.osm3s.timestamp_osm_base : null,
    boundaryRelation: OSM_BOUNDARY_RELATION,
    licence: OSM_LICENCE,
    attribution: OSM_ATTRIBUTION,
    // Of the body as received, before contributor data was removed.
    responseSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    removedFields,
  };
  const file = `${JSON.stringify({ header, response }, null, 1)}\n`;

  const parsed = parseOsmPlaces(JSON.parse(file), NAGA_BOUNDARY);
  if (parsed.problems.length > 0) {
    console.error(`the snapshot would not import; nothing written:\n  ${parsed.problems.join("\n  ")}`);
    return 1;
  }
  mkdirSync(OSM_DIR, { recursive: true });
  writeFileSync(out, file, { flag: "wx" });
  console.log(`\nwrote ${out} (${Buffer.byteLength(file)} bytes, ${elementCount} elements, OSM base ${header.osmBaseTimestamp})`);
  console.log(`places kept ${parsed.places.length}: ${JSON.stringify(parsed.counts)}`);
  console.log(`dropped: ${JSON.stringify(parsed.dropped)}`);
  console.log("next: review the file, update data/source/osm/README.md, commit, then pnpm db:import --dry-run");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
