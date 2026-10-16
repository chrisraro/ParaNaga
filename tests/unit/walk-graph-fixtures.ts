// Hand-made walk road graphs for the walk-graph tests (fake coordinates near Naga, not OSM data).
import { haversineMeters } from "@/domain/geo/geometry";
import type { RoadEdge, RoadGraph } from "@/domain/geo/road-graph";
import type { LatLng } from "@/domain/geo/types";

export type Piece = { a: number; b: number; via?: [number, number][] };

/** A walk-profile road graph: every piece gives two directed edges (twins), like buildRoadGraph. */
export function fakeRoadGraph(points: readonly [number, number][], pieces: readonly Piece[]): Pick<RoadGraph, "profile" | "nodes" | "edges"> {
  const nodes = points.map(([lat, lng], i) => ({ osmId: 1000 + i, lat, lng }));
  const edges: RoadEdge[] = [];
  pieces.forEach((p, k) => {
    const coords: LatLng[] = [
      { lat: points[p.a]![0], lng: points[p.a]![1] },
      ...(p.via ?? []).map(([lat, lng]) => ({ lat, lng })),
      { lat: points[p.b]![0], lng: points[p.b]![1] },
    ];
    let lengthM = 0;
    for (let i = 1; i < coords.length; i++) lengthM += haversineMeters(coords[i - 1]!, coords[i]!);
    const base = { wayId: 1 + k, names: [], lengthM };
    const f = edges.length;
    edges.push({ index: f, from: p.a, to: p.b, ...base, coords, reverse: false, twin: f + 1 });
    edges.push({ index: f + 1, from: p.b, to: p.a, ...base, coords: [...coords].reverse(), reverse: true, twin: f });
  });
  return { profile: "walk", nodes, edges };
}

/** `rows` × `cols` grid, 0.001° apart, from (13.62, 123.19); node index r * cols + c. */
export function gridRoadGraph(rows: number, cols: number, origin: [number, number] = [13.62, 123.19]) {
  const points: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) points.push([origin[0] + r * 0.001, origin[1] + c * 0.001]);
  const pieces: Piece[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) pieces.push({ a: r * cols + c, b: r * cols + c + 1 });
      if (r + 1 < rows) pieces.push({ a: r * cols + c, b: (r + 1) * cols + c });
    }
  }
  return { points, pieces };
}

/** A chain of `n` road nodes 20 m apart heading east from `origin` (one component of n nodes). */
export function chain(n: number, origin: [number, number], firstIndex: number) {
  const points: [number, number][] = [];
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    points.push([origin[0], origin[1] + i * 0.0002]);
    if (i > 0) pieces.push({ a: firstIndex + i - 1, b: firstIndex + i });
  }
  return { points, pieces };
}
