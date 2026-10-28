// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { encodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import { sampleChevrons } from "@/ui/map/direction-chevrons";
import { linesSchema, type Line, type Lines } from "@/domain/api/schemas";
import type { PlanResponse } from "@/domain/api/plan";
import { WALK_STRAIGHT_LABEL } from "@/domain/trip/enrich";
import { ONEWAY_CAUTION, TERMINAL_ACCESS_NOTE, lineNotes, rideRuns, rideTrace } from "@/ui/map/line-rules";
import { shouldDashSegment, splitLineIntoRuns } from "@/ui/map/route-lines-layer";
import { buildTripLinesData, midpointOnPolyline, rideStrokeLayers, slicePolylineByMeasure } from "@/ui/map/trip-lines-layer";
import linesFixture from "../e2e/fixtures/network/lines.json";
import { PROVISIONAL_PLAN, TWO_RIDE_PLAN } from "../e2e/fixtures/plan-responses";
import { streetOnly } from "./guidance-fixtures";

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

const LINES: Lines = linesSchema.parse(linesFixture);
const plan = PROVISIONAL_PLAN as unknown as PlanResponse;
const LOOP_A_ID = plan.variants[0]!.variantId;
const LOOP_A_LINE = LINES.lines.find((l) => l.variantId === LOOP_A_ID)!;

describe("rideRuns and lineNotes (T12-2: the same rules on trip ride slices)", () => {
  const total = polylineLengthM(SQUARE_CIRCUIT);
  const oneway = { fromM: 200, toM: 600, lengthM: 400, reason: "oneway_conflict" as const, streets: [], against: ["gen luna"] };
  const shortOneway = { fromM: 700, toM: 780, lengthM: 80, reason: "oneway_conflict" as const, streets: [], against: ["x"] };
  const terminal = { fromM: 1500, toM: 1700, lengthM: 200, reason: "terminal_access" as const, streets: [], against: null };
  const offList = { fromM: 900, toM: 1000, lengthM: 100, reason: "off_list_detour" as const, streets: [], against: null };

  it("restricts the runs to [board, alight], dashing only the >= 100 m one-way section on an ok trace", () => {
    const runs = rideRuns(SQUARE_CIRCUIT, total, [oneway, shortOneway, offList, terminal], "ok", 100, 1200, false);
    expect(runs.map((r) => [Math.round(r.fromM), Math.round(r.toM), r.dashed])).toEqual([
      [100, 200, false],
      [200, 600, true],
      [600, 1200, false],
    ]);
    expect(polylineLengthM(runs.flatMap((r, i) => (i === 0 ? r.coords : r.coords.slice(1))))).toBeCloseTo(1100, 0);
  });

  it("dashes off-list sections only on a flagged trace", () => {
    const flagged = rideRuns(SQUARE_CIRCUIT, total, [offList], "flagged", 0, 1200, false);
    expect(flagged.some((r) => r.dashed && r.reason === "off_list_detour")).toBe(true);
    const ok = rideRuns(SQUARE_CIRCUIT, total, [offList], "ok", 0, 1200, false);
    expect(ok.every((r) => !r.dashed)).toBe(true);
  });

  it("wraps across a circuit's start and keeps a dashed section that lies after the start", () => {
    const runs = rideRuns(SQUARE_CIRCUIT, total, [oneway], "ok", total - 300, 400, true);
    expect(runs.map((r) => [Math.round(r.fromM), Math.round(r.toM), r.dashed])).toEqual([
      [Math.round(total - 300), Math.round(total), false],
      [0, 200, false],
      [200, 400, true],
    ]);
  });

  it("notes the one-way caution and the terminal access road only for what is in view", () => {
    const line = { segments: [oneway, shortOneway, terminal], status: "ok" as const };
    expect(lineNotes(line)).toEqual({ onewayCaution: true, terminalAccess: true });
    expect(lineNotes(line, [[0, 150]])).toEqual({ onewayCaution: false, terminalAccess: false });
    expect(lineNotes(line, [[650, 800]])).toEqual({ onewayCaution: false, terminalAccess: false });
    expect(lineNotes(line, [[1600, 1650]])).toEqual({ onewayCaution: false, terminalAccess: true });
    expect(ONEWAY_CAUTION).toBe("street order conflicts with one-way mapping — confirm on the ground");
    expect(TERMINAL_ACCESS_NOTE).toBe("terminal access road");
  });
});

