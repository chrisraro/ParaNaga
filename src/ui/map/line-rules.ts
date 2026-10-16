// Pure geometry and segment rules for the approximate route lines (Task 12, Task 5 rulings).
// No Leaflet import: the trip detail and route detail use these for their notes, and the map layers
// use them to draw. Measures are metres along the published line (`Line.lengthM`).
//
// Rendering rules (binding, applied to trip ride slices, the route overview and route detail):
// - `off_list_detour` is dashed only when the whole trace is `flagged`;
// - `oneway_conflict` is dashed on a flagged trace, and at >= 100 m even on an `ok` trace, with the
//   visible caution ONEWAY_CAUTION wherever such a section is drawn;
// - `terminal_access` is drawn normally, with the note TERMINAL_ACCESS_NOTE.
import type { Line, Lines, UntracedLine } from "@/domain/api/schemas";
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";

type TraceSegment = Line["segments"][number];

export const ONEWAY_CAUTION = "street order conflicts with one-way mapping — confirm on the ground" as const;
export const TERMINAL_ACCESS_NOTE = "terminal access road" as const;
/** Trip detail, for a ride with no drawn path. */
export const UNTRACED_RIDE_LABEL = "Path could not be traced from the street list; stops shown only" as const;

export type SliceOptions = {
  isCircular?: boolean;
  totalLengthM?: number | null;
};

/**
 * Linearly slices `coords` between `[fromM, toM]` (metres from the start of the polyline).
 * When `isCircular` is true and `fromM > toM`, wraps across the start (`[fromM, total] + [0, toM]`).
 */
export function slicePolylineByMeasure(
  coords: readonly LatLng[],
  fromM: number,
  toM: number,
  options: SliceOptions = {},
): LatLng[] {
  if (coords.length < 2) return [...coords];

  const segLengths: number[] = [];
  let rawTotalM = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i - 1]!, coords[i]!);
    segLengths.push(d);
    rawTotalM += d;
  }
  if (rawTotalM <= 0) return [coords[0]!, coords[coords.length - 1]!];

  const nominalTotalM = options.totalLengthM && options.totalLengthM > 0 ? options.totalLengthM : rawTotalM;
  const scale = rawTotalM / nominalTotalM;

  const clampRaw = (m: number) => Math.max(0, Math.min(rawTotalM, m * scale));

  const sliceLinearRaw = (startRawM: number, endRawM: number): LatLng[] => {
    const lo = Math.max(0, Math.min(rawTotalM, Math.min(startRawM, endRawM)));
    const hi = Math.max(0, Math.min(rawTotalM, Math.max(startRawM, endRawM)));
    if (hi - lo < 1e-3) {
      const pt = pointAtRawMeasure(coords, segLengths, lo);
      return [pt, pt];
    }
    const out: LatLng[] = [pointAtRawMeasure(coords, segLengths, lo)];
    let acc = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const nextAcc = acc + segLengths[i]!;
      if (nextAcc > lo + 1e-3 && nextAcc < hi - 1e-3) {
        out.push(coords[i + 1]!);
      }
      acc = nextAcc;
    }
    out.push(pointAtRawMeasure(coords, segLengths, hi));
    return out;
  };

  if (options.isCircular && fromM > toM) {
    const firstHalf = sliceLinearRaw(clampRaw(fromM), rawTotalM);
    const secondHalf = sliceLinearRaw(0, clampRaw(toM));
    if (firstHalf.length === 0) return secondHalf;
    if (secondHalf.length === 0) return firstHalf;
    const lastFirst = firstHalf[firstHalf.length - 1]!;
    const firstSecond = secondHalf[0]!;
    const dup = haversineMeters(lastFirst, firstSecond) < 0.5;
    return dup ? [...firstHalf, ...secondHalf.slice(1)] : [...firstHalf, ...secondHalf];
  }

  return sliceLinearRaw(clampRaw(fromM), clampRaw(toM));
}

function pointAtRawMeasure(coords: readonly LatLng[], segLengths: readonly number[], targetRawM: number): LatLng {
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i]!;
    if (acc + segLen >= targetRawM || i === segLengths.length - 1) {
      const a = coords[i]!;
      const b = coords[i + 1]!;
      const t = segLen > 0 ? Math.min(1, Math.max(0, (targetRawM - acc) / segLen)) : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    acc += segLen;
  }
  return coords[coords.length - 1]!;
}

