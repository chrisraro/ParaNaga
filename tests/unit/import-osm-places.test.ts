import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAGA_BOUNDARY } from "@/domain/geo/naga";
import { CATEGORY_RULES, KEPT_TAGS, categorize, parseOsmPlaces, stripOverpassResponse, type OsmPlace } from "@/domain/import/osm-places";
import { CORE_PLACE_CATEGORIES, OSM_CATEGORY_LABEL, OSM_PLACE_CATEGORIES, isCorePlaceCategory } from "@/domain/places/osm-categories";

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
      "osm:node/999000000001", "osm:node/999000000002", "osm:node/999000000008", "osm:node/999000000009", "osm:node/999000000010",
      "osm:node/999000000012", "osm:node/999000000013", "osm:node/999000000015", "osm:node/999000000016",
      "osm:way/999000000003", "osm:way/999000000011", "osm:relation/999000000004",
    ]);
    expect(dropped).toEqual({ unnamed: 2, outside_boundary: 1, other_tags: 0, no_coordinate: 1 });
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
    // The D10 categories keep their order at the top of the table; the fallbacks come last.
    const order = [...new Set(CATEGORY_RULES.map((r) => r.category))];
    expect(order.slice(0, 10)).toEqual([
      "bus_terminal", "hospital_clinic", "college_university", "school", "place_of_worship", "government",
      "market", "mall", "park", "square",
    ]);
    expect(CATEGORY_RULES.at(-1)!.category).toBe("other_place");
    expect([...order].sort()).toEqual([...OSM_PLACE_CATEGORIES].sort());
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

  it("never outputs forbidden tags", () => {
    const text = JSON.stringify(parse().places);
    for (const forbidden of ["opening_hours", "phone", "website", "image", "entrance", "addr:", "religion",
      "+63", "synthetic.invalid", "10:00-21:00"]) {
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
      ...Object.fromEntries(OSM_PLACE_CATEGORIES.map((c) => [c, 0])),
      bus_terminal: 1, college_university: 1, school: 2, government: 3, market: 1, mall: 1, park: 2, restaurant: 1,
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
    expect(parse(real).problems).toEqual([]);
    expect(parse(real).synthetic).toBe(false);
  });

  it.each(["user", "uid", "changeset"])("refuses a file whose elements still carry contributor data (%s)", (field) => {
    const raw = fixture();
    raw.response.elements[3]![field] = field === "user" ? "someone" : 42;
    raw.response.elements[5]![field] = field === "user" ? "someone" : 42;
    const result = parse(raw);
    expect(result.problems).toEqual([
      "OSM snapshot: 2 element(s) carry contributor data (user, uid, changeset); write snapshots only with " +
        "scripts/fetch-osm-places.ts, which removes it",
    ]);
  });

  it("requires removedFields (with user, uid, changeset) on a non-synthetic file", () => {
    const real = fixture();
    delete real.header.synthetic;
    delete real.header.removedFields;
    expect(parse(real).problems[0]).toMatch(/^OSM snapshot: invalid at header\.removedFields: must list user, uid, changeset/);
    real.header.removedFields = ["nodes"];
    expect(parse(real).problems).toHaveLength(1);
    // The synthetic fixture does not need it.
    const synthetic = fixture();
    delete synthetic.header.removedFields;
    expect(parse(synthetic).problems).toEqual([]);
  });
});

