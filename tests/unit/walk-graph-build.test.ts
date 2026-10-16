import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { buildRoadGraph } from "@/domain/geo/road-graph";
import { parseOsmRoads } from "@/domain/import/osm-roads";
import { walkGraphPayloadSchema } from "@/domain/walk/format";
import { buildWalkGraph } from "@/domain/walk/walk-graph-build";
import { chain, fakeRoadGraph, gridRoadGraph, type Piece } from "./walk-graph-fixtures";

// Square A-B-C-D with spurs A-E and C-F; D-A bends south-west (longer). B and D have degree 2.
const A: [number, number] = [13.62, 123.19];
const B: [number, number] = [13.621, 123.19];
const C: [number, number] = [13.621, 123.191];
const D: [number, number] = [13.62, 123.191];
const E: [number, number] = [13.6195, 123.1895];
const F: [number, number] = [13.6215, 123.1915];
const BEND: [number, number] = [13.6195, 123.1905];
const squarePoints = [A, B, C, D, E, F];
const squarePieces: Piece[] = [
  { a: 0, b: 1 },
  { a: 1, b: 2 },
  { a: 2, b: 3 },
  { a: 3, b: 0, via: [BEND] },
  { a: 0, b: 4 },
  { a: 2, b: 5 },
];
const ll = ([lat, lng]: [number, number]) => ({ lat, lng });
const e5 = (x: number) => Math.round(x * 1e5);

/** Decodes the payload's node list back to integer pairs. */
function nodesE5(nodes: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < nodes.length; i += 2) {
    lat += nodes[i]!;
    lng += nodes[i + 1]!;
    out.push([lat, lng]);
  }
  return out;
}
function edgeQuads(edges: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < edges.length; i += 4) out.push(edges.slice(i, i + 4));
  return out;
}

const build = (points: readonly [number, number][], pieces: readonly Piece[], min?: number) =>
  buildWalkGraph(fakeRoadGraph(points, pieces), { roadSource: "TEST", ...(min === undefined ? {} : { minComponentNodes: min }) });

