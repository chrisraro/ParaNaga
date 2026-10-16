// Approximate route path tracer (J1, D6): follows a variant's LPTRP street list (or its
// provisional pins, or its feeder anchors) on the OpenStreetMap road graph (vehicle profile).
// The result is always an "Approximate path, not a verified route shape".
//
// Street-list mode (R1–R7, Loops C/D, trial circuits):
//   - each listed street resolves to the edges whose names match it (name, alt_name, old_name,
//     official_name, or a reviewed alias); a listed landmark resolves to the point the caller gives
//     in `landmarks`, or (null) is skipped and reported as landmark_unresolved;
//   - waypoints are the junction nodes where street i meets street i+1 (no common node: any node of
//     street i+1, reported in `disjointPairs`), chosen as the one closest along street i from the
//     previous waypoint: a directed shortest path costing edges on street i ×1, on any listed
//     street ×3, others ×10;
//   - an open list starts at the end of its first street farthest from the second item and ends at
//     the end of its last street farthest from the last waypoint; a circuit starts at the waypoint
//     where its last street meets its first (a repeated first street is dropped) and closes back to it.
// Pin mode (Loops A/B): waypoints are the provisional pins in order, each snapped to the nearest
//   drivable edge (≤ 60 m, else the pin is unsnapped and the trace fails); between pins a directed
//   shortest path costing listed streets ×1 and others ×4; stop measures are the length along the
//   line at each snapped pin (a circuit closes back to the first pin; measures wrap at lengthM).
// Anchor mode (tricycle feeders): anchors are points or a junction of two named streets, traced in
//   order (×1 everywhere); any unresolved anchor fails with anchor_unresolved.
//
// Never fabricates: an unmatched street or an unreachable waypoint is a gap. The line breaks there
// (`parts`), `continuous` is false and the trace fails.
//
// Result status (controller rulings 2026-10-16):
//   ok      — every listed street matched, continuous, every pin snapped within 60 m, and the gate
//             off-list share ≤ 15 %. Drawn solid; its off_list_detour segments (short connectors)
//             render solid too, but its oneway_conflict segments render DASHED with "street order
//             conflicts with one-way mapping — confirm on the ground" (ruling, fix round 1).
//   flagged — the same but the gate off-list share is > 15 %. Drawn; all its off-list segments
//             except terminal_access render DASHED, with the one-way caution (oneway_conflict) or
//             the generic caution (off_list_detour), plus a route-detail note.
//   fail    — no line: an unresolved anchor, pin or street, or no connected path.
// Off-list segment reasons:
//   terminal_access — a stretch of at most 1 km that reaches a listed terminal (`terminals`, e.g.
//                     Bicol Central Station; some point within 250 m of it): the road that only
//                     connects the terminal to the listed streets. Recorded, rendered as normal (never dashed) with the note
//                     "terminal access road", and excluded from the gate off-list share;
//   oneway_conflict — judged per stretch: re-routing its leg with the listed one-way streets usable
//                     both ways (never roundabout pieces, never one carriageway of a divided road
//                     whose same-named opposite carriageway exists) replaces THAT stretch — between
//                     the points where the leg leaves and rejoins the re-route (within 30 m) around
//                     the stretch, the re-route drives a reversed listed street and less than half
//                     the stretch's off-list length. Checked before terminal_access;
//   off_list_detour — any other off-list stretch.
//
// Pure and deterministic: ties go to the lower node index (node indices follow OSM node ids).
import { haversineMeters } from "../geo/geometry";
import { edgesWithin, nearestEdge, type EdgeHit, type RoadEdge, type RoadGraph } from "../geo/road-graph";
import { normalizeStreetName, type StreetAlias } from "../geo/street-names";
import type { LatLng } from "../geo/types";

export const TRACE_BUILDER_VERSION = "trace-route/1";
/** D6: at most this share of the path's length may be on streets that are not on the list. */
export const MAX_OFF_LIST_SHARE = 0.15;
/** D6: every pin snaps within this distance of the road graph. */
export const PIN_SNAP_MAX_M = 60;
/** A pin prefers an edge it can be driven along in the route's direction within this distance. */
export const PIN_DIRECTION_SNAP_M = 25;
/** A relaxed re-route (listed one-ways usable both ways) must remove at least this share of a stretch's off-list length for oneway_conflict. */
const ONEWAY_CONFLICT_GAIN = 0.5;
/** The relaxed re-route must pass within this distance of an off-list stretch's start and end. */
const CONFLICT_MATCH_M = 30;
/** A route terminus farther than this from its street is ignored (reported in terminiIgnored). */
export const TERMINUS_MAX_M = 500;
/** A landmark or point anchor (a terminal centroid, a place node) snaps within this distance. */
export const LANDMARK_SNAP_MAX_M = 200;

const STREET_COST = { current: 1, listed: 3, other: 10 } as const;
const PIN_COST = { listed: 1, other: 4 } as const;

export type TraceAnchor =
  | { kind: "point"; label: string; at: LatLng }
  | { kind: "junction"; streets: readonly [string, string] }
  | { kind: "unresolved"; label: string };

export type TraceInput = {
  /** The legal street list in order (may name landmarks; see `landmarks`). */
  streets: readonly string[];
  /** List items that are landmarks, not streets: their point, or null when unresolved (skipped). */
  landmarks?: Readonly<Record<string, LatLng | null>>;
  /** Feeder anchors in order (anchor mode, used when there are no pins). */
  anchors?: readonly TraceAnchor[];
  /** Provisional pins in order (pin mode). */
  pins?: readonly LatLng[];
  /** Points of listed terminals (e.g. Bicol Central Station): off-list stretches of ≤ 1 km reaching them are terminal_access. */
  terminals?: readonly LatLng[];
  /**
   * Open lists only: the route's outer terminus (a reviewed place, e.g. the barangay in the route
   * name). The trace starts (`start`) or ends (`end`) at the node of the first/last street nearest
   * to it instead of the street's far end.
   */
  termini?: { start?: LatLng | null; end?: LatLng | null };
  isCircular: boolean;
};

