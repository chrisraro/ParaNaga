// Road graph built from a parsed OpenStreetMap road snapshot (src/domain/import/osm-roads.ts).
//
// Two profiles:
//   vehicle — the jeepney profile: drivable classes (motorway … residential, unclassified, service,
//             living_street, *_link, busway), one-way respected (oneway=yes|1|true, oneway=-1,
//             junction=roundabout|circular; oneway:psv overrides oneway). psv=yes|designated or
//             bus=yes|designated lets a jeepney through; otherwise motor_vehicle=no|private,
//             vehicle=no|private and access=no|private block. area=yes and
//             service=parking_aisle|drive-through are left out (not through roads).
//   walk    — D7: every highway class except motorway, motorway_link, construction, proposed (and
//             the lifecycle values abandoned, disused, razed, which are not roads); foot=no is
//             excluded, and access=private|no unless foot=yes|designated. Undirected.
//
// Ways are split at junctions (a way's end nodes and nodes shared by two or more kept ways), so
// degree-2 nodes are contracted into edge polylines. Every edge is directed; a two-way piece gives
// two edges (`twin` links them). Edges carry the way id, normalized street names and the haversine
// length. A spatial grid (~100 m cells) indexes the edges for nearestEdge.
//
// Pure and deterministic: same snapshot → same graph (ways by id, nodes by OSM id).
import { haversineMeters } from "./geometry";
import { wayStreetNames } from "./street-names";
import type { LatLng } from "./types";
import type { OsmRoads, RoadWay } from "../import/osm-roads";

export type RoadProfile = "vehicle" | "walk";

const DRIVABLE = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "busway",
]);
const NOT_WALKABLE = new Set(["motorway", "motorway_link", "construction", "proposed", "abandoned", "disused", "razed"]);

export const GRID_CELL_M = 100;

export type GraphNode = { osmId: number; lat: number; lng: number };

export type RoadEdge = {
  index: number;
  /** Node indices into `nodes`. */
  from: number;
  to: number;
  wayId: number;
  /** Normalized names (name, alt_name, old_name, official_name), for street matching. */
  names: string[];
  lengthM: number;
  /** The polyline from `from` to `to`, both ends included. */
  coords: LatLng[];
  /** True when the edge runs against the way's node order. */
  reverse: boolean;
  /** The edge over the same polyline in the other direction; null on a one-way piece. */
  twin: number | null;
  /** Set on pieces of a roundabout (junction=roundabout|circular). */
  roundabout?: true;
};

export type SpatialGrid = {
  cellM: number;
  originLat: number;
  originLng: number;
  mPerDegLat: number;
  mPerDegLng: number;
  /** "ix,iy" → canonical edge indices (one per two-way pair) whose segments touch the cell. */
  cells: Map<string, number[]>;
};

export type RoadGraph = {
  profile: RoadProfile;
  nodes: GraphNode[];
  edges: RoadEdge[];
  /** Outgoing edge indices per node index. */
  out: number[][];
  grid: SpatialGrid;
};

function included(way: RoadWay, profile: RoadProfile): boolean {
  const t = way.tags;
  if (profile === "vehicle") {
    if (!DRIVABLE.has(t.highway)) return false;
    if (t.area === "yes") return false;
    if (t.service === "parking_aisle" || t.service === "drive-through") return false;
    const allowed = (v: string | undefined) => v === "yes" || v === "designated";
    if (allowed(t.psv) || allowed(t.bus)) return true;
    const blocked = (v: string | undefined) => v === "no" || v === "private";
    return !blocked(t.motor_vehicle) && !blocked(t.vehicle) && !blocked(t.access);
  }
  if (NOT_WALKABLE.has(t.highway)) return false;
  if (t.foot === "no") return false;
  if ((t.access === "private" || t.access === "no") && t.foot !== "yes" && t.foot !== "designated") return false;
  return true;
}

