import { describe, expect, it } from "vitest";
import { buildGraph, forwardRides } from "@/domain/planner/graph";
import { LINE_VARIANT_ID, LOOP_VARIANT_ID, STOP_ID, syntheticSnapshot } from "../fixtures/synthetic/planner-network";
import { realLoopsSnapshot, realLoopsSnapshotWithMeasures } from "../fixtures/real-loops";

describe("buildGraph (synthetic)", () => {
  const graph = buildGraph(syntheticSnapshot(), 400);
  const loop = graph.variants.find((v) => v.variantId === LOOP_VARIANT_ID)!;
  const line = graph.variants.find((v) => v.variantId === LINE_VARIANT_ID)!;

  it("orders variants by id and keeps stop order", () => {
    expect(graph.variants.map((v) => v.variantId)).toEqual([LOOP_VARIANT_ID, LINE_VARIANT_ID]);
    expect(loop.stops.map((s) => s.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"].map((c) => STOP_ID[c]));
  });

  it("closes a circular variant (last → first) but not a line", () => {
    expect(loop.segmentMeters).toHaveLength(6);
    expect(line.segmentMeters).toHaveLength(2);
    for (const m of loop.segmentMeters) expect(m).toBeGreaterThan(990);
    expect(loop.segmentMeters.every((m) => m < 1010)).toBe(true);
  });

  it("rides forward only and never a full circuit on a loop", () => {
    const rides = forwardRides(loop, 2); // board at P3
    expect(rides.map((r) => r.position)).toEqual([3, 4, 5, 0, 1]); // P4 P5 P6 P1 P2 — never P3 again
    expect(rides.map((r) => r.steps)).toEqual([1, 2, 3, 4, 5]);
    expect(rides.at(-1)!.meters).toBeLessThan(loop.segmentMeters.reduce((s, m) => s + m, 0));
    expect(rides[0]!.meters).toBeCloseTo(loop.segmentMeters[2]!, 6);
  });

  it("rides a line forward to its end only", () => {
    expect(forwardRides(line, 0).map((r) => r.position)).toEqual([1, 2]);
    expect(forwardRides(line, 2)).toEqual([]);
  });

  it("links stops of different variants within the transfer cap only", () => {
    const fromP3 = graph.transfers[graph.variants.indexOf(loop)]![2]!;
    expect(fromP3).toHaveLength(1);
    expect(fromP3[0]).toMatchObject({ variant: graph.variants.indexOf(line), position: 0 });
    expect(fromP3[0]!.meters).toBeGreaterThan(195);
    expect(fromP3[0]!.meters).toBeLessThan(205);
    const fromP2 = graph.transfers[graph.variants.indexOf(loop)]![1]!;
    expect(fromP2).toEqual([]);
    expect(buildGraph(syntheticSnapshot(), 150).transfers[graph.variants.indexOf(loop)]![2]).toEqual([]);
  });

  it("drops a circular variant's closing duplicate of its first stop", () => {
    const s = syntheticSnapshot();
    s.variants[0]!.stopIds = [...s.variants[0]!.stopIds, s.variants[0]!.stopIds[0]!];
    const g = buildGraph(s, 400);
    const v = g.variants.find((x) => x.variantId === LOOP_VARIANT_ID)!;
    expect(v.stops).toHaveLength(6);
    expect(v.segmentMeters.every((m) => m > 990)).toBe(true);
    expect(forwardRides(v, 0).map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("skips a variant that repeats a stop id elsewhere", () => {
    const s = syntheticSnapshot();
    const ids = s.variants[1]!.stopIds;
    s.variants[1]!.stopIds = [ids[0]!, ids[1]!, ids[0]!, ids[2]!];
    const g = buildGraph(s, 400);
    expect(g.skippedVariantIds).toEqual([LINE_VARIANT_ID]);
  });

  it("skips a variant that references a stop missing from the snapshot", () => {
    const s = syntheticSnapshot();
    s.variants[1]!.stopIds = [...s.variants[1]!.stopIds, "00000000-0000-4000-8000-999999999999"];
    const g = buildGraph(s, 400);
    expect(g.variants.map((v) => v.variantId)).toEqual([LOOP_VARIANT_ID]);
    expect(g.skippedVariantIds).toEqual([LINE_VARIANT_ID]);
  });
});

describe("buildGraph (real Loop A / Loop B)", () => {
  const graph = buildGraph(realLoopsSnapshot(), 400);

  it("has the two provisional loops with their real lengths", () => {
    const byCode = Object.fromEntries(graph.variants.map((v) => [v.routeCode, v]));
    expect(byCode["R8-A"]!.stops).toHaveLength(30);
    expect(byCode["R8-B"]!.stops).toHaveLength(31);
    const len = (code: string) => byCode[code]!.segmentMeters.reduce((s, m) => s + m, 0);
    expect(len("R8-A")).toBeGreaterThan(7000);
    expect(len("R8-A")).toBeLessThan(7300);
    expect(len("R8-B")).toBeGreaterThan(7000);
    expect(len("R8-B")).toBeLessThan(7300);
    expect(Math.max(...byCode["R8-A"]!.segmentMeters)).toBeLessThan(460);
    expect(Math.max(...byCode["R8-B"]!.segmentMeters)).toBeLessThan(460);
  });

  it("has A↔B transfers (Plaza Rizal A1 and B1 are a few metres apart)", () => {
    const total = graph.transfers.flat(2).length;
    expect(total).toBeGreaterThan(0);
    for (const t of graph.transfers.flat(2)) expect(t.meters).toBeLessThanOrEqual(400);
  });
});

describe("D13 ride metres along the approximate path (stop measures)", () => {
  /** Loop S with path measures: 1100 m between consecutive stops, ring length 6600 m. */
  const withMeasures = (measuresM: number[] | null, pathLengthM: number | null, line?: { measuresM: number[] | null; pathLengthM: number | null }) => {
    const s = syntheticSnapshot();
    s.variants[0] = { ...s.variants[0]!, measuresM, pathLengthM };
    if (line) s.variants[1] = { ...s.variants[1]!, ...line };
    return s;
  };
  const loopOf = (g: ReturnType<typeof buildGraph>) => g.variants.find((v) => v.variantId === LOOP_VARIANT_ID)!;
  const lineOf = (g: ReturnType<typeof buildGraph>) => g.variants.find((v) => v.variantId === LINE_VARIANT_ID)!;

  it("measures a ride as measure(alight) − measure(board) when the variant has measures", () => {
    const loop = loopOf(buildGraph(withMeasures([0, 1100, 2200, 3300, 4400, 5500], 6600), 400));
    const rides = forwardRides(loop, 0);
    expect(rides.map((r) => r.meters)).toEqual([1100, 2200, 3300, 4400, 5500]);
    expect(rides.every((r) => r.basis === "approximate_path")).toBe(true);
    expect(rides[1]).toMatchObject({ position: 2, boardMeasureM: 0, alightMeasureM: 2200 });
  });

  it("wraps by pathLengthM when a circuit ride passes the start of the path", () => {
    const loop = loopOf(buildGraph(withMeasures([0, 1100, 2200, 3300, 4400, 5500], 6600), 400));
    const fromP5 = forwardRides(loop, 4); // P5 → P6 → P1 → P2 …
    expect(fromP5.map((r) => r.position)).toEqual([5, 0, 1, 2, 3]);
    expect(fromP5.map((r) => r.meters)).toEqual([1100, 2200, 3300, 4400, 5500]);
    expect(fromP5[2]).toMatchObject({ boardMeasureM: 4400, alightMeasureM: 1100 }); // (1100 − 4400) mod 6600 = 3300
  });

  it("wraps correctly when the path starts mid-ring (measures need not start at the first stop)", () => {
    const loop = loopOf(buildGraph(withMeasures([3000, 4100, 5200, 6300, 800, 1900], 6600), 400));
    expect(forwardRides(loop, 2).map((r) => r.meters)).toEqual([1100, 2200, 3300, 4400, 5500]);
    expect(forwardRides(loop, 3)[0]).toMatchObject({ meters: 1100, boardMeasureM: 6300, alightMeasureM: 800 });
  });

  it("measures a line (not circular) without wrapping", () => {
    const g = buildGraph(withMeasures(null, null, { measuresM: [0, 850, 1900], pathLengthM: 1950 }), 400);
    expect(forwardRides(lineOf(g), 0).map((r) => [r.meters, r.basis])).toEqual([[850, "approximate_path"], [1900, "approximate_path"]]);
  });

  it("keeps the straight-line sum (basis stop_to_stop_straight_line, no measures) without measures", () => {
    const g = buildGraph(syntheticSnapshot(), 400);
    const loop = loopOf(g);
    const rides = forwardRides(loop, 0);
    expect(rides[0]!.meters).toBeCloseTo(loop.segmentMeters[0]!, 9);
    expect(rides.every((r) => r.basis === "stop_to_stop_straight_line" && r.boardMeasureM === null && r.alightMeasureM === null)).toBe(true);
    expect(loop.pathSegmentMeters).toBeNull();
  });

  it("falls back to the straight line when the measures are not in ride order (never a negative or multi-lap ride)", () => {
    // measures out of cyclic order: segments would wrap twice round the ring
    const loop = loopOf(buildGraph(withMeasures([0, 4400, 1100, 5500, 2200, 3300], 6600), 400));
    expect(loop.pathSegmentMeters).toBeNull();
    expect(forwardRides(loop, 0)[0]!.basis).toBe("stop_to_stop_straight_line");
    // a line whose measures go backwards
    const g = buildGraph(withMeasures(null, null, { measuresM: [0, 900, 400], pathLengthM: 1950 }), 400);
    expect(lineOf(g).pathSegmentMeters).toBeNull();
    // the wrong number of measures (an old or partial cache)
    expect(loopOf(buildGraph(withMeasures([0, 1100, 2200], 6600), 400)).pathSegmentMeters).toBeNull();
  });

  it("drops the closing duplicate's measure with the closing stop", () => {
    const s = withMeasures([0, 1100, 2200, 3300, 4400, 5500, 6600], 6600);
    s.variants[0]!.stopIds = [...s.variants[0]!.stopIds, s.variants[0]!.stopIds[0]!];
    const loop = loopOf(buildGraph(s, 400));
    expect(loop.stops).toHaveLength(6);
    expect(loop.pathSegmentMeters).toEqual([1100, 1100, 1100, 1100, 1100, 1100]);
  });

  it("carries the route id and mode of the variant", () => {
    const loop = loopOf(buildGraph(syntheticSnapshot(), 400));
    expect(loop).toMatchObject({ routeId: syntheticSnapshot().variants[0]!.routeId, mode: "jeepney" });
  });
});

describe("D13 on the real loops (captured path measures)", () => {
  const graph = buildGraph(realLoopsSnapshotWithMeasures(), 400);

  it("uses the approximate path on both loops", () => {
    for (const v of graph.variants) expect(v.pathSegmentMeters).not.toBeNull();
  });

  // The path is measured between the pins' SNAPPED road positions (stored at 0.1 m), so a stop
  // pair on a straight street can measure up to a couple of metres under the pin-to-pin line
  // (worst on the captured data: 2.3 m). Tolerance: 5 m per ride.
  const SNAP_TOLERANCE_M = 5;

  it("property: the path distance of every ride is at least its straight-line stop-to-stop sum (± pin snapping)", () => {
    for (const v of graph.variants) {
      expect(v.pathSegmentMeters!.reduce((a, b) => a + b, 0)).toBeGreaterThan(v.segmentMeters.reduce((a, b) => a + b, 0));
      for (let board = 0; board < v.stops.length; board++) {
        let straight = 0;
        for (const r of forwardRides(v, board)) {
          straight += v.segmentMeters[(board + r.steps - 1) % v.stops.length]!;
          expect(r.basis).toBe("approximate_path");
          expect(r.meters).toBeGreaterThanOrEqual(straight - SNAP_TOLERANCE_M);
        }
      }
    }
  });
});