export type TraceQuality = {
  builderVersion: string;
  mode: "streets" | "pins" | "anchors";
  /** Distinct listed streets (landmarks excluded). */
  listedStreets: number;
  matchedStreets: number;
  unmatchedStreets: string[];
  landmarksUnresolved: string[];
  anchorsUnresolved: string[];
  /** Consecutive listed streets with no common node ("A → B"). */
  disjointPairs: string[];
  /** Share of the traced length on edges of no listed street; null when there is no list. */
  offListShare: number | null;
  /** The share used by the gate: off-list length minus terminal_access stretches; null without a list. */
  gateOffListShare: number | null;
  /** Length of terminal_access stretches, metres. */
  terminalAccessM: number;
  /** The off-list streets the path uses most, by length (normalized OSM name, or "(unnamed)"); at most 6. */
  offListStreets: { name: string; m: number }[];
  /** Largest pin or anchor snap distance in metres; null when nothing was snapped. */
  maxSnapM: number | null;
  /** Largest landmark snap distance in metres; null when no landmark was snapped. */
  maxLandmarkSnapM: number | null;
  /** Largest distance from a terminus to the street node used for it; null without termini. */
  terminusSnapM: number | null;
  /** Termini farther than TERMINUS_MAX_M from their street, ignored (the street's far end is used). */
  terminiIgnored: { end: "start" | "end"; distM: number }[];
  /** Indices of pins with no drivable edge within PIN_SNAP_MAX_M. */
  unsnappedPins: number[];
  continuous: boolean;
  /** Breaks in the line (unmatched streets and unreachable waypoints). */
  gaps: number;
  /** Total length of the traced parts, in metres (rounded to 0.1 m). */
  lengthM: number;
};

/** Why a trace has no line (no connected path, or an anchor/pin/street that could not be placed). */
export type TraceFailure = "anchor_unresolved" | "pin_unsnapped" | "unmatched_streets" | "not_continuous" | "empty";

/**
 * Why a continuous line is drawn flagged (off-list share above MAX_OFF_LIST_SHARE):
 *   oneway_conflict - the off-list detour exists because listed streets are one-way against the
 *                     travel order (re-routing with those one-ways usable both ways removes most of it);
 *   off_list_detour - any other off-list detour.
 */
export type TraceFlagReason = "oneway_conflict" | "off_list_detour";
/** Per-segment reason: a flag reason, or a terminal access road (never dashed, not gated). */
export type OffListReason = TraceFlagReason | "terminal_access";
/** A terminal_access stretch is at most this long… */
export const TERMINAL_ACCESS_M = 1000;
/** …and reaches within this distance of the listed terminal's point. */
export const TERMINAL_REACH_M = 250;

/** A stretch of the line on streets not on the list, by measure along the line. */
export type OffListSegment = {
  fromM: number;
  toM: number;
  lengthM: number;
  /** Normalized OSM names (or "(unnamed)") with metres, longest first. */
  streets: { name: string; m: number }[];
  reason: OffListReason;
  /** oneway_conflict only: the listed streets (normalized names) mapped one-way against the travel order. */
  against?: string[];
};

type Drawn = { line: LatLng[]; lengthM: number; stopMeasures: number[]; quality: TraceQuality; offListSegments: OffListSegment[] };

/**
 * ok      - passes the D6 gate; drawn as an approximate path.
 * flagged - continuous but over the off-list threshold; drawn, with its off-list segments marked
 *           (rendered later as dashed with a caution) and the reason.
 * fail    - no line: unresolved anchors, pins or streets, or no connected path (`parts` for preview only).
 */
export type TraceResult =
  | ({ ok: true; status: "ok" } & Drawn)
  | ({ ok: true; status: "flagged"; flag: TraceFlagReason } & Drawn)
  | { ok: false; status: "fail"; reason: TraceFailure; quality: TraceQuality; parts: LatLng[][] };

// ---------------------------------------------------------------- endpoints and routing

type DirAt = { edge: number; t: number };
/** Where a trace stands or goes: a graph node, a set of candidate nodes, or a point on an edge. */
type Spot = { kind: "node"; node: number } | { kind: "nodes"; nodes: readonly number[] } | { kind: "point"; at: LatLng; dirs: DirAt[] };
type Piece = { coords: LatLng[]; edge: number };
type Leg = { pieces: Piece[]; end: Spot & { kind: "node" | "point" } };

function pointSpot(graph: RoadGraph, hit: EdgeHit): Spot & { kind: "point" } {
  const dirs: DirAt[] = [{ edge: hit.edge.index, t: hit.t }];
  if (hit.edge.twin !== null) dirs.push({ edge: hit.edge.twin, t: 1 - hit.t });
  return { kind: "point", at: hit.point, dirs };
}

const cumCache = new WeakMap<object, number[]>();
function cumulative(coords: readonly LatLng[]): number[] {
  let c = cumCache.get(coords);
  if (!c) {
    c = [0];
    for (let i = 1; i < coords.length; i++) c.push(c[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!));
    cumCache.set(coords, c);
  }
  return c;
}

