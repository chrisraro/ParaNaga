// Path-based boarding and alighting (plan E §A): samples, approaches, rides (line and circuit),
// walk caps, transfers, free-point names and the planning network built from Lines.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NetworkSnapshot } from "@/domain/api/schemas";
import { haversineMeters } from "@/domain/geo/geometry";
import { projectOnLine } from "@/domain/geo/measure";
import { encodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import { buildPlanningNetwork } from "@/domain/planner/graph";
import {
  approaches, MAX_ACCESS_WALK_GRAPH_M, MIN_RIDE_M, nameFreePoint, pathVariant, rideMeters, ridesOnVariant, SAMPLE_STEP_M,
  transferPoints, type PlanningLine,
} from "@/domain/planner/paths";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";

const LAT0 = 13.62;
const LNG0 = 123.18;
const M_LAT = 111_195; // metres per degree of latitude
const M_LNG = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
/** A point x metres east and y metres north of (LAT0, LNG0). */
const at = (x: number, y: number): LatLng => ({ lat: LAT0 + y / M_LAT, lng: LNG0 + x / M_LNG });

let seq = 0;
function line(points: LatLng[], over: Partial<PlanningLine> = {}): PlanningLine {
  seq += 1;
  const n = String(seq).padStart(12, "0");
  return {
    variantId: `00000000-0000-4000-8000-${n}`, routeId: `00000000-0000-4000-9000-${n}`, routeCode: `T${seq}`, routeName: `Test ${seq}`,
    mode: "jeepney", kind: "permanent", direction: "inbound", status: "ok", encoded: encodePolyline(points), ...over,
  };
}

// A straight 4 km street running east, and a 2 km square loop.
const STRAIGHT = pathVariant(line([at(0, 0), at(1500, 0), at(4000, 0)]));
const SQUARE_PTS = [at(0, 0), at(500, 0), at(500, 500), at(0, 500), at(0, 0)];
const SQUARE = pathVariant(line(SQUARE_PTS, { direction: "clockwise" }));

describe("pathVariant", () => {
  it("samples every 25 m plus every vertex, from 0 to the path length", () => {
    const s = STRAIGHT.samples;
    expect(s[0]!.m).toBe(0);
    expect(s.at(-1)!.m).toBeCloseTo(STRAIGHT.lengthM, 6);
    for (let i = 1; i < s.length; i++) expect(s[i]!.m - s[i - 1]!.m).toBeLessThanOrEqual(SAMPLE_STEP_M + 1e-9);
    expect(s.some((x) => Math.abs(x.m - STRAIGHT.cumM[1]!) < 1e-9)).toBe(true); // the 1,500 m vertex
  });

  it.each([
    { direction: "clockwise", close: 0, circuit: true },
    { direction: "circuit", close: 55, circuit: true },
    { direction: "counterclockwise", close: 70, circuit: false }, // ends more than 60 m apart
    { direction: "inbound", close: 0, circuit: false }, // closed ends but not a circuit direction
  ] as const)("$direction with ends $close m apart → circuit $circuit", ({ direction, close, circuit }) => {
    const v = pathVariant(line([at(0, 0), at(500, 0), at(500, 500), at(0, 500), at(0, close)], { direction }));
    expect(v.isCircuit).toBe(circuit);
  });
});

describe("approaches", () => {
  it("a point 600 m off every path yields none; 400 m off yields one", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 4000, noNaN: true }), fc.constantFrom(-1, 1), (x, side) => {
        expect(approaches(STRAIGHT, at(x, side * 600))).toEqual([]);
        const a = approaches(STRAIGHT, at(x, side * 400));
        expect(a).toHaveLength(1);
        expect(a[0]!.measureM).toBeCloseTo(STRAIGHT.lengthM * (x / 4000), -1);
        expect(a[0]!.distM).toBeCloseTo(400, -1);
      }),
      { numRuns: 200 },
    );
  });

  it("an out-and-back path near both ends yields two approaches", () => {
    const outBack = pathVariant(line([at(0, 0), at(3000, 0), at(3000, 120), at(0, 120)], { direction: "inbound" }));
    const a = approaches(outBack, at(-100, 60));
    expect(a).toHaveLength(2);
    expect(a[0]!.measureM).toBeLessThan(50);
    expect(a[1]!.measureM).toBeGreaterThan(outBack.lengthM - 50);
  });

  it("a circuit's approach across the seam is one approach", () => {
    expect(approaches(SQUARE, at(-50, -50))).toHaveLength(1);
  });
});

