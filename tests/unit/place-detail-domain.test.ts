// Place and Terminal detail helpers (src/domain/places/place-detail.ts), on the real captured index.
import { describe, expect, it } from "vitest";
import { searchIndexSchema } from "@/domain/api/schemas";
import { haversineMeters } from "@/domain/geo/geometry";
import {
  findPlace,
  nearestMappedStops,
  osmKeyParts,
  osmObjectUrl,
  osmPlaceHref,
  osmSourceText,
  otherSpellings,
  parsePlaceRef,
  pinPlacePoint,
  queryFromHash,
  searchHref,
  studyKindText,
  studyRouteText,
  terminalEvidenceLabel,
  terminalModesText,
  terminalNoteSentences,
  terminalRouteSub,
} from "@/domain/places/place-detail";
import raw from "../e2e/fixtures/network/search-index.json" with { type: "json" };

const index = searchIndexSchema.parse(raw);
const SM = index.osmPlaces.find((p) => p.name === "SM City Naga")!;
const PLAZA = index.pinPlaces.find((p) => p.label === "Plaza Rizal")!;

describe("place URLs", () => {
  it("parses well-formed params and refuses anything else", () => {
    expect(parsePlaceRef("osm", { type: "way", id: "123" })).toEqual({ kind: "osm", type: "way", id: "123" });
    for (const bad of [{ type: "area", id: "1" }, { type: "node", id: "0" }, { type: "node", id: "12a" }, { type: "node" }]) {
      expect(parsePlaceRef("osm", bad)).toBeNull();
    }
    expect(parsePlaceRef("pin", { key: PLAZA.key })).toEqual({ kind: "pin", key: PLAZA.key });
    expect(parsePlaceRef("pin", { key: "XYZ" })).toBeNull();
    expect(parsePlaceRef("barangay", { key: "bagumbayan-norte" })).toEqual({ kind: "barangay", key: "bagumbayan-norte" });
    expect(parsePlaceRef("barangay", { key: "Bagumbayan Norte" })).toBeNull();
    expect(parsePlaceRef("study", { code: "DSC-A-01" })).toEqual({ kind: "study", code: "DSC-A-01" });
    expect(parsePlaceRef("study", { code: "../x" })).toBeNull();
  });

  it("builds each place's href from its index key, and finds it again", () => {
    const href = osmPlaceHref(SM.key)!;
    expect(href).toMatch(/^\/app\/places\/osm\/(node|way|relation)\/\d+$/);
    const [, , , , type, id] = href.split("/");
    const ref = parsePlaceRef("osm", { type, id })!;
    expect(findPlace(index, ref)).toMatchObject({ kind: "osm", place: { name: "SM City Naga" } });
    expect(osmPlaceHref("aaef5c44ccad2cd3")).toBeNull();
    expect(osmKeyParts("osm:relation/42")).toEqual({ type: "relation", id: "42" });
    expect(findPlace(index, { kind: "pin", key: PLAZA.key })).toMatchObject({ kind: "pin", place: { label: "Plaza Rizal" } });
    expect(findPlace(index, { kind: "barangay", key: "abella" })).toMatchObject({ kind: "barangay", place: { name: "Abella" } });
    expect(findPlace(index, { kind: "study", code: "DSC-A-01" })).toMatchObject({ kind: "study", place: { label: "Penafrancia - Magsaysay" } });
    expect(findPlace(index, { kind: "osm", type: "node", id: "1" })).toBeNull();
    expect(findPlace(index, { kind: "barangay", key: "nowhere" })).toBeNull();
  });

  it("search links carry the query in the fragment only", () => {
    const href = searchHref("UMA Residences");
    expect(href).toBe("/app/search#q=UMA%20Residences");
    expect(href).not.toContain("?");
    expect(queryFromHash("#q=UMA%20Residences")).toBe("UMA Residences");
    expect(queryFromHash("")).toBe("");
    expect(queryFromHash("#q=%E0%A4%A")).toBe("");
  });

  it("the OpenStreetMap object link has no query string", () => {
    expect(osmObjectUrl("way", "123")).toBe("https://www.openstreetmap.org/way/123");
  });
});

describe("OpenStreetMap place copy", () => {
  it("source line names the snapshot date, the object and its version", () => {
    expect(osmSourceText({ sourceCode: "OSM-2026-10-15", osmVersion: 4 }, "way", "123")).toBe(
      "OpenStreetMap, snapshot of 15 Oct 2026 · object way/123 v4",
    );
  });

  it("nearest mapped stops: within 600 m, nearest first, at most 3, one per mapped place", () => {
    const near = nearestMappedStops(index, SM);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(3);
    for (const s of near) expect(s.meters).toBeLessThanOrEqual(600);
    expect(near.map((s) => s.meters)).toEqual([...near.map((s) => s.meters)].sort((a, b) => a - b));
    expect(new Set(near.map((s) => s.label)).size).toBe(near.length);
    // A place far from every pin lists none.
    expect(nearestMappedStops(index, { lat: 13.66, lng: 123.29 })).toEqual([]);
  });

  it("prefers a pin on a route order at the same spot", () => {
    const near = nearestMappedStops(index, pinPlacePoint(PLAZA), 600, 1);
    expect(near[0]).toMatchObject({ label: "Plaza Rizal", layer: "Loop Service A" });
    expect(near[0]!.meters).toBeLessThan(1);
  });
});

describe("mapped-pin place copy", () => {
  it("the trip end is the first on-route pin", () => {
    const pin = PLAZA.pins.find((p) => p.onRoute)!;
    expect(haversineMeters(pinPlacePoint(PLAZA), pin)).toBe(0);
  });

  it("other spellings only when the group has more than one", () => {
    expect(otherSpellings({ label: "Plaza Rizal", spellings: ["Plaza Rizal"] })).toEqual([]);
    expect(otherSpellings({ label: "A Ave.", spellings: ["A Ave.", "A Ave"] })).toEqual(["A Ave"]);
  });
});

describe("study label copy", () => {
  it("names the study context and the route", () => {
    expect(studyKindText("2025_LPTRP_SimEx")).toBe("Stop label from the 2025 route study (2025 LPTRP SimEx)");
    expect(studyKindText(null)).toBe("Stop label from the 2025 route study");
    expect(studyRouteText("R8-A", "clockwise")).toBe("R8-A clockwise");
    expect(studyRouteText(null, null)).toBe("Not recorded");
  });
});

describe("terminal copy", () => {
  it("modes, evidence and notes", () => {
    expect(terminalModesText(["jeepney", "UV/van"])).toBe("Jeepney, UV/van");
    expect(terminalModesText(["city_jeepney"])).toBe("City jeepney");
    expect(terminalEvidenceLabel("official_address")).toBe("city source");
    expect(terminalEvidenceLabel("something_new")).toBe("something new");
    expect(terminalNoteSentences("T01", false)).toEqual(["Not the PNR railway station."]);
    expect(terminalNoteSentences("T06", false)).toEqual(["Not Bicol Central Station (the bus terminal)."]);
    expect(terminalNoteSentences("T02", true)).toEqual([
      "Northbound/eastbound are administrative labels.",
    ]);
    expect(terminalNoteSentences("T05", false)).toEqual([]);
    expect(terminalRouteSub("legal_plan")).toBe("Legal route plan");
    expect(terminalRouteSub("trial")).toBe("Nov 2025 trial");
  });
});
