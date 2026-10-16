import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";
import { walkGraphPayloadSchema } from "@/domain/walk/format";
import { decodeWalkGraph, encodeWalkGraph, parseWalkGraph, routeWalk, snapWalk, WALK_SNAP_M, type WalkGraph, type WalkSnap } from "@/domain/walk/walk-graph";
import { buildWalkGraph } from "@/domain/walk/walk-graph-build";
import { chain, fakeRoadGraph, gridRoadGraph, type Piece } from "./walk-graph-fixtures";

const A: [number, number] = [13.62, 123.19];
const B: [number, number] = [13.621, 123.19];
const C: [number, number] = [13.621, 123.191];
const D: [number, number] = [13.62, 123.191];
const E: [number, number] = [13.6195, 123.1895];
const F: [number, number] = [13.6215, 123.1915];
const BEND: [number, number] = [13.6195, 123.1905];
const ll = ([lat, lng]: [number, number]): LatLng => ({ lat, lng });
const square = () =>
  decodeWalkGraph(
    buildWalkGraph(
      fakeRoadGraph(
        [A, B, C, D, E, F],
        [
          { a: 0, b: 1 },
          { a: 1, b: 2 },
          { a: 2, b: 3 },
          { a: 3, b: 0, via: [BEND] },
          { a: 0, b: 4 },
          { a: 2, b: 5 },
        ],
      ),
      { roadSource: "TEST" },
    ).payload,
  );
const graphOf = (points: [number, number][], pieces: Piece[], min = 1) =>
  decodeWalkGraph(buildWalkGraph(fakeRoadGraph(points, pieces), { roadSource: "TEST", minComponentNodes: min }).payload);
const M_PER_DEG_LAT = 111_195;

describe("decode / encode", () => {
  it("decode → encode reproduces the payload exactly", () => {
    const grid = gridRoadGraph(4, 4);
    const payload = buildWalkGraph(fakeRoadGraph(grid.points, [...grid.pieces, { a: 0, b: 5, via: [[13.6203, 123.1904]] }]), { roadSource: "TEST" }).payload;
    expect(encodeWalkGraph(decodeWalkGraph(payload))).toEqual(payload);
    const sq = buildWalkGraph(fakeRoadGraph([A, B, C, D, E, F], [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0, via: [BEND] }, { a: 0, b: 4 }, { a: 2, b: 5 }]), { roadSource: "TEST" }).payload;
    expect(JSON.stringify(encodeWalkGraph(decodeWalkGraph(sq)))).toBe(JSON.stringify(sq));
  });

  it("round trip holds for random sub-networks (fast-check)", () => {
    const grid = gridRoadGraph(4, 5);
    fc.assert(
      fc.property(fc.subarray(grid.pieces, { minLength: 1 }), (pieces) => {
        const payload = buildWalkGraph(fakeRoadGraph(grid.points, pieces), { roadSource: "TEST", minComponentNodes: 1 }).payload;
        expect(encodeWalkGraph(decodeWalkGraph(payload))).toEqual(payload);
      }),
      { numRuns: 60 },
    );
  });

  it("parseWalkGraph refuses a malformed payload instead of throwing", () => {
    const good = buildWalkGraph(fakeRoadGraph(gridRoadGraph(2, 2).points, gridRoadGraph(2, 2).pieces), { roadSource: "TEST" }).payload;
    expect(parseWalkGraph(good).ok).toBe(true);
    expect(parseWalkGraph({ ...good, v: 2 }).ok).toBe(false);
    expect(parseWalkGraph({ ...good, edges: [0, 99, 10, 0] }).ok).toBe(false);
    expect(parseWalkGraph({ ...good, edges: [1, 0, 10, 0] }).ok).toBe(false);
    expect(parseWalkGraph({ ...good, geom: [1, 2] }).ok).toBe(false);
    expect(parseWalkGraph({ ...good, nodes: [1.5, 2] }).ok).toBe(false);
    expect(parseWalkGraph("nope").ok).toBe(false);
    expect(walkGraphPayloadSchema.safeParse({ ...good, edges: [0, 1, 10] }).success).toBe(false);
  });
});