describe("rides", () => {
  const ALONG = fc.double({ min: 0, max: 4000, noNaN: true });

  it("a line never yields alight < board, and every ride is at least 200 m", () => {
    fc.assert(
      fc.property(ALONG, ALONG, (bx, ax) => {
        const r = ridesOnVariant(STRAIGHT, approaches(STRAIGHT, at(bx, 30)), approaches(STRAIGHT, at(ax, -30)));
        if (r === null) return;
        expect(r.alight.measureM).toBeGreaterThanOrEqual(r.board.measureM);
        expect(r.rideM).toBeGreaterThanOrEqual(MIN_RIDE_M);
        expect(r.rideM).toBeCloseTo(r.alight.measureM - r.board.measureM, 9);
      }),
    );
  });

  it("a circuit ride is in [200, pathLength) and goes forward (wrapping at the end)", () => {
    const ON_SQUARE = fc.double({ min: 0, max: 1999.99, noNaN: true }).map((d) => {
      if (d < 500) return at(d, 0);
      if (d < 1000) return at(500, d - 500);
      if (d < 1500) return at(1500 - d, 500);
      return at(0, 2000 - d);
    });
    fc.assert(
      fc.property(ON_SQUARE, ON_SQUARE, (b, a) => {
        const r = ridesOnVariant(SQUARE, approaches(SQUARE, b, 20), approaches(SQUARE, a, 20));
        if (r === null) return;
        expect(r.rideM).toBeGreaterThanOrEqual(MIN_RIDE_M);
        expect(r.rideM).toBeLessThan(SQUARE.lengthM);
        const fwd = (((r.alight.measureM - r.board.measureM) % SQUARE.lengthM) + SQUARE.lengthM) % SQUARE.lengthM;
        expect(r.rideM).toBeCloseTo(fwd, 6);
      }),
    );
  });

  it("ride distance ≥ straight line board → alight", () => {
    fc.assert(
      fc.property(fc.constantFrom(STRAIGHT, SQUARE), fc.tuple(ALONG, ALONG, ALONG, ALONG), (v, [x1, y1, x2, y2]) => {
        const r = ridesOnVariant(v, approaches(v, at(x1 / 4, y1 / 8)), approaches(v, at(x2 / 4, y2 / 8)));
        if (r !== null) expect(r.rideM).toBeGreaterThanOrEqual(haversineMeters(r.board.point, r.alight.point) - 0.5);
      }),
    );
  });

  it.each([
    { v: "line", board: 1000, alight: 1199, ride: null },
    { v: "line", board: 1000, alight: 1200, ride: 200 },
    { v: "line", board: 1200, alight: 1000, ride: null }, // backwards
    // Circuit: a negative number means "path length minus".
    { v: "circuit", board: -100, alight: 99, ride: null }, // 199 m across the seam
    { v: "circuit", board: -100, alight: 100, ride: 200 },
    { v: "circuit", board: 300, alight: 300, ride: null }, // a full lap is never a ride
    { v: "circuit", board: 300, alight: 100, ride: -200 },
  ] as const)("rideMeters $v $board → $alight = $ride", ({ v, board, alight, ride }) => {
    const variant = v === "line" ? STRAIGHT : SQUARE;
    const m = (x: number) => (x < 0 ? variant.lengthM + x : x);
    const r = rideMeters(variant, m(board), alight);
    if (ride === null) expect(r).toBeNull();
    else expect(r).toBeCloseTo(m(ride), 6);
  });

  it.each([
    { walk: 750, kept: true },
    { walk: 751, kept: false },
    { walk: null, kept: false }, // unreachable on the street graph
  ])("access walk on the graph $walk m → kept $kept (cap 750 m)", ({ walk, kept }) => {
    const boards = approaches(STRAIGHT, at(500, 450));
    const alights = approaches(STRAIGHT, at(3000, 0));
    const r = ridesOnVariant(STRAIGHT, boards, alights, { board: () => walk, alight: () => 0 });
    expect(r !== null).toBe(kept);
    if (kept) expect(r!.boardWalkM).toBe(MAX_ACCESS_WALK_GRAPH_M);
  });

  it("without a graph the walks are round(straight × 1.3)", () => {
    const r = ridesOnVariant(STRAIGHT, approaches(STRAIGHT, at(500, 400)), approaches(STRAIGHT, at(3000, -100)))!;
    expect(r.boardWalkM).toBe(Math.round(r.board.distM * 1.3));
    expect(r.alightWalkM).toBe(Math.round(r.alight.distM * 1.3));
    expect(r.score).toBeCloseTo(r.boardWalkM + r.alightWalkM + 0.25 * r.rideM, 9);
  });

  it("keeps the best pair on an out-and-back path", () => {
    const outBack = pathVariant(line([at(0, 0), at(3000, 0), at(3000, 120), at(0, 120)]));
    // From near the start to x = 2000: the outbound leg (board ≈ 0, alight ≈ 2000) beats riding round.
    const r = ridesOnVariant(outBack, approaches(outBack, at(0, 60)), approaches(outBack, at(2000, 20)))!;
    expect(r.board.measureM).toBeLessThan(50);
    expect(r.alight.measureM).toBeCloseTo(2000, -1);
  });
});