/** The part of a polyline between fractions t0 ≤ t1 of its length. */
function slice(coords: readonly LatLng[], t0: number, t1: number): LatLng[] {
  const cum = cumulative(coords);
  const total = cum[cum.length - 1]!;
  const at = (m: number): LatLng => {
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < m) i++;
    const seg = cum[i]! - cum[i - 1]!;
    const u = seg === 0 ? 0 : Math.max(0, Math.min(1, (m - cum[i - 1]!) / seg));
    const a = coords[i - 1]!;
    const b = coords[i]!;
    return { lat: a.lat + u * (b.lat - a.lat), lng: a.lng + u * (b.lng - a.lng) };
  };
  const m0 = t0 * total;
  const m1 = t1 * total;
  const out: LatLng[] = [t0 <= 0 ? coords[0]! : at(m0)];
  for (let i = 1; i < coords.length - 1; i++) if (cum[i]! > m0 && cum[i]! < m1) out.push(coords[i]!);
  out.push(t1 >= 1 ? coords[coords.length - 1]! : at(m1));
  return out;
}

/** Binary min-heap of [cost, node], ties broken by node index. */
class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  private less(a: [number, number], b: [number, number]) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  push(item: [number, number]) {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const h = this.items;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Cheapest directed path from `from` to `to` (costs per edge from `weight`), or null when none.
 * A node set target ends at the cheapest of its nodes (ties: lower node index).
 */
function route(graph: RoadGraph, from: Spot & { kind: "node" | "point" }, to: Spot, weight: (e: number) => number): Leg | null {
  const edges = graph.edges;
  const cost = (e: number, fraction: number) => fraction * edges[e]!.lengthM * weight(e);

  type Seed = { node: number; cost: number; piece: Piece | null };
  const seeds: Seed[] =
    from.kind === "node"
      ? [{ node: from.node, cost: 0, piece: null }]
      : from.dirs.map((d) => ({ node: edges[d.edge]!.to, cost: cost(d.edge, 1 - d.t), piece: { coords: slice(edges[d.edge]!.coords, d.t, 1), edge: d.edge } }));
  type Goal = { extra: number; piece: Piece | null };
  const goals = new Map<number, Goal[]>();
  const addGoal = (node: number, g: Goal) => goals.set(node, [...(goals.get(node) ?? []), g]);
  if (to.kind === "node") addGoal(to.node, { extra: 0, piece: null });
  else if (to.kind === "nodes") for (const n of to.nodes) addGoal(n, { extra: 0, piece: null });
  else for (const d of to.dirs) addGoal(edges[d.edge]!.from, { extra: cost(d.edge, d.t), piece: { coords: slice(edges[d.edge]!.coords, 0, d.t), edge: d.edge } });

  type Best = { cost: number; node: number; goal: Goal | null; direct: Piece | null };
  let best: Best | null = null;
  // Point to point on the same piece, moving forward along one of its directions.
  if (from.kind === "point" && to.kind === "point") {
    for (const a of from.dirs) {
      for (const b of to.dirs) {
        if (a.edge !== b.edge || a.t > b.t) continue;
        const c = cost(a.edge, b.t - a.t);
        if (best === null || c < best.cost) best = { cost: c, node: -1, goal: null, direct: { coords: slice(edges[a.edge]!.coords, a.t, b.t), edge: a.edge } };
      }
    }
  }

  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const seedOf = new Int32Array(n).fill(-1);
  const heap = new Heap();
  seeds.forEach((s, i) => {
    if (s.cost < dist[s.node]!) {
      dist[s.node] = s.cost;
      seedOf[s.node] = i;
      prevEdge[s.node] = -1;
      heap.push([s.cost, s.node]);
    }
  });
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > dist[u]!) continue;
    if (best !== null && d >= best.cost) break;
    for (const g of goals.get(u) ?? []) {
      const c = d + g.extra;
      if (best === null || c < best.cost) best = { cost: c, node: u, goal: g, direct: null };
    }
    for (const e of graph.out[u]!) {
      const v = edges[e]!.to;
      const nd = d + cost(e, 1);
      if (nd < dist[v]!) {
        dist[v] = nd;
        prevEdge[v] = e;
        seedOf[v] = -1;
        heap.push([nd, v]);
      }
    }
  }
  if (best === null) return null;
  if (best.direct) return { pieces: [best.direct], end: to as Spot & { kind: "point" } };

  const pieces: Piece[] = [];
  let v = best.node;
  while (prevEdge[v]! >= 0) {
    const e = prevEdge[v]!;
    pieces.push({ coords: edges[e]!.coords, edge: e });
    v = edges[e]!.from;
  }
  const seed = seeds[seedOf[v]!];
  if (seed?.piece) pieces.push(seed.piece);
  pieces.reverse();
  if (best.goal?.piece) pieces.push(best.goal.piece);
  const end: Leg["end"] = to.kind === "point" ? to : { kind: "node", node: best.node };
  return { pieces, end };
}

/** A one-way piece with a same-named one-way piece running the other way within this distance is a divided road. */
const DIVIDED_ROAD_M = 60;

/** Whether a one-way edge is one carriageway of a divided road (a same-named opposite one-way piece nearby). */
function isDividedCarriageway(graph: RoadGraph, e: RoadEdge): boolean {
  if (e.names.length === 0) return false;
  const mid = e.coords[Math.floor(e.coords.length / 2)]!;
  const own = bearing(e.coords[0]!, e.coords[e.coords.length - 1]!);
  for (const h of edgesWithin(graph, mid, DIVIDED_ROAD_M)) {
    const f = h.edge;
    if (f.index === e.index || f.twin !== null || !f.names.some((n) => e.names.includes(n))) continue;
    const other = bearing(f.coords[h.seg - 1]!, f.coords[h.seg]!);
    if (angleBetween(own, other) > 135) return true;
  }
  return false;
}

/**
 * The graph plus a reversed copy of every one-way edge that a vehicle could plausibly be expected to
 * drive the other way if the mapping were wrong (indices after the real ones; `reverseOf` maps them
 * back): never a roundabout piece, never one carriageway of a divided road. Used only to test
 * whether an off-list stretch is caused by listed one-ways.
 */
