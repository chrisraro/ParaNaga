import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boundsContains, haversineMeters, padBounds, pointInRing } from "@/domain/geo/geometry";
import {
  NAGA_BOUNDARY,
  NAGA_BOUNDS,
  NAGA_DEFAULT_CENTER,
  NAGA_DEFAULT_ZOOM,
  NAGA_MASK_RINGS,
  NAGA_MAX_BOUNDS,
  NAGA_MAX_ZOOM,
  NAGA_MIN_ZOOM,
  isInsideNaga,
} from "@/domain/geo/naga";

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };

describe("isInsideNaga", () => {
  it("accepts Plaza Rizal", () => {
    expect(isInsideNaga(PLAZA_RIZAL)).toBe(true);
  });

  it("rejects Pili and the Mt Isarog summit", () => {
    expect(isInsideNaga({ lat: 13.5828, lng: 123.2756 })).toBe(false);
    expect(isInsideNaga({ lat: 13.6584, lng: 123.3716 })).toBe(false);
  });

  it("accepts all 128 mapped stop records from the seed", () => {
    const seed = JSON.parse(
      readFileSync(resolve(__dirname, "../../Data_Sets/naga_transport_seed.json"), "utf8"),
    ) as { mapped_stop_records: { latitude: number; longitude: number }[] };
    const stops = seed.mapped_stop_records;
    expect(stops).toHaveLength(128);
    const outside = stops.filter((s) => !isInsideNaga({ lat: s.latitude, lng: s.longitude }));
    expect(outside).toEqual([]);
  });
});

describe("Naga constants", () => {
  it("computes NAGA_BOUNDS from the boundary", () => {
    expect(NAGA_BOUNDS.south).toBeCloseTo(13.6023285, 6);
    expect(NAGA_BOUNDS.north).toBeCloseTo(13.6743613, 6);
    expect(NAGA_BOUNDS.west).toBeCloseTo(123.1751748, 6);
    expect(NAGA_BOUNDS.east).toBeCloseTo(123.3764733, 6);
  });

  it("pads NAGA_MAX_BOUNDS by 0.01 degrees on each side", () => {
    expect(NAGA_MAX_BOUNDS.south).toBeCloseTo(NAGA_BOUNDS.south - 0.01, 9);
    expect(NAGA_MAX_BOUNDS.north).toBeCloseTo(NAGA_BOUNDS.north + 0.01, 9);
    expect(NAGA_MAX_BOUNDS.west).toBeCloseTo(NAGA_BOUNDS.west - 0.01, 9);
    expect(NAGA_MAX_BOUNDS.east).toBeCloseTo(NAGA_BOUNDS.east + 0.01, 9);
  });

  it("exposes the default view and zoom limits", () => {
    expect(NAGA_DEFAULT_CENTER).toEqual(PLAZA_RIZAL);
    expect(NAGA_DEFAULT_ZOOM).toBe(15);
    expect(NAGA_MIN_ZOOM).toBe(12);
    expect(NAGA_MAX_ZOOM).toBe(19);
  });

  it("builds mask rings: world rectangle then the city as a hole, in [lat, lng]", () => {
    expect(NAGA_MASK_RINGS).toHaveLength(2);
    const [world, hole] = NAGA_MASK_RINGS;
    expect(world).toEqual([
      [-90, -180],
      [-90, 180],
      [90, 180],
      [90, -180],
    ]);
    expect(hole).toHaveLength(NAGA_BOUNDARY.length);
    const [lng, lat] = NAGA_BOUNDARY[0]!;
    expect(hole![0]).toEqual([lat, lng]);
  });
});

describe("haversineMeters", () => {
  it("measures Plaza Rizal to BISCAST at about 1,260 m", () => {
    expect(Math.abs(haversineMeters(PLAZA_RIZAL, BISCAST) - 1260)).toBeLessThanOrEqual(15);
  });

  it("is zero for identical points", () => {
    expect(haversineMeters(PLAZA_RIZAL, PLAZA_RIZAL)).toBe(0);
  });
});

describe("pointInRing", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];

  it("uses [lng, lat] order", () => {
    expect(pointInRing({ lat: 5, lng: 5 }, square)).toBe(true);
    expect(pointInRing({ lat: 5, lng: 11 }, square)).toBe(false);
    expect(pointInRing({ lat: -1, lng: 5 }, square)).toBe(false);
  });
});

describe("padBounds / boundsContains", () => {
  const b = { south: 1, west: 2, north: 3, east: 4 };

  it("pads every side", () => {
    expect(padBounds(b, 0.5)).toEqual({ south: 0.5, west: 1.5, north: 3.5, east: 4.5 });
  });

  it("padding by zero is a no-op", () => {
    expect(padBounds(b, 0)).toEqual(b);
  });

  it("contains is inclusive on edges and false outside", () => {
    expect(boundsContains(b, { lat: 1, lng: 2 })).toBe(true);
    expect(boundsContains(b, { lat: 3, lng: 4 })).toBe(true);
    expect(boundsContains(b, { lat: 2, lng: 3 })).toBe(true);
    expect(boundsContains(b, { lat: 0.999, lng: 3 })).toBe(false);
    expect(boundsContains(b, { lat: 2, lng: 4.001 })).toBe(false);
  });
});
