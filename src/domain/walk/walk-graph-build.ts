// Street graph builder (import side): road graph → compact payload (format.ts).
//
//   buildWalkGraph(walkRoadGraph)          → v1 (walk only).
//   buildStreetGraph(roads, rules, areas)  → v2: the union of walk- and tricycle-profile ways
//                                            (road-graph.ts "street") with per-edge flags, the
//                                            tricycle restriction rules and the padyak area anchors.
//
//   1. The D7 filters are the road graph's walk profile (road-graph.ts); a vehicle graph is refused.
//   2. Components (union-find over the undirected pieces): the largest one plus every component of
//      more than `minComponentNodes` (default 50) road-graph nodes is kept; smaller islands are
//      dropped and counted.
//   3. Degree-2 contraction: a node with exactly two piece ends (not one self-loop) whose two pieces
//      carry the same flags (oriented through the node) is folded into the edge polyline; a ring
//      with no junction keeps its lowest node and becomes a loop edge.
//   4. Precision 5: every coordinate is rounded to integer degrees × 1e5. Consecutive duplicate
//      points are dropped. Edge length (decimetres) is the original haversine length, but never
//      less than the haversine length of the rounded polyline (keeps the A* heuristic admissible).
//   5. Deterministic order: nodes by (lat, lng, road-graph index); edges oriented a ≤ b (a loop
//      takes the lexicographically smaller direction; the tricycle direction bits swap with it) and
//      sorted by (a, b, length, geometry, flags).
//
// v2 rules (plan E §C): a reviewed `exclude` record of a tricycle rule marks the edges of its ways
// (clipped between its clip nodes) with the rule's index + 1, unless an `exempt` record of the same
// rule covers them (exempt crossings stay usable at all hours; a junction exemption is a single
// node, which no restricted edge needs). Padyak `exclude` records set the padyak-banned bit; a drawn
// padyak rule with an hours exception cannot be carried and is refused. Records with no geometry
// (not_mapped) mark nothing. A listed way absent from the snapshot aborts the build.
//
// Padyak areas (controller ruling, Task 3): anchors of neighbouring areas sit 345–670 m apart, so
// each area gets an effective radius min(seed radiusM ?? 1,000, max(250, 0.6 × distance from its
// anchors to the nearest anchor of any other area)), rounded down to whole metres.
//
// Pure: no fs, no DB.
import { haversineMeters } from "../geo/geometry";
import { buildRoadGraph, wayDirections, wayIncluded, type RoadEdge, type RoadGraph } from "../geo/road-graph";
import type { LatLng } from "../geo/types";
import type { ModesSeedPadyakArea, ModesSeedRoadRule } from "../import/modes-seed";
import type { OsmRoads } from "../import/osm-roads";
import {
  FLAG_NATIONAL, FLAG_PADYAK_BANNED, FLAG_PADYAK_CLASS, FLAG_RULE_SHIFT, FLAG_TRI_AB, FLAG_TRI_BA, FLAG_WALK,
  STREET_GRAPH_FORMAT_VERSION, WALK_GRAPH_FORMAT_VERSION, type StreetGraphPayload, type WalkGraphPayload,
} from "./format";
import { STREET_RULE_LABELS, type StreetRule } from "./rules";

export const DEFAULT_MIN_COMPONENT_NODES = 50;
/** Recorded with every stored walk graph (transit.walk_graph_version.builder_version). */
export const WALK_GRAPH_BUILDER_VERSION = "walk-graph-build/1";
export const STREET_GRAPH_BUILDER_VERSION = "street-graph-build/2";

export const PADYAK_MAX_RADIUS_M = 1000;
export const PADYAK_MIN_RADIUS_M = 250;
const NATIONAL = new Set(["trunk", "primary", "trunk_link", "primary_link"]);
/** Padyak road classes (plan E §C): the tricycle classes plus small streets and tracks. */
const PADYAK_CLASSES = new Set([
  "trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
  "unclassified", "residential", "service", "living_street", "track",
]);

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

type Chain = { a: number; b: number; coords: LatLng[]; lengthM: number; flags: number };
type RoundedEdge = { a: number; b: number; lengthDm: number; pts: [number, number][]; flags: number };
type Place = [number, number, number, number];
type V2Extras = { flagOf: (piece: RoadEdge) => number; rules: StreetRule[]; areas: { code: string; radiusM: number }[]; places: Place[] };
type BuildOptions = { roadSource: string; minComponentNodes?: number };