describe("transferPoints", () => {
  it("a street shared by two variants gives a 0 m transfer", () => {
    const a = pathVariant(line([at(0, 0), at(2000, 0)]));
    const b = pathVariant(line([at(1000, -1000), at(1000, 0), at(1500, 0), at(1500, 1000)]));
    const t = transferPoints(a, b);
    expect(t).toHaveLength(1);
    expect(t[0]!.straightM).toBe(0);
    expect(t[0]!.fromM).toBeCloseTo(1000, -1);
  });

  it.each([
    { gap: 250, count: 1 },
    { gap: 350, count: 0 },
  ])("parallel streets $gap m apart → $count transfer(s)", ({ gap, count }) => {
    const a = pathVariant(line([at(0, 0), at(2000, 0)]));
    const b = pathVariant(line([at(0, gap), at(2000, gap)]));
    const t = transferPoints(a, b);
    expect(t).toHaveLength(count);
    if (count) expect(t[0]!.straightM).toBe(gap);
  });

  it("two separate crossings give two transfers", () => {
    const a = pathVariant(line([at(0, 0), at(4000, 0)]));
    const b = pathVariant(line([at(500, 1000), at(500, -1000), at(3500, -1000), at(3500, 1000)]));
    expect(transferPoints(a, b).map((t) => Math.round(t.fromM / 100) * 100)).toEqual([500, 3500]);
  });
});

describe("buildPlanningNetwork", () => {
  const snapshot = (variants: NetworkSnapshot["variants"] = [], stops: NetworkSnapshot["stops"] = []) =>
    ({ stops, variants }) as Pick<NetworkSnapshot, "stops" | "variants">;

  it("plans permanent jeepney variants with a path, also without a stop order; never trial or other modes", () => {
    const ok = line([at(0, 0), at(2000, 0)]);
    const flagged = line([at(0, 100), at(2000, 100)], { status: "flagged" });
    const trial = line([at(0, 200), at(2000, 200)], { kind: "trial" });
    const tricycle = line([at(0, 300), at(2000, 300)], { mode: "tricycle" });
    const net = buildPlanningNetwork(snapshot(), { lines: [trial, flagged, tricycle, ok] });
    expect(net.variants.map((v) => v.variantId)).toEqual([ok.variantId, flagged.variantId].sort());
    expect(buildPlanningNetwork(snapshot(), null).variants).toEqual([]);
  });

  it("is deterministic: line order does not change variants or transfers", () => {
    const ls = [0, 1, 2, 3].map((i) => line([at(0, i * 150), at(2000, i * 150), at(2000 - i * 300, 1000)]));
    const a = buildPlanningNetwork(snapshot(), { lines: ls });
    const b = buildPlanningNetwork(snapshot(), { lines: [...ls].reverse() });
    expect(b).toEqual(a);
    expect(a.transfers.flat().length).toBeGreaterThan(0);
    for (const ts of a.transfers) {
      expect(ts).toEqual([...ts].sort((x, y) => x.fromM - y.fromM || x.toVariant - y.toVariant));
    }
  });

  it("names a free point by a same-variant pin within 100 m along the path, else any stop within 100 m, else none", () => {
    const l = line([at(0, 0), at(2000, 0)]);
    const stop = (id: string, p: LatLng, name: string) => ({
      id, name, lat: p.lat, lng: p.lng, status: "candidate" as const, navigationApproved: false, source: { layer: "x", code: null, label: null },
    });
    const pin = stop("00000000-0000-4000-a000-000000000001", at(1000, 5), "Pin");
    const other = stop("00000000-0000-4000-a000-000000000002", at(1500, 60), "Other");
    const net = buildPlanningNetwork(
      snapshot([{ variantId: l.variantId, stopIds: [pin.id] } as NetworkSnapshot["variants"][number]], [pin, other]),
      { lines: [l] },
    );
    const v = net.variants[0]!;
    expect(nameFreePoint(net, v, 1090, at(1090, 0))).toEqual({ stopId: pin.id, name: "Pin" });
    expect(nameFreePoint(net, v, 1450, at(1450, 0))).toEqual({ stopId: other.id, name: "Other" });
    expect(nameFreePoint(net, v, 600, at(600, 0))).toBeNull();
  });
});

