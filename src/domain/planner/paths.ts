// Path-based boarding and alighting (plan E §A). Pure and deterministic.
//
//  - A planned variant is one Lines path (decoded once), ridden in path order only. It is a
//    circuit when its direction is circuit/clockwise/counterclockwise AND its ends lie within
//    60 m; otherwise a line.
//  - The path is sampled every 25 m plus every vertex. An approach to a point P is a maximal run
//    of consecutive samples within 500 m straight-line of P (a circuit's run may wrap across the
//    seam); its measure is P projected onto the path restricted to that run.
//  - A ride boards at an origin approach and alights at a destination approach: line
//    d = alight − board, kept when d ≥ 200; circuit d = (alight − board) mod length, kept when
//    200 ≤ d < length (never a lap). Access/egress walks are graph metres ≤ 750 (×1.3 straight
//    estimate without a graph). The best pair per variant is the lowest walk + 0.25 × ride.
//  - Transfers: samples of variant 1 whose nearest point on variant 2 is within 300 m, grouped in
//    runs; one transfer per run at the closest pair (a shared street gives 0 m).
//  - A free point is named by the nearest same-variant pin within 100 m along the path, else the
//    nearest snapshot stop within 100 m straight-line, else not at all.
import type { Line } from "../api/schemas";
import { haversineMeters } from "../geo/geometry";
import { projectOnLine } from "../geo/measure";
import { decodePolyline } from "../geo/polyline";
import type { LatLng } from "../geo/types";

export const SAMPLE_STEP_M = 25;
export const APPROACH_RADIUS_M = 500;
export const MIN_RIDE_M = 200;
export const MAX_ACCESS_WALK_GRAPH_M = 750;
export const TRANSFER_RADIUS_M = 300;
export const CIRCUIT_CLOSE_M = 60;
export const NAME_RADIUS_M = 100;
const WALK_ESTIMATE_FACTOR = 1.3;
const RIDE_WEIGHT = 0.25;
const CIRCUIT_DIRECTIONS: ReadonlySet<string> = new Set(["circuit", "clockwise", "counterclockwise"]);

/** The Lines fields the planner reads. */
export type PlanningLine = Pick<Line, "variantId" | "routeId" | "routeCode" | "routeName" | "mode" | "kind" | "direction" | "status" | "encoded">;

/** A path sample: a point at `m` metres along the path, on segment seg → seg + 1. */
export type PathSample = LatLng & { m: number; seg: number };

export type PathVariant = Omit<PlanningLine, "encoded"> & {
  isCircuit: boolean;
  points: LatLng[];
  /** Metres along the path at each vertex (haversine, as `projectOnLine`). */
  cumM: number[];
  lengthM: number;
  samples: PathSample[];
};

/** `run`: the run's samples in path order (approaches() only); the planner picks the shortest street walk among them. */
export type Approach = { measureM: number; point: LatLng; distM: number; run?: PathSample[] };

/** Graph walk metres to/from an approach point (snap legs included), or null when unreachable. */
export type WalkLength = (a: Approach) => number | null;

export type PathRide = { board: Approach; alight: Approach; rideM: number; boardWalkM: number; alightWalkM: number; score: number };

export type TransferPoint = { fromM: number; toM: number; from: LatLng; to: LatLng; straightM: number };

const straightEstimate: WalkLength = (a) => Math.round(a.distM * WALK_ESTIMATE_FACTOR);

const isCircuitPoints = (direction: string, points: readonly LatLng[]) =>
  CIRCUIT_DIRECTIONS.has(direction) && haversineMeters(points[0]!, points.at(-1)!) <= CIRCUIT_CLOSE_M;

/** A circuit (plan E §A): a circular direction and path ends within 60 m of each other. */
export const isCircuitLine = (line: PlanningLine) => isCircuitPoints(line.direction, decodePolyline(line.encoded));

export function pathVariant(line: PlanningLine): PathVariant {
  const { encoded, ...rest } = line;
  const points = decodePolyline(encoded);
  const cumM = [0];
  for (let i = 1; i < points.length; i++) cumM.push(cumM[i - 1]! + haversineMeters(points[i - 1]!, points[i]!));
  const lengthM = cumM.at(-1)!;
  const samples: PathSample[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segM = cumM[i + 1]! - cumM[i]!;
    samples.push({ ...a, m: cumM[i]!, seg: i });
    for (let k = Math.floor(cumM[i]! / SAMPLE_STEP_M) + 1; k * SAMPLE_STEP_M < cumM[i + 1]!; k++) {
      const t = (k * SAMPLE_STEP_M - cumM[i]!) / segM;
      samples.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), m: k * SAMPLE_STEP_M, seg: i });
    }
  }
  samples.push({ ...points.at(-1)!, m: lengthM, seg: points.length - 2 });
  const isCircuit = isCircuitPoints(line.direction, points);
  return { ...rest, isCircuit, points, cumM, lengthM, samples };
}

