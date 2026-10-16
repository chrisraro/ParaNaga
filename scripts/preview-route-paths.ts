// Dev-only preview of the approximate route paths (Task 5). Never part of the app or the import.
//
//   pnpm data:preview-paths
//
// Traces every variant (R1–R8 street lists, Loops A/B with their provisional pins, the 2025 trial
// circuits, the tricycle feeders) on the pinned OSM road snapshot and writes
// tmp/route-paths-preview.geojson (git-ignored; open it in a local GIS tool, never upload it) and a
// table per variant: pass/fail, coverage (listed streets matched), off-list share, length, gaps.
// Reads committed files only; no network.
//
// Paths are "Approximate path, not a verified route shape". Map data © OpenStreetMap contributors (ODbL 1.0).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NAGA_BOUNDARY } from "../src/domain/geo/naga";
import { buildRoadGraph } from "../src/domain/geo/road-graph";
import type { StreetAlias } from "../src/domain/geo/street-names";
import type { LatLng } from "../src/domain/geo/types";
import { buildSnapshot, withIdentities } from "../src/domain/import/mapped-stops";
import { importableRecords, parseModesSeed } from "../src/domain/import/modes-seed";
import { parseOsmPlaces } from "../src/domain/import/osm-places";
import { resolvePlaceName, verifyStreetAliases } from "../src/domain/import/osm-roads";
import { provisionalLoopSequence } from "../src/domain/import/provisional-loops";
import { resolveRouteLandmarks, ROUTE_LANDMARKS, ROUTE_TERMINI } from "../src/domain/import/route-landmarks";
import { normalizeSeed } from "../src/domain/import/seed";
import { traceVariant, type TraceAnchor, type TraceInput, type TraceResult } from "../src/domain/import/trace-route";
import { readNewestOsmSnapshot } from "./lib/import-plan";
import { readNewestModesSeed } from "./lib/modes-plan";
import { readPinnedRoadsSnapshot } from "./lib/roads-snapshot";

const OUT = "tmp/route-paths-preview.geojson";
/** Feeder place names with a reviewed waiting-area terminal (C: sourced terminal coordinate fallback). */
const PLACE_TERMINAL_FALLBACK: Readonly<Record<string, string>> = { "Deca Vistansa": "T15" };

type Job = { id: string; input: TraceInput; note: string };

