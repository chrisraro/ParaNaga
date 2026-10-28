// On-device street routing over the serialized street graph (format.ts v1/v2): decode, grid index,
// snap, A* and bounded Dijkstra, per mode (walk, tricycle, padyak).
//
//   parseWalkGraph(json)              Zod-checked decode of v1 or v2; never throws. v1 is walk only.
//   snapStreet(g, p, opts)            nearest edge the mode may use within 100 m (WALK_SNAP_M),
//                                     preferring the mode's largest connected component: an island
//                                     edge wins only when the point is within ISLAND_SNAP_M (5 m) of
//                                     it and nearer than the main network.
//   routeStreet(g, from, to, opts)    A* (haversine heuristic over the node coordinates, scaled by
//                                     0.999 so it stays a lower bound) from the snapped start,
//                                     including the partial edges at both snapped points. Tricycle
//                                     edges are directed (flag bits 1–2) and a restricted edge is
//                                     usable only while its rule is lifted on the Manila clock at
//                                     `now` (rules.ts). Padyak uses walk ∧ padyak class ∧ ¬banned.
//   boundedDistances(g, from, r, m)   one Dijkstra from `from` up to r graph metres; the lookup
//                                     gives the same length routeStreet would, for any point.
//   padyakAreas(g, p)                 every padyak area with an anchor within its effective radius of p.
//   padyakAreaCoverage(g, points)     per area: recall and false positives on sample points (dry run).
//   routeWalk / snapWalk              the walk mode (kept for the walk-only callers).
//
// Walk lines are approximate (crossings not checked); the UI labels them. Pure: no fs, no DB.
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";
import {
  FLAG_NATIONAL, FLAG_PADYAK_BANNED, FLAG_PADYAK_CLASS, FLAG_RULE_SHIFT, FLAG_TRI_AB, FLAG_TRI_BA, FLAG_WALK,
  STREET_GRAPH_FORMAT_VERSION, walkGraphPayloadSchema, WALK_GRAPH_FORMAT_VERSION, type WalkGraphPayload,
} from "./format";
import { ruleLifted, type StreetRule } from "./rules";

export const WALK_SNAP_M = 100;
export const ISLAND_SNAP_M = 5;
/** Plan E-J5 as ruled during build: the reference radius around the nearest anchor (coverage truth). */
export const PADYAK_AREA_RADIUS_M = 1000;
const CELL_M = 100;
const E5 = 1e5;
const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;
const HEURISTIC_SCALE = 0.999;
const MODES = ["walk", "tricycle", "padyak"] as const;

export type StreetMode = (typeof MODES)[number];
/** `ignoreRules`: tricycle only, treat every time-windowed restriction as lifted (to tell a ban from an off-map end). */
export type StreetOptions = { mode: StreetMode; now: Date; ignoreRules?: boolean };

export type WalkGraph = {
  version: 1 | 2;
  roadSource: string;
  bbox: [number, number, number, number];
  nodeCount: number;
  edgeCount: number;
  /** Node coordinates, integer degrees × 1e5. */
  nodeLat: Int32Array;
  nodeLng: Int32Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeLenDm: Int32Array;
  /** Per-edge flags (format.ts FLAG_*); a v1 graph has FLAG_WALK only. */
  flags: Uint16Array;
  rules: StreetRule[];
  /** Padyak areas with their effective anchor radius; `places` rows are [osmId, latE5, lngE5, area index or -1]. */
  areas: { code: string; radiusM: number }[];
  places: [number, number, number, number][];
  /** Edge e's intermediate points are geomLat/geomLng[geomStart[e] … geomStart[e+1]) (absolute E5). */
  geomStart: Int32Array;
  geomLat: Int32Array;
  geomLng: Int32Array;
  /** Incident edges of node v: adjEdge[adjStart[v] … adjStart[v+1]) (a loop appears twice). */
  adjStart: Int32Array;
  adjEdge: Int32Array;
  /** Per mode: connected component per node over the mode's edges (any direction, any hour; -1 = none) and the largest one (-1 = no edge). */
  components: Record<StreetMode, { id: Int32Array; main: number }>;
  grid: WalkGrid;
};