describe("stripOverpassResponse", () => {
  const overpass = {
    version: 0.6,
    generator: "Overpass API",
    osm3s: { timestamp_osm_base: "2026-10-15T00:00:00Z", copyright: "ODbL" },
    remark: undefined,
    elements: [
      { type: "node", id: 1, lat: 13.6234, lon: 123.1847, timestamp: "2026-01-01T00:00:00Z", version: 2, changeset: 9,
        user: "someone", uid: 7, tags: { amenity: "school", name: "Synthetic School" } },
      { type: "way", id: 2, bounds: { minlat: 1 }, center: { lat: 13.624, lon: 123.185 }, nodes: [1, 2], version: 1,
        timestamp: "2026-01-01T00:00:00Z", user: "x", uid: 8, changeset: 3, geometry: [], tags: { shop: "mall", name: "M" } },
      { type: "relation", id: 3, center: { lat: 13.6235, lon: 123.1848 }, members: [{ ref: 1 }], version: 1,
        timestamp: "2026-01-01T00:00:00Z", tags: { leisure: "park", name: "P" } },
    ],
  };

  it("keeps only type, id, lat, lon, center, version, timestamp and tags, in that order", () => {
    const { response, removedFields } = stripOverpassResponse(overpass);
    expect(Object.keys(response)).toEqual(["version", "generator", "osm3s", "elements"]);
    const elements = response.elements as Record<string, unknown>[];
    expect(elements.map((e) => Object.keys(e))).toEqual([
      ["type", "id", "lat", "lon", "version", "timestamp", "tags"],
      ["type", "id", "center", "version", "timestamp", "tags"],
      ["type", "id", "center", "version", "timestamp", "tags"],
    ]);
    expect(JSON.stringify(response)).not.toMatch(/someone|"uid"|"user"|changeset|"nodes"|"members"|bounds|geometry/);
    expect(removedFields).toEqual(expect.arrayContaining(["user", "uid", "changeset", "nodes", "members", "bounds", "otherTags"]));
  });

  it("keeps only the tags the importer reads, and the parser output is unchanged", () => {
    expect([...KEPT_TAGS].sort()).toEqual([
      "alt_name", "amenity", "building", "bus", "craft", "healthcare", "historic", "leisure", "name", "name:en",
      "name:fil", "office", "old_name", "place", "public_transport", "shop", "tourism",
    ]);
    const noisy = structuredClone(overpass);
    Object.assign(noisy.elements[0]!.tags, {
      phone: "+63 000", opening_hours: "24/7", note: "n", fixme: "f", source: "survey", "name:en": "Synthetic School EN",
    });
    const { response } = stripOverpassResponse(noisy);
    const tags = (response.elements as { tags: Record<string, string> }[])[0]!.tags;
    expect(tags).toEqual({ amenity: "school", name: "Synthetic School", "name:en": "Synthetic School EN" });
    // The fixture's places parse identically after stripping its extra tags.
    const raw = fixture();
    const stripped = stripOverpassResponse(raw.response as Parameters<typeof stripOverpassResponse>[0]);
    expect(JSON.stringify(stripped.response)).not.toMatch(/opening_hours|phone|website|image|entrance|addr:|religion|"type":"multipolygon"/);
    expect(parse({ header: raw.header, response: stripped.response }).places).toEqual(parse().places);
  });

  it("is deterministic and its output imports without problems", () => {
    const a = JSON.stringify(stripOverpassResponse(overpass));
    expect(JSON.stringify(stripOverpassResponse(structuredClone(overpass)))).toBe(a);
    const { response, removedFields } = stripOverpassResponse(overpass);
    const header: Record<string, unknown> = { ...fixture().header, removedFields };
    delete header.synthetic;
    const result = parse({ header, response });
    expect(result.problems).toEqual([]);
    expect(result.places.map((p) => p.key)).toEqual(["osm:node/1", "osm:way/2", "osm:relation/3"]);
  });
});