type Relaxed = { graph: RoadGraph; reverseOf: Map<number, number>; realEdges: number };
const relaxedCache = new WeakMap<RoadGraph, Relaxed>();
function relaxedGraph(graph: RoadGraph): Relaxed {
  const hit = relaxedCache.get(graph);
  if (hit) return hit;
  const edges: RoadEdge[] = [...graph.edges];
  const out = graph.out.map((l) => [...l]);
  const reverseOf = new Map<number, number>();
  for (const e of graph.edges) {
    if (e.twin !== null || e.roundabout || isDividedCarriageway(graph, e)) continue;
    const index = edges.length;
    edges.push({ ...e, index, from: e.to, to: e.from, coords: [...e.coords].reverse(), reverse: !e.reverse, twin: null });
    out[e.to]!.push(index);
    reverseOf.set(index, e.index);
  }
  const relaxed = { graph: { ...graph, edges, out }, reverseOf, realEdges: graph.edges.length };
  relaxedCache.set(graph, relaxed);
  return relaxed;
}

/** Compass bearing (degrees) from a to b, planar at city scale. */
function bearing(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return (Math.atan2(x, b.lat - a.lat) * 180) / Math.PI;
}
const angleBetween = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Snaps a pin: among the edges within PIN_DIRECTION_SNAP_M, the nearest one that can be driven in
 * the travel direction (two-way, or one-way within 90 degrees of `travel`, the bearing from the
 * previous pin to the next); otherwise the nearest edge within PIN_SNAP_MAX_M.
 */
function withDirs(h: EdgeHit): EdgeHit & { dirs: DirAt[] } {
  const dirs: DirAt[] = [{ edge: h.edge.index, t: h.t }];
  if (h.edge.twin !== null) dirs.push({ edge: h.edge.twin, t: 1 - h.t });
  return { ...h, dirs };
}

function snapPin(graph: RoadGraph, p: LatLng, travel: number | null): (EdgeHit & { dirs: DirAt[] }) | null {
  if (travel !== null) {
    for (const h of edgesWithin(graph, p, PIN_DIRECTION_SNAP_M)) {
      // A two-way edge can always be driven in the travel direction; a one-way edge only when it
      // points within 90 degrees of it.
      if (h.edge.twin !== null || angleBetween(bearing(h.edge.coords[h.seg - 1]!, h.edge.coords[h.seg]!), travel) < 90) return withDirs(h);
    }
  }
  const h = nearestEdge(graph, p, PIN_SNAP_MAX_M);
  return h ? withDirs(h) : null;
}

// ---------------------------------------------------------------- line building

class LineBuilder {
  parts: LatLng[][] = [];
  private current: LatLng[] = [];
  lengthM = 0;
  offListM = 0;
  readonly offListByName = new Map<string, number>();
  gaps = 0;
  constructor(
    private readonly offList: (e: number) => boolean,
    private readonly nameOf: (e: number) => string = () => "",
  ) {}
  /** Length of the current part so far (the measure along an unbroken line). */
  get partLengthM() {
    return this.currentLength;
  }
  private currentLength = 0;
  start(p: LatLng) {
    if (this.current.length === 0) this.current.push(p);
  }
  segments: { fromM: number; toM: number; streets: Map<string, number>; conflict: boolean; against: Set<string>; minTerminalM: number }[] = [];
  private open: { fromM: number; toM: number; streets: Map<string, number>; conflict: boolean; against: Set<string>; minTerminalM: number } | null = null;
  /** Distance from a point to the nearest listed terminal (Infinity without terminals). */
  terminalDist: (p: LatLng) => number = () => Infinity;
  /** Appends a leg; `conflictPieces` maps indices of its pieces in a oneway_conflict stretch to the listed streets driven against. */
  add(leg: Leg, conflictPieces: ReadonlyMap<number, readonly string[]> = new Map()) {
    for (const [pieceIndex, piece] of leg.pieces.entries()) {
      const conflict = conflictPieces.has(pieceIndex);
      for (const p of piece.coords) {
        const last = this.current[this.current.length - 1];
        if (last && last.lat === p.lat && last.lng === p.lng) continue;
        if (last) {
          const m = haversineMeters(last, p);
          this.lengthM += m;
          this.currentLength += m;
          if (this.offList(piece.edge)) {
            this.offListM += m;
            const name = this.nameOf(piece.edge);
            this.offListByName.set(name, (this.offListByName.get(name) ?? 0) + m);
            if (!this.open) {
              this.open = { fromM: this.currentLength - m, toM: this.currentLength, streets: new Map(), conflict: false, against: new Set(), minTerminalM: this.terminalDist(last) };
              this.segments.push(this.open);
            }
            this.open.minTerminalM = Math.min(this.open.minTerminalM, this.terminalDist(p));
            this.open.toM = this.currentLength;
            this.open.streets.set(name, (this.open.streets.get(name) ?? 0) + m);
            if (conflict) {
              this.open.conflict = true;
              for (const n of conflictPieces.get(pieceIndex)!) this.open.against.add(n);
            }
          } else this.open = null;
        }
        this.current.push(p);
      }
    }
  }
  /** A gap: the current part ends; the next part starts at `p`. */
  breakAt(p: LatLng | null) {
    this.gaps++;
    this.open = null;
    this.flush();
    this.currentLength = 0;
    if (p) this.current.push(p);
  }
  flush() {
    if (this.current.length >= 2) this.parts.push(this.current);
    this.current = [];
  }
}

const spotPoint = (graph: RoadGraph, s: Spot & { kind: "node" | "point" }): LatLng =>
  s.kind === "point" ? s.at : { lat: graph.nodes[s.node]!.lat, lng: graph.nodes[s.node]!.lng };