describe("routeWalk: shortest path", () => {
  it("equals the hand-computed shortest path (A → C via B, not the bent D side)", () => {
    const g = square();
    const r = routeWalk(g, ll(A), ll(C));
    expect(r.kind).toBe("path");
    if (r.kind !== "path") return;
    const viaB = haversineMeters(ll(A), ll(B)) + haversineMeters(ll(B), ll(C));
    expect(r.lengthM).toBeCloseTo(viaB, 0);
    expect(Math.abs(r.lengthM - viaB)).toBeLessThanOrEqual(0.1);
    expect(r.snapFromM).toBe(0);
    expect(r.snapToM).toBe(0);
    expect(r.coords).toEqual([ll(A), ll(B), ll(C)]);
  });

  it("uses the partial edges at both snapped points and adds the two snap legs to the length", () => {
    const g = square();
    // Start 20 m west of the midpoint of A-B; end 30 m east of the midpoint of C-D (both run north-south).
    const from = { lat: 13.6205, lng: 123.19 - 20 / (M_PER_DEG_LAT * Math.cos((13.6205 * Math.PI) / 180)) };
    const to = { lat: 13.6205, lng: 123.191 + 30 / (M_PER_DEG_LAT * Math.cos((13.6205 * Math.PI) / 180)) };
    const r = routeWalk(g, from, to);
    expect(r.kind).toBe("path");
    if (r.kind !== "path") return;
    expect(r.snapFromM).toBeCloseTo(20, 0);
    expect(r.snapToM).toBeCloseTo(30, 0);
    const halfAB = haversineMeters(ll(A), ll(B)) / 2;
    const expected = 20 + halfAB + haversineMeters(ll(B), ll(C)) + haversineMeters(ll(C), ll(D)) / 2 + 30;
    expect(Math.abs(r.lengthM - expected)).toBeLessThan(0.5);
    expect(r.coords[0]).toEqual(from);
    expect(r.coords.at(-1)).toEqual(to);
    expect(r.coords).toContainEqual(ll(B));
    expect(r.coords).toContainEqual(ll(C));
  });

  it("both ends on one edge: walks along it (no node needed)", () => {
    const g = square();
    const r = routeWalk(g, { lat: 13.6202, lng: 123.19 }, { lat: 13.6208, lng: 123.19 });
    expect(r.kind).toBe("path");
    if (r.kind !== "path") return;
    expect(Math.abs(r.lengthM - 0.0006 * M_PER_DEG_LAT)).toBeLessThan(0.3);
    expect(r.coords).toHaveLength(2);
  });

  it("same point → a zero-length path", () => {
    const r = routeWalk(square(), ll(A), ll(A));
    expect(r).toMatchObject({ kind: "path", lengthM: 0 });
  });
});

describe("routeWalk: fallbacks", () => {
  it("an end 150 m from any edge → straight (no_edge_near_end); a start → no_edge_near_start", () => {
    const g = square();
    const far = { lat: 13.6215 + 150 / M_PER_DEG_LAT, lng: 123.1915 }; // 150 m north of F, the northernmost point
    expect(routeWalk(g, ll(A), far)).toMatchObject({ kind: "straight", reason: "no_edge_near_end" });
    expect(routeWalk(g, far, ll(A))).toMatchObject({ kind: "straight", reason: "no_edge_near_start" });
    expect(WALK_SNAP_M).toBe(100);
  });

  it("a disconnected island → no_path", () => {
    const main = gridRoadGraph(3, 3);
    const island = chain(3, [13.63, 123.19], 9);
    const g = graphOf([...main.points, ...island.points], [...main.pieces, ...island.pieces]);
    expect(routeWalk(g, { lat: 13.63, lng: 123.1902 }, ll(A))).toMatchObject({ kind: "straight", reason: "no_path" });
  });
});

