import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildRoadGraph, type RoadGraph } from "@/domain/geo/road-graph";
import type { LatLng } from "@/domain/geo/types";
import type { RoadWay } from "@/domain/import/osm-roads";
import { boundaryCrossing, resolveRouteLandmarks } from "@/domain/import/route-landmarks";
import { MAX_OFF_LIST_SHARE, TRACE_BUILDER_VERSION, traceVariant, type TraceInput } from "@/domain/import/trace-route";

// A synthetic 6 x 6 grid (100 m spacing): rows "Row r St" run west to east, columns "Col c Ave"
// run north to south. Node id = 1000 + 10 r + c; row r is south of row r - 1.
const LAT0 = 13.62;
const LNG0 = 123.18;
const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const N = 6;
const at = (r: number, c: number): LatLng => ({ lat: LAT0 - (r * 100) / M_PER_DEG_LAT, lng: LNG0 + (c * 100) / M_PER_DEG_LNG });
const nid = (r: number, c: number) => 1000 + 10 * r + c;

type Piece = { id: number; nodes: [number, number]; tags: RoadWay["tags"] };
type RC = [number, number];

function grid(edit?: (pieces: Piece[], extraNodes: Map<number, LatLng>) => void): RoadGraph {
  const pieces: Piece[] = [];
  let id = 1;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c + 1 < N; c++) pieces.push({ id: id++, nodes: [nid(r, c), nid(r, c + 1)], tags: { highway: "residential", name: `Row ${r} St` } });
  }
  for (let c = 0; c < N; c++) {
    for (let r = 0; r + 1 < N; r++) pieces.push({ id: id++, nodes: [nid(r, c), nid(r + 1, c)], tags: { highway: "residential", name: `Col ${c} Ave` } });
  }
  const nodes = new Map<number, LatLng>();
  edit?.(pieces, nodes);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) nodes.set(nid(r, c), at(r, c));
  const ways: RoadWay[] = pieces.map((p) => ({ id: p.id, version: 1, timestamp: "2020-01-01T00:00:00Z", nodeIds: p.nodes, tags: p.tags }));
  return buildRoadGraph({ ways, nodes }, { profile: "vehicle" });
}
const pieceIndex = (pieces: Piece[], a: RC, b: RC) =>
  pieces.findIndex((x) => (x.nodes[0] === nid(...a) && x.nodes[1] === nid(...b)) || (x.nodes[0] === nid(...b) && x.nodes[1] === nid(...a)));
const retag = (pieces: Piece[], a: RC, b: RC, tags: Record<string, string>) => {
  const p = pieces[pieceIndex(pieces, a, b)]!;
  p.tags = { ...p.tags, ...tags } as RoadWay["tags"];
};
const remove = (pieces: Piece[], a: RC, b: RC) => pieces.splice(pieceIndex(pieces, a, b), 1);

const plain = grid();
const input = (over: Partial<TraceInput>): TraceInput => ({ streets: [], isCircular: false, ...over });

/** Names of the edges the line runs on, in order (consecutive repeats collapsed). */
function streetsOf(g: RoadGraph, line: readonly LatLng[]): string[] {
  const out: string[] = [];
  const close = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
  for (let i = 1; i < line.length; i++) {
    const e = g.edges.find((x) => x.coords.some((c, j) => j > 0 && close(x.coords[j - 1]!, line[i - 1]!) && close(c, line[i]!)));
    const name = e?.names[0] ?? "?";
    if (out.at(-1) !== name) out.push(name);
  }
  return out;
}