/** Returns the geographic midpoint at 50% of the polyline's cumulative length. */
export function midpointOnPolyline(coords: readonly LatLng[]): LatLng | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0]!;
  const segLengths: number[] = [];
  let totalM = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i - 1]!, coords[i]!);
    segLengths.push(d);
    totalM += d;
  }
  if (totalM <= 0) return coords[0]!;
  return pointAtRawMeasure(coords, segLengths, totalM / 2);
}

export type PolylineRun = {
  coords: LatLng[];
  fromM: number;
  toM: number;
  dashed: boolean;
  reason: TraceSegment["reason"] | null;
};

/**
 * Task 5 ruling:
 * - `terminal_access` is always solid.
 * - `off_list_detour` is dashed only when `lineStatus === "flagged"`.
 * - `oneway_conflict` is dashed when `lineStatus === "flagged"` or `segment.lengthM >= 100`
 *   (so R3's 72 m / 81 m segments stay solid).
 */
export function shouldDashSegment(segment: TraceSegment, lineStatus: "ok" | "flagged"): boolean {
  if (segment.reason === "terminal_access") return false;
  if (segment.reason === "off_list_detour") return lineStatus === "flagged";
  if (segment.reason === "oneway_conflict") {
    return lineStatus === "flagged" || segment.lengthM >= 100;
  }
  return false;
}

/**
 * Splits a decoded route polyline into contiguous solid and dashed runs according to `shouldDashSegment`.
 */
export function splitLineIntoRuns(
  coords: readonly LatLng[],
  totalLengthM: number,
  segments: readonly TraceSegment[],
  lineStatus: "ok" | "flagged",
): PolylineRun[] {
  if (coords.length < 2) return [];
  const dashedSegs = segments
    .filter((s) => shouldDashSegment(s, lineStatus) && s.toM > s.fromM)
    .sort((a, b) => a.fromM - b.fromM);

  if (dashedSegs.length === 0) {
    return [{ coords: [...coords], fromM: 0, toM: totalLengthM, dashed: false, reason: null }];
  }

  const runs: PolylineRun[] = [];
  let cursorM = 0;

  for (const seg of dashedSegs) {
    const startM = Math.max(cursorM, Math.min(totalLengthM, seg.fromM));
    const endM = Math.max(startM, Math.min(totalLengthM, seg.toM));
    if (startM - cursorM > 1) {
      const solidSlice = slicePolylineByMeasure(coords, cursorM, startM, { isCircular: false, totalLengthM });
      if (solidSlice.length >= 2) {
        runs.push({ coords: solidSlice, fromM: cursorM, toM: startM, dashed: false, reason: null });
      }
    }
    if (endM - startM > 1) {
      const dashedSlice = slicePolylineByMeasure(coords, startM, endM, { isCircular: false, totalLengthM });
      if (dashedSlice.length >= 2) {
        runs.push({ coords: dashedSlice, fromM: startM, toM: endM, dashed: true, reason: seg.reason });
      }
    }
    cursorM = Math.max(cursorM, endM);
  }

  if (totalLengthM - cursorM > 1) {
    const tailSlice = slicePolylineByMeasure(coords, cursorM, totalLengthM, { isCircular: false, totalLengthM });
    if (tailSlice.length >= 2) {
      runs.push({ coords: tailSlice, fromM: cursorM, toM: totalLengthM, dashed: false, reason: null });
    }
  }

  return runs.length > 0
    ? runs
    : [{ coords: [...coords], fromM: 0, toM: totalLengthM, dashed: false, reason: null }];
}

/** The measure intervals a ride covers: `[from, to]`, or `[from, total] + [0, to]` across a circuit's start. */
export function rideIntervals(fromM: number, toM: number, totalLengthM: number, isCircular: boolean): [number, number][] {
  const clamp = (m: number) => Math.max(0, Math.min(totalLengthM, m));
  if (isCircular && fromM > toM) return [[clamp(fromM), totalLengthM], [0, clamp(toM)]];
  return [[clamp(Math.min(fromM, toM)), clamp(Math.max(fromM, toM))]];
}

/**
 * The solid and dashed runs of one ride: the line restricted to the ride's interval(s), cut where a
 * segment is dashed under `shouldDashSegment`. Each run is sliced from the full line, so a dashed
 * section keeps its exact geometry.
 */
