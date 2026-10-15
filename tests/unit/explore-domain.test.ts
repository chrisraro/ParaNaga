import { describe, expect, it } from "vitest";
import { routeListSchema, searchIndexSchema } from "@/domain/api/schemas";
import { OSM_PLACE_CATEGORIES } from "@/domain/places/osm-categories";
import {
  EXPLORE_CATEGORIES,
  barangaysAZ,
  chipOfOsmCategory,
  emptyCategoryText,
  feederLeadsByCode,
  leadStatusText,
  railSourcesText,
  mappedStopsAZ,
  pinPlaceSub,
  placesInCategory,
  routeDirectoryGroups,
  routeEvidenceBadge,
} from "@/domain/places/explore";
import rawIndex from "../e2e/fixtures/network/search-index.json" with { type: "json" };
import rawRoutes from "../e2e/fixtures/network/routes.json" with { type: "json" };

const index = searchIndexSchema.parse(rawIndex);
const routes = routeListSchema.parse(rawRoutes);

const pin = (layer: string | null) => ({ stopId: "00000000-0000-4000-8000-000000000000", code: null, layer, lat: 13.62, lng: 123.18, onRoute: false });

describe("Explore categories", () => {
  it("maps every D10 category to exactly one chip, in artboard order", () => {
    expect(EXPLORE_CATEGORIES.map((c) => c.label)).toEqual([
      "All",
      "Faith",
      "Schools",
      "Markets & malls",
      "Health",
      "Government",
      "Parks & plazas",
      "Terminals",
    ]);
    for (const category of OSM_PLACE_CATEGORIES) {
      expect(EXPLORE_CATEGORIES.filter((c) => c.osm?.includes(category)), category).toHaveLength(1);
    }
    expect(chipOfOsmCategory("college_university")).toBe("schools");
    expect(chipOfOsmCategory("square")).toBe("parks");
    expect(chipOfOsmCategory("bus_terminal")).toBe("terminals");
  });

  it("All lists every place A–Z; a chip lists only its categories", () => {
    const all = placesInCategory(index.osmPlaces, "all");
    expect(all).toHaveLength(index.osmPlaces.length);
    const names = all.map((p) => p.name);
    expect(names).toEqual([...names].sort(new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare));
    const schools = placesInCategory(index.osmPlaces, "schools");
    expect(schools.length).toBe(index.osmPlaces.filter((p) => p.category === "school" || p.category === "college_university").length);
    expect(new Set(schools.map((p) => p.category))).toEqual(new Set(["school", "college_university"]));
    expect(placesInCategory(index.osmPlaces, "faith").every((p) => p.category === "place_of_worship")).toBe(true);
    // The input is not reordered.
    expect(index.osmPlaces.map((p) => p.key)).toEqual(rawIndex.osmPlaces.map((p) => p.key));
  });

  it("an empty chip says so", () => {
    expect(placesInCategory([], "markets")).toEqual([]);
    expect(emptyCategoryText("markets")).toBe("No markets or malls on file yet.");
    expect(emptyCategoryText("health")).toBe("No health places on file yet.");
    expect(emptyCategoryText("government")).toBe("No government offices on file yet.");
  });
});

describe("Explore directory", () => {
  it("mapped stops: A–Z with the pin count and the loops", () => {
    const list = mappedStopsAZ(index.pinPlaces);
    expect(list).toHaveLength(index.pinPlaces.length);
    const labels = list.map((p) => p.label);
    expect(labels).toEqual([...labels].sort(new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare));
    expect(pinPlaceSub({ pins: [pin("Loop Service C"), pin("Loop Service A"), pin("Loop Service A")] })).toBe("3 pins · Loop A, C");
    expect(pinPlaceSub({ pins: [pin("Loop Service B")] })).toBe("1 pin · Loop B");
    expect(pinPlaceSub({ pins: [pin(null), pin("Other layer")] })).toBe("2 pins");
  });

  it("routes: grouped by group number, the 11 routes of the plan", () => {
    const groups = routeDirectoryGroups(routes);
    expect(groups.map((g) => g.title)).toEqual(["Group 1", "Group 2", "Group 3", "Group 4", "Group 5", "Group 6", "Group 7", "Group 8"]);
    expect(groups.flatMap((g) => g.routes)).toHaveLength(11);
    expect(groups.at(-1)!.routes.map((r) => r.code)).toEqual(["R8-A", "R8-B", "R8-C", "R8-D"]);
    const r1 = routes.groups[0]!.routes[0]!;
    expect(routeDirectoryGroups({ groups: [{ groupNumber: null, routes: [r1] }] })).toEqual([{ title: "Other routes", routes: [r1] }]);
  });

  it("route evidence badge: Provisional stops for A and B, Documented only otherwise", () => {
    const all = routes.groups.flatMap((g) => g.routes);
    expect(all.filter((r) => routeEvidenceBadge(r) === "provisional-stops").map((r) => r.code)).toEqual(["R8-A", "R8-B"]);
    expect(routeEvidenceBadge({ verification: "verified", hasProvisionalStops: true })).toBe("verified");
  });

  it("barangays A–Z and leads by code", () => {
    expect(barangaysAZ(index.barangays)).toHaveLength(27);
    expect(feederLeadsByCode([...index.feederLeads].reverse()).map((l) => l.code)).toEqual(["SF01", "SF02", "SF03", "SF04", "SF05"]);
  });

  it("lead status: unverified reads Documented, not verified; any other status is spelled out", () => {
    expect(leadStatusText("unverified")).toBe("Documented, not verified");
    expect(leadStatusText(null)).toBe("Documented, not verified");
    expect(leadStatusText("verified_by_survey")).toBe("Documented · status: verified by survey");
  });

  it("rail sources: codes the register does not list are marked", () => {
    expect(railSourcesText(null)).toBe("S19, S20, S21");
    expect(railSourcesText(new Set(["S19", "S21"]))).toBe("S19, S20 (not in register), S21");
  });
});
