// Client-side search over the published search index (src/domain/search/search.ts), on the REAL
// index captured for the e2e fixtures (revision modes-2026-10-16: 233 OpenStreetMap places,
// 47 mapped-pin places, 11 routes, 6 terminals, 27 barangays, 32 study labels).
import { describe, expect, it } from "vitest";
import { searchIndexSchema } from "@/domain/api/schemas";
import {
  GROUP_LIMIT,
  GROUP_ORDER,
  bigramDice,
  countResults,
  endpointForResult,
  resultSubtitle,
  searchIndex,
  type SearchGroup,
  type SearchResult,
} from "@/domain/search/search";
import raw from "../e2e/fixtures/network/search-index.json" with { type: "json" };

const index = searchIndexSchema.parse(raw);
const off = { regional: false } as const;
const on = { regional: true } as const;

const group = (groups: SearchGroup[], id: SearchGroup["id"]) => groups.find((g) => g.id === id);
const titles = (g: SearchGroup | undefined) => (g ? g.results.map((r) => r.title) : []);
const first = (groups: SearchGroup[]): SearchResult => groups[0]!.results[0]!;

describe("searchIndex: the brief's queries", () => {
  it('"Diversion": the mapped-pin corner first, the 1993 name as an old route name, no "Diversion route"', () => {
    const groups = searchIndex(index, "Diversion", off);
    expect(first(groups)).toMatchObject({ kind: "pin", title: "Cor. Diversion Rd. & Fraternidad St." });
    expect(titles(group(groups, "legacy"))).toContain("Concepcion via Panganiban/diversion");
    for (const r of group(groups, "routes")?.results ?? []) expect(r.title).not.toMatch(/diversion/i);
  });

  it('"Centro": terminal T05 "Centro loading cluster" and every route named "Centro–…"', () => {
    const groups = searchIndex(index, "Centro", off);
    expect(group(groups, "terminals")!.results).toContainEqual(expect.objectContaining({ kind: "terminal", code: "T05", title: "Centro loading cluster" }));
    const centroRoutes = index.routes.filter((r) => r.name.startsWith("Centro–")).map((r) => r.code);
    expect(centroRoutes).toHaveLength(11);
    const found = group(groups, "routes")!.results.map((r) => (r.kind === "route" ? r.code : null));
    for (const code of centroRoutes) expect(found).toContain(code);
  });

  it('"magsaysay": routes through a street of the legal plan, and places', () => {
    const groups = searchIndex(index, "magsaysay", off);
    const routes = group(groups, "routes")!.results;
    const viaStreet = routes.filter((r) => r.kind === "route" && r.matchedStreet !== null);
    expect(viaStreet.map((r) => (r.kind === "route" ? r.code : ""))).toContain("R1");
    const r1 = viaStreet.find((r) => r.kind === "route" && r.code === "R1")!;
    expect(resultSubtitle(r1)).toBe("Legal route plan lists Magsaysay Ave");
    // A route named after the street is a name match, not a street match.
    expect(routes.find((r) => r.kind === "route" && r.code === "R2")).toMatchObject({ matchedStreet: null });
    expect(group(groups, "places")!.results.length).toBeGreaterThan(0);
  });

  it('"Penafrancia" finds "Peñafrancia"', () => {
    const all = searchIndex(index, "Penafrancia", off).flatMap((g) => g.results);
    expect(all.some((r) => r.title.includes("Peñafrancia") || (r.kind === "route" && r.matchedStreet?.includes("Peñafrancia")))).toBe(true);
  });

  it('"Iriga" only with regional connections on', () => {
    // Nothing at all without the toggle (not even a loose fuzzy hit such as "Brigade").
    expect(searchIndex(index, "Iriga", off)).toEqual([]);
    const regional = group(searchIndex(index, "Iriga", on), "regional")!;
    expect(regional.results[0]).toMatchObject({ kind: "regional", title: "Iriga", terminalCode: "T02" });
    expect(resultSubtitle(regional.results[0]!)).toBe("Eastbound destinations from Eastbound Terminal · services not verified");
  });

  it('"xyz" finds nothing', () => {
    expect(searchIndex(index, "xyz", on)).toEqual([]);
    expect(countResults(searchIndex(index, "xyz", on))).toBe(0);
  });

  it('"SM City": the OpenStreetMap mall first', () => {
    const top = first(searchIndex(index, "SM City", off));
    expect(top).toMatchObject({ kind: "osm", title: "SM City Naga", category: "mall" });
    expect(resultSubtitle(top)).toBe("Mall · from OpenStreetMap");
  });

  it("a blank query finds nothing (no recent searches: history is a separate opt-in)", () => {
    expect(searchIndex(index, "   ", on)).toEqual([]);
  });
});