/** Which directions a vehicle may use: forward (way order), backward, or both. Walking: both. */
function directions(way: RoadWay, profile: RoadProfile): { forward: boolean; backward: boolean } {
  if (profile === "walk") return { forward: true, backward: true };
  const oneway = way.tags["oneway:psv"] ?? way.tags.oneway;
  if (oneway === "-1" || oneway === "reverse") return { forward: false, backward: true };
  if (oneway === "yes" || oneway === "1" || oneway === "true") return { forward: true, backward: false };
  if (oneway === "no" || oneway === "false" || oneway === "0") return { forward: true, backward: true };
  const junction = way.tags.junction;
  if (junction === "roundabout" || junction === "circular") return { forward: true, backward: false };
  return { forward: true, backward: true };
}

function polylineLength(coords: readonly LatLng[]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += haversineMeters(coords[i - 1]!, coords[i]!);
  return m;
}

export function buildRoadGraph(roads: Pick<OsmRoads, "ways" | "nodes">, options: { profile: RoadProfile }): RoadGraph {
  const { profile } = options;
  const ways = roads.ways.filter((w) => included(w, profile)).sort((a, b) => a.id - b.id);

  // Junctions: way ends, and nodes used more than once (by two ways, or twice by one way).
  const uses = new Map<number, number>();
  const junction = new Set<number>();
  for (const w of ways) {
    junction.add(w.nodeIds[0]!);
    junction.add(w.nodeIds[w.nodeIds.length - 1]!);
    for (const n of w.nodeIds) uses.set(n, (uses.get(n) ?? 0) + 1);
  }
  for (const [n, count] of uses) if (count > 1) junction.add(n);

  const nodeIds = [...junction].sort((a, b) => a - b);
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const nodes: GraphNode[] = nodeIds.map((id) => {
    const c = roads.nodes.get(id)!;
    return { osmId: id, lat: c.lat, lng: c.lng };
  });

  const edges: RoadEdge[] = [];
  const canonical: number[] = [];
  for (const w of ways) {
    const names = wayStreetNames(w.tags);
    const dir = directions(w, profile);
    let start = 0;
    for (let i = 1; i < w.nodeIds.length; i++) {
      if (!junction.has(w.nodeIds[i]!)) continue;
      const coords = w.nodeIds.slice(start, i + 1).map((id) => {
        const c = roads.nodes.get(id)!;
        return { lat: c.lat, lng: c.lng };
      });
      const a = nodeIndex.get(w.nodeIds[start]!)!;
      const b = nodeIndex.get(w.nodeIds[i]!)!;
      const lengthM = polylineLength(coords);
      start = i;
      const base = { wayId: w.id, names, lengthM, ...(w.tags.junction === "roundabout" || w.tags.junction === "circular" ? { roundabout: true as const } : {}) };
      const fwd = dir.forward ? edges.push({ index: edges.length, from: a, to: b, ...base, coords, reverse: false, twin: null }) - 1 : -1;
      const back = dir.backward
        ? edges.push({ index: edges.length, from: b, to: a, ...base, coords: [...coords].reverse(), reverse: true, twin: null }) - 1
        : -1;
      if (fwd >= 0 && back >= 0) {
        edges[fwd]!.twin = back;
        edges[back]!.twin = fwd;
      }
      canonical.push(fwd >= 0 ? fwd : back);
    }
  }

  const out: number[][] = nodes.map(() => []);
  for (const e of edges) out[e.from]!.push(e.index);

  return { profile, nodes, edges, out, grid: buildGrid(nodes, edges, canonical) };
}

