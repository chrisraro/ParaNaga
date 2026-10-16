import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { lineLengthM, projectOnLine } from "@/domain/geo/measure";
import { decodePolyline, encodePolyline } from "@/domain/geo/polyline";

describe("encodePolyline / decodePolyline (precision 5)", () => {
  it("matches the reference example of the encoded polyline algorithm", () => {
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(pts)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual(pts);
  });

  it("an empty line encodes to an empty string", () => {
    expect(encodePolyline([])).toBe("");
    expect(decodePolyline("")).toEqual([]);
  });

  it("round trip within 1e-5 degrees", () => {
    const point = fc.record({
      lat: fc.double({ min: 13.5, max: 13.75, noNaN: true }),
      lng: fc.double({ min: 123.1, max: 123.4, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(point, { maxLength: 50 }), (pts) => {
        const back = decodePolyline(encodePolyline(pts));
        expect(back).toHaveLength(pts.length);
        back.forEach((p, i) => {
          expect(Math.abs(p.lat - pts[i]!.lat)).toBeLessThanOrEqual(1e-5);
          expect(Math.abs(p.lng - pts[i]!.lng)).toBeLessThanOrEqual(1e-5);
        });
      }),
    );
  });

  it("rejects a malformed string", () => {
    expect(() => decodePolyline("_p~iF~ps|U_")).toThrow();
  });
});

describe("measure", () => {
  // Along the meridian 123 E: lengths are exact meridian arcs.
  const line = [
    { lat: 13.6, lng: 123 },
    { lat: 13.601, lng: 123 },
    { lat: 13.603, lng: 123 },
  ];

  it("lineLengthM is the haversine sum", () => {
    const expected = haversineMeters(line[0]!, line[1]!) + haversineMeters(line[1]!, line[2]!);
    expect(lineLengthM(line)).toBeCloseTo(expected, 9);
    expect(lineLengthM([])).toBe(0);
    expect(lineLengthM([line[0]!])).toBe(0);
  });

  it("projectOnLine gives the measure along the line and the distance off it", () => {
    const p = { lat: 13.602, lng: 123 + 10 / (111_195 * Math.cos((13.602 * Math.PI) / 180)) };
    const hit = projectOnLine(line, p);
    expect(hit.distM).toBeCloseTo(10, 0);
    expect(hit.measureM).toBeCloseTo(haversineMeters(line[0]!, { lat: 13.602, lng: 123 }), 0);
    expect(hit.segment).toBe(2);
  });

  it("clamps before the start and after the end", () => {
    expect(projectOnLine(line, { lat: 13.59, lng: 123 }).measureM).toBe(0);
    expect(projectOnLine(line, { lat: 13.61, lng: 123 }).measureM).toBeCloseTo(lineLengthM(line), 6);
  });
});
