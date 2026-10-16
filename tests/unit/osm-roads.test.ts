import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REGIONAL_RELATION_ROLES,
  parseOsmRoads,
  regionalRelationSummary,
  relationLengthKm,
  resolvePlaceName,
  stripRoadsResponse, verifyStreetAliases,
} from "@/domain/import/osm-roads";

const fixture = () => JSON.parse(readFileSync("tests/fixtures/osm/roads-synthetic.osm.json", "utf8")) as {
  header: Record<string, unknown>;
  response: { elements: Record<string, unknown>[] };
};

const EARTH_RADIUS_M = 6_371_008.8;
const meridianM = (dLatDeg: number) => (EARTH_RADIUS_M * dLatDeg * Math.PI) / 180;

describe("parseOsmRoads", () => {
  it("parses the synthetic fixture: ways, coordinates and place nodes", () => {
    const r = parseOsmRoads(fixture());
    expect(r.problems).toEqual([]);
    expect(r.synthetic).toBe(true);
    expect(r.fetchDate).toBe("2026-10-16");
    expect(r.ways.map((w) => w.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(r.ways.find((w) => w.id === 3)).toMatchObject({ nodeIds: [120, 121, 122], tags: { highway: "residential", name: "Mock Lane", oneway: "yes" } });
    expect(r.nodes.get(100)).toEqual({ lat: 13.625, lng: 123.19 });
    expect(r.places.map((p) => [p.id, p.name, p.place])).toEqual([
      [301, "Fakeville", "village"], [302, "Twinplace", "hamlet"], [303, "Twinplace", "hamlet"], [304, "Mock Heights", "neighbourhood"],
    ]);
    expect(r.regionalRelations).toHaveLength(1);
  });

  it("refuses contributor data (user, uid, changeset) anywhere in the elements", () => {
    for (const field of ["user", "uid", "changeset"]) {
      const f = fixture();
      f.response.elements[0]![field] = field === "user" ? "someone" : 42;
      const r = parseOsmRoads(f);
      expect(r.problems.join("\n"), field).toMatch(/contributor data/);
    }
  });

  it("refuses a real (non-synthetic) header that does not list the removed contributor fields", () => {
    const f = fixture();
    f.header.synthetic = false;
    f.header.removedFields = ["otherTags"];
    expect(parseOsmRoads(f).problems.join("\n")).toMatch(/removedFields/);
  });

  it("drops unknown tags from the output (only the kept road and place tags remain)", () => {
    const f = fixture();
    const way = f.response.elements.find((e) => e.type === "way" && e.id === 1)!;
    way.tags = { ...(way.tags as object), surface: "asphalt", lanes: "2", fixme: "x", "name:en": "Fake" };
    const place = f.response.elements.find((e) => e.id === 301)!;
    place.tags = { ...(place.tags as object), population: "1000", wikidata: "Q1" };
    const r = parseOsmRoads(f);
    expect(r.problems).toEqual([]);
    expect(r.ways.find((w) => w.id === 1)!.tags).toEqual({ highway: "residential", name: "Fakeroad Avenue" });
    expect(Object.keys(r.places.find((p) => p.id === 301)!)).toEqual(["id", "name", "place", "lat", "lng"]);
  });

  it("reports a way whose node has no coordinate and leaves it out", () => {
    const f = fixture();
    f.response.elements = f.response.elements.filter((e) => e.id !== 130 || e.type !== "node");
    const r = parseOsmRoads(f);
    expect(r.problems.join("\n")).toMatch(/way\/11.*node 130/);
    expect(r.ways.map((w) => w.id)).not.toContain(11);
  });

  it("never throws on a malformed file", () => {
    expect(parseOsmRoads(null).problems.length).toBeGreaterThan(0);
    expect(parseOsmRoads({ header: {}, response: {} }).problems.length).toBeGreaterThan(0);
  });
});

describe("stripRoadsResponse", () => {
  it("keeps only the listed fields and tags, deterministically", () => {
    const body = {
      version: 0.6,
      generator: "Overpass API",
      osm3s: { timestamp_osm_base: "2026-10-16T00:00:00Z", copyright: "c" },
      elements: [
        { type: "way", id: 7, version: 3, timestamp: "2020-01-01T00:00:00Z", changeset: 1, user: "u", uid: 2, nodes: [1, 2],
          tags: { surface: "asphalt", highway: "residential", name: "A", lanes: "2", oneway: "yes", access: "private", foot: "yes",
            motor_vehicle: "no", vehicle: "no", psv: "yes", bus: "yes", "oneway:psv": "no", service: "alley", maxspeed: "30" } },
        { type: "node", id: 1, lat: 13.6, lon: 123.1 },
        { type: "node", id: 2, lat: 13.61, lon: 123.11, version: 4, timestamp: "2020-01-01T00:00:00Z", user: "u", uid: 2, changeset: 9,
          tags: { place: "hamlet", name: "P", population: "3", is_in: "x" } },
      ],
    };
    const { response, removedFields } = stripRoadsResponse(body);
    expect(removedFields).toEqual(["changeset", "otherTags", "uid", "user"]);
    expect(response).toEqual({
      version: 0.6,
      generator: "Overpass API",
      osm3s: body.osm3s,
      elements: [
        { type: "way", id: 7, version: 3, timestamp: "2020-01-01T00:00:00Z", nodes: [1, 2],
          tags: { highway: "residential", name: "A", oneway: "yes", access: "private", foot: "yes",
            motor_vehicle: "no", vehicle: "no", psv: "yes", bus: "yes", "oneway:psv": "no", service: "alley" } },
        { type: "node", id: 1, lat: 13.6, lon: 123.1 },
        { type: "node", id: 2, lat: 13.61, lon: 123.11, tags: { place: "hamlet", name: "P" } },
      ],
    });
    expect(JSON.stringify(stripRoadsResponse(body))).toBe(JSON.stringify(stripRoadsResponse(body)));
  });
});

describe("regional relations (D5)", () => {
  // Along the meridian 123.0 E, so the true length is R * dLat exactly.
  const geom = (lats: number[]) => lats.map((lat) => ({ lat, lon: 123 }));
  const relation = {
    type: "relation",
    id: 9000001,
    version: 5,
    timestamp: "2024-02-03T04:05:06Z",
    user: "someone",
    uid: 3,
    tags: { type: "route", route: "bus", name: "Fake A–B", ref: "X1", from: "A", to: "B", network: "n", operator: "o" },
    members: [
      { type: "way", ref: 1, role: "", geometry: geom([13.0, 13.005, 13.01]) },
      { type: "way", ref: 2, role: "forward", geometry: geom([13.01, 13.015]) },
      { type: "way", ref: 3, role: "backward", geometry: geom([13.015, 13.02]) },
      // Counted once even though it is listed twice.
      { type: "way", ref: 1, role: "", geometry: geom([13.0, 13.005, 13.01]) },
      // Platforms and stops are not part of the route's length.
      { type: "way", ref: 4, role: "platform", geometry: geom([14.0, 14.5]) },
      { type: "node", ref: 5, role: "stop", lat: 13.0, lon: 123 },
    ],
  };

  it("sums each member way once (roles '', forward, backward), within 1 m", () => {
    expect(REGIONAL_RELATION_ROLES).toEqual(["", "forward", "backward"]);
    expect(Math.abs(relationLengthKm(relation) * 1000 - meridianM(0.02))).toBeLessThan(1);
  });

  it("stores only id, version, timestamp, name, ref, from, to and length (no geometry, no contributor data)", () => {
    const s = regionalRelationSummary(relation);
    expect(s).toEqual({
      relationId: 9000001, version: 5, timestamp: "2024-02-03T04:05:06Z", name: "Fake A–B", ref: "X1", from: "A", to: "B",
      lengthKm: Number((meridianM(0.02) / 1000).toFixed(3)),
    });
  });

  it("missing tags are null; a member way with a gap in its geometry skips only that gap", () => {
    const s = regionalRelationSummary({
      type: "relation", id: 1, version: 1, timestamp: "2024-01-01T00:00:00Z", tags: {},
      members: [{ type: "way", ref: 9, role: "", geometry: [{ lat: 13, lon: 123 }, null, { lat: 13.01, lon: 123 }, { lat: 13.02, lon: 123 }] }],
    });
    expect(s).toMatchObject({ name: null, ref: null, from: null, to: null });
    expect(Math.abs(s.lengthKm * 1000 - meridianM(0.01))).toBeLessThan(1);
  });
});

describe("resolvePlaceName (feeder place_name anchors)", () => {
  const { places } = parseOsmRoads(fixture());

  it("resolves a unique place by normalized name", () => {
    expect(resolvePlaceName(places, "fakeville")).toMatchObject({ status: "resolved", place: { id: 301 } });
    expect(resolvePlaceName(places, "Mock  Heights.")).toMatchObject({ status: "resolved", place: { id: 304 } });
  });

  it("an ambiguous or missing name is unresolved", () => {
    expect(resolvePlaceName(places, "Twinplace")).toEqual({ status: "unresolved", reason: "ambiguous", candidates: [302, 303] });
    expect(resolvePlaceName(places, "Nowhere")).toEqual({ status: "unresolved", reason: "not_found", candidates: [] });
  });
});

describe("committed road snapshot", () => {
  const file = "data/source/osm/naga-roads-2026-10-16.osm.json";
  const text = readFileSync(file, "utf8");

  it("parses without problems, is real (not synthetic) and carries no contributor data", () => {
    const r = parseOsmRoads(JSON.parse(text));
    expect(r.problems).toEqual([]);
    expect(r.synthetic).toBe(false);
    expect(r.header.removedFields).toEqual(expect.arrayContaining(["user", "uid", "changeset"]));
    expect(text).not.toMatch(/"(user|uid|changeset)":/);
    expect(r.ways.length).toBeGreaterThan(1000);
    expect(r.regionalRelations.map((x) => x.relationId)).toHaveLength(14);
  });
});

describe("verifyStreetAliases", () => {
  const roads = parseOsmRoads(JSON.parse(readFileSync("tests/fixtures/osm/roads-synthetic.osm.json", "utf8")));
  it("accepts an alias whose ways carry the OSM name (any name tag), refuses a wrong or missing way", () => {
    expect(verifyStreetAliases([{ legal_name: "Ex Dr", osm_name: "Example Dr.", osm_way_ids: [5] }], roads)).toEqual([]);
    expect(verifyStreetAliases([{ legal_name: "X", osm_name: "Mock Lane", osm_way_ids: [1] }], roads)[0]).toMatch(/does not carry/);
    expect(verifyStreetAliases([{ legal_name: "X", osm_name: "Mock Lane", osm_way_ids: [999] }], roads)[0]).toMatch(/not in the snapshot/);
  });
});