export function rideRuns(
  coords: readonly LatLng[],
  totalLengthM: number,
  segments: readonly TraceSegment[],
  lineStatus: "ok" | "flagged",
  fromM: number,
  toM: number,
  isCircular: boolean,
): PolylineRun[] {
  if (coords.length < 2 || !(totalLengthM > 0)) return [];
  const dashedSegs = segments
    .filter((s) => shouldDashSegment(s, lineStatus) && s.toM > s.fromM)
    .sort((a, b) => a.fromM - b.fromM);
  const runs: PolylineRun[] = [];
  const push = (a: number, b: number, dashed: boolean, reason: TraceSegment["reason"] | null) => {
    const slice = slicePolylineByMeasure(coords, a, b, { isCircular: false, totalLengthM });
    if (slice.length >= 2) runs.push({ coords: slice, fromM: a, toM: b, dashed, reason });
  };
  for (const [a, b] of rideIntervals(fromM, toM, totalLengthM, isCircular)) {
    if (b - a <= 0) continue;
    let cursor = a;
    for (const seg of dashedSegs) {
      const s = Math.max(cursor, seg.fromM);
      const e = Math.min(b, seg.toM);
      if (e <= s) continue;
      if (s - cursor > 0.5) push(cursor, s, false, null);
      push(s, e, true, seg.reason);
      cursor = e;
    }
    if (b - cursor > 0.5) push(cursor, b, false, null);
  }
  return runs;
}

export type LineNotes = {
  /** A dashed one-way-conflict section is drawn: show ONEWAY_CAUTION. */
  onewayCaution: boolean;
  /** A terminal access road is part of what is drawn: show TERMINAL_ACCESS_NOTE. */
  terminalAccess: boolean;
};

/** Which notes apply to a line, or to the part of it within `intervals` (a ride's slice). */
export function lineNotes(
  line: Pick<Line, "segments" | "status">,
  intervals: readonly (readonly [number, number])[] | null = null,
): LineNotes {
  const inView = (s: TraceSegment) =>
    intervals === null || intervals.some(([a, b]) => Math.min(b, s.toM) > Math.max(a, s.fromM));
  return {
    onewayCaution: line.segments.some((s) => s.reason === "oneway_conflict" && shouldDashSegment(s, line.status) && inView(s)),
    terminalAccess: line.segments.some((s) => s.reason === "terminal_access" && inView(s)),
  };
}

/**
 * The drawn line (or the untraced entry) for the direction shown on route detail. A two-way route
 * never falls back to the other direction's line: an untraced direction shows no line and
 * "Path could not be traced".
 */
export function routeDirectionPath(
  lines: Pick<Lines, "lines" | "untraced"> | null | undefined,
  routeCode: string,
  twoWay: boolean,
  direction: "inbound" | "outbound",
): { line: Line | null; untraced: UntracedLine | null } {
  if (!lines) return { line: null, untraced: null };
  const ofRoute = <T extends { routeCode: string; direction: string }>(items: readonly T[]) =>
    items.filter((item) => item.routeCode === routeCode && (!twoWay || item.direction === direction));
  const line = ofRoute(lines.lines)[0] ?? null;
  return { line, untraced: line ? null : (ofRoute(lines.untraced)[0] ?? null) };
}

export type RideTrace = {
  /** "Path could not be traced from the street list; stops shown only". */
  untraced: boolean;
  /** Notes for the part of the line the ride covers (none when the lines are not loaded). */
  notes: LineNotes;
};

const NO_NOTES: LineNotes = { onewayCaution: false, terminalAccess: false };

/**
 * Trace facts for one ride leg of a plan. Untraced comes from the leg itself (D13: a leg is measured
 * `approximate_path` only when its variant has a published path), so it holds in low-data mode where
 * the lines are not loaded; a loaded `lines` without the leg's variant also counts as untraced (no
 * line is drawn for it).
 */
export function rideTrace(
  leg: { variantId: string; distanceBasis: string; boardMeasureM: number | null; alightMeasureM: number | null },
  lines: Pick<Lines, "lines"> | null | undefined,
  isCircular: boolean,
): RideTrace {
  if (leg.distanceBasis !== "approximate_path") return { untraced: true, notes: NO_NOTES };
  if (!lines) return { untraced: false, notes: NO_NOTES };
  const line = lines.lines.find((l) => l.variantId === leg.variantId);
  if (!line) return { untraced: true, notes: NO_NOTES };
  if (leg.boardMeasureM === null || leg.alightMeasureM === null) return { untraced: false, notes: NO_NOTES };
  return { untraced: false, notes: lineNotes(line, rideIntervals(leg.boardMeasureM, leg.alightMeasureM, line.lengthM, isCircular)) };
}
