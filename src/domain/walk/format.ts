// Serialized walk graph, format v1 (compact JSON). Built at import time from the pinned OSM road
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
// Degree-2 nodes are contracted: their coordinates survive only in `geom`, for drawing. The
// brief's optional `polylineDeltaIdx` is implicit (cumulative nGeom), which is smaller than an
// explicit offset. Edge length is at least the haversine length of the rounded polyline, so a
// straight-line heuristic over the decoded coordinates never overestimates.
//
// Pure (Zod only). The structural checks below make the decoder safe on any parsed payload.
import { z } from "zod";

export const WALK_GRAPH_FORMAT_VERSION = 1;

/** Generous ceilings (the real Naga graph is ≈ 5 k nodes, 7 k edges, 25 k geometry points). */
const MAX_NODES = 500_000;
const MAX_EDGES = 1_000_000;
const MAX_GEOM_POINTS = 5_000_000;
/** 1,000 km: far beyond any walk edge; keeps Int32 lengths positive (a negative edge would loop A*). */
export const MAX_EDGE_LENGTH_DM = 10_000_000;
/** A city graph spans at most 1° (≈ 111 km) per axis; bounds the grid index build. */
export const MAX_BBOX_EXTENT_E5 = 100_000;

const int = z.number().int();

export const walkGraphPayloadSchema = z
  .object({
    v: z.literal(WALK_GRAPH_FORMAT_VERSION),
    roadSource: z.string().min(1).max(200),
    bbox: z.tuple([int, int, int, int]),
    nodes: z.array(int).max(MAX_NODES * 2),
    edges: z.array(int).max(MAX_EDGES * 4),
    geom: z.array(int).max(MAX_GEOM_POINTS * 2),
  })
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
    const inside = (lat: number, lng: number) => lat >= south && lat <= north && lng >= west && lng <= east;
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