type WalkGrid = { originLat: number; originLng: number; mPerDegLng: number; cells: Map<number, number[]> };

export type WalkSnap = {
  edge: number;
  /** Distance along the edge from node edgeA[edge] to the projected point, in metres (0 … length). */
  alongM: number;
  /** Distance from the query point to the projected point, in metres. */
  distM: number;
  point: LatLng;
  /** 1-based segment of the edge polyline (a, geom…, b) the point projects onto. */
  seg: number;
};

/** no_mode_data: the graph has no edge for the mode (a v1 graph for tricycle or padyak). */
export type WalkStraightReason = "no_edge_near_start" | "no_edge_near_end" | "no_path" | "no_mode_data";

export type StreetRoute =
  | { kind: "path"; coords: LatLng[]; lengthM: number; snapFromM: number; snapToM: number; usedRules: string[]; usesNationalRoad: boolean }
  /** No street path: draw a straight dotted line `coords` (from → to), labelled so. */
  | { kind: "straight"; reason: WalkStraightReason; coords: LatLng[]; straightM: number };
export type WalkRoute = StreetRoute;

export type ParsedWalkGraph = { ok: true; graph: WalkGraph } | { ok: false; error: string };

/** Validates (Zod, structural checks) and decodes a fetched or cached payload. Never throws. */
export function parseWalkGraph(json: unknown): ParsedWalkGraph {
  const parsed = walkGraphPayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return { ok: true, graph: decodeWalkGraph(parsed.data) };
}

/** Directions a mode may use per edge, ignoring hours: bit 0 a→b, bit 1 b→a. */
function modeDirs(f: number, mode: StreetMode): number {
  if (mode === "walk") return f & FLAG_WALK ? 3 : 0;
  if (mode === "padyak") return f & FLAG_WALK && f & FLAG_PADYAK_CLASS && !(f & FLAG_PADYAK_BANNED) ? 3 : 0;
  return (f & FLAG_TRI_AB ? 1 : 0) | (f & FLAG_TRI_BA ? 2 : 0);
}

/** Directions per edge for a mode at `now` (restricted tricycle edges closed outside their lifted window). */
function passable(g: WalkGraph, { mode, now, ignoreRules }: StreetOptions): Uint8Array {
  if (mode === "tricycle") return computePassable(g, mode, now, ignoreRules);
  // Walk and padyak do not depend on `now`: kept per graph and mode (read-only to every caller).
  let kept = passableByMode.get(g);
  if (!kept) passableByMode.set(g, (kept = {}));
  return (kept[mode] ??= computePassable(g, mode, now));
}

const passableByMode = new WeakMap<WalkGraph, Partial<Record<StreetMode, Uint8Array>>>();

function computePassable(g: WalkGraph, mode: StreetMode, now: Date, ignoreRules = false): Uint8Array {
  const lifted = g.rules.map((r) => mode === "tricycle" && (ignoreRules || ruleLifted(r, now)));
  const dirs = new Uint8Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) {
    const f = g.flags[e]!;
    const rule = f >> FLAG_RULE_SHIFT;
    dirs[e] = mode === "tricycle" && rule > 0 && !lifted[rule - 1] ? 0 : modeDirs(f, mode);
  }
  return dirs;
}

