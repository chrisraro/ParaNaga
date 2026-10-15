import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  fareModesForRouteMode,
  networkHeadSchema,
  parseBbox,
  parseRouteCodeParam,
  parseUuidParam,
  stopSummarySchema,
  variantVerification,
} from "@/domain/api/schemas";
import { NAGA_MAX_BOUNDS } from "@/domain/geo/naga";

const inside = "123.17,13.61,123.20,13.64";

describe("parseBbox", () => {
  it("accepts w,s,e,n inside the Naga max bounds", () => {
    expect(parseBbox(inside)).toEqual({ ok: true, value: { west: 123.17, south: 13.61, east: 123.2, north: 13.64 } });
    expect(parseBbox(" 123.17 , 13.61 , 123.20 , 13.64 ").ok).toBe(true);
  });

  it("accepts exactly the max bounds", () => {
    const b = NAGA_MAX_BOUNDS;
    expect(parseBbox(`${b.west},${b.south},${b.east},${b.north}`).ok).toBe(true);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["three values", "123.17,13.61,123.20"],
    ["five values", `${inside},1`],
    ["not a number", "a,13.61,123.20,13.64"],
    ["NaN", "NaN,13.61,123.20,13.64"],
    ["Infinity", "Infinity,13.61,123.20,13.64"],
    ["exponent", "1e2,13.61,123.20,13.64"],
    ["hex", "0x7b,13.61,123.20,13.64"],
    ["west >= east", "123.20,13.61,123.17,13.64"],
    ["south >= north", "123.17,13.64,123.20,13.61"],
    ["zero width", "123.17,13.61,123.17,13.64"],
    ["outside (Manila)", "120.9,14.5,121.1,14.7"],
    ["partly outside", `${NAGA_MAX_BOUNDS.west - 0.001},13.61,123.20,13.64`],
    ["too long", `${"1".repeat(130)},1,2,3`],
  ])("rejects %s", (_name, raw) => {
    const result = parseBbox(raw);
    expect(result.ok).toBe(false);
  });

  it("never echoes the given values in the message", () => {
    const result = parseBbox("120.987654,14.5,121.1,14.7");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/120\.98|14\.5|121\.1/);
  });
});

describe("parameter parsers", () => {
  it("parses UUIDs and lower-cases them", () => {
    expect(parseUuidParam("6F9619FF-8B86-4D11-B42D-00C04FC964FF", "id")).toEqual({
      ok: true, value: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    });
    expect(parseUuidParam("not-a-uuid", "id")).toEqual({ ok: false, message: "id must be a UUID." });
    expect(parseUuidParam("' or 1=1 --", "id").ok).toBe(false);
  });

  it("parses route codes and upper-cases them", () => {
    expect(parseRouteCodeParam("r8-a")).toEqual({ ok: true, value: "R8-A" });
    expect(parseRouteCodeParam("R3")).toEqual({ ok: true, value: "R3" });
    for (const bad of ["", "-R1", "R1;drop", "R 1", "x".repeat(17), "R1/2"]) {
      expect(parseRouteCodeParam(bad).ok, bad).toBe(false);
    }
  });
});

describe("response schemas", () => {
  it("head requires a uuid revision id and a kind", () => {
    const ok = { revisionId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff", label: "x", kind: "provisional", publishedAt: "2026-10-15T01:02:03.000Z" };
    expect(networkHeadSchema.parse(ok)).toEqual(ok);
    expect(networkHeadSchema.safeParse({ ...ok, kind: "exact" }).success).toBe(false);
    expect(networkHeadSchema.safeParse({ ...ok, revisionId: "1" }).success).toBe(false);
  });

  it("stop summaries keep unknown source fields as null", () => {
    const stop = {
      id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff", name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726,
      status: "candidate", navigationApproved: false, source: { layer: null, code: null, label: null },
    };
    expect(stopSummarySchema.parse(stop)).toEqual(stop);
    expect(stopSummarySchema.safeParse({ ...stop, status: "verified" }).success).toBe(false);
    expect(stopSummarySchema.safeParse({ ...stop, lat: 91 }).success).toBe(false);
  });

  it("error envelope", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "bad_request", message: "m", requestId: "r" } }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ error: { code: "teapot", message: "m", requestId: "r" } }).success).toBe(false);
  });
});

describe("variantVerification", () => {
  it("is verified only for verified, navigation-approved versions", () => {
    expect(variantVerification("provisional", false)).toBe("unverified");
    expect(variantVerification("provisional", true)).toBe("unverified");
    expect(variantVerification("verified", false)).toBe("unverified");
    expect(variantVerification("verified", true)).toBe("verified");
  });
});

describe("fareModesForRouteMode", () => {
  it("maps PUJ routes to both jeepney minimums and anything else to none", () => {
    expect(fareModesForRouteMode("PUJ_Class_2_plan")).toEqual(["traditional_jeepney", "modern_jeepney"]);
    expect(fareModesForRouteMode("PUJ")).toEqual(["traditional_jeepney", "modern_jeepney"]);
    expect(fareModesForRouteMode("PUJABC")).toEqual([]);
    expect(fareModesForRouteMode(null)).toEqual([]);
    expect(fareModesForRouteMode("tricycle")).toEqual([]);
  });
});
