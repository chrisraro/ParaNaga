import { describe, expect, it } from "vitest";
import {
  ROUTE_FIT_MIN_VISIBLE,
  ROUTE_FIT_PAD_RIGHT,
  ROUTE_FIT_PAD_TOP,
  ROUTE_FIT_SHEET_GAP,
  routeFitKey,
  routeFitPadding,
  routeFitPoints,
} from "@/ui/map/route-fit";

const A = { lat: 13.62, lng: 123.19 };
const B = { lat: 13.63, lng: 123.2 };

describe("routeFitPadding", () => {
  it("uses the hidden sheet height as bottom padding, clear of controls", () => {
    const p = routeFitPadding(200, 700);
    expect(p).toEqual({ top: ROUTE_FIT_PAD_TOP, left: 40, right: ROUTE_FIT_PAD_RIGHT, bottom: 200 + ROUTE_FIT_SHEET_GAP });
  });
  it("keeps a minimum bottom gap", () => {
    expect(routeFitPadding(0, 700).bottom).toBe(ROUTE_FIT_SHEET_GAP);
  });
  it("never leaves less than the minimum visible strip under a full sheet", () => {
    // Full snap: the clearance is not guaranteed, but the fit area stays usable and finite.
    const p = routeFitPadding(900, 700);
    expect(Number.isFinite(p.bottom)).toBe(true);
    expect(700 - p.top - p.bottom).toBeGreaterThanOrEqual(ROUTE_FIT_MIN_VISIBLE);
  });
});

describe("routeFitPoints", () => {
  it("puts both ends first and drops non-finite points", () => {
    const pts = routeFitPoints(A, B, [{ lat: NaN, lng: 1 }, { lat: 13.625, lng: 123.195 }]);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toBe(A);
    expect(pts[1]).toBe(B);
  });
});

describe("routeFitKey", () => {
  it("is empty without two points and changes when an end moves", () => {
    expect(routeFitKey([A])).toBe("");
    expect(routeFitKey([A, B])).not.toBe(routeFitKey([A, { ...B, lat: B.lat + 0.001 }]));
    expect(routeFitKey([A, B])).toBe(routeFitKey([A, B]));
  });
});
