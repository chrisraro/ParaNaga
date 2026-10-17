// Read-only review aid (Increment F, review I5): which named places fall in each far zone.
// Reads the pinned places snapshot and the far-areas JSON; prints, per far zone, every named place inside
// (nearest anchor is a zone node AND within that anchor's radius) with its distance to that anchor, then the 15
// places just outside (nearest anchor is a zone node, beyond its radius), nearest first, with the nearest non-far
// barangay. The per-anchor radius used is printed per zone. No database.
import { readFileSync } from "node:fs";
import { haversineMeters } from "../src/domain/geo/geometry";
import { anchorRadiusM, nearestAnchorId, parseFarAreas, zoneOf } from "../src/domain/planner/far-areas";

const PLACES = "data/source/osm/naga-places-2026-10-16.osm.json";
const FAR = "data/planning/far-areas-2026-10-18.json";

type El = { type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: { name?: string } };
const data = parseFarAreas(JSON.parse(readFileSync(FAR, "utf8")));
const elements = (JSON.parse(readFileSync(PLACES, "utf8")) as { response: { elements: El[] } }).response.elements;
const places = elements.flatMap((e) => {
  const c = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
  return e.tags?.name && c ? [{ name: e.tags.name, lat: c.lat, lng: c.lon }] : [];
});
const anchor = (id: number) => data.barangayAnchors.find((a) => a.osmNodeId === id)!;
const farIds = new Set(data.farZones.flatMap((z) => z.nodeIds));
const nonFar = data.barangayAnchors.filter((a) => !farIds.has(a.osmNodeId));
const m = (x: number) => `${Math.round(x)} m`;

for (const z of data.farZones) {
  const radii = z.nodeIds.map((id) => `${anchor(id).name} ${anchorRadiusM(anchor(id), z)} m`).join(", ");
  const near = places
    .map((p) => ({ p, a: anchor(nearestAnchorId(p, data)!) }))
    .filter(({ a }) => z.nodeIds.includes(a.osmNodeId))
    .map(({ p, a }) => ({ p, a, d: haversineMeters(p, a) }))
    .sort((x, y) => x.d - y.d);
  const inside = near.filter((x) => zoneOf(x.p, data) === z.code);
  const outside = near.filter((x) => zoneOf(x.p, data) !== z.code).slice(0, 15);
  console.log(`\n${z.code} ${z.name} (radius per anchor: ${radii}): ${inside.length} places inside`);
  for (const { p, a, d } of inside) console.log(`  in   ${p.name} — ${m(d)} from ${a.name}`);
  for (const { p, a, d } of outside) {
    const nf = nonFar.map((b) => ({ b, d: haversineMeters(p, b) })).sort((x, y) => x.d - y.d)[0]!;
    console.log(`  out  ${p.name} — ${m(d)} from ${a.name} (radius ${anchorRadiusM(a, z)} m); nearest non-far barangay ${nf.b.name} (${m(nf.d)})`);
  }
}