/** Decodes a payload that already passed walkGraphPayloadSchema. */
export function decodeWalkGraph(p: WalkGraphPayload): WalkGraph {
  const nodeCount = p.nodes.length / 2;
  const edgeCount = p.edges.length / 4;
  const nodeLat = new Int32Array(nodeCount);
  const nodeLng = new Int32Array(nodeCount);
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < nodeCount; i++) {
    lat += p.nodes[2 * i]!;
    lng += p.nodes[2 * i + 1]!;
    nodeLat[i] = lat;
    nodeLng[i] = lng;
  }
  const edgeA = new Int32Array(edgeCount);
  const edgeB = new Int32Array(edgeCount);
  const edgeLenDm = new Int32Array(edgeCount);
  const geomStart = new Int32Array(edgeCount + 1);
  const geomLat = new Int32Array(p.geom.length / 2);
  const geomLng = new Int32Array(p.geom.length / 2);
  const degree = new Int32Array(nodeCount + 1);
  let g = 0;
  for (let e = 0; e < edgeCount; e++) {
    const a = p.edges[4 * e]!;
    const b = p.edges[4 * e + 1]!;
    edgeA[e] = a;
    edgeB[e] = b;
    edgeLenDm[e] = p.edges[4 * e + 2]!;
    const count = p.edges[4 * e + 3]!;
    geomStart[e] = g;
    let la = nodeLat[a]!;
    let ln = nodeLng[a]!;
    for (let k = 0; k < count; k++, g++) {
      la += p.geom[2 * g]!;
      ln += p.geom[2 * g + 1]!;
      geomLat[g] = la;
      geomLng[g] = ln;
    }
    degree[a + 1]!++;
    degree[b + 1]!++;
  }
  geomStart[edgeCount] = g;

  const adjStart = new Int32Array(nodeCount + 1);
  for (let v = 0; v < nodeCount; v++) adjStart[v + 1] = adjStart[v]! + degree[v + 1]!;
  const fill = adjStart.slice(0, nodeCount);
  const adjEdge = new Int32Array(2 * edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    adjEdge[fill[edgeA[e]!]!++] = e;
    adjEdge[fill[edgeB[e]!]!++] = e;
  }

  const v2 = p.v === STREET_GRAPH_FORMAT_VERSION ? p : null;
  const flags = v2 ? Uint16Array.from(v2.flags) : new Uint16Array(edgeCount).fill(FLAG_WALK);
  const components = Object.fromEntries(
    MODES.map((mode) => [mode, findComponents(nodeCount, adjStart, adjEdge, edgeA, edgeB, (e) => modeDirs(flags[e]!, mode) !== 0)]),
  ) as WalkGraph["components"];

  const graph: WalkGraph = {
    version: p.v,
    roadSource: p.roadSource,
    bbox: [...p.bbox],
    nodeCount,
    edgeCount,
    nodeLat,
    nodeLng,
    edgeA,
    edgeB,
    edgeLenDm,
    flags,
    rules: v2 ? v2.rules.map((r) => ({ ...r, sourceCodes: [...r.sourceCodes] })) : [],
    areas: v2 ? v2.areas.map((a) => ({ ...a })) : [],
    places: v2 ? v2.places.map((r) => [...r]) : [],
    geomStart,
    geomLat,
    geomLng,
    adjStart,
    adjEdge,
    components,
    grid: { originLat: p.bbox[0] / E5, originLng: p.bbox[1] / E5, mPerDegLng: M_PER_DEG_LAT * Math.cos((((p.bbox[0] + p.bbox[2]) / 2 / E5) * Math.PI) / 180), cells: new Map() },
  };
  indexEdges(graph);
  return graph;
}

/** Components (BFS from the lowest unvisited node) over the edges `keep` accepts; the largest, ties to the lower id, is main. */
function findComponents(
  nodeCount: number, adjStart: Int32Array, adjEdge: Int32Array, edgeA: Int32Array, edgeB: Int32Array, keep: (e: number) => boolean,
): { id: Int32Array; main: number } {
  const id = new Int32Array(nodeCount).fill(-1);
  const queue = new Int32Array(nodeCount);
  let main = -1;
  let mainSize = 0;
  let next = 0;
  for (let s = 0; s < nodeCount; s++) {
    if (id[s] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    id[s] = next;
    let hasEdge = false;
    while (head < tail) {
      const v = queue[head++]!;
      for (let k = adjStart[v]!; k < adjStart[v + 1]!; k++) {
        const e = adjEdge[k]!;
        if (!keep(e)) continue;
        hasEdge = true;
        const w = edgeA[e] === v ? edgeB[e]! : edgeA[e]!;
        if (id[w] === -1) {
          id[w] = next;
          queue[tail++] = w;
        }
      }
    }
    if (!hasEdge) {
      id[s] = -1; // no edge of this mode: in no component
      continue;
    }
    if (tail > mainSize) {
      mainSize = tail;
      main = next;
    }
    next++;
  }
  return { id, main };
}

/** The payload a decoded graph came from (decode → encode is the identity). */
export function encodeWalkGraph(g: WalkGraph): WalkGraphPayload {
  const nodes: number[] = [];
  let pLat = 0;
  let pLng = 0;
  for (let i = 0; i < g.nodeCount; i++) {
    nodes.push(g.nodeLat[i]! - pLat, g.nodeLng[i]! - pLng);
    pLat = g.nodeLat[i]!;
    pLng = g.nodeLng[i]!;
  }
  const edges: number[] = [];
  const geom: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    const s = g.geomStart[e]!;
    const t = g.geomStart[e + 1]!;
    edges.push(g.edgeA[e]!, g.edgeB[e]!, g.edgeLenDm[e]!, t - s);
    let la = g.nodeLat[g.edgeA[e]!]!;
    let ln = g.nodeLng[g.edgeA[e]!]!;
    for (let k = s; k < t; k++) {
      geom.push(g.geomLat[k]! - la, g.geomLng[k]! - ln);
      la = g.geomLat[k]!;
      ln = g.geomLng[k]!;
    }
  }
  const base = { roadSource: g.roadSource, bbox: [...g.bbox] as [number, number, number, number], nodes, edges, geom };
  if (g.version === WALK_GRAPH_FORMAT_VERSION) return { v: WALK_GRAPH_FORMAT_VERSION, ...base };
  return {
    v: STREET_GRAPH_FORMAT_VERSION,
    ...base,
    flags: [...g.flags],
    rules: g.rules.map((r) => ({ ...r, sourceCodes: [...r.sourceCodes] })),
    areas: g.areas.map((a) => ({ ...a })),
    places: g.places.map((r) => [...r]),
  };
}