const E5 = 1e5;
const toE5 = (p: LatLng): [number, number] => [Math.round(p.lat * E5), Math.round(p.lng * E5)];
const fromE5 = ([lat, lng]: readonly [number, number]): LatLng => ({ lat: lat / E5, lng: lng / E5 });
/** Flags of a piece walked against its stored direction: the tricycle a→b / b→a bits swap. */
const turn = (f: number) => (f & ~(FLAG_TRI_AB | FLAG_TRI_BA)) | ((f & FLAG_TRI_AB) << 1) | ((f & FLAG_TRI_BA) >> 1);
const byCode = (x: { code: string }, y: { code: string }) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0);

export function buildWalkGraph(road: Pick<RoadGraph, "profile" | "nodes" | "edges">, options: BuildOptions): WalkGraphBuild {
  if (road.profile !== "walk") throw new Error(`buildWalkGraph: needs the walk profile, got "${road.profile}"`);
  return build(road, options, null);
}

/** Street graph v2 from the road snapshot, the reviewed road rules and padyak areas (imported records only). */
export function buildStreetGraph(
  roads: Pick<OsmRoads, "ways" | "nodes" | "places">,
  rules: readonly ModesSeedRoadRule[],
  areas: readonly ModesSeedPadyakArea[],
  options: BuildOptions,
): { payload: StreetGraphPayload; stats: WalkGraphBuildStats } {
  const ways = new Map(roads.ways.map((w) => [w.id, w]));
  const imported = rules.filter((r) => r.review.decision === "import");
  const drawn = imported.filter((r) => r.geometry === "ways");
  for (const r of drawn) for (const id of r.wayIds) if (!ways.has(id)) throw new Error(`buildStreetGraph: rule ${r.code}: way/${id} is not in the road snapshot`);
  for (const r of drawn) {
    if (r.appliesTo[0] === "padyak" && r.kind === "exclude" && r.exceptWindow !== null) throw new Error(`buildStreetGraph: padyak rule ${r.code} has hours, which the graph cannot carry`);
  }
  const splitAt = new Set(drawn.flatMap((r) => r.clips.flatMap((c) => [c.fromNodeId, c.toNodeId])));
  const road = buildRoadGraph(roads, { profile: "street", splitAt });

  // Tricycle restrictions: one payload rule per rule code, sorted.
  const triCodes = [...new Set(imported.filter((r) => r.appliesTo[0] === "tricycle" && r.kind === "exclude").map((r) => r.ruleCode))].sort();
  const streetRules: StreetRule[] = triCodes.map((code) => {
    const records = imported.filter((r) => r.ruleCode === code && r.kind === "exclude");
    if (new Set(records.map((r) => JSON.stringify(r.exceptWindow))).size !== 1) throw new Error(`buildStreetGraph: rule ${code}: its records disagree on the hours exception`);
    const label = STREET_RULE_LABELS[code];
    if (!label) throw new Error(`buildStreetGraph: rule ${code} has no label`);
    const w = records[0]!.exceptWindow;
    return { code, label, sourceCodes: [...new Set(records.flatMap((r) => r.sourceCodes))].sort(), liftedFrom: w?.from ?? null, liftedTo: w?.to ?? null };
  });

  // A record covers a piece (way order) on its ways, inside the clip when the way is clipped.
  const covers = (r: ModesSeedRoadRule, e: RoadEdge) => {
    if (!r.wayIds.includes(e.wayId)) return false;
    const clip = r.clips.find((c) => c.wayId === e.wayId);
    if (!clip) return true;
    const ids = ways.get(e.wayId)!.nodeIds;
    const [i, j] = [ids.indexOf(clip.fromNodeId), ids.indexOf(clip.toNodeId)];
    return ids.indexOf(road.nodes[e.from]!.osmId) >= Math.min(i, j) && ids.lastIndexOf(road.nodes[e.to]!.osmId) <= Math.max(i, j);
  };
  const flagOf = (e: RoadEdge) => {
    const way = ways.get(e.wayId)!;
    const walk = wayIncluded(way, "walk");
    const tri = wayIncluded(way, "tricycle") ? wayDirections(way, "tricycle") : { forward: false, backward: false };
    let f = (walk ? FLAG_WALK : 0) | (tri.forward ? FLAG_TRI_AB : 0) | (tri.backward ? FLAG_TRI_BA : 0);
    if (NATIONAL.has(way.tags.highway)) f |= FLAG_NATIONAL;
    if (walk && PADYAK_CLASSES.has(way.tags.highway)) f |= FLAG_PADYAK_CLASS;
    if (drawn.some((r) => r.appliesTo[0] === "padyak" && r.kind === "exclude" && covers(r, e))) f |= FLAG_PADYAK_BANNED;
    if (tri.forward || tri.backward) {
      const i = triCodes.findIndex((code) => {
        const mine = drawn.filter((r) => r.ruleCode === code && covers(r, e));
        return mine.some((r) => r.kind === "exclude") && !mine.some((r) => r.kind === "exempt");
      });
      if (i >= 0) f |= (i + 1) << FLAG_RULE_SHIFT;
    }
    return f;
  };

  // Padyak areas (sorted by code) and their anchor place nodes, one row per membership.
  const placeById = new Map(roads.places.map((p) => [p.id, p]));
  const areaList = areas.filter((a) => a.review.decision === "import").sort(byCode);
  const places: Place[] = [];
  areaList.forEach((a, i) => {
    for (const id of a.placeNodeIds) {
      const p = placeById.get(id);
      if (!p) throw new Error(`buildStreetGraph: padyak area ${a.code}: node/${id} is not a place node in the snapshot`);
      places.push([id, ...toE5(p), i]);
    }
  });
  places.sort((x, y) => x[0] - y[0] || x[3] - y[3]);
  const anchor = ([, lat, lng]: Place) => fromE5([lat, lng]);
  const areaRows = areaList.map((a, i) => {
    let nearestOtherM = Infinity;
    for (const p of places) if (p[3] === i) for (const q of places) if (q[3] !== i) nearestOtherM = Math.min(nearestOtherM, haversineMeters(anchor(p), anchor(q)));
    const radiusM = Math.floor(Math.min(a.radiusM ?? PADYAK_MAX_RADIUS_M, Math.max(PADYAK_MIN_RADIUS_M, 0.6 * nearestOtherM)));
    return { code: a.code, radiusM };
  });

  return build(road, options, { flagOf, rules: streetRules, areas: areaRows, places }) as { payload: StreetGraphPayload; stats: WalkGraphBuildStats };
}

