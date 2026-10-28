// Client-side search over the published search index (src/domain/search/search.ts), on the REAL
// index captured for the e2e fixtures (revision modes-lines-2026-10-16: 233 OpenStreetMap places,
// 47 mapped-pin places, 11 routes, 6 terminals, 27 barangays, 32 study labels).
import { describe, expect, it } from "vitest";
import { intercitySchema, searchIndexSchema } from "@/domain/api/schemas";
import { actionFor, detailHref } from "@/domain/search/select";
import {
  GROUP_LIMIT,
  GROUP_ORDER,
  PLACES_STEP,
  bigramDice,
  countResults,
  endpointForResult,
  groupView,
  resultSubtitle,
  searchIndex,
  type SearchGroup,
  type SearchResult,
} from "@/domain/search/search";
import raw from "../e2e/fixtures/network/search-index.json" with { type: "json" };
import rawIntercity from "../e2e/fixtures/network/intercity.json" with { type: "json" };

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
    for (const r of group(groups, "routes")?.results ?? []) expect(r.title).not.toMatch(/diversion route/i);
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

describe("searchIndex: routes by letter, number, loop and street (route tally 2026-10-20)", () => {
  const first = (q: string) => {
    const r = group(searchIndex(index, q, off), "routes")?.results[0];
    return r && r.kind === "route" ? r.code : null;
  };
  it.each([
    ["A", "R8-A"], ["B", "R8-B"], ["C", "R8-C"], ["D", "R8-D"],
    ["Route 1", "R1"], ["Route 2", "R2"], ["Route 3", "R3"], ["Route 4", "R4"], ["Route 5", "R5"], ["Route 6", "R6"], ["Route 7", "R7"],
    ["Loop C", "R8-C"], ["Panganiban", "R4"], ["San Felipe", "R5"], ["Cararayan", "R1"], ["Pacol", "R6"], ["Panicuason", "R7"],
  ])("%s finds %s first", (q, code) => {
    expect(first(q)).toBe(code);
  });
  it("lists only the active services, never a feeder code", () => {
    const codes = group(searchIndex(index, "Centro", off), "routes")!.results.map((r) => (r.kind === "route" ? r.code : ""));
    expect(codes.some((c) => c.startsWith("TRI-"))).toBe(false);
  });
});