// --- Geometry helpers -------------------------------------------------------------------------

/** Edge polyline point k (0 = node a, last = node b), as E5 integers. */
function pointCount(g: WalkGraph, e: number): number {
  return g.geomStart[e + 1]! - g.geomStart[e]! + 2;
}
function pointLat(g: WalkGraph, e: number, k: number): number {
  if (k === 0) return g.nodeLat[g.edgeA[e]!]!;
  const n = pointCount(g, e);
  return k === n - 1 ? g.nodeLat[g.edgeB[e]!]! : g.geomLat[g.geomStart[e]! + k - 1]!;
}
function pointLng(g: WalkGraph, e: number, k: number): number {
  if (k === 0) return g.nodeLng[g.edgeA[e]!]!;
  const n = pointCount(g, e);
  return k === n - 1 ? g.nodeLng[g.edgeB[e]!]! : g.geomLng[g.geomStart[e]! + k - 1]!;
}
const pointLL = (g: WalkGraph, e: number, k: number): LatLng => ({ lat: pointLat(g, e, k) / E5, lng: pointLng(g, e, k) / E5 });
const nodeLL = (g: WalkGraph, v: number): LatLng => ({ lat: g.nodeLat[v]! / E5, lng: g.nodeLng[v]! / E5 });

function x(g: WalkGraph, lngE5: number): number {
  return (lngE5 / E5 - g.grid.originLng) * g.grid.mPerDegLng;
}
function y(g: WalkGraph, latE5: number): number {
  return (latE5 / E5 - g.grid.originLat) * M_PER_DEG_LAT;
}
const cellKey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

function indexEdges(g: WalkGraph): void {
  const { cells } = g.grid;
  for (let e = 0; e < g.edgeCount; e++) {
    const n = pointCount(g, e);
    for (let k = 1; k < n; k++) {
      const ax = x(g, pointLng(g, e, k - 1));
      const ay = y(g, pointLat(g, e, k - 1));
      const bx = x(g, pointLng(g, e, k));
      const by = y(g, pointLat(g, e, k));
      for (let cx = Math.floor(Math.min(ax, bx) / CELL_M); cx <= Math.floor(Math.max(ax, bx) / CELL_M); cx++) {
        for (let cy = Math.floor(Math.min(ay, by) / CELL_M); cy <= Math.floor(Math.max(ay, by) / CELL_M); cy++) {
          const key = cellKey(cx, cy);
          const list = cells.get(key);
          if (!list) cells.set(key, [e]);
          else if (list[list.length - 1] !== e) list.push(e);
        }
      }
    }
  }
}

