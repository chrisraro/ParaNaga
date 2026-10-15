import { describe, expect, it } from "vitest";
import { parseBbox } from "@/domain/api/schemas";
import { bboxParam, viewBbox } from "@/domain/geo/bbox";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";

describe("viewBbox", () => {
  it("widens the view to a 0.005° grid so small pans reuse one query", () => {
    const a = viewBbox({ west: 123.1801, south: 13.6201, east: 123.1899, north: 13.6299 });
    const b = viewBbox({ west: 123.1812, south: 13.6215, east: 123.1888, north: 13.6281 });
    expect(a).toEqual({ west: 123.18, south: 13.62, east: 123.19, north: 13.63 });
    expect(b).toEqual(a);
  });

  it("does not widen a value already on the grid", () => {
    expect(viewBbox({ west: 123.185, south: 13.62, east: 123.19, north: 13.625 })).toEqual({
      west: 123.185, south: 13.62, east: 123.19, north: 13.625,
    });
  });

  it("clips to the Naga max bounds, and the result always parses as a valid bbox", () => {
    const b = NAGA_MAX_BOUNDS;
    const huge = viewBbox({ west: b.west - 1, south: b.south - 1, east: b.east + 1, north: b.north + 1 });
    expect(huge).toEqual({ west: b.west, south: b.south, east: b.east, north: b.north });
    expect(parseBbox(bboxParam(huge!)).ok).toBe(true);
    const near = viewBbox({ west: 123.1801, south: 13.6201, east: 123.1899, north: 13.6299 })!;
    expect(parseBbox(bboxParam(near))).toEqual({ ok: true, value: near });
  });

  it("is null for a view outside the bounds or with non-finite numbers", () => {
    expect(viewBbox({ west: 120, south: 10, east: 120.1, north: 10.1 })).toBeNull();
    expect(viewBbox({ west: Number.NaN, south: 13.6, east: 123.2, north: 13.7 })).toBeNull();
  });
});
