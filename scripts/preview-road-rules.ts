// Dev-only preview of the reviewed road rules and padyak areas (Increment E Task 2). Never part of
// the app or the import.
//
//   pnpm data:preview-road-rules
//
// Reads the reviewed modes seed and the pinned road snapshot (committed files only; no network),
// prints per rule its way ids, names and lengths (clipped where the rule clips), and writes
// tmp/road-rules-preview.html (git-ignored), a Leaflet page for the owner's review of every clipped
// portion. Opening the page loads Leaflet and OSM tiles in the browser; nothing is uploaded.
// Map data © OpenStreetMap contributors (ODbL 1.0).
import { mkdirSync, writeFileSync } from "node:fs";
import { haversineMeters } from "../src/domain/geo/geometry";
import type { LatLng } from "../src/domain/geo/types";
import { importableRecords, parseModesSeed, verifyRulesAgainstRoads } from "../src/domain/import/modes-seed";
import { readNewestModesSeed } from "./lib/modes-plan";
import { readPinnedRoadsSnapshot } from "./lib/roads-snapshot";

const OUT = "tmp/road-rules-preview.html";

function main(): number {
  const snap = readPinnedRoadsSnapshot();
  if (!snap?.roads) {
    console.error(`road snapshot refused: ${snap?.problems.join("; ") ?? "none found"}`);
    return 1;
  }
  const roads = snap.roads;
  const file = readNewestModesSeed();
  if (!file) throw new Error("no modes seed");
  const seed = parseModesSeed(JSON.parse(file.bytes.toString("utf8")));
  const problems = verifyRulesAgainstRoads(seed, roads);
  if (problems.length > 0) {
    console.error(`rules refused:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  const imp = importableRecords(seed);
  const ways = new Map(roads.ways.map((w) => [w.id, w]));
  const at = (id: number): LatLng => roads.nodes.get(id)!;
  const length = (line: LatLng[]) => line.slice(1).reduce((s, p, i) => s + haversineMeters(line[i]!, p), 0);

  const features: { code: string; kind: string; label: string; line: LatLng[] }[] = [];
  const points: { code: string; label: string; at: LatLng }[] = [];
  for (const r of imp.roadRules) {
    console.log(`\n${r.code} ${r.kind} ${r.appliesTo[0]} · ${r.geometry} · ${r.streets.join(" / ")}`);
    if (r.geometry === "not_mapped") console.log(`  ${r.clipNote}`);
    if (r.junctionNodeId !== null) {
      points.push({ code: r.code, label: r.clipNote, at: at(r.junctionNodeId) });
      console.log(`  junction node ${r.junctionNodeId}`);
    }
    let total = 0;
    for (const id of r.wayIds) {
      const w = ways.get(id)!;
      const clip = r.clips.find((c) => c.wayId === id);
      let ids = w.nodeIds;
      if (clip) {
        const a = ids.indexOf(clip.fromNodeId);
        const b = ids.indexOf(clip.toNodeId);
        ids = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      }
      const line = ids.map(at);
      const m = length(line);
      total += m;
      console.log(`  way/${id} "${w.tags.name ?? w.tags.highway}" ${w.tags.highway} ${Math.round(m)} m${clip ? ` (clipped ${clip.fromNodeId}→${clip.toNodeId})` : ""}`);
      features.push({ code: r.code, kind: r.kind, label: `${r.code} way/${id}${clip ? " (clipped)" : ""}`, line });
    }
    if (r.wayIds.length > 0) console.log(`  total ${Math.round(total)} m`);
  }
  for (const a of imp.padyakAreas) {
    console.log(`\n${a.code} ${a.area} (${a.documentedYear}) · ${a.associations.join(", ")} · nodes ${a.placeNodeIds.join(", ")}`);
    for (const id of a.placeNodeIds) {
      const p = roads.places.find((x) => x.id === id)!;
      points.push({ code: a.code, label: `${a.code} ${a.area}: ${p.name}`, at: p });
    }
  }

  const data = JSON.stringify({
    lines: features.map((f) => ({ ...f, line: f.line.map((p) => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]) })),
    points: points.map((p) => ({ ...p, at: [Number(p.at.lat.toFixed(6)), Number(p.at.lng.toFixed(6))] })),
  });
  mkdirSync("tmp", { recursive: true });
  writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Road rules preview</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>html,body,#m{height:100%;margin:0}</style><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
const d=${data};
const m=L.map("m").setView([13.6233869,123.1846726],14);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors (ODbL 1.0)"}).addTo(m);
const colour=(f)=>f.kind==="exempt"?"#1a7f37":f.code.startsWith("PADYAK")?"#8250df":"#cf222e";
for(const f of d.lines) L.polyline(f.line,{color:colour(f),weight:f.kind==="exempt"?8:5,opacity:.8,dashArray:f.code.startsWith("PADYAK")?"8 6":null}).bindTooltip(f.label).addTo(m);
for(const p of d.points) L.circleMarker(p.at,{radius:7,color:p.code.startsWith("PA")?"#0969da":"#1a7f37"}).bindTooltip(p.label).addTo(m);
</script>
`);
  console.log(`\nwrote ${OUT} (red: tricycle exclude, purple dashed: padyak exclude, green: exempt, blue: padyak area nodes)`);
  return 0;
}

process.exitCode = main();
