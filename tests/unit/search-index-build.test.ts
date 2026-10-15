// The search index builder (src/domain/search/index-build.ts) on the REAL Data_Sets files plus
// the Task 3 synthetic OpenStreetMap fixture (tests/fixtures/search-source.ts).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isCompleteSearchIndex, searchIndexSchema } from "@/domain/api/schemas";
import { haversineMeters } from "@/domain/geo/geometry";
import { buildSearchIndex, groupPinPlaces, type SearchSourceStop } from "@/domain/search/index-build";
import { LEGACY_ROUTE_NAMES } from "@/domain/search/legacy-route-names";
import { foldText } from "@/domain/search/normalize";
import { realSearchSource } from "../fixtures/search-source";

const source = realSearchSource();
const index = buildSearchIndex(source);
const stopOf = (layer: string, code: string) => source.stops.find((s) => s.layer === layer && s.code === code)!;
const groupWith = (stopId: string) => index.pinPlaces.find((g) => g.pins.some((p) => p.stopId === stopId));

describe("buildSearchIndex on the real data", () => {
  it("produces a schema-valid, complete index", () => {
    expect(() => searchIndexSchema.parse(index)).not.toThrow();
    expect(isCompleteSearchIndex(index)).toBe(true);
  });

  it("groups Plaza Rizal A1 (Loop A) and A1 (Loop C) at the identical coordinate", () => {
    const a = stopOf("Loop Service A", "A1");
    const c = stopOf("Loop Service C", "A1");
    expect([a.lat, a.lng]).toEqual([c.lat, c.lng]);
    const group = groupWith(a.id)!;
    expect(group.label).toBe("Plaza Rizal");
    expect(group.pins.map((p) => p.stopId)).toContain(c.id);
  });

  it("puts the B1 pins in the A1 group exactly when they are within 60 m of its first pin", () => {
    const a1 = groupWith(stopOf("Loop Service A", "A1").id)!;
    const first = a1.pins[0]!;
    for (const layer of ["Loop Service B", "Loop Service D"]) {
      const b1 = stopOf(layer, "B1");
      const meters = haversineMeters(first, b1);
      const together = a1.pins.some((p) => p.stopId === b1.id);
      expect(together).toBe(meters <= 60);
    }
    // On the real data the B1 pins are about 47 m from A1, so Plaza Rizal is one place.
    expect(haversineMeters(first, stopOf("Loop Service B", "B1"))).toBeLessThan(60);
    expect(a1.pins.map((p) => `${p.layer}/${p.code}`).sort()).toEqual(
      ["Loop Service A/A1", "Loop Service B/B1", "Loop Service C/A1", "Loop Service D/B1"],
    );
  });

  it("makes Naga Cathedral a mapped-pin place with the pin coordinates as given", () => {
    const cathedral = index.pinPlaces.filter((g) => g.label === "Naga Cathedral");
    expect(cathedral.length).toBeGreaterThanOrEqual(1);
    for (const pin of cathedral.flatMap((g) => g.pins)) {
      const s = source.stops.find((x) => x.id === pin.stopId)!;
      expect([pin.lat, pin.lng]).toEqual([s.lat, s.lng]);
    }
  });

  it("never makes a place from a blank label (B18/B19 on Loop B)", () => {
    for (const code of ["B18", "B19"]) {
      const blank = stopOf("Loop Service B", code);
      expect(blank.label?.trim() ?? "").toBe("");
      expect(groupWith(blank.id)).toBeUndefined();
    }
    expect(index.pinPlaces.every((g) => g.label.trim() !== "")).toBe(true);
  });

  it("covers every labelled pin exactly once and marks Loop A/B pins as on a route", () => {
    const labelled = source.stops.filter((s) => (s.label ?? "").trim() !== "");
    const pinned = index.pinPlaces.flatMap((g) => g.pins.map((p) => p.stopId));
    expect(new Set(pinned).size).toBe(pinned.length);
    expect(pinned.sort()).toEqual(labelled.map((s) => s.id).sort());
    const a1 = groupWith(stopOf("Loop Service A", "A1").id)!;
    expect(a1.pins.find((p) => p.layer === "Loop Service A")!.onRoute).toBe(true);
    expect(a1.pins.find((p) => p.layer === "Loop Service C")!.onRoute).toBe(false);
  });

  it("keys a group by sha256(normalized label + first stop id), first 16 hex chars", () => {
    const g = groupWith(stopOf("Loop Service A", "A1").id)!;
    const expected = createHash("sha256").update(foldText(g.label) + g.pins[0]!.stopId).digest("hex").slice(0, 16);
    expect(g.key).toBe(expected);
    expect(new Set(index.pinPlaces.map((p) => p.key)).size).toBe(index.pinPlaces.length);
  });

  it("includes the OpenStreetMap places with their osm: keys and categories", () => {
    expect(index.osmPlaces.map((p) => p.key).sort()).toEqual(source.places.map((p) => p.key).sort());
    const school = index.osmPlaces.find((p) => p.key === "osm:node/999000000001")!;
    expect(school).toMatchObject({ name: "Synthetic Test Elementary School", category: "school", sourceCode: "OSM-2026-10-15" });
    expect(school.aliases).toContain("STES");
    expect(school).not.toHaveProperty("osmType");
  });

  it("lists 11 routes; R8-A streets include Bicol Central Station and its trial stop, distinct and verbatim", () => {
    expect(index.routes).toHaveLength(11);
    const r8a = index.routes.find((r) => r.code === "R8-A")!;
    expect(r8a.streets).toContain("Bicol Central Station");
    expect(r8a.streets).toContain("Eastbound Terminal, Anciano St");
    expect(r8a.streets).toContain("Peñafrancia Ave");
    expect(new Set(r8a.streets).size).toBe(r8a.streets.length);
    expect(r8a).toMatchObject({ hasTrial: true, evidenceLevel: "provisional" });
  });

  it("has 6 terminals, 27 barangays and 32 study labels, none with a location", () => {
    expect(index.terminals).toHaveLength(6);
    expect(index.barangays).toHaveLength(27);
    expect(index.studyLabels).toHaveLength(32);
    for (const x of [...index.terminals, ...index.barangays, ...index.studyLabels]) expect(x.location).toBeNull();
    expect(index.barangays.find((b) => b.name === "Bagumbayan Norte")).toMatchObject({
      key: "bagumbayan-norte", surveyStatus: "not_surveyed", sourceCode: "S22",
    });
    expect(new Set(index.barangays.map((b) => b.key)).size).toBe(27);
  });

  it("carries the destination categories, feeder leads and the S28 legacy names as unmapped hints", () => {
    expect(index.destinationCategories.map((c) => c.category).sort()).toEqual(
      ["eastbound", "north_suburb", "northbound", "south_suburbs", "southbound"],
    );
    expect(index.feederLeads.map((f) => f.code)).toEqual(["SF01", "SF02", "SF03", "SF04", "SF05"]);
    expect(index.legacyNames).toEqual(LEGACY_ROUTE_NAMES);
    expect(index.legacyNames.map((n) => n.name)).toEqual([
      "Concepcion via Panganiban/diversion", "Magsaysay", "San Felipe/Lomeda", "Pacol/Carolina",
      "Cararayan/San Isidro", "Bagumbayan/Calauag",
    ]);
    for (const n of index.legacyNames) expect(n).toMatchObject({ sourceCode: "S28", year: 1993, mappedRouteCode: null });
  });

  it("is deterministic regardless of input stop order", () => {
    const shuffled = { ...source, stops: [...source.stops].reverse() };
    expect(buildSearchIndex(shuffled)).toEqual(index);
  });
});