describe("category mapping (Task 14: every named place)", () => {
  const cat = (tags: Record<string, string>) => categorize(tags)?.category ?? null;

  it.each([
    [{ amenity: "restaurant" }, "restaurant"],
    [{ amenity: "food_court" }, "restaurant"],
    [{ amenity: "fast_food" }, "fast_food"],
    [{ amenity: "cafe" }, "cafe"],
    [{ amenity: "pub" }, "bar"],
    [{ shop: "bakery" }, "bakery"],
    [{ shop: "supermarket" }, "supermarket"],
    [{ shop: "convenience" }, "convenience_store"],
    [{ shop: "department_store" }, "department_store"],
    [{ shop: "clothes" }, "shop"],
    [{ amenity: "bank" }, "bank"],
    [{ amenity: "atm" }, "atm"],
    [{ amenity: "pharmacy" }, "pharmacy"],
    [{ shop: "chemist" }, "pharmacy"],
    [{ healthcare: "pharmacy" }, "pharmacy"],
    [{ amenity: "dentist" }, "health_service"],
    [{ healthcare: "laboratory" }, "health_service"],
    [{ amenity: "fuel" }, "fuel"],
    [{ tourism: "hotel" }, "hotel"],
    [{ tourism: "guest_house" }, "lodging"],
    [{ tourism: "museum" }, "museum"],
    [{ tourism: "viewpoint" }, "attraction"],
    [{ tourism: "information", information: "board" }, "other_place"],
    [{ historic: "monument" }, "historic"],
    [{ amenity: "library" }, "library"],
    [{ leisure: "fitness_centre" }, "sports"],
    [{ leisure: "playground" }, "leisure"],
    [{ office: "company" }, "office"],
    [{ craft: "tailor" }, "craft"],
    [{ amenity: "kindergarten" }, "school"],
    [{ building: "cathedral" }, "place_of_worship"],
    [{ building: "yes" }, "building"],
    [{ amenity: "bicycle_parking" }, "other_place"],
  ] as const)("%j is %s", (tags, category) => {
    expect(cat({ ...tags })).toBe(category);
  });

  it("keeps the D10 precedence over the new rules", () => {
    expect(cat({ shop: "mall", amenity: "restaurant" })).toBe("mall");
    expect(cat({ amenity: "hospital", healthcare: "hospital" })).toBe("hospital_clinic");
    expect(cat({ amenity: "post_office", shop: "stationery" })).toBe("government");
    expect(cat({ amenity: "place_of_worship", building: "church" })).toBe("place_of_worship");
  });

  it("an unlisted value of a place key falls back to the generic categories; no place key is no place", () => {
    expect(cat({ shop: "unheard_of_kind" })).toBe("shop");
    expect(cat({ amenity: "unheard_of_kind" })).toBe("other_place");
    expect(cat({ shop: "no" })).toBeNull();
    expect(cat({ highway: "residential", name: "Rizal Avenue" })).toBeNull();
  });

  it("stores only the tags that decided the category", () => {
    expect(categorize({ amenity: "cafe", cuisine: "coffee_shop", shop: "coffee" })?.tags).toEqual({ amenity: "cafe" });
  });

  it("every category has a human label, and the D10 ten are the core set", () => {
    for (const c of OSM_PLACE_CATEGORIES) expect(OSM_CATEGORY_LABEL[c], c).toMatch(/^[A-Z]/);
    expect(OSM_CATEGORY_LABEL.other_place).toBe("Place");
    expect(OSM_CATEGORY_LABEL.restaurant).toBe("Restaurant");
    expect(CORE_PLACE_CATEGORIES).toHaveLength(10);
    expect(isCorePlaceCategory("mall")).toBe(true);
    expect(isCorePlaceCategory("cafe")).toBe(false);
  });

  it("the stored tags include every key the rules read, so the snapshot strip keeps them", () => {
    for (const key of ["shop", "amenity", "tourism", "leisure", "office", "craft", "healthcare", "historic", "building"]) {
      expect(KEPT_TAGS.has(key), key).toBe(true);
    }
  });
});

describe("migration 0011", () => {
  it("lists exactly the ParaNaga categories in the place_version check", () => {
    const sqlText = readFileSync("db/migrations/0011_osm_place_categories.sql", "utf8");
    const check = sqlText.slice(sqlText.indexOf("add constraint place_version_category_check"));
    const listed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...OSM_PLACE_CATEGORIES].sort());
  });
});
