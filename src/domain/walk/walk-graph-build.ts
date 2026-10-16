// Walk graph builder (import side): walk-profile road graph → compact payload v1 (format.ts).
//
//   1. The D7 filters are the road graph's walk profile (road-graph.ts); a vehicle graph is refused.
//   2. Components (union-find over the undirected pieces): the largest one plus every component of
//      more than `minComponentNodes` (default 50) road-graph nodes is kept; smaller islands are
//      dropped and counted.
//   3. Degree-2 contraction: a node with exactly two piece ends (not one self-loop) is folded into
//      the edge polyline; a ring with no junction keeps its lowest node and becomes a loop edge.
//   4. Precision 5: every coordinate is rounded to integer degrees × 1e5. Consecutive duplicate
//      points are dropped. Edge length (decimetres) is the original haversine length, but never
//      less than the haversine length of the rounded polyline (keeps the A* heuristic admissible).
//   5. Deterministic order: nodes by (lat, lng, road-graph index); edges oriented a ≤ b (a loop
//      takes the lexicographically smaller direction) and sorted by (a, b, length, geometry).
//
// Pure: no fs, no DB.
import { haversineMeters } from "../geo/geometry";
import type { RoadGraph } from "../geo/road-graph";
import type { LatLng } from "../geo/types";
import { WALK_GRAPH_FORMAT_VERSION, type WalkGraphPayload } from "./format";

export const DEFAULT_MIN_COMPONENT_NODES = 50;

export type WalkGraphBuildStats = {
  /** Nodes and undirected edges in the payload (after contraction). */
  nodes: number;
  edges: number;
  /** Connected components of the walk road graph, before filtering. */
  components: number;
  keptComponents: number;
  droppedComponents: number;
  /** Road-graph nodes and metres in the dropped components. */
  droppedNodes: number;
  droppedLengthM: number;
  keptLengthM: number;
};

export type WalkGraphBuild = { payload: WalkGraphPayload; stats: WalkGraphBuildStats };

type Chain = { a: number; b: number; coords: LatLng[]; lengthM: number };
type RoundedEdge = { a: number; b: number; lengthDm: number; pts: [number, number][] };

const E5 = 1e5;
const toE5 = (p: LatLng): [number, number] => [Math.round(p.lat * E5), Math.round(p.lng * E5)];
const fromE5 = ([lat, lng]: readonly [number, number]): LatLng => ({ lat: lat / E5, lng: lng / E5 });

