import { describe, expect, it } from "vitest";
import { OSM_ATTRIBUTION, OSM_TILE_URL, attributionParts, tileConfig } from "@/client/map/tile-config";

describe("tileConfig", () => {
  it("defaults to OSM tiles in development", () => {
    expect(tileConfig({ NODE_ENV: "development" })).toEqual({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors",
    });
  });

  it("defaults to OSM tiles in test", () => {
    expect(tileConfig({ NODE_ENV: "test" })).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION });
  });

  it("renders no basemap in production when no URL is configured", () => {
    expect(tileConfig({ NODE_ENV: "production" })).toEqual({
      url: null,
      attribution: "© OpenStreetMap contributors",
    });
  });

  it("treats a blank URL as unset", () => {
    expect(tileConfig({ NODE_ENV: "production", NEXT_PUBLIC_TILE_URL: "   " }).url).toBeNull();
    expect(tileConfig({ NODE_ENV: "development", NEXT_PUBLIC_TILE_URL: "" }).url).toBe(OSM_TILE_URL);
  });

  it("passes a custom URL and attribution through", () => {
    const url = "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=abc";
    const attribution = "© MapTiler © OpenStreetMap contributors";
    for (const NODE_ENV of ["production", "development"]) {
      expect(
        tileConfig({ NODE_ENV, NEXT_PUBLIC_TILE_URL: url, NEXT_PUBLIC_TILE_ATTRIBUTION: attribution }),
      ).toEqual({ url, attribution });
    }
  });

  it("disables an unknown production provider when its credits are missing", () => {
    const url = "https://tiles.example.com/{z}/{x}/{y}.png";
    expect(tileConfig({ NODE_ENV: "production", NEXT_PUBLIC_TILE_URL: url })).toEqual({
      url: null,
      attribution: OSM_ATTRIBUTION,
    });
  });

  it("preserves mandatory MapTiler and OSM credits when configured text omits them", () => {
    const url = "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png";
    expect(tileConfig({ NODE_ENV: "production", NEXT_PUBLIC_TILE_URL: url }).attribution).toBe("© MapTiler © OpenStreetMap contributors");
    expect(tileConfig({ NODE_ENV: "production", NEXT_PUBLIC_TILE_URL: url, NEXT_PUBLIC_TILE_ATTRIBUTION: "Custom" }).attribution).toBe("Custom © MapTiler © OpenStreetMap contributors");
  });
});

describe("attributionParts", () => {
  const MAPTILER = { text: "© MapTiler", href: "https://www.maptiler.com/copyright/" };
  const OSM = { text: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" };

  it("links both parts of the MapTiler attribution", () => {
    expect(attributionParts("© MapTiler © OpenStreetMap contributors")).toEqual([MAPTILER, { text: " " }, OSM]);
  });

  it("links the OSM default", () => {
    expect(attributionParts(OSM_ATTRIBUTION)).toEqual([OSM]);
  });

  it("keeps unknown text as plain text, never markup", () => {
    expect(attributionParts('<a href="x">Evil</a> tiles')).toEqual([{ text: '<a href="x">Evil</a> tiles' }]);
  });

  it("handles mixed order and surrounding text", () => {
    expect(attributionParts("Tiles © OpenStreetMap contributors, © MapTiler.")).toEqual([
      { text: "Tiles " },
      OSM,
      { text: ", " },
      MAPTILER,
      { text: "." },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(attributionParts("")).toEqual([]);
  });
});
