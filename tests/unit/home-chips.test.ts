import { describe, expect, it } from "vitest";
import { MAX_SAVED_CHIPS, homeChips } from "@/ui/home/home-chips";
import { parseExploreCategory } from "@/domain/places/explore";

const place = (n: number) => ({ id: `p${n}`, label: `Place ${n}`, point: { lat: 13.62, lng: 123.19 }, source: "osm" as const });

describe("homeChips", () => {
  it("is the six place categories, in order, each linking to Explore filtered", () => {
    const chips = homeChips([]);
    expect(chips.map((c) => c.label)).toEqual(["Food & drink", "Schools", "Health", "Markets & malls", "Government", "Terminals"]);
    expect(chips.every((c) => c.kind === "category")).toBe(true);
    expect(chips.map((c) => (c.kind === "category" ? c.href : ""))).toEqual([
      "/app/explore?c=food",
      "/app/explore?c=schools",
      "/app/explore?c=health",
      "/app/explore?c=markets",
      "/app/explore?c=government",
      "/app/explore?c=terminals",
    ]);
  });
  it("puts saved places first, capped, before the categories", () => {
    const chips = homeChips([1, 2, 3, 4, 5, 6].map(place));
    expect(chips.slice(0, MAX_SAVED_CHIPS).every((c) => c.kind === "saved")).toBe(true);
    expect(chips[MAX_SAVED_CHIPS]?.kind).toBe("category");
    expect(chips).toHaveLength(MAX_SAVED_CHIPS + 6);
    expect(chips[0]).toMatchObject({ kind: "saved", id: "p1", label: "Place 1" });
  });
});

describe("parseExploreCategory", () => {
  it("accepts a known category id and rejects the rest", () => {
    expect(parseExploreCategory("food")).toBe("food");
    expect(parseExploreCategory("all")).toBe("all");
    expect(parseExploreCategory("nope")).toBeNull();
    expect(parseExploreCategory("")).toBeNull();
    expect(parseExploreCategory(null)).toBeNull();
  });
});
