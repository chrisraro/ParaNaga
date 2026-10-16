// Landmark items of the LPTRP street lists (and the trial circuits): list entries that name a place,
// not a street. Reviewed rules, resolved against sourced data only:
//   - terminal: the reviewed modes-seed terminal's OSM coordinate (null when it has none);
//   - boundary_crossing: where the named street crosses the city boundary (OSM relation 3084673),
//     only when that crossing is unique (crossings within 50 m count as one, e.g. two carriageways),
//     optionally among those within `withinM` of a named place node (the text's qualifier);
//   - unresolved: no sourced location; the tracer skips the item and reports landmark_unresolved.
// Pure.
import { haversineMeters } from "../geo/geometry";
import type { RoadGraph } from "../geo/road-graph";
import { normalizeStreetName, type StreetAlias } from "../geo/street-names";
import type { LatLng, LngLat } from "../geo/types";

export type LandmarkRule =
  | { kind: "terminal"; code: string; reason: string }
  | { kind: "boundary_crossing"; street: string; near?: { place: string; withinM: number }; reason: string }
  | { kind: "unresolved"; reason: string };

export const ROUTE_LANDMARKS: Readonly<Record<string, LandmarkRule>> = {
  "Bicol Central Station": { kind: "terminal", code: "T01", reason: "LPTRP Loop A/B item; T01 Bicol Central Station (OSM way 293702439 centroid, not an entrance)" },
  "Naga–Pili boundary, Del Rosario": {
    kind: "boundary_crossing",
    street: "AH26",
    near: { place: "Del Rosario", withinM: 2000 },
    reason:
      "R3/R4 terminus: where AH26 (Maharlika Highway, reviewed alias) crosses the Naga City boundary toward Pili; " +
      "of its crossings, the one within 2 km of the Del Rosario place node (the text names Del Rosario)",
  },
  "Eastbound Terminal, Anciano St": { kind: "terminal", code: "T02", reason: "trial circuit item; T02 has no coordinate (street conflict Anciano St vs Waling-Waling St)" },
  Mabolo: { kind: "unresolved", reason: "R3 alternative structure only (not traced); a barangay, no point on file" },
  "Southbound Terminal": { kind: "terminal", code: "T03", reason: "R3 alternative structure only (not traced)" },
};

export const CROSSING_CLUSTER_M = 50;

export type LandmarkResolution = { point: LatLng | null; note: string };

/** Segment intersection of p1–p2 with q1–q2 in lng/lat (planar at city scale), or null. */
function intersect(p1: LatLng, p2: LatLng, q1: LatLng, q2: LatLng): LatLng | null {
  const d = (p2.lng - p1.lng) * (q2.lat - q1.lat) - (p2.lat - p1.lat) * (q2.lng - q1.lng);
  if (d === 0) return null;
  const u = ((q1.lng - p1.lng) * (q2.lat - q1.lat) - (q1.lat - p1.lat) * (q2.lng - q1.lng)) / d;
  const v = ((q1.lng - p1.lng) * (p2.lat - p1.lat) - (q1.lat - p1.lat) * (p2.lng - p1.lng)) / d;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { lat: p1.lat + u * (p2.lat - p1.lat), lng: p1.lng + u * (p2.lng - p1.lng) };
}