describe("real Lines", () => {
  const lines = realLines();
  const net = buildPlanningNetwork(realLinesSnapshot(), lines);

  it("plans every permanent jeepney path and no trial", () => {
    expect(net.variants).toHaveLength(lines.lines.filter((l) => l.mode === "jeepney" && l.kind === "permanent").length);
    expect(net.variants.map((v) => v.variantId)).toEqual([...net.variants.map((v) => v.variantId)].sort());
    expect(net.variants.filter((v) => v.isCircuit).map((v) => v.routeCode).sort()).toEqual(
      expect.arrayContaining(["R8-A", "R8-B", "R8-C", "R8-D"]),
    );
  });

  it.each([
    { place: "San Isidro", p: { lat: 13.6323904, lng: 123.2695351 }, routes: ["R1"] },
    { place: "Panicuason", p: { lat: 13.6632922, lng: 123.3179196 }, routes: ["R7"] },
    { place: "Del Rosario", p: { lat: 13.6173903, lng: 123.2375487 }, routes: ["R2", "R3", "R4"] },
    { place: "Pacol", p: { lat: 13.6595434, lng: 123.2511904 }, routes: ["R6"] },
    { place: "San Felipe", p: { lat: 13.6397717, lng: 123.2031012 }, routes: ["R5"] },
    { place: "Balatas Rd", p: { lat: 13.6325226, lng: 123.2079135 }, routes: ["R1"] },
    { place: "Cararayan", p: { lat: 13.6288288, lng: 123.2406424 }, routes: ["R1"] },
    { place: "J. Miranda Ave", p: { lat: 13.6256, lng: 123.199 }, routes: ["R8-A", "R8-B"] },
  ])("$place has an approach on $routes", ({ p, routes }) => {
    for (const code of routes) {
      const vs = net.variants.filter((v) => v.routeCode === code);
      expect(vs.length).toBeGreaterThan(0);
      expect(vs.some((v) => approaches(v, p).length > 0)).toBe(true);
    }
  });

  it("builds in reasonable time and gives transfers in both directions between loops", () => {
    const t0 = performance.now();
    const again = buildPlanningNetwork(realLinesSnapshot(), lines);
    console.log(`buildPlanningNetwork (real Lines, ${again.variants.length} variants): ${(performance.now() - t0).toFixed(1)} ms`);
    expect(again).toEqual(net);
    const ia = net.variants.findIndex((v) => v.routeCode === "R8-A");
    const ib = net.variants.findIndex((v) => v.routeCode === "R8-B");
    expect(net.transfers[ia]!.some((t) => t.toVariant === ib)).toBe(true);
    expect(net.transfers[ib]!.some((t) => t.toVariant === ia)).toBe(true);
  });

  it("each transfer's target is the globally nearest point of the other path", () => {
    net.transfers.forEach((ts) => {
      for (const t of ts) {
        const full = projectOnLine(net.variants[t.toVariant]!.points, t.from);
        expect(t.straightM).toBe(Math.round(full.distM));
        expect(t.toM).toBeCloseTo(full.measureM, 3);
      }
    });
  });
});
