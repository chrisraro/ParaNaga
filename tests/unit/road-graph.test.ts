import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { buildRoadGraph, nearestEdge, type RoadGraph } from "@/domain/geo/road-graph";
import { parseOsmRoads, type OsmRoads } from "@/domain/import/osm-roads";

const raw = () => JSON.parse(readFileSync("tests/fixtures/osm/roads-synthetic.osm.json", "utf8")) as {
  header: Record<string, unknown>;
  response: { elements: Record<string, unknown>[] };
};
const roads = (edit?: (f: ReturnType<typeof raw>) => void): OsmRoads => {
  const f = raw();
  edit?.(f);
  const r = parseOsmRoads(f);
  expect(r.problems).toEqual([]);
  return r;
};
const setTags = (f: ReturnType<typeof raw>, wayId: number, tags: Record<string, string>) => {
  const way = f.response.elements.find((e) => e.type === "way" && e.id === wayId)!;
  way.tags = { ...(way.tags as object), ...tags };
};

const wayEdges = (g: RoadGraph, wayId: number) => g.edges.filter((e) => e.wayId === wayId);
const ways = (g: RoadGraph) => [...new Set(g.edges.map((e) => e.wayId))].sort((a, b) => a - b);
const osm = (g: RoadGraph, nodeIndex: number) => g.nodes[nodeIndex]!.osmId;

const vehicle = buildRoadGraph(roads(), { profile: "vehicle" });
const walk = buildRoadGraph(roads(), { profile: "walk" });

// Fixture grid: rows 13.625 / 13.6241 / 13.6232 (north to south), columns 123.19 + i * 0.000925.
const M_PER_DEG_LAT = 111_195;