describe("groupPinPlaces", () => {
  const pin = (id: string, label: string | null, lat: number, lng: number): SearchSourceStop => ({
    id, layer: "L", code: id.slice(-2), label, lat, lng, onRoute: false,
  });
  const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

  it("joins labels that differ only in case, spacing and accents; keeps every raw spelling", () => {
    const groups = groupPinPlaces([
      pin(id(1), "Peñafrancia  Ave", 13.62, 123.18),
      pin(id(2), "penafrancia ave", 13.6201, 123.18),
      pin(id(3), "Peñafrancia  Ave", 13.6202, 123.18),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Peñafrancia  Ave");
    expect(groups[0]!.spellings).toEqual(["Peñafrancia  Ave", "penafrancia ave"]);
  });

  it("splits the same label more than 60 m from the group's first pin", () => {
    const groups = groupPinPlaces([pin(id(1), "City Hall", 13.62, 123.18), pin(id(2), "City Hall", 13.621, 123.18)]);
    expect(groups).toHaveLength(2);
  });

  it("skips blank and null labels", () => {
    expect(groupPinPlaces([pin(id(1), "", 13.62, 123.18), pin(id(2), "  ", 13.62, 123.18), pin(id(3), null, 13.62, 123.18)])).toEqual([]);
  });
});
