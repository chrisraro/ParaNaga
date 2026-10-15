import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAGA_BOUNDARY } from "@/domain/geo/naga";
import { CATEGORY_RULES, parseOsmPlaces, type OsmPlace } from "@/domain/import/osm-places";
import { OSM_PLACE_CATEGORIES } from "@/domain/places/osm-categories";

const FIXTURE = "tests/fixtures/osm/naga-places-2026-10-15.osm.json";
const fixture = () => JSON.parse(readFileSync(FIXTURE, "utf8")) as { header: Record<string, unknown>; response: { elements: Record<string, unknown>[] } };
const parse = (snapshot: unknown = fixture()) => parseOsmPlaces(snapshot, NAGA_BOUNDARY);
const byKey = (places: OsmPlace[]) => new Map(places.map((p) => [p.key, p]));

describe("parseOsmPlaces on the synthetic fixture", () => {
  it("accepts the fixture and flags it synthetic", () => {
    const result = parse();
    expect(result.problems).toEqual([]);
    expect(result.synthetic).toBe(true);
    expect(result.fetchDate).toBe("2026-10-15");
    expect(result.header.boundaryRelation).toBe(3084673);
  });

  it("keeps only named, categorised features inside the boundary", () => {
    const { places, dropped } = parse();
    expect(places.map((p) => p.key)).toEqual([
      "osm:node/999000000001", "osm:node/999000000002", "osm:node/999000000009", "osm:node/999000000010",
      "osm:node/999000000012", "osm:node/999000000013", "osm:node/999000000015", "osm:node/999000000016",
      "osm:way/999000000003", "osm:way/999000000011", "osm:relation/999000000004",
    ]);
    expect(dropped).toEqual({ unnamed: 2, outside_boundary: 1, other_tags: 1, no_coordinate: 1 });
  });

  it("drops unnamed and blank-named features", () => {
    const keys = parse().places.map((p) => p.key);
    expect(keys).not.toContain("osm:node/999000000005");
    expect(keys).not.toContain("osm:node/999000000006");
  });

  it("drops a feature just outside the city polygon although it is inside the bounding box", () => {
    expect(parse().places.map((p) => p.key)).not.toContain("osm:node/999000000007");
  });

  it("uses the centre of ways and relations", () => {
    const places = byKey(parse().places);
    expect(places.get("osm:way/999000000003")).toMatchObject({ osmType: "way", osmId: 999000000003, lat: 13.625, lng: 123.187, category: "mall" });
    expect(places.get("osm:relation/999000000004")).toMatchObject({ lat: 13.6215, lng: 123.186, category: "park", osmVersion: 5 });
  });

  it("assigns exactly one category by the fixed precedence table", () => {
    const places = byKey(parse().places);
    // place_of_worship;school -> school; bus_station + public_transport=station/bus=yes -> one bus_terminal;
    // place=square + leisure=park -> park; marketplace + shop=mall -> market.
    expect(places.get("osm:node/999000000002")).toMatchObject({ category: "school", tags: { amenity: "place_of_worship;school" } });
    expect(places.get("osm:node/999000000010")).toMatchObject({
      category: "bus_terminal", tags: { amenity: "bus_station", public_transport: "station", bus: "yes" },
    });
    expect(places.get("osm:way/999000000011")).toMatchObject({ category: "park", tags: { leisure: "park" } });
    expect(places.get("osm:node/999000000016")).toMatchObject({ category: "market", tags: { amenity: "marketplace" } });
    expect(places.get("osm:node/999000000009")?.category).toBe("government");
    expect(places.get("osm:node/999000000013")).toMatchObject({ category: "government", tags: { office: "government" } });
    expect(places.get("osm:node/999000000015")?.category).toBe("college_university");
  });

  it("the precedence table covers every ParaNaga category exactly once", () => {
    expect([...new Set(CATEGORY_RULES.map((r) => r.category))]).toEqual([
      "bus_terminal", "hospital_clinic", "college_university", "school", "place_of_worship", "government",
      "market", "mall", "park", "square",
    ]);
    expect([...new Set(CATEGORY_RULES.map((r) => r.category))].sort()).toEqual([...OSM_PLACE_CATEGORIES].sort());
  });

  it("keeps the name and the alias tags verbatim, skipping empty ones", () => {
    const places = byKey(parse().places);
    expect(places.get("osm:node/999000000001")).toMatchObject({
      name: "Synthetic Test Elementary School", aliases: ["Synthetic Test Elementary", "STES"],
    });
    expect(places.get("osm:node/999000000015")?.aliases).toEqual(["Pamantasang Synthetic", "Synthetic College"]);
    expect(places.get("osm:relation/999000000004")?.aliases).toEqual(["Old Synthetic Park"]);
  });

  it("keeps duplicate names as separate places", () => {
    const twins = parse().places.filter((p) => p.name === "Synthetic Twin Name");
    expect(twins.map((p) => p.key)).toEqual(["osm:node/999000000012", "osm:node/999000000013"]);
  });

  it("never outputs forbidden tags or OSM user metadata", () => {
    const text = JSON.stringify(parse().places);
    for (const forbidden of ["opening_hours", "phone", "website", "image", "entrance", "addr:", "religion",
      "synthetic-user", "uid", "changeset", "+63", "synthetic.invalid", "10:00-21:00"]) {
      expect(text).not.toContain(forbidden);
    }
    for (const p of parse().places) {
      expect(Object.keys(p).sort()).toEqual([
        "aliases", "category", "contentHash", "key", "lat", "lng", "name", "osmId", "osmTimestamp", "osmType",
        "osmVersion", "sourceIdentity", "tags",
      ]);
    }
  });

  it("keeps version and timestamp from the element metadata", () => {
    expect(byKey(parse().places).get("osm:node/999000000009")).toMatchObject({
      osmVersion: 4, osmTimestamp: "2026-01-04T00:00:00Z",
    });
  });

  it("has stable identities and deterministic content hashes", () => {
    const a = parse().places;
    const b = parse().places;
    expect(b).toEqual(a);
    expect(a.every((p) => /^[0-9a-f]{64}$/.test(p.contentHash) && /^[0-9a-f]{64}$/.test(p.sourceIdentity))).toBe(true);
    // Element order in the file does not matter.
    const shuffled = fixture();
    shuffled.response.elements.reverse();
    expect(parse(shuffled).places).toEqual(a);
    // Identity depends only on type/id; the hash changes with content (here the version).
    const bumped = fixture();
    const el = bumped.response.elements.find((e) => e.id === 999000000009)!;
    el.version = 5;
    const after = byKey(parse(bumped).places).get("osm:node/999000000009")!;
    const before = byKey(a).get("osm:node/999000000009")!;
    expect(after.sourceIdentity).toBe(before.sourceIdentity);
    expect(after.contentHash).not.toBe(before.contentHash);
    // A tag the parser ignores does not change the hash.
    const ignored = fixture();
    (ignored.response.elements.find((e) => e.id === 999000000009)!.tags as Record<string, string>).phone = "x";
    expect(byKey(parse(ignored).places).get("osm:node/999000000009")!.contentHash).toBe(before.contentHash);
  });

  it("counts kept places per category", () => {
    expect(parse().counts).toEqual({
      bus_terminal: 1, hospital_clinic: 0, college_university: 1, school: 2, place_of_worship: 0, government: 3,
      market: 1, mall: 1, park: 2, square: 0,
    });
  });
});

describe("parseOsmPlaces validation", () => {
  it("reports a malformed file as a problem instead of throwing", () => {
    expect(parse({ header: {}, response: {} }).problems[0]).toMatch(/^OSM snapshot: invalid at header\./);
    expect(parse(null).problems).toHaveLength(1);
    expect(parse(null).places).toEqual([]);
  });

  it("refuses a snapshot of another boundary relation or licence", () => {
    const other = fixture();
    other.header.boundaryRelation = 1;
    expect(parse(other).problems).toHaveLength(1);
    const licence = fixture();
    licence.header.licence = "CC-BY-4.0";
    expect(parse(licence).problems).toHaveLength(1);
  });

  it("reports a duplicated element", () => {
    const dup = fixture();
    dup.response.elements.push({ ...dup.response.elements[0]! });
    expect(parse(dup).problems).toEqual(["OSM snapshot: element osm:node/999000000001 appears more than once"]);
  });

  it("treats a missing synthetic flag as real data", () => {
    const real = fixture();
    delete real.header.synthetic;
    expect(parse(real).synthetic).toBe(false);
  });
});