describe("buildTripLinesData (T12-1: variant id only)", () => {
  it("draws the ride on the plan variant's own line", () => {
    const data = buildTripLinesData(plan.plan.options[0]!, plan.variants, LINES);
    expect(data.rideSegments).toHaveLength(1);
    expect(data.rideSegments[0]!.variantId).toBe(LOOP_A_ID);
    expect(data.rideSegments[0]!.label).toBe(LOOP_A_LINE.label);
  });

  it("draws nothing for a ride whose variant has no line, even when another line has the same route code", () => {
    const option = structuredClone(plan.plan.options[0]!);
    const ride = option.legs.find((l) => l.kind === "ride")!;
    if (ride.kind === "ride") ride.variantId = "11111111-1111-4111-8111-111111111111";
    const data = buildTripLinesData(option, plan.variants, LINES);
    expect(data.rideSegments).toEqual([]);
    expect(data.walkSegments.length).toBeGreaterThan(0);
  });

  it("does not draw a straight-line (untraced) ride", () => {
    const two = TWO_RIDE_PLAN as unknown as PlanResponse;
    const data = buildTripLinesData(two.plan.options[0]!, two.variants, LINES);
    expect(data.rideSegments.map((r) => r.routeCode)).toEqual(["R8-A"]);
  });

  it("splits the ride slice into runs and notes a terminal access road inside the ride", () => {
    const least = plan.plan.options[1]!; // R8-A 265.6 -> 5751.6 m crosses the terminal access road at 5663.6 m
    const data = buildTripLinesData(least, plan.variants, LINES);
    const ride = data.rideSegments[0]!;
    expect(ride.runs.length).toBeGreaterThanOrEqual(1);
    expect(ride.runs.every((r) => !r.dashed)).toBe(true);
    expect(ride.notes).toEqual({ onewayCaution: false, terminalAccess: true });
    expect(data.caution).toBe(false);
  });

  it("dashes a >= 100 m one-way section of an ok trace on the trip ride and flags the caution", () => {
    const loopB = LINES.lines.find((l) => l.variantId === "9ddd04ca-ab7d-413e-8fd3-7d7f1a3ed7eb")!;
    const option = structuredClone(plan.plan.options[0]!);
    const ride = option.legs.find((l) => l.kind === "ride")!;
    if (ride.kind === "ride") {
      ride.variantId = loopB.variantId;
      ride.routeCode = loopB.routeCode;
      ride.boardMeasureM = 0;
      ride.alightMeasureM = 900;
    }
    const variants = [{ variantId: loopB.variantId, routeCode: loopB.routeCode, routeName: loopB.routeName, isCircular: true, loopDirection: "counterclockwise" as const }];
    const data = buildTripLinesData(option, variants, LINES);
    const seg = data.rideSegments[0]!;
    expect(seg.runs[0]).toMatchObject({ dashed: true, reason: "oneway_conflict" });
    expect(seg.runs.some((r) => !r.dashed)).toBe(true);
    expect(seg.notes.onewayCaution).toBe(true);
    expect(data.caution).toBe(true);
  });

  it("labels a walk with no street path as a straight line", () => {
    const data = buildTripLinesData(plan.plan.options[0]!, plan.variants, LINES);
    expect(data.walkSegments[0]!.label).toBe(WALK_STRAIGHT_LABEL);
  });
});

export type { Line };

