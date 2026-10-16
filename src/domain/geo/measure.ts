// Line measures: length along a polyline and the projection of a point onto it. Pure.
// Projection uses local planar metres (equirectangular around the point): accurate at city scale.
import { haversineMeters } from "./geometry";
import type { LatLng } from "./types";

const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;

/** Haversine length of a polyline, in metres. */
export function lineLengthM(line: readonly LatLng[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += haversineMeters(line[i - 1]!, line[i]!);
  return m;
}

export type LineProjection = {
  /** Distance along the line from its start to the projected point, in metres. */
  measureM: number;
  /** Distance from the point to the line, in metres. */
  distM: number;
  /** Index of the segment's end vertex (1-based segment number). */
  segment: number;
  point: LatLng;
};

/** The nearest point of `line` (at least 2 points) to `p`. Ties go to the earlier segment. */
export function projectOnLine(line: readonly LatLng[], p: LatLng): LineProjection {
  if (line.length < 2) throw new Error("projectOnLine: a line needs at least 2 points");
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
  const xy = (q: LatLng): [number, number] => [(q.lng - p.lng) * mPerDegLng, (q.lat - p.lat) * M_PER_DEG_LAT];
  let best = { d2: Infinity, seg: 1, u: 0 };
  for (let s = 1; s < line.length; s++) {
    const [ax, ay] = xy(line[s - 1]!);
    const [bx, by] = xy(line[s]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
    const qx = ax + u * dx;
    const qy = ay + u * dy;
    const d2 = qx * qx + qy * qy;
    if (d2 < best.d2) best = { d2, seg: s, u };
  }
  const a = line[best.seg - 1]!;
  const b = line[best.seg]!;
  const point = { lat: a.lat + best.u * (b.lat - a.lat), lng: a.lng + best.u * (b.lng - a.lng) };
  const measureM = lineLengthM(line.slice(0, best.seg)) + haversineMeters(a, point);
  return { measureM, distM: Math.sqrt(best.d2), segment: best.seg, point };
}