describe("snapWalk: prefers the largest component", () => {
  const main = gridRoadGraph(3, 3);
  // Island chain along lat 13.6226, ≈ 67 m north of the grid's top row (13.622).
  const island = chain(3, [13.6226, 123.19], 9);
  const g = graphOf([...main.points, ...island.points], [...main.pieces, ...island.pieces]);
  const top = 13.622;

  it("snaps to the main network when the island is nearer but not within a few metres", () => {
    // 20 m south of the island, 46.7 m north of the main grid's top row.
    const p = { lat: 13.6226 - 20 / M_PER_DEG_LAT, lng: 123.1901 };
    const s = snapWalk(g, p)!;
    expect(g.component[g.edgeA[s.edge]!]).toBe(g.mainComponent);
    expect(s.distM).toBeCloseTo((p.lat - top) * M_PER_DEG_LAT, 0);
  });

  it("snaps to the island when the point is clearly on it (≤ 5 m)", () => {
    const p = { lat: 13.6226 + 2 / M_PER_DEG_LAT, lng: 123.1901 };
    const s = snapWalk(g, p)!;
    expect(g.component[g.edgeA[s.edge]!]).not.toBe(g.mainComponent);
    expect(s.distM).toBeCloseTo(2, 0);
  });
});

/** Reference: plain Dijkstra (O(n²)) over the decoded arrays, from the same snaps. */
function dijkstraLength(g: WalkGraph, sf: WalkSnap, st: WalkSnap): number {
  const len = (e: number) => g.edgeLenDm[e]! / 10;
  const dist = new Array<number>(g.nodeCount).fill(Infinity);
  const done = new Array<boolean>(g.nodeCount).fill(false);
  const fa = g.edgeA[sf.edge]!;
  const fb = g.edgeB[sf.edge]!;
  dist[fa] = Math.min(dist[fa]!, sf.alongM);
  dist[fb] = Math.min(dist[fb]!, len(sf.edge) - sf.alongM);
  for (;;) {
    let u = -1;
    for (let i = 0; i < g.nodeCount; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) break;
    done[u] = true;
    for (let k = g.adjStart[u]!; k < g.adjStart[u + 1]!; k++) {
      const e = g.adjEdge[k]!;
      const v = g.edgeA[e] === u ? g.edgeB[e]! : g.edgeA[e]!;
      if (dist[u]! + len(e) < dist[v]!) dist[v] = dist[u]! + len(e);
    }
  }
  let best = Infinity;
  if (sf.edge === st.edge) best = Math.abs(sf.alongM - st.alongM);
  best = Math.min(best, dist[g.edgeA[st.edge]!]! + st.alongM, dist[g.edgeB[st.edge]!]! + len(st.edge) - st.alongM);
  return best;
}

describe("routeWalk: A* equals Dijkstra (fast-check)", () => {
  const grid = gridRoadGraph(6, 6);
  const point = fc.record({ lat: fc.double({ min: 13.6195, max: 13.6255, noNaN: true }), lng: fc.double({ min: 123.1895, max: 123.1955, noNaN: true }) });

  it("on random sub-networks with bent edges and random end points", () => {
    fc.assert(
      fc.property(
        fc.subarray(grid.pieces, { minLength: 10 }),
        fc.array(fc.tuple(fc.double({ min: -0.0004, max: 0.0004, noNaN: true }), fc.double({ min: -0.0004, max: 0.0004, noNaN: true })), { minLength: 60, maxLength: 60 }),
        fc.array(fc.tuple(point, point), { minLength: 5, maxLength: 5 }),
        (pieces, bends, pairs) => {
          const bent = pieces.map((p, i) => {
            const [pa, pb] = [grid.points[p.a]!, grid.points[p.b]!];
            const [dla, dln] = bends[i % bends.length]!;
            return i % 3 === 0 ? { ...p, via: [[(pa[0] + pb[0]) / 2 + dla, (pa[1] + pb[1]) / 2 + dln]] as [number, number][] } : p;
          });
          const g = graphOf(grid.points, bent);
          for (const [from, to] of pairs) {
            const r = routeWalk(g, from, to);
            const sf = snapWalk(g, from);
            const st = snapWalk(g, to);
            if (!sf || !st) {
              expect(r.kind).toBe("straight");
              continue;
            }
            const ref = dijkstraLength(g, sf, st);
            if (ref === Infinity) {
              expect(r).toMatchObject({ kind: "straight", reason: "no_path" });
              continue;
            }
            expect(r.kind).toBe("path");
            if (r.kind === "path") expect(Math.abs(r.lengthM - r.snapFromM - r.snapToM - ref)).toBeLessThan(1e-6);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});