/** Maximal runs [first, last] of consecutive sample indices where `near` holds; a circuit's runs wrap. */
function runs(v: PathVariant, near: (s: PathSample) => boolean): [number, number][] {
  const out: [number, number][] = [];
  v.samples.forEach((s, i) => {
    if (!near(s)) return;
    const last = out.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  });
  const n = v.samples.length;
  if (v.isCircuit && out.length > 1 && out[0]![0] === 0 && out.at(-1)![1] === n - 1) {
    const tail = out.pop()!;
    out[0] = [tail[0], out[0]![1] + n]; // first > last: wraps; index i ≥ n means i − n
  }
  return out;
}

/** P projected onto the path between samples i and j (j ≥ i, both indices into samples). */
function projectOnRun(v: PathVariant, i: number, j: number, p: LatLng): Approach {
  const a = v.samples[i]!;
  const b = v.samples[j]!;
  const sub = [a, ...v.points.slice(a.seg + 1, b.seg + 1), b];
  const pr = projectOnLine(sub, p);
  return { measureM: a.m + pr.measureM, point: pr.point, distM: pr.distM };
}

function projectRun(v: PathVariant, [first, last]: [number, number], p: LatLng): Approach {
  const n = v.samples.length;
  if (last < n) return projectOnRun(v, first, last, p);
  const tail = projectOnRun(v, first, n - 1, p);
  const head = projectOnRun(v, 0, last - n, p);
  return head.distM <= tail.distM ? head : tail;
}

/** Every approach of the path to `p` (samples within `radiusM` straight-line), by measure. */
export function approaches(v: PathVariant, p: LatLng, radiusM = APPROACH_RADIUS_M): Approach[] {
  const n = v.samples.length;
  return runs(v, (s) => haversineMeters(s, p) <= radiusM)
    .map((r) => ({ ...projectRun(v, r, p), run: Array.from({ length: r[1] - r[0] + 1 }, (_, k) => v.samples[(r[0] + k) % n]!) }))
    .sort((x, y) => x.measureM - y.measureM);
}

/** Ride metres from board to alight measure in path order, or null when not a ride (§A). */
export function rideMeters(v: PathVariant, boardM: number, alightM: number): number | null {
  let d = alightM - boardM;
  if (v.isCircuit) d = ((d % v.lengthM) + v.lengthM) % v.lengthM;
  return d >= MIN_RIDE_M && d < (v.isCircuit ? v.lengthM : Infinity) ? d : null;
}

/** The best (board, alight) pair on one variant, or null. Walks default to round(straight × 1.3). */
export function ridesOnVariant(
  v: PathVariant, boards: readonly Approach[], alights: readonly Approach[],
  walk: { board?: WalkLength; alight?: WalkLength } = {},
): PathRide | null {
  const capped = (f: WalkLength, a: Approach) => {
    const m = f(a);
    return m !== null && m <= MAX_ACCESS_WALK_GRAPH_M ? m : null;
  };
  let best: PathRide | null = null;
  for (const board of boards) {
    const boardWalkM = capped(walk.board ?? straightEstimate, board);
    if (boardWalkM === null) continue;
    for (const alight of alights) {
      const rideM = rideMeters(v, board.measureM, alight.measureM);
      const alightWalkM = rideM === null ? null : capped(walk.alight ?? straightEstimate, alight);
      if (rideM === null || alightWalkM === null) continue;
      const score = boardWalkM + alightWalkM + RIDE_WEIGHT * rideM;
      if (!best || score < best.score || (score === best.score && rideM < best.rideM)) {
        best = { board, alight, rideM, boardWalkM, alightWalkM, score };
      }
    }
  }
  return best;
}

const CELL_DEG = 0.003; // ≈ 330 m: a 3 × 3 block covers every sample within 312.5 m
const M_PER_DEG = (Math.PI / 180) * 6_371_008.8;
const cellKey = (cy: number, cx: number) => cy * 1_000_000 + cx;