describe("traceVariant: street-list mode", () => {
  it("the street list A -> B -> C yields a path using only A, B and C edges", () => {
    const r = traceVariant(input({ streets: ["Row 0 St", "Col 3 Ave", "Row 4 St"] }), plain, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(streetsOf(plain, r.line)).toEqual(["row 0 street", "col 3 avenue", "row 4 street"]);
    expect(r.quality.offListShare).toBe(0);
    expect(r.quality.matchedStreets).toBe(3);
    expect(r.quality.continuous).toBe(true);
    expect(r.quality.builderVersion).toBe(TRACE_BUILDER_VERSION);
    // Row 0 from its far (west) end to Col 3, Col 3 south to Row 4, Row 4 to its far (west) end.
    expect(r.line[0]!.lng).toBeCloseTo(at(0, 0).lng, 9);
    expect(r.line.at(-1)!.lng).toBeCloseTo(at(4, 0).lng, 9);
    expect(r.lengthM).toBeCloseTo(300 + 400 + 300, -1);
    expect(r.stopMeasures).toEqual([]);
  });

  it("a one-way street forces the legal direction", () => {
    // Row 2 is one-way west -> east. Listed east -> west it cannot be driven: the path detours.
    const g = grid((p) => {
      for (let c = 0; c + 1 < N; c++) retag(p, [2, c], [2, c + 1], { oneway: "yes" });
    });
    const legal = traceVariant(input({ streets: ["Col 0 Ave", "Row 2 St", "Col 5 Ave"] }), g, []);
    expect(legal.ok).toBe(true);
    const illegal = traceVariant(input({ streets: ["Col 5 Ave", "Row 2 St", "Col 0 Ave"] }), g, []);
    // Drawn, flagged: the detour exists because the listed Row 2 is one-way against the travel order.
    expect(illegal.status).toBe("flagged");
    if (illegal.status !== "flagged") return;
    expect(illegal.flag).toBe("oneway_conflict");
    expect(illegal.offListSegments.length).toBeGreaterThan(0);
    expect(illegal.offListSegments.every((x) => x.reason === "oneway_conflict")).toBe(true);
    expect(illegal.offListSegments[0]!.streets[0]!.name).toMatch(/^(row 1|row 3) street$/);
    const line = illegal.line;
    const row2 = at(2, 0).lat;
    for (let i = 1; i < line.length; i++) {
      const onRow = Math.abs(line[i - 1]!.lat - row2) < 1e-9 && Math.abs(line[i]!.lat - row2) < 1e-9;
      if (onRow) expect(line[i]!.lng).toBeGreaterThan(line[i - 1]!.lng);
    }
    expect(illegal.quality.offListShare ?? 0).toBeGreaterThan(0);
  });

  it("an unmatched street -> ok:false with the street listed", () => {
    const r = traceVariant(input({ streets: ["Row 0 St", "Nowhere St", "Col 3 Ave"] }), plain, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unmatched_streets");
    expect(r.quality.unmatchedStreets).toEqual(["Nowhere St"]);
    expect(r.quality.matchedStreets).toBe(2);
  });

  it("a reviewed alias matches a legal name to its OSM name", () => {
    const r = traceVariant(input({ streets: ["Legal Row Rd", "Col 3 Ave"] }), plain, [{ legalName: "Legal Row Rd", osmName: "Row 0 Street" }]);
    expect(r.ok).toBe(true);
    expect(r.quality.unmatchedStreets).toEqual([]);
  });

  it("off-list share 20 % is drawn flagged with its off-list segment; 10 % passes", () => {
    // Row 0 (500 m) then Col 5 (500 m): two Row 0 pieces renamed -> 200 m of 1000 m off the list.
    const twenty = grid((p) => {
      retag(p, [0, 1], [0, 2], { name: "Other St" });
      retag(p, [0, 2], [0, 3], { name: "Other St" });
    });
    const bad = traceVariant(input({ streets: ["Row 0 St", "Col 5 Ave"] }), twenty, []);
    expect(bad.status).toBe("flagged");
    if (bad.status !== "flagged") return;
    expect(bad.flag).toBe("off_list_detour");
    expect(bad.offListSegments).toEqual([
      { fromM: expect.closeTo(100, 0), toM: expect.closeTo(300, 0), lengthM: expect.closeTo(200, 0), streets: [{ name: "other street", m: 200 }], reason: "off_list_detour" },
    ]);
    expect(bad.quality.offListShare!).toBeCloseTo(0.2, 2);
    expect(bad.quality.offListShare!).toBeGreaterThan(MAX_OFF_LIST_SHARE);
    const ten = grid((p) => retag(p, [0, 1], [0, 2], { name: "Other St" }));
    const good = traceVariant(input({ streets: ["Row 0 St", "Col 5 Ave"] }), ten, []);
    expect(good.status).toBe("ok");
    expect(good.quality.offListShare!).toBeCloseTo(0.1, 2);
  });

  it("never draws across a gap: a disconnected step is a break, not a segment", () => {
    const g = grid((p) => {
      for (let r = 0; r < N; r++) remove(p, [r, 4], [r, 5]);
    });
    const r = traceVariant(input({ streets: ["Col 0 Ave", "Row 3 St", "Col 5 Ave"] }), g, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_continuous");
    expect(r.status).toBe("fail");
    expect(r.quality.continuous).toBe(false);
    expect(r.quality.gaps).toBe(1);
    expect(r.parts.length).toBe(2);
    // No part bridges column 4 and column 5.
    for (const part of r.parts) {
      const cols = new Set(part.map((p) => Math.round((p.lng - LNG0) * M_PER_DEG_LNG / 100)));
      expect(cols.has(4) && cols.has(5)).toBe(false);
    }
  });

  it("termini: an open list starts and ends at the street node nearest the route's terminus", () => {
    const r = traceVariant(input({ streets: ["Row 0 St", "Col 3 Ave", "Row 4 St"], termini: { start: at(0, 1), end: { lat: at(4, 2).lat - 0.001, lng: at(4, 2).lng } } }), plain, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line[0]!.lng).toBeCloseTo(at(0, 1).lng, 9);
    expect(r.line.at(-1)!.lng).toBeCloseTo(at(4, 2).lng, 9);
    expect(r.lengthM).toBeCloseTo(200 + 400 + 100, -1);
    expect(r.quality.terminusSnapM).toBeCloseTo(0.001 * M_PER_DEG_LAT, -1);
  });

  it("a circuit closes back to its first waypoint", () => {
    const r = traceVariant(input({ streets: ["Row 1 St", "Col 4 Ave", "Row 4 St", "Col 1 Ave", "Row 1 St"], isCircular: true }), plain, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line[0]).toEqual(r.line.at(-1));
    expect(r.lengthM).toBeCloseTo(1200, -1);
  });

  it("a landmark item with a point is a waypoint; an unresolved one is skipped and reported", () => {
    const near = { lat: at(0, 3).lat + 10 / M_PER_DEG_LAT, lng: at(0, 3).lng + 30 / M_PER_DEG_LNG };
    const r = traceVariant(input({ streets: ["Col 1 Ave", "Row 0 St", "Some Station", "Row 0 St", "Col 5 Ave"], landmarks: { "Some Station": near } }), plain, []);
    expect(r.ok).toBe(true);
    expect(r.quality.landmarksUnresolved).toEqual([]);
    expect(r.quality.maxLandmarkSnapM).toBeCloseTo(10, 0);
    expect(r.quality.maxSnapM).toBeNull();
    const u = traceVariant(input({ streets: ["Row 0 St", "Gone Station", "Col 3 Ave"], landmarks: { "Gone Station": null } }), plain, []);
    expect(u.ok).toBe(true);
    expect(u.quality.landmarksUnresolved).toEqual(["Gone Station"]);
    expect(u.quality.unmatchedStreets).toEqual([]);
  });
});

describe("traceVariant: pin mode", () => {
  const north = (p: LatLng, m: number): LatLng => ({ lat: p.lat + m / M_PER_DEG_LAT, lng: p.lng });
  const mid = (a: LatLng, b: LatLng): LatLng => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

  it("pins in order produce monotonic measures", () => {
    const pins = [north(mid(at(1, 0), at(1, 1)), 5), north(mid(at(1, 2), at(1, 3)), -5), at(3, 3), mid(at(4, 3), at(5, 3))];
    const r = traceVariant(input({ streets: ["Row 1 St", "Col 3 Ave"], pins }), plain, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stopMeasures).toHaveLength(4);
    expect(r.stopMeasures[0]).toBe(0);
    for (let i = 1; i < 4; i++) expect(r.stopMeasures[i]!).toBeGreaterThan(r.stopMeasures[i - 1]!);
    expect(r.stopMeasures[1]).toBeCloseTo(200, -1);
    expect(r.lengthM).toBeCloseTo(r.stopMeasures[3]!, 6);
    expect(r.quality.maxSnapM).toBeCloseTo(5, 0);
  });

  it("a circuit's measures increase and wrap at the path length", () => {
    const pins = [mid(at(1, 1), at(1, 2)), mid(at(1, 4), at(2, 4)), mid(at(4, 4), at(4, 3)), mid(at(3, 1), at(2, 1))];
    const r = traceVariant(input({ streets: ["Row 1 St", "Col 4 Ave", "Row 4 St", "Col 1 Ave"], pins, isCircular: true }), plain, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 1; i < 4; i++) expect(r.stopMeasures[i]!).toBeGreaterThan(r.stopMeasures[i - 1]!);
    expect(r.lengthM).toBeCloseTo(1200, -1);
    expect(r.stopMeasures[3]!).toBeLessThan(r.lengthM);
    expect(r.line[0]!.lat).toBeCloseTo(r.line.at(-1)!.lat, 9);
    expect(r.line[0]!.lng).toBeCloseTo(r.line.at(-1)!.lng, 9);
  });

  it("a pin snaps to the carriageway it can be driven along in the travel direction (within 25 m)", () => {
    // Row 2 is a divided road: the grid row is eastbound only, a westbound carriageway runs 15 m south.
    const south = (p: LatLng, m: number): LatLng => ({ lat: p.lat - m / M_PER_DEG_LAT, lng: p.lng });
    const g = grid((p, nodes) => {
      for (let c = 0; c + 1 < N; c++) retag(p, [2, c], [2, c + 1], { oneway: "yes" });
      let id = 900;
      for (let c = 0; c < N; c++) nodes.set(2000 + c, south(at(2, c), 15));
      for (let c = 0; c + 1 < N; c++) p.push({ id: id++, nodes: [2000 + c + 1, 2000 + c], tags: { highway: "residential", name: "Row 2 St", oneway: "yes" } });
      p.push({ id: id++, nodes: [nid(2, 0), 2000], tags: { highway: "residential", name: "Row 2 St" } });
      p.push({ id: id++, nodes: [2005, nid(2, 5)], tags: { highway: "residential", name: "Row 2 St" } });
    });
    // Each pin is 9 m south of the eastbound row and 6 m north of the westbound carriageway (the
    // nearest edge); the route runs east, so the eastbound row (within 25 m) is preferred.
    const pins = [south(mid(at(2, 1), at(2, 2)), 9), south(mid(at(2, 3), at(2, 4)), 9)];
    const r = traceVariant(input({ streets: ["Row 2 St"], pins }), g, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quality.maxSnapM).toBeCloseTo(9, 0);
    expect(r.lengthM).toBeCloseTo(200, -1);
    // 30 m further south only the westbound carriageway is within 25 m: the nearest-edge fallback
    // snaps there and the trace has to loop around.
    const far = traceVariant(input({ streets: ["Row 2 St"], pins: pins.map((x) => south(x, 30)) }), g, []);
    expect(far.ok).toBe(true);
    if (far.ok) expect(far.lengthM).toBeGreaterThan(400);
  });

  it("a pin 80 m from any road -> fail", () => {
    // Remove the four pieces around node (2,2): the block around it is 200 m wide.
    const g = grid((p) => {
      remove(p, [1, 2], [2, 2]);
      remove(p, [2, 2], [3, 2]);
      remove(p, [2, 1], [2, 2]);
      remove(p, [2, 2], [2, 3]);
    });
    const centre = { lat: at(2, 2).lat + 10 / M_PER_DEG_LAT, lng: at(2, 2).lng - 5 / M_PER_DEG_LNG };
    const r = traceVariant(input({ streets: ["Row 1 St"], pins: [at(1, 1), centre, at(3, 3)] }), g, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("pin_unsnapped");
    expect(r.quality.unsnappedPins).toEqual([1]);
  });
});

describe("traceVariant: anchors", () => {
  it("a missing anchor -> anchor_unresolved", () => {
    const r = traceVariant(input({ anchors: [{ kind: "point", label: "A", at: at(0, 0) }, { kind: "unresolved", label: "Langon" }] }), plain, []);
    expect(r).toMatchObject({ ok: false, reason: "anchor_unresolved" });
    if (!r.ok) expect(r.quality.anchorsUnresolved).toEqual(["Langon"]);
  });

  it("junction and point anchors are traced in order", () => {
    const r = traceVariant(input({ anchors: [{ kind: "point", label: "A", at: at(0, 0) }, { kind: "junction", streets: ["Row 2 St", "Col 3 Ave"] }] }), plain, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lengthM).toBeCloseTo(500, -1);
  });
});

describe("traceVariant: determinism", () => {
  const names = [...Array.from({ length: N }, (_, i) => `Row ${i} St`), ...Array.from({ length: N }, (_, i) => `Col ${i} Ave`)];
  it("same input -> byte-identical output", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...names), { minLength: 1, maxLength: 6 }), fc.boolean(), (streets, isCircular) => {
        const a = JSON.stringify(traceVariant(input({ streets, isCircular }), plain, []));
        const b = JSON.stringify(traceVariant(input({ streets, isCircular }), grid(), []));
        expect(a).toBe(b);
      }),
      { numRuns: 60 },
    );
  });
});

