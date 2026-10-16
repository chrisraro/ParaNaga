// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";
import { sampleChevrons } from "@/ui/map/direction-chevrons";
import { shouldDashSegment, splitLineIntoRuns } from "@/ui/map/route-lines-layer";
import { midpointOnPolyline, rideStrokeLayers, slicePolylineByMeasure } from "@/ui/map/trip-lines-layer";

const SQUARE_CIRCUIT: LatLng[] = [
  { lat: 13.62, lng: 123.18 },
  { lat: 13.625, lng: 123.18 },
  { lat: 13.625, lng: 123.185 },
  { lat: 13.62, lng: 123.185 },
  { lat: 13.62, lng: 123.18 },
];

function polylineLengthM(coords: readonly LatLng[]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversineMeters(coords[i - 1]!, coords[i]!);
  }
  return sum;
}

describe("slicePolylineByMeasure", () => {
  it("slices a linear segment [fromM, toM] along a polyline", () => {
    const total = polylineLengthM(SQUARE_CIRCUIT);
    const sliced = slicePolylineByMeasure(SQUARE_CIRCUIT, 200, 900, { isCircular: false, totalLengthM: total });
    expect(sliced.length).toBeGreaterThanOrEqual(2);
    expect(polylineLengthM(sliced)).toBeCloseTo(700, 0);
  });

  it("slices a circuit across the start when boardMeasureM > alightMeasureM", () => {
    const total = polylineLengthM(SQUARE_CIRCUIT);
    const fromM = total - 300;
    const toM = 400;
    const sliced = slicePolylineByMeasure(SQUARE_CIRCUIT, fromM, toM, { isCircular: true, totalLengthM: total });
    expect(sliced.length).toBeGreaterThanOrEqual(3);
    // Total wrapped length should be ~300 m + ~400 m = ~700 m.
    expect(polylineLengthM(sliced)).toBeCloseTo(700, 0);
    // And it passes through the circuit origin (13.62, 123.18).
    expect(sliced.some((p) => Math.abs(p.lat - 13.62) < 1e-5 && Math.abs(p.lng - 123.18) < 1e-5)).toBe(true);
  });

  it("scales proportionally when stored totalLengthM differs slightly from haversine sum", () => {
    const raw = polylineLengthM(SQUARE_CIRCUIT);
    const sliced = slicePolylineByMeasure(SQUARE_CIRCUIT, 0, raw * 0.5, { isCircular: false, totalLengthM: raw });
    expect(polylineLengthM(sliced)).toBeCloseTo(raw * 0.5, 0);
  });
});

describe("rideStrokeLayers (two-tone layering order)", () => {
  it("layers casing → solid traditional base → dashed modern secondary (24 24) for mixed_trad_modern", () => {
    const layers = rideStrokeLayers("mixed_trad_modern");
    expect(layers).toEqual([
      { role: "casing", visualKey: "traditional_puj", dashArray: null, className: "pn-line pn-line--casing" },
      { role: "base", visualKey: "traditional_puj", dashArray: null, className: "pn-line pn-line--ride" },
      { role: "secondary", visualKey: "modern_puj", dashArray: "24 24", className: "pn-line pn-line--ride pn-line--ride-secondary" },
    ]);
  });

  it("layers casing → solid core for a single-class route", () => {
    const layers = rideStrokeLayers("traditional_puj");
    expect(layers).toEqual([
      { role: "casing", visualKey: "traditional_puj", dashArray: null, className: "pn-line pn-line--casing" },
      { role: "base", visualKey: "traditional_puj", dashArray: null, className: "pn-line pn-line--ride" },
    ]);
  });
});

describe("midpointOnPolyline and sampleChevrons", () => {
  it("finds the midpoint along a polyline and samples chevrons every 250 m", () => {
    const mid = midpointOnPolyline(SQUARE_CIRCUIT);
    expect(mid).not.toBeNull();
    const chevrons = sampleChevrons(SQUARE_CIRCUIT, 250);
    expect(chevrons.length).toBeGreaterThanOrEqual(7);
    // First edge goes due north (bearing ~0 deg).
    expect(chevrons[0]!.bearingDeg).toBeCloseTo(0, 0);
  });
});

describe("shouldDashSegment and splitLineIntoRuns (Task 5 ruling)", () => {
  it("dashes oneway_conflict on ok paths only when lengthM >= 100, and never dashes terminal_access", () => {
    expect(shouldDashSegment({ fromM: 0, toM: 81, lengthM: 81, reason: "oneway_conflict", streets: [], against: ["x"] }, "ok")).toBe(false);
    expect(shouldDashSegment({ fromM: 0, toM: 120, lengthM: 120, reason: "oneway_conflict", streets: [], against: ["x"] }, "ok")).toBe(true);
    expect(shouldDashSegment({ fromM: 0, toM: 50, lengthM: 50, reason: "off_list_detour", streets: [], against: null }, "ok")).toBe(false);
    expect(shouldDashSegment({ fromM: 0, toM: 50, lengthM: 50, reason: "off_list_detour", streets: [], against: null }, "flagged")).toBe(true);
    expect(shouldDashSegment({ fromM: 0, toM: 500, lengthM: 500, reason: "terminal_access", streets: [], against: null }, "flagged")).toBe(false);
  });

  it("splits a polyline into solid and dashed runs for cautioned segments", () => {
    const total = polylineLengthM(SQUARE_CIRCUIT);
    const runs = splitLineIntoRuns(
      SQUARE_CIRCUIT,
      total,
      [{ fromM: 200, toM: 600, lengthM: 400, reason: "oneway_conflict", streets: [], against: ["gen luna"] }],
      "ok",
    );
    expect(runs.map((r) => ({ dashed: r.dashed, reason: r.reason }))).toEqual([
      { dashed: false, reason: null },
      { dashed: true, reason: "oneway_conflict" },
      { dashed: false, reason: null },
    ]);
  });
});