/**
 * The nearest point of `b` to `p` when within `radiusM`, else null. The nearest point lies within
 * half a sample step of a sample on its segment, so only segments with a sample within
 * (nearest sample + half a step) are projected.
 */
function nearestWithin(b: PathVariant, grid: Map<number, PathSample[]>, p: LatLng, radiusM: number): Approach | null {
  const cy = Math.floor(p.lat / CELL_DEG);
  const cx = Math.floor(p.lng / CELL_DEG);
  const mLng = M_PER_DEG * Math.cos((p.lat * Math.PI) / 180);
  const slack = SAMPLE_STEP_M / 2 + 1; // the 1 m margin covers local planar vs haversine metres
  const near: [PathSample, number][] = [];
  let minD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const s of grid.get(cellKey(cy + dy, cx + dx)) ?? []) {
        const ey = (s.lat - p.lat) * M_PER_DEG;
        const ex = (s.lng - p.lng) * mLng;
        const d = Math.sqrt(ey * ey + ex * ex);
        if (d > radiusM + slack) continue;
        near.push([s, d]);
        minD = Math.min(minD, d);
      }
    }
  }
  const segs = new Set<number>();
  for (const [s, d] of near) if (d <= minD + 2 * slack) segs.add(s.seg).add(Math.max(0, s.seg - 1));
  let best: Approach | null = null;
  for (const k of [...segs].sort((x, y) => x - y)) {
    const pr = projectOnLine([b.points[k]!, b.points[k + 1]!], p);
    if (pr.distM <= radiusM && (!best || pr.distM < best.distM)) best = { measureM: b.cumM[k]! + pr.measureM, point: pr.point, distM: pr.distM };
  }
  return best;
}

/** Transfer points from `a` to `b` (§A): one per run of `a` samples within 300 m of `b`. */
export function transferPoints(a: PathVariant, b: PathVariant): TransferPoint[] {
  const grid = new Map<number, PathSample[]>();
  for (const s of b.samples) {
    const key = cellKey(Math.floor(s.lat / CELL_DEG), Math.floor(s.lng / CELL_DEG));
    const cell = grid.get(key);
    if (cell) cell.push(s);
    else grid.set(key, [s]);
  }
  const nearest = new Map<number, Approach>();
  const near = (s: PathSample) => {
    const pr = nearestWithin(b, grid, s, TRANSFER_RADIUS_M);
    if (pr) nearest.set(s.m, pr);
    return pr !== null;
  };
  const n = a.samples.length;
  return runs(a, near).map(([first, last]) => {
    let best: TransferPoint | null = null;
    for (let i = first; i <= last; i++) {
      const s = a.samples[i % n]!;
      const pr = nearest.get(s.m)!;
      if (!best || Math.round(pr.distM) < Math.round(best.straightM)) best = { fromM: s.m, toM: pr.measureM, from: { lat: s.lat, lng: s.lng }, to: pr.point, straightM: pr.distM };
    }
    return { ...best!, straightM: Math.round(best!.straightM) };
  }).sort((x, y) => x.fromM - y.fromM);
}

export type NamedStop = { id: string; name: string; lat: number; lng: number };
/** A same-variant pin with its measure along the variant's path. */
export type VariantPin = { stopId: string; measureM: number };

/** The name for a free board/alight point (§A), or null. */
export function nameFreePoint(
  net: { stops: readonly NamedStop[]; pins: ReadonlyMap<string, readonly VariantPin[]> },
  v: PathVariant, measureM: number, point: LatLng,
): { stopId: string; name: string } | null {
  const byId = new Map(net.stops.map((s) => [s.id, s]));
  const along = (m: number) => {
    const d = Math.abs(m - measureM);
    return v.isCircuit ? Math.min(d, v.lengthM - d) : d;
  };
  const pick = <T>(xs: readonly T[], dist: (x: T) => number) =>
    xs.map((x) => ({ x, d: dist(x) })).filter((c) => c.d <= NAME_RADIUS_M).sort((p, q) => p.d - q.d)[0]?.x;
  const pin = pick(net.pins.get(v.variantId) ?? [], (p) => along(p.measureM));
  const stop = pin ? byId.get(pin.stopId) : pick(net.stops, (s) => haversineMeters(s, point));
  return stop ? { stopId: stop.id, name: stop.name } : null;
}

