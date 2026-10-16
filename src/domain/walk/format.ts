// Serialized street graph, formats v1 (walk only) and v2 (walk + tricycle + padyak) (compact JSON). Built at import time from the pinned OSM road
// snapshot (walk-graph-build.ts), served as an immutable per-revision file and decoded on the
// phone (walk-graph.ts). Everything derived from OSM: ODbL 1.0 derived database.
//
//   {
//     v: 1,
//     roadSource: "OSMR-2026-10-16",              // the road snapshot this graph was built from
//     bbox: [southE5, westE5, northE5, eastE5],   // integer degrees × 1e5 over every point
//     nodes: [lat0, lng0, dLat1, dLng1, …],       // integer degrees × 1e5 (precision 5, ≈1.1 m);
//                                                 // node 0 absolute, then deltas from the previous node
//     edges: [a, b, lengthDm, nGeom, …],          // 4 ints per undirected edge: node indices a ≤ b
//                                                 // (a = b for a loop), length in decimetres, and the
//                                                 // number of intermediate points it takes from geom
//     geom: [dLat, dLng, …],                      // intermediate points of the edges, in edge order
//                                                 // (an edge's slice starts at the sum of the earlier
//                                                 // edges' nGeom): the first point is a delta from
//                                                 // node a, the next ones from the previous point
//   }
//
// Format v2 (plan E §C, E-J3) is v1 over the union of walk- and tricycle-profile ways, plus:
//
//     flags:  [f0, f1, …],                        // one int per edge (bit layout: FLAG_* below):
//                                                 //   bit 0 walk; bit 1 tricycle a→b; bit 2 tricycle
//                                                 //   b→a; bit 3 national road (trunk|primary and
//                                                 //   links; note only); bit 4 padyak banned (Sec 132
//                                                 //   ways); bit 5 padyak road class; bits 6–7 zero;
//                                                 //   bits 8–15 tricycle restriction rule index + 1
//     rules:  [{ code, label, sourceCodes, liftedFrom, liftedTo }],   // restrictions (rules.ts)
//     areas:  [{ code, radiusM }, …],             // padyak areas (a place's areaIndex points here) and
//                                                 // their effective anchor radius in whole metres
//     places: [[osmId, latE5, lngE5, areaIndex], …]  // padyak area anchor nodes (one row per area
//                                                 // membership; -1 = no area), inside the bbox
//
// A padyak edge is walk ∧ padyak class ∧ ¬banned. A v1 payload decodes as all edges walk-only.
//
// Degree-2 nodes are contracted: their coordinates survive only in `geom`, for drawing. The
// brief's optional `polylineDeltaIdx` is implicit (cumulative nGeom), which is smaller than an
// explicit offset. Edge length is at least the haversine length of the rounded polyline, so a
// straight-line heuristic over the decoded coordinates never overestimates.
//
// Pure (Zod only). The structural checks below make the decoder safe on any parsed payload.
import { z } from "zod";

export const WALK_GRAPH_FORMAT_VERSION = 1;
export const STREET_GRAPH_FORMAT_VERSION = 2;

export const FLAG_WALK = 1;
export const FLAG_TRI_AB = 2;
export const FLAG_TRI_BA = 4;
export const FLAG_NATIONAL = 8;
export const FLAG_PADYAK_BANNED = 16;
export const FLAG_PADYAK_CLASS = 32;
export const FLAG_RULE_SHIFT = 8;
const FLAG_RESERVED = 0xc0;
const MAX_RULES = 255;
const MAX_AREAS = 255;
const MAX_PLACES = 10_000;

/** Generous ceilings (the real Naga graph is ≈ 5 k nodes, 7 k edges, 25 k geometry points). */
const MAX_NODES = 500_000;
const MAX_EDGES = 1_000_000;
const MAX_GEOM_POINTS = 5_000_000;
/** 1,000 km: far beyond any walk edge; keeps Int32 lengths positive (a negative edge would loop A*). */
export const MAX_EDGE_LENGTH_DM = 10_000_000;
/** A city graph spans at most 1° (≈ 111 km) per axis; bounds the grid index build. */
export const MAX_BBOX_EXTENT_E5 = 100_000;

const int = z.number().int();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const label = z.string().min(1).max(200);
const base = {
  roadSource: z.string().min(1).max(200),
  bbox: z.tuple([int, int, int, int]),
  nodes: z.array(int).max(MAX_NODES * 2),
  edges: z.array(int).max(MAX_EDGES * 4),
  geom: z.array(int).max(MAX_GEOM_POINTS * 2),
};
const v1Schema = z.object({ v: z.literal(WALK_GRAPH_FORMAT_VERSION), ...base });
const v2Schema = z.object({
  v: z.literal(STREET_GRAPH_FORMAT_VERSION),
  ...base,
  flags: z.array(int.min(0).max(0xffff)).max(MAX_EDGES),
  rules: z
    .array(z.object({ code: z.string().min(1).max(40), label, sourceCodes: z.array(z.string().min(1).max(20)).max(20), liftedFrom: hhmm.nullable(), liftedTo: hhmm.nullable() }))
    .max(MAX_RULES),
  areas: z.array(z.object({ code: z.string().min(1).max(20), radiusM: int.min(1).max(1000) })).max(MAX_AREAS),
  places: z.array(z.tuple([int.min(1).max(Number.MAX_SAFE_INTEGER), int, int, int.min(-1)])).max(MAX_PLACES),
});