/** Planar length (metres) of edge e's polyline, plus the projection of (px, py) onto it. */
function project(g: WalkGraph, e: number, px: number, py: number): { d2: number; seg: number; u: number; before: number; total: number } {
  const n = pointCount(g, e);
  let best = { d2: Infinity, seg: 1, u: 0, before: 0 };
  let total = 0;
  for (let k = 1; k < n; k++) {
    const ax = x(g, pointLng(g, e, k - 1));
    const ay = y(g, pointLat(g, e, k - 1));
    const dx = x(g, pointLng(g, e, k)) - ax;
    const dy = y(g, pointLat(g, e, k)) - ay;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + u * dx - px;
    const qy = ay + u * dy - py;
    const d2 = qx * qx + qy * qy;
    const len = Math.sqrt(len2);
    if (d2 < best.d2) best = { d2, seg: k, u, before: total + u * len };
    total += len;
  }
  return { ...best, total };
}

function snapWith(g: WalkGraph, p: LatLng, dirs: Uint8Array, comp: WalkGraph["components"][StreetMode], maxM: number): WalkSnap | null {
  if (g.edgeCount === 0) return null;
  const px = (p.lng - g.grid.originLng) * g.grid.mPerDegLng;
  const py = (p.lat - g.grid.originLat) * M_PER_DEG_LAT;
  const r = Math.ceil(maxM / CELL_M);
  const cx0 = Math.floor(px / CELL_M);
  const cy0 = Math.floor(py / CELL_M);
  const seen = new Set<number>();
  type Best = { e: number; d2: number; seg: number; u: number; before: number; total: number };
  let any: Best | null = null;
  let main: Best | null = null;
  const better = (c: Best, b: Best | null) => b === null || c.d2 < b.d2 || (c.d2 === b.d2 && c.e < b.e);
  for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
    for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
      for (const e of g.grid.cells.get(cellKey(cx, cy)) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (dirs[e] === 0) continue;
        const c = { e, ...project(g, e, px, py) };
        if (c.d2 > maxM * maxM) continue;
        if (better(c, any)) any = c;
        if (comp.id[g.edgeA[e]!] === comp.main && better(c, main)) main = c;
      }
    }
  }
  if (any === null) return null;
  const islandClose = Math.sqrt(any.d2) <= ISLAND_SNAP_M;
  const pick = main !== null && (!islandClose || any === main) ? main : any;
  const lenM = g.edgeLenDm[pick.e]! / 10;
  const a = pointLL(g, pick.e, pick.seg - 1);
  const b = pointLL(g, pick.e, pick.seg);
  const point = { lat: a.lat + pick.u * (b.lat - a.lat), lng: a.lng + pick.u * (b.lng - a.lng) };
  // Along-edge distance scaled to the stored length (≥ the polyline), so partial costs stay
  // consistent with whole edges.
  const alongM = pick.total === 0 ? 0 : Math.min(lenM, (pick.before / pick.total) * lenM);
  return { edge: pick.e, alongM, distM: Math.sqrt(pick.d2), point, seg: pick.seg };
}

/**
 * The snapped point for `p` within `maxM` metres on an edge the mode may use at `now`, or null.
 * Prefers the mode's largest component unless the nearest edge is on an island within
 * ISLAND_SNAP_M of `p` (and nearer than the main network). Ties go to the lower edge index.
 */
export function snapStreet(g: WalkGraph, p: LatLng, opts: StreetOptions, maxM: number = WALK_SNAP_M): WalkSnap | null {
  return snapWith(g, p, passable(g, opts), g.components[opts.mode], maxM);
}

const WALK_ANY_TIME: StreetOptions = { mode: "walk", now: new Date(0) };

/** snapStreet for walking. */
export function snapWalk(g: WalkGraph, p: LatLng, maxM: number = WALK_SNAP_M): WalkSnap | null {
  return snapStreet(g, p, WALK_ANY_TIME, maxM);
}

// --- Search -----------------------------------------------------------------------------------