/** The node of a node-set target nearest (straight line) to `p`: where a new part starts after a gap. */
function nearestOf(graph: RoadGraph, nodes: readonly number[], p: LatLng): number {
  let best = nodes[0]!;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = haversineMeters(p, graph.nodes[n]!);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------- streets

type StreetInfo = { edges: Set<number>; nodes: number[]; ends: number[] };

function streetIndex(graph: RoadGraph, aliases: readonly StreetAlias[]) {
  const aliasMap = new Map<string, string[]>();
  for (const a of aliases) {
    const key = normalizeStreetName(a.legalName);
    aliasMap.set(key, [...(aliasMap.get(key) ?? []), normalizeStreetName(a.osmName)]);
  }
  const cache = new Map<string, StreetInfo>();
  return (legalName: string): StreetInfo => {
    const key = normalizeStreetName(legalName);
    const hit = cache.get(key);
    if (hit) return hit;
    const wanted = new Set([key, ...(aliasMap.get(key) ?? [])].filter((x) => x !== ""));
    const edges = new Set<number>();
    for (const e of graph.edges) if (e.names.some((nm) => wanted.has(nm))) edges.add(e.index);
    const degree = new Map<number, number>();
    for (const i of edges) {
      const e = graph.edges[i]!;
      if (e.twin !== null && e.twin < i && edges.has(e.twin)) continue; // count each two-way piece once
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const nodes = [...degree.keys()].sort((a, b) => a - b);
    const ends = nodes.filter((nd) => degree.get(nd) === 1);
    const info = { edges, nodes, ends: ends.length > 0 ? ends : nodes };
    cache.set(key, info);
    return info;
  };
}

/** The node of a street nearest (straight line) to `p`; ties: lower node index. */
function nearestNode(graph: RoadGraph, street: StreetInfo, p: LatLng): { node: number; distM: number } {
  let best = street.nodes[0]!;
  let bestD = Infinity;
  for (const n of street.nodes) {
    const d = haversineMeters(p, graph.nodes[n]!);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { node: best, distM: bestD };
}

function reachable(graph: RoadGraph, street: StreetInfo, from: number, targets: readonly number[], directed: boolean): boolean {
  const want = new Set(targets);
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const u = stack.pop()!;
    if (want.has(u)) return true;
    for (const e of graph.out[u]!) {
      const edge = graph.edges[e]!;
      if (!street.edges.has(e)) continue;
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        stack.push(edge.to);
      }
    }
    if (!directed) {
      // Undirected: also walk the street's pieces backwards.
      for (const e of street.edges) {
        const edge = graph.edges[e]!;
        if (edge.to === u && !seen.has(edge.from)) {
          seen.add(edge.from);
          stack.push(edge.from);
        }
      }
    }
  }
  return false;
}

/**
 * False only when `targets` are connected to `from` along this street but cannot be driven to in
 * that direction (a one-way street entered from the wrong end). A street with a gap is not judged.
 */
function reachesAlong(graph: RoadGraph, street: StreetInfo, from: number, targets: readonly number[]): boolean {
  return reachable(graph, street, from, targets, true) || !reachable(graph, street, from, targets, false);
}

/**
 * The end of a street farthest (straight line) from the nearest of `from`; ties: lower node index.
 * With `drivable`, ends for which it holds (the street can be driven in the travel direction
 * from or to them) are preferred; when none does, every end is considered.
 */
function farEnd(graph: RoadGraph, street: StreetInfo, from: readonly LatLng[], drivable?: (node: number) => boolean): number {
  const usable = drivable ? street.ends.filter(drivable) : [];
  const ends = usable.length > 0 ? usable : street.ends;
  let best = ends[0]!;
  let bestD = -1;
  for (const n of ends) {
    const p = graph.nodes[n]!;
    const d = Math.min(...from.map((q) => haversineMeters(p, q)));
    if (d > bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------- trace

type Item = { kind: "street"; name: string; info: StreetInfo } | { kind: "landmark"; name: string; spot: Spot & { kind: "point" } };
type Waypoint = { target: Spot; current: StreetInfo | null };

function emptyQuality(mode: TraceQuality["mode"]): TraceQuality {
  return {
    builderVersion: TRACE_BUILDER_VERSION, mode, listedStreets: 0, matchedStreets: 0, unmatchedStreets: [], landmarksUnresolved: [],
    anchorsUnresolved: [], disjointPairs: [], offListShare: null, gateOffListShare: null, terminalAccessM: 0, offListStreets: [], maxSnapM: null, maxLandmarkSnapM: null, terminusSnapM: null, terminiIgnored: [], unsnappedPins: [],
    continuous: true, gaps: 0, lengthM: 0,
  };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function traceVariant(input: TraceInput, graph: RoadGraph, aliases: readonly StreetAlias[]): TraceResult {
  const mode: TraceQuality["mode"] = input.pins && input.pins.length > 0 ? "pins" : input.anchors && input.anchors.length > 0 ? "anchors" : "streets";
  const q = emptyQuality(mode);
  const street = streetIndex(graph, aliases);
  const landmarks = input.landmarks ?? {};
  const isLandmark = (name: string) => Object.prototype.hasOwnProperty.call(landmarks, name);

  // Listed streets: matched / unmatched (distinct, in list order).
  const listed = new Set<number>();
  const seen = new Set<string>();
  for (const name of input.streets) {
    if (isLandmark(name)) {
      if (landmarks[name] === null && !q.landmarksUnresolved.includes(name)) q.landmarksUnresolved.push(name);
      continue;
    }
    const key = normalizeStreetName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    q.listedStreets++;
    const info = street(name);
    if (info.edges.size === 0) q.unmatchedStreets.push(name);
    else {
      q.matchedStreets++;
      for (const e of info.edges) listed.add(e);
    }
  }
  const hasList = q.listedStreets > 0;
  const offList = (e: number) => hasList && !listed.has(e);
  const line = new LineBuilder(offList, (e) => graph.edges[e]!.names[0] ?? "(unnamed)");
  const terminals = input.terminals ?? [];
  if (terminals.length > 0) line.terminalDist = (p) => Math.min(...terminals.map((t) => haversineMeters(p, t)));
  const snaps: number[] = [];
  const landmarkSnaps: number[] = [];
  const terminusSnaps: number[] = [];
  const stopMeasures: number[] = [];

  const legOffListM = (pieces: readonly Piece[], isOff: (e: number) => boolean) =>
    pieces.reduce((sum, p) => (isOff(p.edge) ? sum + cumulative(p.coords)[p.coords.length - 1]! : sum), 0);
  /**
   * The pieces of a leg that belong to oneway_conflict stretches. A stretch (consecutive off-list
   * pieces) is a conflict when, with the leg re-routed with listed one-ways usable both ways (see
   * relaxedGraph), the re-route between where the leg leaves it before the stretch and rejoins it
   * after (points within CONFLICT_MATCH_M) drives a reversed listed street and less than half the
   * stretch's off-list length.
   */
  const onewayConflicts = (from: Spot & { kind: "node" | "point" }, to: Spot, weight: (e: number) => number, leg: Leg): Map<number, string[]> => {
    const out = new Map<number, string[]>();
    const stretches: number[][] = [];
    leg.pieces.forEach((p, i) => {
      if (!offList(p.edge)) return;
      const lastStretch = stretches[stretches.length - 1];
      if (lastStretch && lastStretch[lastStretch.length - 1] === i - 1) lastStretch.push(i);
      else stretches.push([i]);
    });
    if (stretches.length === 0) return out;
    const relaxed = relaxedGraph(graph);
    const real = (e: number) => relaxed.reverseOf.get(e) ?? e;
    const w = (e: number) => (e < relaxed.realEdges ? weight(e) : listed.has(real(e)) ? weight(real(e)) : Infinity);
    const alt = route(relaxed.graph, from, to, w);
    if (!alt || !alt.pieces.some((p) => p.edge >= relaxed.realEdges)) return out;
    // The re-route as points, each with the edge of the segment that ends there.
    const pts: { p: LatLng; edge: number }[] = [];
    for (const piece of alt.pieces) for (const p of piece.coords) pts.push({ p, edge: piece.edge });
    // The original leg as points, each with the piece of the segment that ends there.
    const orig: { p: LatLng; piece: number }[] = [];
    leg.pieces.forEach((piece, k) => piece.coords.forEach((p) => orig.push({ p, piece: k })));
    /** Index of the re-route point within CONFLICT_MATCH_M of `q` (nearest; at or after `after`), or -1. */
    const onAlt = (q: LatLng, after: number): number => {
      let best = -1;
      let bestD = CONFLICT_MATCH_M;
      for (let i = after; i < pts.length; i++) {
        const d = haversineMeters(pts[i]!.p, q);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    for (const stretch of stretches) {
      const firstPiece = stretch[0]!;
      const lastPiece = stretch[stretch.length - 1]!;
      // Where the leg and the re-route diverge before the stretch and meet again after it.
      let i0 = orig.findIndex((o) => o.piece === firstPiece);
      let a0 = -1;
      for (; i0 >= 0; i0--) if ((a0 = onAlt(orig[i0]!.p, 0)) >= 0) break;
      if (a0 < 0) continue;
      let i1 = orig.length - 1 - [...orig].reverse().findIndex((o) => o.piece === lastPiece);
      let a1 = -1;
      for (; i1 < orig.length; i1++) if ((a1 = onAlt(orig[i1]!.p, a0)) >= 0) break;
      if (a1 < 0) continue;
      // Between them the re-route must drive a reversed listed street and avoid most of the stretch.
      let reversed = false;
      const against = new Set<string>();
      let altOff = 0;
      for (let i = a0 + 1; i <= a1; i++) {
        const e = pts[i]!.edge;
        if (e >= relaxed.realEdges) {
          reversed = true;
          against.add(relaxed.graph.edges[e]!.names[0] ?? "(unnamed)");
        }
        if (offList(real(e))) altOff += haversineMeters(pts[i - 1]!.p, pts[i]!.p);
      }
      const stretchOff = legOffListM(stretch.map((i) => leg.pieces[i]!), offList);
      if (reversed && altOff < stretchOff * (1 - ONEWAY_CONFLICT_GAIN)) for (const i of stretch) out.set(i, [...against].sort());
    }
    return out;
  };

  /** Follows waypoints from `start`; a waypoint that cannot be reached is a gap. */
  const follow = (start: Spot & { kind: "node" | "point" }, waypoints: readonly Waypoint[], weightFor: (w: Waypoint) => (e: number) => number, onArrive?: (i: number) => void) => {
    let pos = start;
    line.start(spotPoint(graph, pos));
    waypoints.forEach((w, i) => {
      const weight = weightFor(w);
      const leg = route(graph, pos, w.target, weight);
      if (leg) {
        line.add(leg, hasList ? onewayConflicts(pos, w.target, weight, leg) : undefined);
        pos = leg.end;
      } else {
        const here = spotPoint(graph, pos);
        pos = w.target.kind === "nodes" ? { kind: "node", node: nearestOf(graph, w.target.nodes, here) } : (w.target as Spot & { kind: "node" | "point" });
        line.breakAt(spotPoint(graph, pos));
      }
      onArrive?.(i);
    });
    return pos;
  };

  if (mode === "pins") {
    const spots: (Spot & { kind: "point" })[] = [];
    const pins = input.pins!;
    pins.forEach((p, i) => {
      // Travel direction at the pin: from the previous pin to the next (wrapping on a circuit).
      const n = pins.length;
      const prev = i > 0 ? pins[i - 1]! : input.isCircular && n > 2 ? pins[n - 1]! : p;
      const next = i < n - 1 ? pins[i + 1]! : input.isCircular && n > 2 ? pins[0]! : p;
      const travel = prev === next ? null : bearing(prev, next);
      const hit = snapPin(graph, p, travel);
      if (!hit) q.unsnappedPins.push(i);
      else {
        snaps.push(hit.distM);
        spots.push({ kind: "point", at: hit.point, dirs: hit.dirs });
      }
    });
    if (spots.length > 0) {
      const weight = () => (e: number) => (listed.has(e) ? PIN_COST.listed : PIN_COST.other);
      const targets: Waypoint[] = spots.slice(1).map((s) => ({ target: s, current: null }));
      if (input.isCircular && spots.length > 1) targets.push({ target: spots[0]!, current: null });
      stopMeasures.push(0);
      follow(spots[0]!, targets, weight, (i) => {
        if (i < spots.length - 1) stopMeasures.push(line.gaps === 0 ? line.partLengthM : NaN);
      });
    }
  } else if (mode === "anchors") {
    const spots: Spot[] = [];
    for (const a of input.anchors!) {
      if (a.kind === "unresolved") {
        q.anchorsUnresolved.push(a.label);
        continue;
      }
      if (a.kind === "point") {
        const hit = nearestEdge(graph, a.at, LANDMARK_SNAP_MAX_M);
        if (!hit) q.anchorsUnresolved.push(a.label);
        else {
          snaps.push(hit.distM);
          spots.push(pointSpot(graph, hit));
        }
        continue;
      }
      const [s1, s2] = a.streets;
      const common = street(s1).nodes.filter((n) => street(s2).nodes.includes(n));
      if (common.length === 0) q.anchorsUnresolved.push(`${s1} / ${s2}`);
      else spots.push({ kind: "node", node: common[0]! });
    }
    if (q.anchorsUnresolved.length === 0 && spots.length > 1) {
      follow(spots[0] as Spot & { kind: "node" | "point" }, spots.slice(1).map((s) => ({ target: s, current: null })), () => () => 1);
    }
  } else {
    // Items in order; unresolved landmarks are skipped (reported above).
    const items: (Item | null)[] = [];
    for (const name of input.streets) {
      if (isLandmark(name)) {
        const p = landmarks[name];
        if (!p) continue;
        const hit = nearestEdge(graph, p, LANDMARK_SNAP_MAX_M);
        if (!hit) {
          if (!q.landmarksUnresolved.includes(name)) q.landmarksUnresolved.push(name);
          continue;
        }
        landmarkSnaps.push(hit.distM);
        items.push({ kind: "landmark", name, spot: pointSpot(graph, hit) });
        continue;
      }
      const info = street(name);
      items.push(info.edges.size === 0 ? null : { kind: "street", name, info });
    }
    // Runs between unmatched streets (null): each is traced on its own; a break between runs is a gap.
    const runs: Item[][] = [[]];
    for (const it of items) {
      if (it === null) {
        if (runs[runs.length - 1]!.length > 0) runs.push([]);
      } else runs[runs.length - 1]!.push(it);
    }
    const nonEmpty = runs.filter((r) => r.length > 0);
    const circular = input.isCircular && nonEmpty.length === 1 && q.unmatchedStreets.length === 0;
    const sameName = (a: Item, b: Item) => normalizeStreetName(a.name) === normalizeStreetName(b.name);

    const weightFor = (w: Waypoint) => (e: number) => (w.current?.edges.has(e) ? STREET_COST.current : listed.has(e) ? STREET_COST.listed : STREET_COST.other);
    /** The waypoint between items a → b (null when a is a landmark: its point was the waypoint). */
    const between = (a: Item, b: Item): Waypoint | null => {
      if (b.kind === "landmark") return { target: b.spot, current: a.kind === "street" ? a.info : null };
      if (a.kind === "landmark") return null;
      const common = a.info.nodes.filter((n) => b.info.edges.size > 0 && b.info.nodes.includes(n));
      if (common.length === 0) {
        const pair = `${a.name} → ${b.name}`;
        if (!q.disjointPairs.includes(pair)) q.disjointPairs.push(pair);
        return { target: { kind: "nodes", nodes: b.info.nodes }, current: a.info };
      }
      return { target: { kind: "nodes", nodes: common }, current: a.info };
    };
    const targetPoints = (t: Spot): LatLng[] =>
      t.kind === "point" ? [t.at] : t.kind === "node" ? [spotPoint(graph, t)] : t.nodes.map((n) => spotPoint(graph, { kind: "node", node: n }));

    nonEmpty.forEach((run, runIndex) => {
      if (runIndex > 0) line.breakAt(null);
      if (circular) {
        const cyc = run.length > 1 && sameName(run[0]!, run[run.length - 1]!) ? run.slice(0, -1) : run;
        const wps: Waypoint[] = [];
        for (let k = 0; k < cyc.length; k++) {
          const w = between(cyc[(k + cyc.length - 1) % cyc.length]!, cyc[k]!);
          if (w) wps.push(w);
        }
        if (wps.length === 0) return;
        // wps[0] is where the last item meets the first. Pass 1 starts at its lowest node; pass 2
        // starts at the node the closing leg reaches (closest along the last street).
        const first = wps[0]!.target;
        const startAt = (node: number | null): Spot & { kind: "node" | "point" } =>
          first.kind === "point" ? first : first.kind === "node" ? first : { kind: "node", node: node ?? first.nodes[0]! };
        let pos = startAt(null);
        for (const w of [...wps.slice(1), wps[0]!]) {
          const leg = route(graph, pos, w.target, weightFor(w));
          if (!leg) break;
          pos = leg.end;
        }
        const start = startAt(first.kind === "nodes" && pos.kind === "node" ? pos.node : null);
        const closing = { target: start, current: wps[0]!.current };
        follow(start, [...wps.slice(1), closing], weightFor);
        return;
      }
      // Open run: from the far end of the first street to the far end of the last.
      const wps: Waypoint[] = [];
      for (let k = 1; k < run.length; k++) {
        const w = between(run[k - 1]!, run[k]!);
        if (w) wps.push(w);
      }
      const head = run[0]!;
      let start: Spot & { kind: "node" | "point" };
      if (head.kind === "landmark") start = head.spot;
      else {
        const t = runIndex === 0 && input.termini?.start ? nearestNode(graph, head.info, input.termini.start) : null;
        if (t && t.distM <= TERMINUS_MAX_M) {
          terminusSnaps.push(t.distM);
          start = { kind: "node", node: t.node };
        } else {
          if (t) q.terminiIgnored.push({ end: "start", distM: round(t.distM, 1) });
          const toward = wps[0] ? targetPoints(wps[0].target) : [];
          const targets = wps[0]?.target.kind === "nodes" ? wps[0].target.nodes : null;
          start = { kind: "node", node: toward.length > 0 ? farEnd(graph, head.info, toward, targets ? (n) => reachesAlong(graph, head.info, n, targets) : undefined) : head.info.ends[0]! };
        }
      }
      const pos = follow(start, wps, weightFor);
      const tail = run[run.length - 1]!;
      if (tail.kind === "street") {
        const from = pos;
        let end = farEnd(graph, tail.info, [spotPoint(graph, pos)], from.kind === "node" ? (n) => reachesAlong(graph, tail.info, from.node, [n]) : undefined);
        if (runIndex === nonEmpty.length - 1 && input.termini?.end) {
          const t = nearestNode(graph, tail.info, input.termini.end);
          if (t.distM <= TERMINUS_MAX_M) {
            terminusSnaps.push(t.distM);
            end = t.node;
          } else q.terminiIgnored.push({ end: "end", distM: round(t.distM, 1) });
        }
        follow(pos, [{ target: { kind: "node", node: end }, current: tail.info }], weightFor);
      }
    });
  }
  line.flush();

  q.gaps = line.gaps;
  q.continuous = line.gaps === 0 && line.parts.length <= 1;
  q.lengthM = round(line.lengthM, 1);
  q.offListShare = hasList ? (line.lengthM > 0 ? round(line.offListM / line.lengthM, 4) : 0) : null;
  q.maxSnapM = snaps.length > 0 ? round(Math.max(...snaps), 1) : null;
  q.offListStreets = [...line.offListByName]
    .map(([name, m]) => ({ name, m: round(m, 0) }))
    .sort((a, b) => b.m - a.m || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, 6);
  q.terminusSnapM = terminusSnaps.length > 0 ? round(Math.max(...terminusSnaps), 1) : null;
  q.maxLandmarkSnapM = landmarkSnaps.length > 0 ? round(Math.max(...landmarkSnaps), 1) : null;

  const reason: TraceFailure | null =
    q.anchorsUnresolved.length > 0
      ? "anchor_unresolved"
      : q.unsnappedPins.length > 0
        ? "pin_unsnapped"
        : q.unmatchedStreets.length > 0
          ? "unmatched_streets"
          : !q.continuous
            ? "not_continuous"
            : line.parts.length === 0 || line.lengthM === 0
              ? "empty"
              : null;
  if (reason !== null) return { ok: false, status: "fail", reason, quality: q, parts: line.parts };
  const isTerminalAccess = (sg: { fromM: number; toM: number; minTerminalM: number }) =>
    sg.minTerminalM <= TERMINAL_REACH_M && sg.toM - sg.fromM <= TERMINAL_ACCESS_M;
  const offListSegments: OffListSegment[] = line.segments.map((sg) => ({
    fromM: round(sg.fromM, 1),
    toM: round(sg.toM, 1),
    lengthM: round(sg.toM - sg.fromM, 1),
    streets: [...sg.streets].map(([name, m]) => ({ name, m: round(m, 0) })).sort((a, b) => b.m - a.m || (a.name < b.name ? -1 : 1)),
    reason: sg.conflict ? "oneway_conflict" : isTerminalAccess(sg) ? "terminal_access" : "off_list_detour",
    ...(sg.conflict ? { against: [...sg.against].sort() } : {}),
  }));
  const terminalM = line.segments.filter((sg) => !sg.conflict && isTerminalAccess(sg)).reduce((sum, sg) => sum + (sg.toM - sg.fromM), 0);
  q.terminalAccessM = round(terminalM, 1);
  q.gateOffListShare = hasList ? (line.lengthM > 0 ? round(Math.max(0, line.offListM - terminalM) / line.lengthM, 4) : 0) : null;
  const drawn: Drawn = { line: line.parts[0]!, lengthM: q.lengthM, stopMeasures: stopMeasures.map((m) => round(m, 1)), quality: q, offListSegments };
  if (q.gateOffListShare !== null && q.gateOffListShare > MAX_OFF_LIST_SHARE) {
    // The flag reason is the one carrying most of the off-list length.
    const byReason = (r: TraceFlagReason) => offListSegments.filter((x) => x.reason === r).reduce((sum, x) => sum + x.lengthM, 0);
    const flag: TraceFlagReason = byReason("oneway_conflict") > byReason("off_list_detour") ? "oneway_conflict" : "off_list_detour";
    return { ok: true, status: "flagged", flag, ...drawn };
  }
  return { ok: true, status: "ok", ...drawn };
}