describe("buildRoadGraph: classes and access", () => {
  it("vehicle: drivable classes only (no footway, no private service road)", () => {
    expect(ways(vehicle)).toEqual([1, 2, 3, 4, 5, 9, 10, 11]);
  });

  it("walk: no motorway; access=private excluded unless foot=yes", () => {
    expect(ways(walk)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10]);
    expect(wayEdges(walk, 7)).toEqual([]);
    expect(wayEdges(walk, 8).length).toBeGreaterThan(0);
  });

  it("walk: foot=designated also lifts access=private; foot=no and access=no exclude", () => {
    const g = buildRoadGraph(roads((f) => {
      setTags(f, 7, { foot: "designated" });
      setTags(f, 1, { foot: "no" });
      setTags(f, 2, { access: "no" });
    }), { profile: "walk" });
    expect(ways(g)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("buildRoadGraph: direction", () => {
  it("a one-way street exists in one direction for vehicles and in both for walking", () => {
    expect(wayEdges(vehicle, 3).length).toBeGreaterThan(0);
    expect(wayEdges(vehicle, 3).every((e) => !e.reverse)).toBe(true);
    const fwd = wayEdges(walk, 3).filter((e) => !e.reverse);
    const back = wayEdges(walk, 3).filter((e) => e.reverse);
    expect(back.length).toBe(fwd.length);
    expect(fwd.length).toBeGreaterThan(0);
    // Way order 120 -> 121 -> 122: the vehicle edge leaves 120's side, never 122's.
    expect(wayEdges(vehicle, 3).map((e) => osm(vehicle, e.from))).not.toContain(122);
  });

  it("a roundabout is one-way; oneway=-1 runs against the way order; oneway=no on a roundabout is two-way", () => {
    expect(wayEdges(vehicle, 10).every((e) => !e.reverse)).toBe(true);
    const g = buildRoadGraph(roads((f) => {
      setTags(f, 1, { oneway: "-1" });
      setTags(f, 10, { oneway: "no" });
    }), { profile: "vehicle" });
    expect(wayEdges(g, 1).every((e) => e.reverse)).toBe(true);
    expect(wayEdges(g, 10).some((e) => e.reverse)).toBe(true);
  });

  it("two-way edges have a twin running the other way over the same polyline", () => {
    for (const e of wayEdges(vehicle, 4)) {
      const twin = vehicle.edges[e.twin!]!;
      expect([twin.from, twin.to]).toEqual([e.to, e.from]);
      expect(twin.coords).toEqual([...e.coords].reverse());
    }
    expect(wayEdges(vehicle, 3).every((e) => e.twin === null)).toBe(true);
  });
});

describe("buildRoadGraph: edges", () => {
  it("contracts degree-2 nodes: junction nodes only, polylines keep the shape", () => {
    // Vehicles: node 101 only joins way 1 (the footway is excluded), so 100 -> 102 is one edge.
    const e = wayEdges(vehicle, 1).find((x) => !x.reverse)!;
    expect([osm(vehicle, e.from), osm(vehicle, e.to)]).toEqual([100, 102]);
    expect(e.coords).toHaveLength(3);
    expect(vehicle.nodes.map((n) => n.osmId)).not.toContain(101);
    // Walking: the footway starts at 101, so it is a junction.
    expect(walk.nodes.map((n) => n.osmId)).toContain(101);
  });

  it("edges carry the way id, normalized street names and the haversine length", () => {
    const e = wayEdges(vehicle, 5).find((x) => !x.reverse && osm(vehicle, x.from) === 102)!;
    expect(e.names).toEqual(["example drive"]);
    const expected = e.coords.slice(1).reduce((sum, c, i) => sum + haversineMeters(e.coords[i]!, c), 0);
    expect(e.lengthM).toBeCloseTo(expected, 6);
    expect(e.lengthM).toBeGreaterThan(90);
  });

  it("outgoing adjacency lists exactly the edges leaving each node", () => {
    vehicle.out.forEach((list, node) => {
      for (const i of list) expect(vehicle.edges[i]!.from).toBe(node);
    });
    expect(vehicle.out.flat().length).toBe(vehicle.edges.length);
  });

  it("is deterministic", () => {
    const again = buildRoadGraph(roads(), { profile: "walk" });
    expect(JSON.stringify(again.edges)).toBe(JSON.stringify(walk.edges));
    expect(JSON.stringify(again.nodes)).toBe(JSON.stringify(walk.nodes));
  });
});

describe("nearestEdge", () => {
  // 20 m north of the midpoint between 100 (123.19) and 101 (123.190925) on row 13.625.
  const p = { lat: 13.625 + 20 / M_PER_DEG_LAT, lng: 123.1904625 };

  it("projects onto the nearest segment (walk: 100 -> 101 is a whole edge)", () => {
    const hit = nearestEdge(walk, p, 100)!;
    expect(hit.edge.wayId).toBe(1);
    expect(hit.distM).toBeCloseTo(20, 0);
    const forward = osm(walk, hit.edge.from) === 100;
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(forward || osm(walk, hit.edge.from) === 101).toBe(true);
    expect(hit.point.lat).toBeCloseTo(13.625, 6);
    expect(hit.point.lng).toBeCloseTo(123.1904625, 6);
  });

  it("t is the fraction along the whole contracted edge (vehicle: 100 -> 102)", () => {
    const hit = nearestEdge(vehicle, p, 100)!;
    expect(hit.edge.wayId).toBe(1);
    expect(hit.edge.reverse).toBe(false);
    expect(hit.t).toBeCloseTo(0.25, 2);
  });

  it("clamps to the segment ends and returns null beyond maxM", () => {
    const west = { lat: 13.625, lng: 123.19 - 30 / (M_PER_DEG_LAT * Math.cos((13.625 * Math.PI) / 180)) };
    const hit = nearestEdge(walk, west, 100)!;
    expect(hit.distM).toBeCloseTo(30, 0);
    expect([0, 1]).toContain(Math.round(hit.t * 1000) / 1000);
    expect(nearestEdge(walk, west, 25)).toBeNull();
    expect(nearestEdge(walk, { lat: 13.7, lng: 123.3 }, 100)).toBeNull();
  });
});