/** Where the street (by name or reviewed alias) crosses the ring: the unique crossing, or null. */
export function boundaryCrossing(
  graph: RoadGraph,
  ring: readonly LngLat[],
  street: string,
  aliases: readonly StreetAlias[],
  near?: { at: LatLng; withinM: number; label: string },
): LandmarkResolution {
  const key = normalizeStreetName(street);
  const wanted = new Set([key, ...aliases.filter((a) => normalizeStreetName(a.legalName) === key).map((a) => normalizeStreetName(a.osmName))]);
  const hits: { point: LatLng; edge: number }[] = [];
  for (const e of graph.edges) {
    if (e.reverse && e.twin !== null) continue; // each two-way piece once
    if (!e.names.some((n) => wanted.has(n))) continue;
    for (let i = 1; i < e.coords.length; i++) {
      for (let j = 1; j < ring.length; j++) {
        const q1 = { lng: ring[j - 1]![0], lat: ring[j - 1]![1] };
        const q2 = { lng: ring[j]![0], lat: ring[j]![1] };
        const p = intersect(e.coords[i - 1]!, e.coords[i]!, q1, q2);
        if (p) hits.push({ point: p, edge: e.index });
      }
    }
  }
  if (hits.length === 0) return { point: null, note: `${street} does not cross the boundary` };
  hits.sort((a, b) => a.edge - b.edge);
  const clusters: { point: LatLng; edge: number }[][] = [];
  for (const h of hits) {
    const c = clusters.find((cl) => cl.some((x) => haversineMeters(x.point, h.point) <= CROSSING_CLUSTER_M));
    if (c) c.push(h);
    else clusters.push([h]);
  }
  const kept = near ? clusters.filter((cl) => cl.some((x) => haversineMeters(x.point, near.at) <= near.withinM)) : clusters;
  const where = near ? ` within ${near.withinM} m of ${near.label}` : "";
  if (kept.length !== 1) return { point: null, note: `${street} crosses the boundary at ${kept.length} places${where} (${clusters.length} in all; not unique)` };
  const at = kept[0]![0]!;
  return { point: at.point, note: `${street} crosses the boundary once${where} (edge ${at.edge}; ${clusters.length} crossing(s) in all)` };
}

export type LandmarkContext = {
  terminals: readonly { code: string; lat: number | null; lng: number | null }[];
  graph: RoadGraph;
  boundary: readonly LngLat[];
  aliases: readonly StreetAlias[];
  /** Named place nodes (road snapshot) for `near` qualifiers; a name must match exactly one. */
  places?: readonly { name: string; lat: number; lng: number }[];
};

/** Resolves every rule: name → point (or null) with a note saying how. */
export function resolveRouteLandmarks(rules: Readonly<Record<string, LandmarkRule>>, ctx: LandmarkContext): Record<string, LandmarkResolution> {
  const out: Record<string, LandmarkResolution> = {};
  for (const name of Object.keys(rules).sort()) {
    const rule = rules[name]!;
    if (rule.kind === "unresolved") out[name] = { point: null, note: rule.reason };
    else if (rule.kind === "terminal") {
      const t = ctx.terminals.find((x) => x.code === rule.code);
      out[name] = t && t.lat !== null && t.lng !== null ? { point: { lat: t.lat, lng: t.lng }, note: `${rule.code} coordinate` } : { point: null, note: `${rule.code} has no coordinate` };
    } else if (rule.near) {
      const matches = (ctx.places ?? []).filter((p) => normalizeStreetName(p.name) === normalizeStreetName(rule.near!.place));
      out[name] =
        matches.length === 1
          ? boundaryCrossing(ctx.graph, ctx.boundary, rule.street, ctx.aliases, { at: matches[0]!, withinM: rule.near.withinM, label: rule.near.place })
          : { point: null, note: `place "${rule.near.place}" matches ${matches.length} place nodes` };
    } else out[name] = boundaryCrossing(ctx.graph, ctx.boundary, rule.street, ctx.aliases);
  }
  return out;
}

/**
 * The outer terminus of each open LPTRP route (the barangay in its name; the other end is Centro),
 * resolved by name against the road snapshot's place nodes. Inbound lists start there, outbound
 * lists end there. A missing or ambiguous place leaves the trace on the street's far end.
 */
export const ROUTE_TERMINI: Readonly<Record<string, { place: string; reason: string }>> = {
  R1: { place: "San Isidro", reason: "route name: Centro–San Isidro via Cararayan" },
  R2: { place: "Del Rosario", reason: "route name: Centro–Del Rosario via Magsaysay Avenue" },
  R5: { place: "San Felipe", reason: "route name: Centro–San Felipe" },
  R6: { place: "Pacol", reason: "route name: Centro–Pacol" },
  R7: { place: "Panicuason", reason: "route name: Centro–Carolina–Panicuason" },
};