describe("buildWalkGraph: profile and format", () => {
  it("refuses a vehicle road graph (D7 filters come from the walk profile)", () => {
    const roads = parseOsmRoads(JSON.parse(readFileSync("tests/fixtures/osm/roads-synthetic.osm.json", "utf8")));
    expect(() => buildWalkGraph(buildRoadGraph(roads, { profile: "vehicle" }), { roadSource: "TEST" })).toThrow(/walk/);
    const { payload } = buildWalkGraph(buildRoadGraph(roads, { profile: "walk" }), { roadSource: "TEST" });
    expect(walkGraphPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("emits v1 with integer precision-5 coordinates, the road source and the bbox over every point", () => {
    const { payload } = build(squarePoints, squarePieces);
    expect(payload.v).toBe(1);
    expect(payload.roadSource).toBe("TEST");
    expect(walkGraphPayloadSchema.safeParse(payload).success).toBe(true);
    for (const x of [...payload.nodes, ...payload.edges, ...payload.geom, ...payload.bbox]) expect(Number.isInteger(x)).toBe(true);
    // South/west come from the spur end E (13.6195, 123.1895); north/east from F.
    expect(payload.bbox).toEqual([e5(13.6195), e5(123.1895), e5(13.6215), e5(123.1915)]);
  });
});

describe("buildWalkGraph: degree-2 contraction", () => {
  it("drops degree-2 nodes into edge geometry and sums the lengths (decimetres)", () => {
    const { payload, stats } = build(squarePoints, squarePieces);
    const nodes = nodesE5(payload.nodes);
    // Kept: A, C, E, F (sorted by lat, then lng): E, A, C, F.
    expect(nodes).toEqual([E, A, C, F].map(([la, ln]) => [e5(la), e5(ln)]));
    expect(stats).toMatchObject({ nodes: 4, edges: 4 });
    const quads = edgeQuads(payload.edges);
    const iA = 1;
    const iC = 2;
    const viaB = Math.round((haversineMeters(ll(A), ll(B)) + haversineMeters(ll(B), ll(C))) * 10);
    const viaD = Math.round((haversineMeters(ll(A), ll(BEND)) + haversineMeters(ll(BEND), ll(D)) + haversineMeters(ll(D), ll(C))) * 10);
    const ac = quads.filter(([a, b]) => a === iA && b === iC);
    expect(ac.map(([, , len, n]) => [len, n]).sort((x, y) => x[0]! - y[0]!)).toEqual([
      [viaB, 1],
      [viaD, 2],
    ]);
    expect(payload.geom).toHaveLength(6); // B (1 point) + BEND, D (2 points); the spurs have none
  });

  it("a ring with no junction becomes one node with a loop edge", () => {
    const { payload, stats } = build(
      [A, B, C, D],
      [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
        { a: 2, b: 3 },
        { a: 3, b: 0 },
      ],
    );
    expect(stats).toMatchObject({ nodes: 1, edges: 1 });
    expect(edgeQuads(payload.edges)).toEqual([[0, 0, expect.any(Number), 3]]);
  });

  it("edge length is never below the haversine length of the rounded polyline", () => {
    // Points with 7 dp: rounding moves them, the length must still cover the rounded chord.
    const { payload } = build(
      [
        [13.6200049, 123.1900049],
        [13.6200149, 123.1900049],
        [13.62, 123.19],
      ],
      [
        { a: 0, b: 1 },
        { a: 0, b: 2 },
        { a: 1, b: 2 },
      ],
    );
    const nodes = nodesE5(payload.nodes);
    for (const [a, b, len, n] of edgeQuads(payload.edges)) {
      if (n !== 0) continue;
      const chord = haversineMeters({ lat: nodes[a!]![0] / 1e5, lng: nodes[a!]![1] / 1e5 }, { lat: nodes[b!]![0] / 1e5, lng: nodes[b!]![1] / 1e5 });
      expect(len! / 10).toBeGreaterThanOrEqual(chord);
    }
  });
});

describe("buildWalkGraph: components", () => {
  it("keeps the largest component plus every component over the threshold; drops and counts the rest", () => {
    const grid = gridRoadGraph(3, 3);
    const big = chain(5, [13.64, 123.2], 9); // 5 nodes > 4: kept
    const small = chain(4, [13.65, 123.2], 14); // 4 nodes: dropped
    const { payload, stats } = build([...grid.points, ...big.points, ...small.points], [...grid.pieces, ...big.pieces, ...small.pieces], 4);
    expect(stats).toMatchObject({ components: 3, keptComponents: 2, droppedComponents: 1, droppedNodes: 4 });
    expect(stats.droppedLengthM).toBeCloseTo(3 * haversineMeters({ lat: 13.65, lng: 123.2 }, { lat: 13.65, lng: 123.2002 }), 6);
    const lats = nodesE5(payload.nodes).map(([la]) => la);
    expect(lats).toContain(e5(13.64));
    expect(lats).not.toContain(e5(13.65));
  });

  it("default threshold: over 50 nodes (51 kept, 50 dropped)", () => {
    const grid = gridRoadGraph(10, 10); // 100 nodes: the largest
    const keep = chain(51, [13.64, 123.2], 100);
    const drop = chain(50, [13.65, 123.2], 151);
    const { stats } = build([...grid.points, ...keep.points, ...drop.points], [...grid.pieces, ...keep.pieces, ...drop.pieces]);
    expect(stats).toMatchObject({ components: 3, keptComponents: 2, droppedComponents: 1, droppedNodes: 50 });
  });
});

describe("buildWalkGraph: deterministic", () => {
  it("same pieces in any order and direction → byte-identical payload", () => {
    const grid = gridRoadGraph(4, 5);
    const pieces = [...grid.pieces, { a: 0, b: 6, via: [[13.6203, 123.1904]] as [number, number][] }];
    const reference = JSON.stringify(build(grid.points, pieces).payload);
    fc.assert(
      fc.property(fc.shuffledSubarray(pieces, { minLength: pieces.length }), fc.array(fc.boolean(), { minLength: pieces.length, maxLength: pieces.length }), (order, flips) => {
        const turned = order.map((p, i) => (flips[i] ? { a: p.b, b: p.a, ...(p.via ? { via: [...p.via].reverse() } : {}) } : p));
        expect(JSON.stringify(build(grid.points, turned).payload)).toBe(reference);
      }),
      { numRuns: 50 },
    );
  });
});