function build(road: Pick<RoadGraph, "profile" | "nodes" | "edges">, options: BuildOptions, v2: V2Extras | null): WalkGraphBuild {
  const minNodes = options.minComponentNodes ?? DEFAULT_MIN_COMPONENT_NODES;
  const n = road.nodes.length;

  // Undirected pieces: the way-order edge of each two-way pair (walk and street edges always have a twin).
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

  // 3. Degree-2 contraction (only through nodes where the flags continue unchanged).
  const flags = kept.map((p) => (v2 ? v2.flagOf(p) : 0));
  const incident: number[][] = Array.from({ length: n }, () => []);
  kept.forEach((p, i) => {
    incident[p.from]!.push(i);
    incident[p.to]!.push(i);
  });
  const isKeep = (v: number) => {
    const inc = incident[v]!;
    if (inc.length === 0) return false;
    if (inc.length !== 2 || inc[0] === inc[1]) return true;
    const [i, j] = [inc[0]!, inc[1]!];
    const into = kept[i]!.to === v ? flags[i]! : turn(flags[i]!);
    const out = kept[j]!.from === v ? flags[j]! : turn(flags[j]!);
    return into !== out;
  };
  const used = new Array<boolean>(kept.length).fill(false);
  const chains: Chain[] = [];
  const walk = (start: number, first: number) => {
    let at = start;
    let piece = first;
    const coords: LatLng[] = [{ lat: road.nodes[start]!.lat, lng: road.nodes[start]!.lng }];
    const chainFlags = kept[first]!.from === start ? flags[first]! : turn(flags[first]!);
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
    chains.push({ a: start, b: at, coords, lengthM, flags: chainFlags });
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
    let f = c.flags;
    if (a > b || (a === b && compareSeq([...pts].reverse(), pts) < 0)) {
      [a, b] = [b, a];
      geometry = [...pts].reverse();
      f = turn(f);
    }
    return { a, b, lengthDm, pts: geometry, flags: f };
  });
  rounded.sort((x, y) => x.a - y.a || x.b - y.b || x.lengthDm - y.lengthDm || compareSeq(x.pts, y.pts) || x.flags - y.flags);

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
  for (const [, lat, lng] of v2?.places ?? []) extend([lat, lng]);
  const bbox: [number, number, number, number] = south === Infinity ? [0, 0, 0, 0] : [south, west, north, east];
  const base = { roadSource: options.roadSource, bbox, nodes, edges, geom };

  return {
    payload: v2
      ? { v: STREET_GRAPH_FORMAT_VERSION, ...base, flags: rounded.map((e) => e.flags), rules: v2.rules, areas: v2.areas, places: v2.places }
      : { v: WALK_GRAPH_FORMAT_VERSION, ...base },
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