/** Binary min-heap of (key, value) with lazy deletion. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  topKey(): number {
    return this.keys[0]!;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0]!;
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1]! < k[c]!) c++;
        if (k[c]! >= lastK) break;
        k[i] = k[c]!;
        v[i] = v[c]!;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

const SEED_A = -2;
const SEED_B = -3;
const AB = 1;
const BA = 2;
const len = (g: WalkGraph, e: number) => g.edgeLenDm[e]! / 10;

/**
 * Shortest-path search from a snapped start. `prevEdge[v]` is the edge into v, or SEED_A / SEED_B
 * for a node reached straight from the start along its edge (toward node a / node b).
 * `visit(v, d)` sees each settled node and returns the bound below which to keep going.
 */
function search(g: WalkGraph, dirs: Uint8Array, sf: WalkSnap, h: (v: number) => number, visit: (v: number, d: number) => number) {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const prevEdge = new Int32Array(g.nodeCount).fill(-1);
  const heap = new Heap();
  const seed = (v: number, d: number, side: number) => {
    if (d < dist[v]!) {
      dist[v] = d;
      prevEdge[v] = side;
      heap.push(d + h(v), v);
    }
  };
  if (dirs[sf.edge]! & BA) seed(g.edgeA[sf.edge]!, sf.alongM, SEED_A);
  if (dirs[sf.edge]! & AB) seed(g.edgeB[sf.edge]!, len(g, sf.edge) - sf.alongM, SEED_B);
  let bound = Infinity;
  while (heap.size > 0 && heap.topKey() < bound) {
    const fKey = heap.topKey();
    const v = heap.pop();
    const d = dist[v]!;
    if (fKey > d + h(v) + 1e-9) continue; // stale entry
    bound = visit(v, d);
    for (let k = g.adjStart[v]!; k < g.adjStart[v + 1]!; k++) {
      const e = g.adjEdge[k]!;
      if (g.edgeLenDm[e]! < 0) continue; // defensive: the schema refuses these
      const fromA = g.edgeA[e] === v;
      // A loop edge (a = b) appears twice; either direction it allows returns to v (never shorter).
      if (!(dirs[e]! & (fromA ? AB : BA))) continue;
      const w = fromA ? g.edgeB[e]! : g.edgeA[e]!;
      const nd = d + len(g, e);
      if (nd < dist[w]!) {
        dist[w] = nd;
        prevEdge[w] = e;
        heap.push(nd + h(w), w);
      }
    }
  }
  return { dist, prevEdge };
}

/** Cost from node `v` (at distance d) onto the snapped end, or Infinity when the mode cannot. */
function endCost(g: WalkGraph, dirs: Uint8Array, st: WalkSnap, v: number, d: number): { cost: number; side: "a" | "b" } {
  let best: { cost: number; side: "a" | "b" } = { cost: Infinity, side: "a" };
  if (v === g.edgeA[st.edge] && dirs[st.edge]! & AB) best = { cost: d + st.alongM, side: "a" };
  if (v === g.edgeB[st.edge] && dirs[st.edge]! & BA && d + len(g, st.edge) - st.alongM < best.cost) best = { cost: d + len(g, st.edge) - st.alongM, side: "b" };
  return best;
}

/** Cost along a shared edge from one snapped point to the other, or Infinity. */
function sameEdgeCost(dirs: Uint8Array, sf: WalkSnap, st: WalkSnap): number {
  if (sf.edge !== st.edge) return Infinity;
  const need = sf.alongM <= st.alongM ? AB : BA;
  return dirs[sf.edge]! & need || sf.alongM === st.alongM ? Math.abs(sf.alongM - st.alongM) : Infinity;
}

function straight(reason: WalkStraightReason, from: LatLng, to: LatLng): StreetRoute {
  return { kind: "straight", reason, coords: [from, to], straightM: haversineMeters(from, to) };
}