function main(): number {
  const snap = readPinnedRoadsSnapshot();
  if (!snap) {
    console.error("no road snapshot in data/source/osm");
    return 1;
  }
  if (snap.problems.length > 0 || !snap.roads) {
    console.error(`road snapshot refused:\n  ${snap.problems.join("\n  ")}`);
    return 1;
  }
  const roads = snap.roads;
  const graph = buildRoadGraph(roads, { profile: "vehicle" });

  const modesFile = readNewestModesSeed();
  if (!modesFile) throw new Error("no modes seed");
  const modes = importableRecords(parseModesSeed(JSON.parse(modesFile.bytes.toString("utf8"))));
  const aliasProblems = verifyStreetAliases(modes.streetAliases, roads);
  if (aliasProblems.length > 0) {
    console.error(`street aliases refused:\n  ${aliasProblems.join("\n  ")}`);
    return 1;
  }
  const aliases: StreetAlias[] = modes.streetAliases.map((a) => ({ legalName: a.legal_name, osmName: a.osm_name }));
  const terminals = modes.terminals.map((t) => ({ code: t.code, lat: t.coordinate?.lat ?? null, lng: t.coordinate?.lng ?? null }));

  const seed = normalizeSeed(JSON.parse(readFileSync("Data_Sets/naga_transport_seed.json", "utf8")));
  const kml = readFileSync("Data_Sets/naga_mapped_stops_source.kml", "utf8");
  const stops = buildSnapshot(kml, readFileSync("Data_Sets/naga_mapped_stops.geojson", "utf8"), readFileSync("Data_Sets/naga_mapped_stops.csv", "utf8"));
  const records = withIdentities(stops.records, stops.metadata.mapId);
  const placesFile = readNewestOsmSnapshot();
  const places = placesFile ? parseOsmPlaces(JSON.parse(placesFile.bytes.toString("utf8")), NAGA_BOUNDARY).places : [];

  const resolved = resolveRouteLandmarks(ROUTE_LANDMARKS, { terminals, graph, boundary: NAGA_BOUNDARY, aliases, places: roads.places });
  const landmarks = Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.point]));

  const jobs: Job[] = [];
  const terminusOf = (code: string): LatLng | null => {
    const rule = ROUTE_TERMINI[code];
    if (!rule) return null;
    const r = resolvePlaceName(roads.places, rule.place);
    return r.status === "resolved" ? { lat: r.place.lat, lng: r.place.lng } : null;
  };
  for (const r of seed.routes) {
    const s = r.legalStreets;
    const terminus = terminusOf(r.publicCode);
    if (s.inbound) jobs.push({ id: `${r.publicCode} inbound`, input: { streets: s.inbound, landmarks, termini: { start: terminus }, isCircular: false }, note: "street list" });
    if (s.outbound) jobs.push({ id: `${r.publicCode} outbound`, input: { streets: s.outbound, landmarks, termini: { end: terminus }, isCircular: false }, note: "street list" });
    if (s.circuit) {
      const seq = r.publicCode === "R8-A" || r.publicCode === "R8-B" ? provisionalLoopSequence(records, r.publicCode) : null;
      if (seq) {
        const byId = new Map(records.map((x) => [x.sourceIdentity, x]));
        const pins: LatLng[] = seq.map((q) => ({ lat: byId.get(q.recordIdentity)!.lat, lng: byId.get(q.recordIdentity)!.lng }));
        jobs.push({ id: `${r.publicCode} circuit (pins)`, input: { streets: s.circuit, landmarks, pins, isCircular: true }, note: `${pins.length} provisional pins` });
      }
      jobs.push({ id: `${r.publicCode} circuit`, input: { streets: s.circuit, landmarks, isCircular: true }, note: "street list" });
    }
  }
  for (const t of seed.trialChanges) {
    jobs.push({ id: `${t.routeCode} trial ${t.adopted ?? ""}`, input: { streets: t.simplifiedCircuit, landmarks, isCircular: true }, note: "trial circuit" });
  }
  for (const route of modes.routes) {
    route.variants.forEach((v, i) => {
      const anchors: TraceAnchor[] = v.anchors.map((a): TraceAnchor => {
        if (a.kind === "junction") return { kind: "junction", streets: a.streets };
        if (a.kind === "osm_places_snapshot") {
          const p = places.find((x) => x.key === a.key);
          return p ? { kind: "point", label: a.key, at: { lat: p.lat, lng: p.lng } } : { kind: "unresolved", label: a.key };
        }
        if (a.kind === "osm_place") return { kind: "unresolved", label: `osm:${a.osmType}/${a.osmId}` };
        const r = resolvePlaceName(roads.places, a.name);
        if (r.status === "resolved") return { kind: "point", label: a.name, at: { lat: r.place.lat, lng: r.place.lng } };
        const t = terminals.find((x) => x.code === PLACE_TERMINAL_FALLBACK[a.name]);
        if (t && t.lat !== null && t.lng !== null) return { kind: "point", label: `${a.name} (${t.code})`, at: { lat: t.lat, lng: t.lng } };
        return { kind: "unresolved", label: a.name };
      });
      jobs.push({ id: `${route.code} variant ${i + 1}`, input: { streets: [], anchors, isCircular: false }, note: v.name });
    });
  }

  const features: unknown[] = [];
  const rows: string[] = [
    "| Variant | Result | Coverage | Off-list | Length km | Gaps | Max snap m | Terminus m | Unmatched / unresolved / disjoint |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const job of jobs) {
    const r: TraceResult = traceVariant(job.input, graph, aliases);
    const q = r.quality;
    const parts = r.ok ? [r.line] : r.parts;
    const result = r.status === "fail" ? `fail (${r.reason})` : r.status === "flagged" ? `flagged (${r.flag})` : "pass";
    features.push({
      type: "Feature",
      properties: { variant: job.id, status: r.status, reason: r.status === "fail" ? r.reason : r.status === "flagged" ? r.flag : null,
        offListSegments: r.ok ? r.offListSegments : [], note: job.note, label: "Approximate path, not a verified route shape", ...q },
      geometry: { type: "MultiLineString", coordinates: parts.map((p) => p.map((c) => [Number(c.lng.toFixed(6)), Number(c.lat.toFixed(6))])) },
    });
    const coverage = q.listedStreets > 0 ? `${q.matchedStreets}/${q.listedStreets} (${Math.round((100 * q.matchedStreets) / q.listedStreets)} %)` : "n/a";
    const off = q.offListShare === null ? "n/a" : `${(100 * q.offListShare).toFixed(1)} %`;
    const notes = [...q.unmatchedStreets.map((x) => `unmatched: ${x}`), ...q.landmarksUnresolved.map((x) => `landmark: ${x}`), ...q.anchorsUnresolved.map((x) => `anchor: ${x}`),
      ...q.disjointPairs.map((x) => `no junction: ${x}`), ...(r.status === "flagged"
        ? r.offListSegments.filter((x) => x.lengthM >= 50).map((x) => `${x.reason} ${x.lengthM} m @${Math.round(x.fromM)} m: ${x.streets.map((y) => `${y.name} ${y.m}`).join(", ")}`)
        : []), ...q.unsnappedPins.map((x) => `pin ${x + 1} unsnapped`)].join("; ");
    rows.push(`| ${job.id} | ${result} | ${coverage} | ${off} | ${(q.lengthM / 1000).toFixed(2)} | ${q.gaps} | ${q.maxSnapM ?? "–"} | ${q.terminusSnapM ?? "–"} | ${notes || "–"} |`);
  }

  mkdirSync("tmp", { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify({ type: "FeatureCollection", attribution: "Map data © OpenStreetMap contributors (ODbL 1.0)", snapshot: snap.fileName, features })}\n`,
  );
  console.log(`snapshot ${snap.fileName} (sha256 ${snap.sha256})`);
  console.log(`aliases: ${aliases.length}; landmarks:`);
  for (const [k, v] of Object.entries(resolved)) console.log(`  ${k}: ${v.point ? `${v.point.lat.toFixed(6)},${v.point.lng.toFixed(6)}` : "unresolved"} (${v.note})`);
  console.log(`\n${rows.join("\n")}\n\nwrote ${OUT} (dev-only, git-ignored)`);
  return 0;
}

process.exit(main());