describe("searchIndex: route codes", () => {
  it.each(["R8-A", "R8A", "r8a", "8a", "r8 a"])("%s finds R8-A", (q) => {
    const routes = group(searchIndex(index, q, off), "routes")!.results;
    expect(routes[0]).toMatchObject({ kind: "route", code: "R8-A", title: "R8-A Centro–Magsaysay Loop A", evidence: "provisional" });
  });

  it("documentary routes carry the documented evidence", () => {
    const r3 = group(searchIndex(index, "R3", off), "routes")!.results[0]!;
    expect(r3).toMatchObject({ kind: "route", code: "R3", evidence: "documented" });
  });
});

describe("searchIndex: ranking", () => {
  it("scores exact > name prefix > word prefix > substring > fuzzy", () => {
    const score = (q: string) => searchIndex(index, q, off)[0]?.results[0]?.score ?? 0;
    expect(score("Plaza Rizal")).toBe(100);
    expect(score("Plaza Riz")).toBe(80);
    expect(score("rizal plaza")).toBe(60);
    expect(score("aza riz")).toBe(40);
    expect(score("Cathedrall")).toBe(20); // typo: fuzzy bigram match
  });

  it("fuzzy needs at least 4 characters, the same first letter and a bigram Dice of 0.6", () => {
    expect(bigramDice("magsaysay", "magsaysai")).toBeGreaterThanOrEqual(0.6);
    expect(bigramDice("abc", "xyz")).toBe(0);
    expect(searchIndex(index, "Naga Cathedrl", off).flatMap((g) => g.results).some((r) => r.title === "Naga Cathedral")).toBe(true);
    expect(searchIndex(index, "rzl", off)).toEqual([]);
  });

  it("orders groups in the fixed order of the brief; old route names never lead", () => {
    const groups = searchIndex(index, "magsaysay", off);
    expect(groups.map((g) => g.id)).toEqual(["places", "routes", "terminals", "study", "legacy"]);
    expect(groups[0]!.id).toBe("places");
    expect(GROUP_ORDER).toEqual(["saved", "places", "routes", "terminals", "barangays", "study", "legacy", "regional"]);
  });

  it("orders results by score inside a group; Places list OpenStreetMap before mapped pins on a tie", () => {
    const groups = searchIndex(index, "Plaza Rizal", off);
    expect(groups[0]!.id).toBe("places");
    const places = groups[0]!.results;
    // Both the OSM park and the mapped-pin place are named exactly "Plaza Rizal": OSM first.
    expect(places.slice(0, 2).map((r) => r.kind)).toEqual(["osm", "pin"]);
  });

  it("keeps every match in its group; the screen shows the first GROUP_LIMIT", () => {
    expect(GROUP_LIMIT).toBe(5);
    expect(group(searchIndex(index, "Centro", off), "routes")!.results.length).toBe(12); // 11 LPTRP routes + the VISTODA feeder
  });

  it("searches saved places first among equals and lists them in the Saved group", () => {
    const saved = [{ id: "s1", label: "Lola's house", point: { lat: 13.62, lng: 123.19 } }];
    const groups = searchIndex(index, "lola", { regional: false, saved });
    expect(groups[0]).toMatchObject({ id: "saved", title: "Saved" });
    expect(resultSubtitle(groups[0]!.results[0]!)).toBe("Saved place");
  });

  it("feeder leads join the regional group only with the toggle on", () => {
    expect(searchIndex(index, "trimobile", off).flatMap((g) => g.results).some((r) => r.kind === "feeder")).toBe(false);
    const leads = searchIndex(index, "trimobile", on).flatMap((g) => g.results).filter((r) => r.kind === "feeder");
    expect(leads.length).toBeGreaterThan(0);
    expect(resultSubtitle(leads[0]!)).toBe("Feeder service lead · not verified");
  });
});