export function buildWalkGraph(
  road: Pick<RoadGraph, "profile" | "nodes" | "edges">,
  options: { roadSource: string; minComponentNodes?: number },
): WalkGraphBuild {
  if (road.profile !== "walk") throw new Error(`buildWalkGraph: needs the walk profile, got "${road.profile}"`);
  const minNodes = options.minComponentNodes ?? DEFAULT_MIN_COMPONENT_NODES;
  const n = road.nodes.length;

  // Undirected pieces: the way-order edge of each two-way pair (walk edges always have a twin).
  const pieces = road.edges.filter((e) => e.twin === null || !e.reverse);

  // 2. Components.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const touched = new Array<boolean>(n).fill(false);
  for (const p of pieces) {
    touched[p.from] = touched[p.to] = true;
    const ra = find(p.from);
    const rb = find(p.to);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // root = lowest node index
  }
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) if (touched[i]) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let largest = -1;
  for (const [root, s] of size) if (largest < 0 || s > size.get(largest)! || (s === size.get(largest)! && root < largest)) largest = root;
  const keepRoot = (root: number) => root === largest || size.get(root)! > minNodes;
  let droppedNodes = 0;
  let droppedComponents = 0;
  for (const [root, s] of size) {
    if (keepRoot(root)) continue;
    droppedComponents++;
    droppedNodes += s;
  }
  let droppedLengthM = 0;
  let keptLengthM = 0;
  const kept = pieces.filter((p) => {
    const keep = keepRoot(find(p.from));
    if (keep) keptLengthM += p.lengthM;
    else droppedLengthM += p.lengthM;
    return keep;
  });

  // 3. Degree-2 contraction.
  const incident: number[][] = Array.from({ length: n }, () => []);
  kept.forEach((p, i) => {
    incident[p.from]!.push(i);
    incident[p.to]!.push(i);
  });
  const isKeep = (v: number) => {
    const inc = incident[v]!;
    return inc.length > 0 && (inc.length !== 2 || inc[0] === inc[1]);
  };
  const used = new Array<boolean>(kept.length).fill(false);
  const chains: Chain[] = [];
  const walk = (start: number, first: number) => {
    let at = start;
    let piece = first;
    const coords: LatLng[] = [{ lat: road.nodes[start]!.lat, lng: road.nodes[start]!.lng }];
    let lengthM = 0;
    for (;;) {
      used[piece] = true;
      const p = kept[piece]!;
      const forward = p.from === at;
      const pc = forward ? p.coords : [...p.coords].reverse();
      coords.push(...pc.slice(1));
      lengthM += p.lengthM;
      at = forward ? p.to : p.from;
      if (at === start || isKeep(at)) break;
      const next = incident[at]!.find((q) => q !== piece);
      if (next === undefined || used[next]) break;
      piece = next;
    }
    chains.push({ a: start, b: at, coords, lengthM });
  };
  const keepNodes = new Set<number>();
  for (let v = 0; v < n; v++) {
    if (!isKeep(v)) continue;
    keepNodes.add(v);
    for (const i of incident[v]!) if (!used[i]) walk(v, i);
  }
  // Rings with no junction: start at their lowest node.
  for (let v = 0; v < n; v++) {
    for (const i of incident[v]!) {
      if (used[i]) continue;
      keepNodes.add(v);
      walk(v, i);
    }
  }

  // 4. Rounding and 5. ordering.
  const order = [...keepNodes].map((v) => ({ v, e5: toE5(road.nodes[v]!) }));
  order.sort((x, y) => x.e5[0] - y.e5[0] || x.e5[1] - y.e5[1] || x.v - y.v);
  const newIndex = new Map(order.map((o, i) => [o.v, i]));

  const rounded: RoundedEdge[] = chains.map((c) => {
    const ends = [toE5(c.coords[0]!), toE5(c.coords[c.coords.length - 1]!)];
    const pts: [number, number][] = [];
    let prev = ends[0]!;
    for (const q of c.coords.slice(1, -1).map(toE5)) {
      if (q[0] === prev[0] && q[1] === prev[1]) continue;
      pts.push(q);
      prev = q;
    }
    const last = pts[pts.length - 1];
    if (last && last[0] === ends[1]![0] && last[1] === ends[1]![1]) pts.pop();
    const line = [ends[0]!, ...pts, ends[1]!].map(fromE5);
    let roundedM = 0;
    for (let i = 1; i < line.length; i++) roundedM += haversineMeters(line[i - 1]!, line[i]!);
    const lengthDm = Math.max(Math.round(c.lengthM * 10), Math.ceil(roundedM * 10 - 1e-9));
    let a = newIndex.get(c.a)!;
    let b = newIndex.get(c.b)!;
    let geometry = pts;
    if (a > b || (a === b && compareSeq([...pts].reverse(), pts) < 0)) {
      [a, b] = [b, a];
      geometry = [...pts].reverse();
    }
    return { a, b, lengthDm, pts: geometry };
  });
  rounded.sort((x, y) => x.a - y.a || x.b - y.b || x.lengthDm - y.lengthDm || compareSeq(x.pts, y.pts));

  // Encode.
  const nodes: number[] = [];
  let pLat = 0;
  let pLng = 0;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  const extend = ([lat, lng]: readonly [number, number]) => {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  };
  for (const { e5 } of order) {
    nodes.push(e5[0] - pLat, e5[1] - pLng);
    [pLat, pLng] = e5;
    extend(e5);
  }
  const edges: number[] = [];
  const geom: number[] = [];
  for (const e of rounded) {
    edges.push(e.a, e.b, e.lengthDm, e.pts.length);
    let prev = order[e.a]!.e5;
    for (const q of e.pts) {
      geom.push(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
      extend(q);
    }
  }
  const bbox: [number, number, number, number] = order.length === 0 ? [0, 0, 0, 0] : [south, west, north, east];

  return {
    payload: { v: WALK_GRAPH_FORMAT_VERSION, roadSource: options.roadSource, bbox, nodes, edges, geom },
    stats: {
      nodes: order.length,
      edges: rounded.length,
      components: size.size,
      keptComponents: size.size - droppedComponents,
      droppedComponents,
      droppedNodes,
      droppedLengthM,
      keptLengthM,
    },
  };
}

function compareSeq(x: readonly (readonly [number, number])[], y: readonly (readonly [number, number])[]): number {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]![0] - y[i]![0] || x[i]![1] - y[i]![1];
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
