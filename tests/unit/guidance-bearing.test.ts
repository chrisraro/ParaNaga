import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { COMPASS_WORDS, compass8, initialBearingDegrees } from "@/domain/geo/bearing";

const C = { lat: 13.6233869, lng: 123.1846726 };
const d = 0.002;

describe("initialBearingDegrees", () => {
  it("points north, east, south and west", () => {
    expect(initialBearingDegrees(C, { lat: C.lat + d, lng: C.lng })).toBeCloseTo(0, 3);
    expect(initialBearingDegrees(C, { lat: C.lat, lng: C.lng + d })).toBeCloseTo(90, 1);
    expect(initialBearingDegrees(C, { lat: C.lat - d, lng: C.lng })).toBeCloseTo(180, 3);
    expect(initialBearingDegrees(C, { lat: C.lat, lng: C.lng - d })).toBeCloseTo(270, 1);
  });

  it("is always in [0, 360)", () => {
    fc.assert(
      fc.property(fc.double({ min: -0.05, max: 0.05, noNaN: true }), fc.double({ min: -0.05, max: 0.05, noNaN: true }), (dLat, dLng) => {
        const b = initialBearingDegrees(C, { lat: C.lat + dLat, lng: C.lng + dLng });
        return b >= 0 && b < 360;
      }),
      { seed: 9, numRuns: 500 },
    );
  });
});

describe("compass8 octants", () => {
  it.each([
    [0, "N"], [22.4, "N"], [22.5, "NE"], [45, "NE"], [67.4, "NE"], [67.5, "E"], [90, "E"], [112.5, "SE"], [135, "SE"],
    [157.5, "S"], [180, "S"], [202.5, "SW"], [225, "SW"], [247.5, "W"], [270, "W"], [292.5, "NW"], [315, "NW"], [337.4, "NW"], [337.5, "N"], [359.9, "N"],
    [360, "N"], [-45, "NW"], [-90, "W"], [450, "E"],
  ] as const)("%s° is %s", (deg, octant) => {
    expect(compass8(deg)).toBe(octant);
  });

  it("each octant spans 45°, centred on its direction", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 }), fc.double({ min: -22.49, max: 22.49, noNaN: true }), (i, offset) => {
        const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
        return compass8(i * 45 + offset) === names[i];
      }),
      { seed: 11, numRuns: 500 },
    );
  });

  it("has words for every octant", () => {
    expect(COMPASS_WORDS).toEqual({ N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" });
  });
});