function buildGrid(nodes: readonly GraphNode[], edges: readonly RoadEdge[], canonical: readonly number[]): SpatialGrid {
  const originLat = nodes.reduce((m, n) => Math.min(m, n.lat), nodes[0]?.lat ?? 0);
  const originLng = nodes.reduce((m, n) => Math.min(m, n.lng), nodes[0]?.lng ?? 0);
  const mPerDegLat = (Math.PI / 180) * 6_371_008.8;
  const meanLat = nodes.length > 0 ? nodes.reduce((s, n) => s + n.lat, 0) / nodes.length : 0;
  const mPerDegLng = mPerDegLat * Math.cos((meanLat * Math.PI) / 180);
  const grid: SpatialGrid = { cellM: GRID_CELL_M, originLat, originLng, mPerDegLat, mPerDegLng, cells: new Map() };
  for (const i of canonical) {
    const coords = edges[i]!.coords;
    for (let s = 1; s < coords.length; s++) {
      const [ax, ay] = toXY(grid, coords[s - 1]!);
      const [bx, by] = toXY(grid, coords[s]!);
      for (let cx = Math.floor(Math.min(ax, bx) / GRID_CELL_M); cx <= Math.floor(Math.max(ax, bx) / GRID_CELL_M); cx++) {
        for (let cy = Math.floor(Math.min(ay, by) / GRID_CELL_M); cy <= Math.floor(Math.max(ay, by) / GRID_CELL_M); cy++) {
          const key = `${cx},${cy}`;
          const list = grid.cells.get(key);
          if (!list) grid.cells.set(key, [i]);
          else if (list[list.length - 1] !== i) list.push(i);
        }
      }
    }
  }
  return grid;
}

/** Local planar metres (equirectangular around the grid origin): accurate at city scale. */
function toXY(grid: SpatialGrid, p: LatLng): [number, number] {
  return [(p.lng - grid.originLng) * grid.mPerDegLng, (p.lat - grid.originLat) * grid.mPerDegLat];
}

export type EdgeHit = {
  edge: RoadEdge;
  /** Fraction of the edge's length from `from` to the projected point, 0…1. */
  t: number;
  distM: number;
  /** The projected point on the edge. */
  point: LatLng;
  /** 1-based index of the polyline segment the point projects onto (coords[seg-1] → coords[seg]). */
  seg: number;
};

/**
 * Every edge within `maxM` metres of `point` (its nearest projection each), nearest first; ties go
 * to the lower edge index. Two-way pieces are indexed once (the way-order edge; use `twin`).
 */
export function edgesWithin(graph: RoadGraph, point: LatLng, maxM: number): EdgeHit[] {
  const { grid } = graph;
  const [px, py] = toXY(grid, point);
  const r = Math.ceil(maxM / grid.cellM);
  const cx0 = Math.floor(px / grid.cellM);
  const cy0 = Math.floor(py / grid.cellM);
  const candidates = new Set<number>();
  for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
    for (let cy = cy0 - r; cy <= cy0 + r; cy++) for (const i of grid.cells.get(`${cx},${cy}`) ?? []) candidates.add(i);
  }
  const hits: EdgeHit[] = [];
  for (const i of [...candidates].sort((a, b) => a - b)) {
    const coords = graph.edges[i]!.coords;
    let best: { d2: number; seg: number; u: number } | null = null;
    for (let s = 1; s < coords.length; s++) {
      const [ax, ay] = toXY(grid, coords[s - 1]!);
      const [bx, by] = toXY(grid, coords[s]!);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const qx = ax + u * dx - px;
      const qy = ay + u * dy - py;
      const d2 = qx * qx + qy * qy;
      if (best === null || d2 < best.d2) best = { d2, seg: s, u };
    }
    if (best === null || Math.sqrt(best.d2) > maxM) continue;
    const edge = graph.edges[i]!;
    const a = edge.coords[best.seg - 1]!;
    const b = edge.coords[best.seg]!;
    const at = { lat: a.lat + best.u * (b.lat - a.lat), lng: a.lng + best.u * (b.lng - a.lng) };
    const before = polylineLength(edge.coords.slice(0, best.seg)) + haversineMeters(a, at);
    hits.push({ edge, t: edge.lengthM === 0 ? 0 : Math.min(1, before / edge.lengthM), distM: Math.sqrt(best.d2), point: at, seg: best.seg });
  }
  return hits.sort((x, y) => x.distM - y.distM || x.edge.index - y.edge.index);
}

/**
 * The edge nearest to `point` within `maxM` metres (projection onto its segments), or null.
 * Two-way pieces are indexed once (the way-order edge; use `twin` for the other direction).
 * Ties go to the lower edge index.
 */
export function nearestEdge(graph: RoadGraph, point: LatLng, maxM: number): EdgeHit | null {
  return edgesWithin(graph, point, maxM)[0] ?? null;
}
