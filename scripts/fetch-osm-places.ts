// One-off, owner-run: fetches the OpenStreetMap places snapshot for Naga City.
//
//   pnpm exec tsx scripts/fetch-osm-places.ts            # writes data/source/osm/naga-places-<UTC date>.osm.json
//   pnpm exec tsx scripts/fetch-osm-places.ts --dry-run  # prints the query, sends nothing
//
// Sends ONE Overpass query for the area of OSM relation 3084673 (the same relation as
// data/geo/naga-city-boundary.json) with the D10 tag filters, `nwr` + `out center meta` (ways and
// relations get a centre; every element has version and timestamp). The raw response text is
// embedded verbatim after a header object:
//   {"header": {query, endpoint, fetchedAt, osmBaseTimestamp, boundaryRelation, licence,
//               attribution, responseSha256}, "response": <Overpass response, byte for byte>}
// The file is then committed and reviewed like any data file. The app and `pnpm db:import` only
// ever read committed files: no network call at import, build or runtime. A refresh is a new
// dated file plus a new import. Never run this in CI or at build time.
//
// Data © OpenStreetMap contributors, ODbL 1.0 (see data/source/osm/README.md).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NAGA_BOUNDARY } from "../src/domain/geo/naga";
import { OSM_ATTRIBUTION, OSM_BOUNDARY_RELATION, OSM_LICENCE, parseOsmPlaces } from "../src/domain/import/osm-places";
import { OSM_DIR } from "./lib/import-plan";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** Overpass area id of a relation = 3 600 000 000 + relation id. */
const AREA_ID = 3_600_000_000 + OSM_BOUNDARY_RELATION;

const OVERPASS_QUERY = `[out:json][timeout:180];
area(id:${AREA_ID})->.naga;
(
  nwr["shop"="mall"](area.naga);
  nwr["amenity"="marketplace"](area.naga);
  nwr["amenity"~"^(school|college|university)$"](area.naga);
  nwr["amenity"~"^(hospital|clinic)$"](area.naga);
  nwr["amenity"="place_of_worship"](area.naga);
  nwr["amenity"~"^(townhall|police|fire_station|post_office)$"](area.naga);
  nwr["office"="government"](area.naga);
  nwr["amenity"="bus_station"](area.naga);
  nwr["public_transport"="station"]["bus"="yes"](area.naga);
  nwr["leisure"="park"](area.naga);
  nwr["place"="square"](area.naga);
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

  const res = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
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
  let body: { osm3s?: { timestamp_osm_base?: unknown }; elements?: unknown; remark?: unknown };
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
  if (!Array.isArray(body.elements)) {
    console.error("Overpass response has no elements array; nothing written.");
    return 1;
  }

  const header = {
    query: OVERPASS_QUERY,
    endpoint: OVERPASS_ENDPOINT,
    fetchedAt,
    osmBaseTimestamp: typeof body.osm3s?.timestamp_osm_base === "string" ? body.osm3s.timestamp_osm_base : null,
    boundaryRelation: OSM_BOUNDARY_RELATION,
    licence: OSM_LICENCE,
    attribution: OSM_ATTRIBUTION,
    responseSha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
  // The response is embedded as the exact bytes Overpass sent (still valid JSON).
  const file = `{"header": ${JSON.stringify(header, null, 1)},\n"response": ${text.trim()}}\n`;

  const parsed = parseOsmPlaces(JSON.parse(file), NAGA_BOUNDARY);
  if (parsed.problems.length > 0) {
    console.error(`the snapshot would not import; nothing written:\n  ${parsed.problems.join("\n  ")}`);
    return 1;
  }
  mkdirSync(OSM_DIR, { recursive: true });
  writeFileSync(out, file, { flag: "wx" });
  console.log(`\nwrote ${out} (${Buffer.byteLength(file)} bytes, ${body.elements.length} elements, OSM base ${header.osmBaseTimestamp})`);
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