describe("route landmarks", () => {
  // A "boundary" ring around columns 0–2.5 (the vertical line at column 2.5 crosses every row once).
  const ring: [number, number][] = [
    [at(0, 0).lng - 0.001, at(0, 0).lat + 0.001],
    [at(0, 0).lng + 250 / M_PER_DEG_LNG, at(0, 0).lat + 0.001],
    [at(0, 0).lng + 250 / M_PER_DEG_LNG, at(5, 0).lat - 0.001],
    [at(0, 0).lng - 0.001, at(5, 0).lat - 0.001],
    [at(0, 0).lng - 0.001, at(0, 0).lat + 0.001],
  ];

  it("a street crossing the boundary once resolves (also through an alias)", () => {
    const r = boundaryCrossing(plain, ring, "Highway X", [{ legalName: "Highway X", osmName: "Row 2 Street" }]);
    expect(r.point!.lat).toBeCloseTo(at(2, 0).lat, 9);
    expect(r.point!.lng).toBeCloseTo(at(0, 0).lng + 250 / M_PER_DEG_LNG, 9);
  });

  it("no crossing or several distinct crossings stay unresolved (never guessed)", () => {
    expect(boundaryCrossing(plain, ring, "Col 0 Ave", []).point).toBeNull();
    const g = grid((p) => {
      retag(p, [1, 2], [1, 3], { name: "Twin Rd" });
      retag(p, [4, 2], [4, 3], { name: "Twin Rd" });
    });
    expect(boundaryCrossing(g, ring, "Twin Rd", []).point).toBeNull();
    expect(boundaryCrossing(g, ring, "Twin Rd", []).note).toMatch(/not unique/);
  });

  it("a near-place qualifier picks the one crossing close to the place; none close stays unresolved", () => {
    const g = grid((p) => {
      retag(p, [1, 2], [1, 3], { name: "Twin Rd" });
      retag(p, [4, 2], [4, 3], { name: "Twin Rd" });
    });
    const r = resolveRouteLandmarks(
      { L: { kind: "boundary_crossing", street: "Twin Rd", near: { place: "Southville", withinM: 150 }, reason: "x" } },
      { terminals: [], graph: g, boundary: ring, aliases: [], places: [{ name: "Southville", ...at(4, 2) }] },
    );
    expect(r.L!.point!.lat).toBeCloseTo(at(4, 0).lat, 9);
    const none = resolveRouteLandmarks(
      { L: { kind: "boundary_crossing", street: "Twin Rd", near: { place: "Nowhere", withinM: 150 }, reason: "x" } },
      { terminals: [], graph: g, boundary: ring, aliases: [], places: [{ name: "Southville", ...at(4, 2) }] },
    );
    expect(none.L!.point).toBeNull();
  });

  it("terminal landmarks use the terminal coordinate or stay null", () => {
    const r = resolveRouteLandmarks(
      { A: { kind: "terminal", code: "T01", reason: "x" }, B: { kind: "terminal", code: "T02", reason: "x" }, C: { kind: "unresolved", reason: "x" } },
      { terminals: [{ code: "T01", lat: 13.6, lng: 123.1 }, { code: "T02", lat: null, lng: null }], graph: plain, boundary: ring, aliases: [] },
    );
    expect(r.A!.point).toEqual({ lat: 13.6, lng: 123.1 });
    expect(r.B!.point).toBeNull();
    expect(r.C!.point).toBeNull();
  });
});