/** Shortest path for the mode from `from` to `to` at `now`, or a straight-line fallback with its reason. */
export function routeStreet(g: WalkGraph, from: LatLng, to: LatLng, opts: StreetOptions): StreetRoute {
  const comp = g.components[opts.mode];
  if (comp.main === -1) return straight("no_mode_data", from, to);
  const dirs = passable(g, opts);
  const sf = snapWith(g, from, dirs, comp, WALK_SNAP_M);
  if (!sf) return straight("no_edge_near_start", from, to);
  const st = snapWith(g, to, dirs, comp, WALK_SNAP_M);
  if (!st) return straight("no_edge_near_end", from, to);
  if (comp.id[g.edgeA[sf.edge]!] !== comp.id[g.edgeA[st.edge]!]) return straight("no_path", from, to);

  const target = st.point;
  const h = (v: number) => HEURISTIC_SCALE * haversineMeters(nodeLL(g, v), target);
  // best: end node of the graph part + 1, or 0 = along the shared edge.
  let bestCost = sameEdgeCost(dirs, sf, st);
  let bestEnd = bestCost < Infinity ? 0 : -1;
  let bestSide: "a" | "b" = "a";
  const { prevEdge } = search(g, dirs, sf, h, (v, d) => {
    const end = endCost(g, dirs, st, v, d);
    if (end.cost < bestCost) {
      bestCost = end.cost;
      bestEnd = v + 1;
      bestSide = end.side;
    }
    return bestCost;
  });
  if (bestEnd < 0) return straight("no_path", from, to);

  const coords: LatLng[] = [from, sf.point];
  const used: number[] = [];
  if (bestEnd === 0) {
    coords.push(...between(g, sf, st), st.point);
    if (bestCost > 0) used.push(sf.edge);
  } else {
    const end = bestEnd - 1;
    // Graph part: walk back from `end` to a seed node.
    const nodes: number[] = [end];
    const edges: number[] = [];
    for (let v = end; prevEdge[v]! >= 0; ) {
      const e = prevEdge[v]!;
      edges.push(e);
      v = g.edgeA[e] === v ? g.edgeB[e]! : g.edgeA[e]!;
      nodes.push(v);
    }
    nodes.reverse();
    edges.reverse();
    const side = prevEdge[nodes[0]!] === SEED_A ? "a" : "b";
    if ((side === "a" ? sf.alongM : len(g, sf.edge) - sf.alongM) > 0) used.push(sf.edge);
    used.push(...edges);
    if ((bestSide === "a" ? st.alongM : len(g, st.edge) - st.alongM) > 0) used.push(st.edge);
    coords.push(...partial(g, sf, side));
    for (let i = 0; i < edges.length; i++) coords.push(...edgePoints(g, edges[i]!, nodes[i]!));
    coords.push(...partial(g, st, bestSide).reverse(), st.point);
  }
  coords.push(to);

  const usedRules = new Set<string>();
  let usesNationalRoad = false;
  for (const e of used) {
    const f = g.flags[e]!;
    if (opts.mode === "tricycle" && f >> FLAG_RULE_SHIFT > 0) usedRules.add(g.rules[(f >> FLAG_RULE_SHIFT) - 1]!.code);
    if (f & FLAG_NATIONAL) usesNationalRoad = true;
  }
  const snapFromM = haversineMeters(from, sf.point);
  const snapToM = haversineMeters(st.point, to);
  return {
    kind: "path",
    coords: dedupe(coords),
    lengthM: bestCost + snapFromM + snapToM,
    snapFromM,
    snapToM,
    usedRules: [...usedRules].sort(),
    usesNationalRoad,
  };
}

/** Shortest walk from `from` to `to` (routeStreet in the walk mode). */
export function routeWalk(g: WalkGraph, from: LatLng, to: LatLng): StreetRoute {
  return routeStreet(g, from, to, WALK_ANY_TIME);
}

/**
 * One Dijkstra from `from` over the mode's edges at `now`, settled up to `radiusM` graph metres
 * (the snap legs not counted). The lookup gives, for any point, the length routeStreet returns
 * (snap legs included), or null when either end does not snap, it is unreachable, or its graph
 * part is over the radius.
 */
export function boundedDistances(g: WalkGraph, from: LatLng, radiusM: number, mode: StreetMode, now: Date = new Date(0)): (to: LatLng) => number | null {
  const opts = { mode, now };
  const comp = g.components[mode];
  const dirs = passable(g, opts);
  const sf = comp.main === -1 ? null : snapWith(g, from, dirs, comp, WALK_SNAP_M);
  if (!sf) return () => null;
  const { dist } = search(g, dirs, sf, () => 0, () => radiusM + 1e-9);
  const snapFromM = haversineMeters(from, sf.point);
  return (to) => {
    const st = snapWith(g, to, dirs, comp, WALK_SNAP_M);
    if (!st || comp.id[g.edgeA[st.edge]!] !== comp.id[g.edgeA[sf.edge]!]) return null;
    const a = g.edgeA[st.edge]!;
    const b = g.edgeB[st.edge]!;
    const cost = Math.min(sameEdgeCost(dirs, sf, st), endCost(g, dirs, st, a, dist[a]!).cost, endCost(g, dirs, st, b, dist[b]!).cost);
    return cost < Infinity && cost <= radiusM ? cost + snapFromM + haversineMeters(st.point, to) : null;
  };
}

