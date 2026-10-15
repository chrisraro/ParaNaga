// What picking a search result does (src/domain/search/select.ts), on the real captured index.
import { describe, expect, it } from "vitest";
import { searchIndexSchema } from "@/domain/api/schemas";
import { searchIndex, type SearchResult } from "@/domain/search/search";
import { actionFor, noticeFor, parseSearchPurpose } from "@/domain/search/select";
import raw from "../e2e/fixtures/network/search-index.json" with { type: "json" };

const index = searchIndexSchema.parse(raw);
const find = (q: string, kind: SearchResult["kind"], regional = false) =>
  searchIndex(index, q, { regional }).flatMap((g) => g.results).find((r) => r.kind === kind)!;

describe("parseSearchPurpose", () => {
  it("accepts start, destination and save only", () => {
    expect(parseSearchPurpose("start")).toBe("start");
    expect(parseSearchPurpose("destination")).toBe("destination");
    expect(parseSearchPurpose("save")).toBe("save");
    for (const x of [null, undefined, "", "Start", "end", "start "]) expect(parseSearchPurpose(x)).toBeNull();
  });
});

describe("actionFor", () => {
  it("for=start|destination: an OpenStreetMap or mapped-pin place sets that end", () => {
    expect(actionFor(find("SM City", "osm"), "destination")).toMatchObject({ type: "endpoint", which: "destination", endpoint: { label: "SM City Naga" } });
    expect(actionFor(find("Plaza Rizal", "pin"), "start")).toMatchObject({ type: "endpoint", which: "start", endpoint: { label: "Plaza Rizal (mapped pin)" } });
  });

  it("a route opens route detail whatever the purpose", () => {
    for (const purpose of [null, "start", "save"] as const) expect(actionFor(find("R8A", "route"), purpose)).toEqual({ type: "open", href: "/app/routes/R8-A" });
  });

  it("no location (terminal, barangay, study label, regional): its own screen, never an endpoint", () => {
    const abella = find("Abella", "barangay");
    const starbucks = find("Starbucks", "study");
    for (const purpose of [null, "destination", "save"] as const) {
      expect(actionFor(find("Centro loading", "terminal"), purpose)).toEqual({ type: "open", href: "/app/terminals/T05" });
      expect(actionFor(abella, purpose)).toEqual({ type: "open", href: "/app/places/barangay/abella" });
      expect(actionFor(starbucks, purpose)).toEqual({ type: "open", href: `/app/places/study/${starbucks.kind === "study" ? starbucks.code : ""}` });
      expect(actionFor(find("Iriga", "regional", true), purpose)).toEqual({ type: "open", href: "/app/terminals/T02" });
    }
  });

  it("browsing (no purpose): places open their place detail; saving: a notice", () => {
    const sm = find("SM City", "osm");
    const key = sm.kind === "osm" ? sm.key : "";
    expect(key).toMatch(/^osm:(node|way|relation)\/\d+$/);
    expect(actionFor(sm, null)).toEqual({ type: "open", href: `/app/places/osm/${key.slice("osm:".length)}` });
    const plaza = find("Plaza Rizal", "pin");
    expect(actionFor(plaza, null)).toEqual({ type: "open", href: `/app/places/pin/${plaza.kind === "pin" ? plaza.key : ""}` });
    expect(actionFor(sm, "save")).toEqual({ type: "notice" });
    expect(actionFor(plaza, "save")).toEqual({ type: "notice" });
  });

  it("a regional category without a terminal and a saved place (browsing) show a notice", () => {
    const regional = { kind: "regional", title: "Somewhere", category: "eastbound", terminalCode: null, terminalName: null, score: 100, offset: 0 } as const;
    expect(actionFor(regional, null)).toEqual({ type: "notice" });
    const saved = { kind: "saved", id: "s1", title: "Home", point: { lat: 13.62, lng: 123.19 }, score: 100, offset: 0 } as const;
    expect(actionFor(saved, null)).toEqual({ type: "notice" });
    expect(actionFor(saved, "start")).toMatchObject({ type: "endpoint", which: "start" });
  });

  it("old route names and feeder leads are not tappable", () => {
    expect(actionFor(find("Pacol/Carolina", "legacy"), "start")).toEqual({ type: "none" });
    expect(actionFor(find("trimobile", "feeder", true), null)).toEqual({ type: "none" });
  });
});

describe("noticeFor", () => {
  it("an OpenStreetMap place: entrance not mapped, can be set as an end, with attribution", () => {
    const n = noticeFor(find("SM City", "osm"), null);
    expect(n.body).toBe("Mall. Location from OpenStreetMap — entrance not mapped.");
    expect(n.body).toContain("Location from OpenStreetMap — entrance not mapped");
    expect(n.endpoint?.label).toBe("SM City Naga");
    expect(n.osm).toBe(true);
  });

  it("a mapped-pin place says trips from it are unverified", () => {
    const n = noticeFor(find("Plaza Rizal", "pin"), null);
    expect(n.body).toContain("Trips from mapped pins are unverified.");
    expect(n.endpoint?.label).toBe("Plaza Rizal (mapped pin)");
  });

  it("places without a location say why they cannot be a trip end", () => {
    for (const r of [find("Centro loading", "terminal"), find("Abella", "barangay"), find("Starbucks", "study")]) {
      const n = noticeFor(r, "start");
      expect(n.body).toContain("cannot be a trip start or destination");
      expect(n.endpoint).toBeNull();
    }
    const regional = noticeFor(find("Iriga", "regional", true), null);
    expect(regional.body).toBe(
      "Eastbound destinations are listed for Eastbound Terminal. Individual services are not verified, and the terminal's location is not mapped.",
    );
  });

  it("no notice promises a screen that opens soon", () => {
    for (const r of [find("SM City", "osm"), find("Plaza Rizal", "pin"), find("Centro loading", "terminal"), find("Abella", "barangay")]) {
      expect(noticeFor(r, null).body).not.toMatch(/open soon/);
    }
  });

  it("for=save: the notice gives the place's facts (the page note alone says saving opens soon)", () => {
    const n = noticeFor(find("SM City", "osm"), "save");
    expect(n.body).toBe("Mall. Location from OpenStreetMap — entrance not mapped.");
    expect(n.body).not.toMatch(/opens soon/);
    expect(n.endpoint).toBeNull();
    expect(n.osm).toBe(true);
    expect(noticeFor(find("Plaza Rizal", "pin"), "save").body).toBe(
      "Mapped stop candidate (Loop A, Loop B, Loop C, Loop D), not verified for navigation. Trips from mapped pins are unverified.",
    );
  });
});