describe("searchIndex: route codes", () => {
  it.each(["R8-A", "R8A", "r8a", "8a", "r8 a"])("%s finds R8-A", (q) => {
    const routes = group(searchIndex(index, q, off), "routes")!.results;
    expect(routes[0]).toMatchObject({ kind: "route", code: "R8-A", title: "Centro-Magsaysay Loop A (clockwise)", evidence: "provisional" });
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
    expect(group(searchIndex(index, "Centro", off), "routes")!.results.length).toBe(11); // the 11 active services; the VISTODA feeder is not an active jeepney route
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

// ---------------------------------------------------------------- Task 14: every named place

const osm = (name: string, category: SearchIndexPlace["category"], n: number, aliases: string[] = []): SearchIndexPlace => ({
  key: `osm:node/${n}`, name, aliases, category, lat: 13.62 + n / 100000, lng: 123.18, osmVersion: 1, sourceCode: "OSM-2026-10-17",
});
type SearchIndexPlace = (typeof index.osmPlaces)[number];
const pinPlace = (label: string, n: number) => ({
  key: `pin${n}`, label, spellings: [label],
  pins: [{ stopId: "00000000-0000-4000-8000-00000000000" + n, code: null, layer: "Loop Service A", lat: 13.62, lng: 123.18, onRoute: true }],
});
const withPlaces = (osmPlaces: SearchIndexPlace[], pinPlaces: ReturnType<typeof pinPlace>[] = []) => ({ ...index, osmPlaces, pinPlaces });

describe("searchIndex: named places (Task 14)", () => {
  it("finds a restaurant, a cafe, a pharmacy and a bank from the lazy chunk, labelled from OpenStreetMap, never verified", () => {
    const idx = withPlaces([
      osm("Mang Inasal Naga", "restaurant", 1), osm("Bo's Coffee", "cafe", 2), osm("Mercury Drug", "pharmacy", 3, ["Mercury Drug Store"]),
      osm("BDO Naga", "bank", 4), osm("Nameless Hall", "other_place", 5),
    ]);
    const sub = (q: string) => resultSubtitle(first(searchIndex(idx, q, off)));
    expect(sub("mang inasal")).toBe("Restaurant · from OpenStreetMap");
    expect(sub("coffee")).toBe("Cafe · from OpenStreetMap");
    expect(sub("mercury drug store")).toBe("Pharmacy · from OpenStreetMap");
    expect(sub("bdo")).toBe("Bank · from OpenStreetMap");
    expect(sub("nameless")).toBe("Place · from OpenStreetMap");
    for (const q of ["mang inasal", "coffee", "bdo"]) expect(resultSubtitle(first(searchIndex(idx, q, off)))).not.toMatch(/verified/i);
  });

  it("a business name beats a mapped-stop street label that matches the same way, and the Places group leads the routes found only through a street", () => {
    const idx = withPlaces([osm("Magsaysay Drug", "pharmacy", 1)], [pinPlace("Magsaysay Ave", 1)]);
    expect(searchIndex(idx, "magsaysay", off)[0]!.results.map((r) => r.kind)).toEqual(["osm", "pin"]);
    // A route whose legal plan lists the street scores as a substring, but sits in the Routes group, below every place.
    const street = { ...index.routes[0]!, streets: ["Magsaysay Ave"] };
    const ids = searchIndex({ ...idx, routes: [street] }, "magsaysay", off).map((g) => g.id);
    expect(ids.indexOf("places")).toBeLessThan(ids.indexOf("routes"));
  });

  it("a match that starts earlier still wins over a business that only contains the query", () => {
    const idx = withPlaces([osm("Mercury Drug Magsaysay", "pharmacy", 1)], [pinPlace("Cor. Magsaysay Ave & Elias Angeles St", 1)]);
    expect(searchIndex(idx, "magsaysay", off)[0]!.results.map((r) => r.kind)).toEqual(["pin", "osm"]);
  });

  it("a higher score wins: a street label that starts with the query beats a business that only contains it", () => {
    const idx = withPlaces([osm("Mercury Drug Magsaysay", "pharmacy", 1)], [pinPlace("Magsaysay Ave", 1)]);
    expect(searchIndex(idx, "magsaysay", off)[0]!.results.map((r) => r.kind)).toEqual(["pin", "osm"]);
  });

  it("a real business ranks above a generic building or unclassified place of the same score", () => {
    const idx = withPlaces([osm("Rizal Building", "building", 1), osm("Rizal Hall", "other_place", 2), osm("Rizal Bakery", "bakery", 3)]);
    const titlesOf = searchIndex(idx, "rizal", off)[0]!.results.map((r) => r.title);
    expect(titlesOf[0]).toBe("Rizal Bakery");
    expect(new Set(titlesOf.slice(1))).toEqual(new Set(["Rizal Building", "Rizal Hall"]));
  });

  it("a category word finds places of that category whose name lacks it; a name match outranks a category-only match", () => {
    const idx = withPlaces([osm("Starbucks", "cafe", 1), osm("Cafe Real", "restaurant", 2), osm("Mercury Drug", "pharmacy", 3)]);
    const hits = searchIndex(idx, "cafe", off)[0]!.results;
    expect(hits.map((r) => r.title)).toEqual(["Cafe Real", "Starbucks"]);
    expect(hits[1]!.score).toBe(40);
    expect(searchIndex(idx, "pharmacy", off)[0]!.results.map((r) => r.title)).toEqual(["Mercury Drug"]);
    expect(searchIndex(idx, "place of worship", off)).toEqual([]);
  });

  it("exact and prefix still lead inside the places group", () => {
    const idx = withPlaces([osm("Naga Pharmacy Annex", "pharmacy", 1), osm("Pharmacy", "pharmacy", 2), osm("Pharmacy Plus", "pharmacy", 3)]);
    expect(searchIndex(idx, "pharmacy", off)[0]!.results.map((r) => r.title)).toEqual(["Pharmacy", "Pharmacy Plus", "Naga Pharmacy Annex"]);
  });
});

describe("groupView: GROUP_LIMIT and show more", () => {
  const many = (n: number) => ({
    id: "places" as const, title: "Places",
    results: Array.from({ length: n }, (_, i) => ({ kind: "osm" as const, key: `osm:node/${i + 1}`, title: `P${i}`, category: "shop" as const, point: { lat: 13.6, lng: 123.1 }, score: 40, offset: 0 })),
  });

  it("starts at GROUP_LIMIT rows; a small group says Show all N and reveals everything", () => {
    const v = groupView(many(12));
    expect(v.rows).toHaveLength(GROUP_LIMIT);
    expect(v.label).toBe("Show all 12");
    expect(groupView(many(12), v.next).rows).toHaveLength(12);
    expect(groupView(many(12), v.next).label).toBeNull();
    expect(groupView(many(3)).label).toBeNull();
  });

  it("a large places group reveals PLACES_STEP more at a time, then Show all", () => {
    expect(PLACES_STEP).toBe(25);
    const g = many(80);
    const a = groupView(g);
    expect(a.label).toBe("Show 25 more");
    const b = groupView(g, a.next);
    expect(b.rows).toHaveLength(30);
    expect(b.label).toBe("Show 25 more");
    const c = groupView(g, b.next);
    expect(c.rows).toHaveLength(55);
    expect(c.label).toBe("Show all 80");
    expect(groupView(g, c.next).rows).toHaveLength(80);
  });

  it("other large groups keep Show all", () => {
    const g = { ...many(80), id: "routes" as const };
    expect(groupView(g).label).toBe("Show all 80");
  });
});

describe("searchIndex: route aliases (stop-sign letters and names)", () => {
  const withAliases = searchIndexSchema.parse({
    ...raw,
    routes: index.routes.map((r) => ({
      ...r,
      aliases: ({ R2: ["E"], R6: ["I"], R7: ["J"], R1: ["Centro - Cararayan - San Isidro"] } as Record<string, string[]>)[r.code] ?? [],
    })),
  });
  const routesFor = (q: string) => group(searchIndex(withAliases, q, off), "routes")?.results ?? [];

  it.each([["E", "R2"], ["Route E", "R2"], ["route i", "R6"], ["J", "R7"]])("%s finds %s first and says which name matched", (q, code) => {
    const top = routesFor(q)[0]!;
    expect(top).toMatchObject({ kind: "route", code });
    expect(resultSubtitle(top)).toMatch(/^Also called [EIJ]$/);
  });

  it("the sign's route name finds R1", () => {
    expect(routesFor("Cararayan - San Isidro")[0]).toMatchObject({ kind: "route", code: "R1" });
  });

  it("a code or name match keeps the plain row (no alias subtitle)", () => {
    const r2 = routesFor("R2")[0]!;
    expect(r2).toMatchObject({ code: "R2", matchedAlias: null });
    expect(resultSubtitle(r2)).toBe("");
  });

  it("an index without aliases parses with an empty list (older snapshots)", () => {
    expect(index.routes.every((r) => r.aliases.length === 0)).toBe(true);
  });
});

describe("searchIndex: Leaving Naga destinations (IC1)", () => {
  const destinations = intercitySchema.parse(rawIntercity).destinations.map((d) =>
    d.code === "D-PITX" ? { ...d, aliases: ["Parañaque Integrated Terminal Exchange"] } : d,
  );
  const withIntercity = (regional: boolean) => ({ regional, intercity: destinations });

  it("appear only with regional connections on, in the regional group, before the category rows", () => {
    expect(searchIndex(index, "Legazpi", withIntercity(false)).flatMap((g) => g.results).some((r) => r.kind === "intercity")).toBe(false);
    const regional = group(searchIndex(index, "Legazpi", withIntercity(true)), "regional")!;
    expect(regional.results[0]).toMatchObject({ kind: "intercity", code: "D-LEGAZPI", title: "Legazpi", score: 100 });
    expect(resultSubtitle(regional.results[0]!)).toBe("Leaving Naga · how to go from Naga");
  });

  it("match on an alias (folded: case and accents)", () => {
    const hit = searchIndex(index, "paranaque integrated", withIntercity(true)).flatMap((g) => g.results).find((r) => r.kind === "intercity");
    expect(hit).toMatchObject({ kind: "intercity", code: "D-PITX", title: "PITX" });
  });

  it("are never a trip end; they open S24 with ?to=", () => {
    const hit = group(searchIndex(index, "Clark", withIntercity(true)), "regional")!.results.find((r) => r.kind === "intercity")!;
    expect(endpointForResult(hit)).toBeNull();
    expect(detailHref(hit)).toBe("/app/leaving?to=D-CLARK");
    expect(actionFor(hit, "destination")).toEqual({ type: "open", href: "/app/leaving?to=D-CLARK" });
  });

  it("without the guide (not loaded yet) the regional option works as before", () => {
    const groups = searchIndex(index, "Iriga", on);
    expect(groups.flatMap((g) => g.results).some((r) => r.kind === "intercity")).toBe(false);
    expect(group(groups, "regional")!.results[0]).toMatchObject({ kind: "regional", title: "Iriga" });
  });
});