/**
 * Indices of every padyak area with an anchor within the area's effective radius of `p`, ascending.
 * A point may be in several areas; a padyak trip needs one area shared by both ends.
 */
export function padyakAreas(g: WalkGraph, p: LatLng): number[] {
  const hits = new Set<number>();
  for (const [, lat, lng, area] of g.places) {
    if (area >= 0 && haversineMeters(p, { lat: lat / E5, lng: lng / E5 }) <= g.areas[area]!.radiusM) hits.add(area);
  }
  return [...hits].sort((a, b) => a - b);
}

export type PadyakAreaCoverage = {
  code: string;
  radiusM: number;
  /** Sample points whose nearest anchor (of any area) lies within PADYAK_AREA_RADIUS_M and belongs to this area. */
  inside: number;
  /** Of those, the points padyakAreas assigns to this area (recall = resolved / inside). */
  resolved: number;
  /** Points assigned to this area whose nearest anchor within PADYAK_AREA_RADIUS_M is another area's, or none. */
  falsePositives: number;
};

/** Per padyak area, recall and false positives of padyakAreas over `points` (for the import dry run). */
export function padyakAreaCoverage(g: WalkGraph, points: readonly LatLng[]): PadyakAreaCoverage[] {
  const out = g.areas.map((a) => ({ code: a.code, radiusM: a.radiusM, inside: 0, resolved: 0, falsePositives: 0 }));
  for (const p of points) {
    let truth = -1;
    let bestM = PADYAK_AREA_RADIUS_M;
    for (const [, lat, lng, area] of g.places) {
      const m = haversineMeters(p, { lat: lat / E5, lng: lng / E5 });
      if (area >= 0 && m <= bestM) [truth, bestM] = [area, m];
    }
    const assigned = padyakAreas(g, p);
    if (truth >= 0) {
      out[truth]!.inside++;
      if (assigned.includes(truth)) out[truth]!.resolved++;
    }
    for (const a of assigned) if (a !== truth) out[a]!.falsePositives++;
  }
  return out;
}

/** Points of edge e walked from node `fromNode`, excluding that node, including the far node. */
function edgePoints(g: WalkGraph, e: number, fromNode: number): LatLng[] {
  const n = pointCount(g, e);
  const out: LatLng[] = [];
  if (g.edgeA[e] === fromNode) for (let k = 1; k < n; k++) out.push(pointLL(g, e, k));
  else for (let k = n - 2; k >= 0; k--) out.push(pointLL(g, e, k));
  return out;
}

/** Points from the snapped point (excluded) to the edge's node `end` (included). */
function partial(g: WalkGraph, s: WalkSnap, end: "a" | "b"): LatLng[] {
  const n = pointCount(g, s.edge);
  const out: LatLng[] = [];
  if (end === "a") for (let k = s.seg - 1; k >= 0; k--) out.push(pointLL(g, s.edge, k));
  else for (let k = s.seg; k < n; k++) out.push(pointLL(g, s.edge, k));
  return out;
}

/** Polyline vertices strictly between two snapped points on the same edge, in walking order. */
function between(g: WalkGraph, s: WalkSnap, t: WalkSnap): LatLng[] {
  const out: LatLng[] = [];
  if (s.alongM <= t.alongM) for (let k = s.seg; k <= t.seg - 1; k++) out.push(pointLL(g, s.edge, k));
  else for (let k = s.seg - 1; k >= t.seg; k--) out.push(pointLL(g, s.edge, k));
  return out;
}

function dedupe(coords: LatLng[]): LatLng[] {
  return coords.filter((c, i) => i === 0 || c.lat !== coords[i - 1]!.lat || c.lng !== coords[i - 1]!.lng);
}