describe("result copy", () => {
  const find = (q: string, kind: SearchResult["kind"], options = off) =>
    searchIndex(index, q, options).flatMap((g) => g.results).find((r) => r.kind === kind)!;

  it("mapped-pin places name their loops and say candidate", () => {
    expect(resultSubtitle(find("Plaza Rizal", "pin"))).toBe("Mapped stop · Loop A, Loop B, Loop C, Loop D · candidate");
  });

  it("terminals, barangays, study labels and old names say what is not on file", () => {
    expect(resultSubtitle(find("Centro loading", "terminal"))).toBe(
      "Terminal · Padian / Gen. Luna / Elias Angeles / Diaz / Dinaga / Caceres streets · location not mapped",
    );
    expect(resultSubtitle(find("Abella", "barangay"))).toBe("Barangay · not surveyed");
    expect(resultSubtitle(find("Starbucks", "study"))).toBe("R8-A clockwise · label only, no location");
    expect(resultSubtitle(find("Pacol/Carolina", "legacy"))).toBe("Historical name (1993) · not matched to a current route · S28");
  });
});

describe("endpointForResult", () => {
  const find = (q: string, kind: SearchResult["kind"]) => searchIndex(index, q, off).flatMap((g) => g.results).find((r) => r.kind === kind)!;

  it("an OpenStreetMap place: its coordinate and name", () => {
    const sm = index.osmPlaces.find((p) => p.name === "SM City Naga")!;
    expect(endpointForResult(find("SM City", "osm"))).toEqual({ point: { lat: sm.lat, lng: sm.lng }, label: "SM City Naga", place: "osm" });
  });

  it("a mapped-pin place: its first on-route pin, labelled as a mapped pin", () => {
    const plaza = index.pinPlaces.find((p) => p.label === "Plaza Rizal")!;
    const onRoute = plaza.pins.find((p) => p.onRoute)!;
    expect(endpointForResult(find("Plaza Rizal", "pin"))).toEqual({ point: { lat: onRoute.lat, lng: onRoute.lng }, label: "Plaza Rizal (mapped pin)", place: "pin" });
  });

  it("a mapped-pin place with no on-route pin: its first pin", () => {
    const offRoute = index.pinPlaces.find((p) => p.pins.every((x) => !x.onRoute))!;
    const result = searchIndex(index, offRoute.label, off).flatMap((g) => g.results).find((r) => r.kind === "pin" && r.key === offRoute.key)!;
    expect(endpointForResult(result)).toEqual({ point: { lat: offRoute.pins[0]!.lat, lng: offRoute.pins[0]!.lng }, label: `${offRoute.label} (mapped pin)`, place: "pin" });
  });

  it("a saved place: its stored point", () => {
    const saved = [{ id: "s1", label: "Work", point: { lat: 13.62, lng: 123.19 } }];
    const result = searchIndex(index, "work", { regional: false, saved })[0]!.results[0]!;
    expect(endpointForResult(result)).toEqual({ point: { lat: 13.62, lng: 123.19 }, label: "Work", place: "pinned" });
  });

  it("nothing without a location: routes, terminals, barangays, study labels, old names, regional", () => {
    for (const [q, kind] of [
      ["R3", "route"], ["Centro loading", "terminal"], ["Abella", "barangay"], ["Starbucks", "study"], ["Pacol/Carolina", "legacy"],
    ] as const) {
      expect(endpointForResult(find(q, kind))).toBeNull();
    }
    const iriga = searchIndex(index, "Iriga", on).flatMap((g) => g.results).find((r) => r.kind === "regional")!;
    expect(endpointForResult(iriga)).toBeNull();
  });
});