export const walkGraphPayloadSchema = z
  .discriminatedUnion("v", [v1Schema, v2Schema])
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (p.nodes.length % 2 !== 0) issue("nodes: odd length (expected lat/lng pairs)");
    if (p.edges.length % 4 !== 0) issue("edges: length is not a multiple of 4");
    if (p.geom.length % 2 !== 0) issue("geom: odd length (expected lat/lng pairs)");
    const [south, west, north, east] = p.bbox;
    if (south > north || west > east) issue("bbox: south > north or west > east");
    if (Math.abs(south) > 90e5 || Math.abs(north) > 90e5 || Math.abs(west) > 180e5 || Math.abs(east) > 180e5) {
      issue("bbox: outside valid latitude/longitude");
    }
    if (north - south > MAX_BBOX_EXTENT_E5 || east - west > MAX_BBOX_EXTENT_E5) issue("bbox: extent over 1° per axis");
    const inside = (lat: number, lng: number) => lat >= south && lat <= north && lng >= west && lng <= east;
    if (p.v === STREET_GRAPH_FORMAT_VERSION) {
      if (p.flags.length * 4 !== p.edges.length) issue("flags: not one per edge");
      p.flags.forEach((f, i) => {
        if ((f & FLAG_RESERVED) !== 0) issue(`flags[${i}]: reserved bits set`);
        if (f >> FLAG_RULE_SHIFT > p.rules.length) issue(`flags[${i}]: rule index out of range`);
      });
      p.rules.forEach((r, i) => {
        if ((r.liftedFrom === null) !== (r.liftedTo === null)) issue(`rules[${i}]: liftedFrom and liftedTo are both set or both null`);
      });
      p.places.forEach(([, lat, lng, area], i) => {
        if (area >= p.areas.length) issue(`places[${i}]: area index out of range`);
        if (!inside(lat, lng)) issue(`places[${i}]: outside bbox`);
      });
    }
    const nodeCount = p.nodes.length / 2;
    let geomPoints = 0;
    for (let i = 0; i + 3 < p.edges.length; i += 4) {
      const a = p.edges[i]!;
      const b = p.edges[i + 1]!;
      if (a < 0 || b < 0 || a >= nodeCount || b >= nodeCount) {
        issue(`edges[${i / 4}]: node index out of range`);
        return;
      }
      if (a > b) {
        issue(`edges[${i / 4}]: a > b`);
        return;
      }
      if (p.edges[i + 2]! < 0 || p.edges[i + 3]! < 0) {
        issue(`edges[${i / 4}]: negative length or geometry count`);
        return;
      }
      if (p.edges[i + 2]! > MAX_EDGE_LENGTH_DM) {
        issue(`edges[${i / 4}]: length over ${MAX_EDGE_LENGTH_DM} dm`);
        return;
      }
      geomPoints += p.edges[i + 3]!;
    }
    if (geomPoints * 2 !== p.geom.length) {
      issue(`geom: ${p.geom.length / 2} points, edges reference ${geomPoints}`);
      return;
    }
    // Absolute points (accumulated deltas) must lie inside the bbox: this also rules out Int32
    // overflow in the decoder and unbounded grid cells.
    const nodeLat: number[] = [];
    const nodeLng: number[] = [];
    let lat = 0;
    let lng = 0;
    for (let i = 0; i + 1 < p.nodes.length; i += 2) {
      lat += p.nodes[i]!;
      lng += p.nodes[i + 1]!;
      if (!inside(lat, lng)) {
        issue(`nodes[${i / 2}]: outside bbox`);
        return;
      }
      nodeLat.push(lat);
      nodeLng.push(lng);
    }
    let g = 0;
    for (let i = 0; i + 3 < p.edges.length; i += 4) {
      lat = nodeLat[p.edges[i]!]!;
      lng = nodeLng[p.edges[i]!]!;
      for (let k = 0; k < p.edges[i + 3]!; k++, g++) {
        lat += p.geom[2 * g]!;
        lng += p.geom[2 * g + 1]!;
        if (!inside(lat, lng)) {
          issue(`geom point ${g} (edges[${i / 4}]): outside bbox`);
          return;
        }
      }
    }
  });

export type WalkGraphPayload = z.infer<typeof walkGraphPayloadSchema>;
export type StreetGraphPayload = Extract<WalkGraphPayload, { v: 2 }>;
