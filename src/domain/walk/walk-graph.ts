// On-device walk routing over the serialized walk graph (format.ts): decode, grid index, snap, A*.
//
//   parseWalkGraph(json)   Zod-checked decode; never throws.
//   snapWalk(g, p)         nearest edge within 100 m (WALK_SNAP_M), preferring the largest
//                          connected component: an island edge wins only when the point is within
//                          ISLAND_SNAP_M (5 m) of it and nearer than the main network.
//   routeWalk(g, from, to) A* (haversine heuristic over the node coordinates, scaled by 0.999 so it
//                          stays a lower bound) from the snapped start, including the partial edges
//                          at both snapped points. Returns the path with its length (the two snap
//                          legs included), or a straight-line fallback with its reason.
//
// Walk lines are approximate (crossings not checked); the UI labels them. Pure: no fs, no DB.
import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";
import { walkGraphPayloadSchema, WALK_GRAPH_FORMAT_VERSION, type WalkGraphPayload } from "./format";

export const WALK_SNAP_M = 100;
export const ISLAND_SNAP_M = 5;
const CELL_M = 100;
const E5 = 1e5;
const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;
const HEURISTIC_SCALE = 0.999;

export type WalkGraph = {
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
  /** Edge e's intermediate points are geomLat/geomLng[geomStart[e] … geomStart[e+1]) (absolute E5). */
  geomStart: Int32Array;
  geomLat: Int32Array;
  geomLng: Int32Array;
  /** Incident edges of node v: adjEdge[adjStart[v] … adjStart[v+1]) (a loop appears twice). */
  adjStart: Int32Array;
  adjEdge: Int32Array;
  /** Connected component per node; the largest one is `mainComponent`. */
  component: Int32Array;
  mainComponent: number;
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

export type WalkStraightReason = "no_edge_near_start" | "no_edge_near_end" | "no_path";

export type WalkRoute =
  | { kind: "path"; coords: LatLng[]; lengthM: number; snapFromM: number; snapToM: number }
  /** No street path: draw a straight dotted line `coords` (from → to), labelled so. */
  | { kind: "straight"; reason: WalkStraightReason; coords: LatLng[]; straightM: number };

export type ParsedWalkGraph = { ok: true; graph: WalkGraph } | { ok: false; error: string };

/** Validates (Zod, structural checks) and decodes a fetched or cached payload. Never throws. */
export function parseWalkGraph(json: unknown): ParsedWalkGraph {
  const parsed = walkGraphPayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return { ok: true, graph: decodeWalkGraph(parsed.data) };
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

  // Components (BFS from the lowest unvisited node); the largest, ties to the lower id, is main.
  const component = new Int32Array(nodeCount).fill(-1);
  const queue = new Int32Array(nodeCount);
  let mainComponent = -1;
  let mainSize = 0;
  let id = 0;
  for (let s = 0; s < nodeCount; s++) {
    if (component[s] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    component[s] = id;
    while (head < tail) {
      const v = queue[head++]!;
      for (let k = adjStart[v]!; k < adjStart[v + 1]!; k++) {
        const e = adjEdge[k]!;
        const w = edgeA[e] === v ? edgeB[e]! : edgeA[e]!;
        if (component[w] === -1) {
          component[w] = id;
          queue[tail++] = w;
        }
      }
    }
    if (tail > mainSize) {
      mainSize = tail;
      mainComponent = id;
    }
    id++;
  }

  const graph: WalkGraph = {
    roadSource: p.roadSource,
    bbox: [...p.bbox],
    nodeCount,
    edgeCount,
    nodeLat,
    nodeLng,
    edgeA,
    edgeB,
    edgeLenDm,
    geomStart,
    geomLat,
    geomLng,
    adjStart,
    adjEdge,
    component,
    mainComponent,
    grid: { originLat: p.bbox[0] / E5, originLng: p.bbox[1] / E5, mPerDegLng: M_PER_DEG_LAT * Math.cos((((p.bbox[0] + p.bbox[2]) / 2 / E5) * Math.PI) / 180), cells: new Map() },
  };
  indexEdges(graph);
  return graph;
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
  return { v: WALK_GRAPH_FORMAT_VERSION, roadSource: g.roadSource, bbox: [...g.bbox], nodes, edges, geom };
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

/**
 * The snapped point for `p` within `maxM` metres, or null. Prefers the largest component unless
 * the nearest edge is on an island within ISLAND_SNAP_M of `p` (and nearer than the main network).
 * Ties go to the lower edge index.
 */
export function snapWalk(g: WalkGraph, p: LatLng, maxM: number = WALK_SNAP_M): WalkSnap | null {
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
        const c = { e, ...project(g, e, px, py) };
        if (c.d2 > maxM * maxM) continue;
        if (better(c, any)) any = c;
        if (g.component[g.edgeA[e]!] === g.mainComponent && better(c, main)) main = c;
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

// --- A* ---------------------------------------------------------------------------------------

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

function straight(reason: WalkStraightReason, from: LatLng, to: LatLng): WalkRoute {
  return { kind: "straight", reason, coords: [from, to], straightM: haversineMeters(from, to) };
}

/** Shortest walk from `from` to `to` on the graph, or a straight-line fallback with its reason. */
export function routeWalk(g: WalkGraph, from: LatLng, to: LatLng): WalkRoute {
  const sf = snapWalk(g, from);
  if (!sf) return straight("no_edge_near_start", from, to);
  const st = snapWalk(g, to);
  if (!st) return straight("no_edge_near_end", from, to);
  if (g.component[g.edgeA[sf.edge]!] !== g.component[g.edgeA[st.edge]!]) return straight("no_path", from, to);

  const len = (e: number) => g.edgeLenDm[e]! / 10;
  const target = st.point;
  const h = (v: number) => HEURISTIC_SCALE * haversineMeters(nodeLL(g, v), target);
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const prevEdge = new Int32Array(g.nodeCount).fill(-1);
  const heap = new Heap();
  const seed = (v: number, d: number) => {
    if (d < dist[v]!) {
      dist[v] = d;
      heap.push(d + h(v), v);
    }
  };
  seed(g.edgeA[sf.edge]!, sf.alongM);
  seed(g.edgeB[sf.edge]!, len(sf.edge) - sf.alongM);

  // best: 0 = along the shared edge, otherwise the end node of the graph part (+1 so 0 is free).
  let bestCost = Infinity;
  let bestEnd = -1;
  let bestSide: "a" | "b" = "a";
  if (sf.edge === st.edge) {
    bestCost = Math.abs(sf.alongM - st.alongM);
    bestEnd = 0;
  }
  const ta = g.edgeA[st.edge]!;
  const tb = g.edgeB[st.edge]!;
  while (heap.size > 0 && heap.topKey() < bestCost) {
    const fKey = heap.topKey();
    const v = heap.pop();
    const d = dist[v]!;
    if (fKey > d + h(v) + 1e-9) continue; // stale entry
    if (v === ta && d + st.alongM < bestCost) {
      bestCost = d + st.alongM;
      bestEnd = v + 1;
      bestSide = "a";
    }
    if (v === tb && d + len(st.edge) - st.alongM < bestCost) {
      bestCost = d + len(st.edge) - st.alongM;
      bestEnd = v + 1;
      bestSide = "b";
    }
    for (let k = g.adjStart[v]!; k < g.adjStart[v + 1]!; k++) {
      const e = g.adjEdge[k]!;
      const w = g.edgeA[e] === v ? g.edgeB[e]! : g.edgeA[e]!;
      const nd = d + len(e);
      if (nd < dist[w]!) {
        dist[w] = nd;
        prevEdge[w] = e;
        heap.push(nd + h(w), w);
      }
    }
  }
  if (bestEnd < 0) return straight("no_path", from, to);

  const coords: LatLng[] = [from, sf.point];
  if (bestEnd === 0) {
    coords.push(...between(g, sf, st), st.point);
  } else {
    const end = bestEnd - 1;
    // Graph part: walk back from `end` to a seed node (prevEdge -1).
    const nodes: number[] = [end];
    const edges: number[] = [];
    for (let v = end; prevEdge[v] !== -1; ) {
      const e = prevEdge[v]!;
      edges.push(e);
      v = g.edgeA[e] === v ? g.edgeB[e]! : g.edgeA[e]!;
      nodes.push(v);
    }
    nodes.reverse();
    edges.reverse();
    const start = nodes[0]!;
    coords.push(...partial(g, sf, start === g.edgeA[sf.edge] && dist[start] === sf.alongM ? "a" : "b"));
    for (let i = 0; i < edges.length; i++) coords.push(...edgePoints(g, edges[i]!, nodes[i]!));
    coords.push(...partial(g, st, bestSide).reverse(), st.point);
  }
  coords.push(to);

  const snapFromM = haversineMeters(from, sf.point);
  const snapToM = haversineMeters(st.point, to);
  return { kind: "path", coords: dedupe(coords), lengthM: bestCost + snapFromM + snapToM, snapFromM, snapToM };
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