describe("rideTrace (T12-5: untraced from the leg's distance basis, not from loaded lines)", () => {
  const ride = (o: PlanResponse["plan"]["options"][number]) => o.legs.find((l) => l.kind === "ride")!;

  it("a ride along a published path is traced even when the lines are not loaded (low-data mode)", () => {
    const leg = ride(plan.plan.options[0]!);
    if (leg.kind !== "ride") throw new Error("ride");
    expect(rideTrace(leg, null, true)).toEqual({ untraced: false, notes: { onewayCaution: false, terminalAccess: false } });
  });

  it("a straight-line ride is untraced whether or not lines are loaded", () => {
    const two = TWO_RIDE_PLAN as unknown as PlanResponse;
    const loopB = two.plan.options[0]!.legs.filter((l) => l.kind === "ride")[1]!;
    if (loopB.kind !== "ride") throw new Error("ride");
    expect(rideTrace(loopB, null, true).untraced).toBe(true);
    expect(rideTrace(loopB, LINES, true).untraced).toBe(true);
  });

  it("a ride whose variant has no line in the loaded lines is untraced", () => {
    const leg = structuredClone(ride(plan.plan.options[0]!));
    if (leg.kind !== "ride") throw new Error("ride");
    leg.variantId = "11111111-1111-4111-8111-111111111111";
    expect(rideTrace(leg, LINES, true).untraced).toBe(true);
  });

  it("notes the terminal access road the ride passes", () => {
    const leg = ride(plan.plan.options[1]!);
    if (leg.kind !== "ride") throw new Error("ride");
    expect(rideTrace(leg, LINES, true)).toEqual({ untraced: false, notes: { onewayCaution: false, terminalAccess: true } });
  });
});

describe("buildTripLinesData: tricycle and padyak legs (Increment E Task 10)", () => {
  const A = { lat: 13.6233869, lng: 123.1846726 };
  const B = { lat: 13.6323904, lng: 123.1946726 };
  const mid = { lat: 13.6283, lng: 123.1846726 };
  const streetOption = (kind: "tricycle" | "padyak", basis: "street_graph" | "straight_line" | "unavailable" | "restricted") => {
    const o = streetOnly(kind, basis === "unavailable" || basis === "restricted" ? null : 1500, basis);
    const leg = {
      ...o.legs[0]!,
      from: { kind: "origin" as const, ...A, stopId: null, name: null },
      to: { kind: "destination" as const, ...B, stopId: null, name: null },
      path: basis === "street_graph" ? encodePolyline([A, mid, B]) : null,
    };
    return { ...o, legs: [leg] } as PlanResponse["plan"]["options"][number];
  };

  it("draws a routed tricycle as a solid street segment in the tricycle key, with a legend entry", () => {
    const data = buildTripLinesData(streetOption("tricycle", "street_graph"), [], LINES);
    expect(data.streetSegments).toHaveLength(1);
    expect(data.streetSegments[0]).toMatchObject({ mode: "tricycle", chipText: "Trike" });
    expect(data.streetSegments[0]!.coords).toHaveLength(3);
    expect(data.legendItems).toContain("tricycle");
    expect(data.legendExtras).toEqual([]);
    expect(data.allCoords).toHaveLength(3);
    expect(data.announcement).toContain("Tricycle");
  });

  it("draws a padyak routed path dashed (legend extra padyak), not under the tricycle entry", () => {
    const data = buildTripLinesData(streetOption("padyak", "street_graph"), [], LINES);
    expect(data.streetSegments[0]).toMatchObject({ mode: "padyak", chipText: "Padyak" });
    expect(data.legendExtras).toEqual(["padyak"]);
    expect(data.legendItems).not.toContain("tricycle");
  });

  it("never draws a straight line for a tricycle or padyak without a routed path", () => {
    for (const kind of ["tricycle", "padyak"] as const) {
      for (const basis of ["straight_line", "restricted"] as const) {
        const data = buildTripLinesData(streetOption(kind, basis), [], LINES);
        expect(data.streetSegments).toEqual([]);
        expect(data.allCoords).toEqual([]);
        expect(data.legendExtras).toEqual([]);
      }
    }
  });

  it("draws nothing for an unavailable street route", () => {
    const data = buildTripLinesData(streetOption("tricycle", "unavailable"), [], LINES);
    expect(data.streetSegments).toEqual([]);
    expect(data.allCoords).toEqual([]);
  });
});
