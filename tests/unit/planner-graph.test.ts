import { describe, expect, it } from "vitest";
import { buildGraph, forwardRides } from "@/domain/planner/graph";
import { LINE_VARIANT_ID, LOOP_VARIANT_ID, STOP_ID, syntheticSnapshot } from "../fixtures/synthetic/planner-network";
import { realLoopsSnapshot } from "../fixtures/real-loops";

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
