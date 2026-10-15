import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  fareModesForRouteMode,
  fleetClassSchema,
  fleetSummarySchema,
  networkHeadSchema,
  networkSnapshotSchema,
  operatingStatusSchema,
  snapshotTerminalSchema,
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
    expect(fareModesForRouteMode("bus")).toEqual([]);
  });

  it("maps tricycle feeders to the tricycle minimum (F03 mode) only", () => {
    expect(fareModesForRouteMode("tricycle")).toEqual(["trimobile_e_trike_taxicle"]);
  });
});

// ---------------------------------------------------------------- modes (Increment D)

const fleetClass = {
  code: "FL-R4-MOD", vehicleClass: "modern_puj", evidenceLevels: ["official_report", "news_report", "owner_confirmation"],
  status: "operating", firstReportedOn: "2023-04-17", lastReportedOn: "2026-10-16", unitsNote: "about 10 units", aircon: true,
  airconSourceCodes: ["N14", "U01"], cooperatives: [], sourceCodes: ["N14", "U01"],
  label: "Modern jeepney · air-conditioned · operating (owner-confirmed October 2026)",
};
const fleet = { label: "Traditional and modern jeepneys", chip: "Jeepney · traditional + modern", colourKey: "mixed_trad_modern", classes: [fleetClass] };
const fare = (code: string, modeCode: string) => ({
  code, modeCode, vehicleClass: null, baseCentavos: 1400, baseKm: 4, incrementCentavosPerKm: 200, discountPercent: null,
  discountedBaseCentavos: null, discountGroups: null, rounding: null, effectiveFrom: "2026-09-28", enactedOn: null,
  evidenceStatus: null, status: "draft", publishExact: false, isEstimate: true, sourceCodes: ["S05"],
});
const terminal = { code: "T01", name: "Bicol Central Station", kind: "terminal", modes: ["bus"], lat: 13.6192359, lng: 123.1897426,
  coordSource: "osm_way_centroid", verification: "community_coordinate_official_address" };
const snapshot = {
  revision: { revisionId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff", label: "modes-2026-10-16", kind: "provisional", publishedAt: null },
  stops: [], variants: [], fareRules: [fare("F01", "traditional_jeepney"), fare("F03", "trimobile_e_trike_taxicle")], terminals: [terminal], routes: [],
};

describe("modes schemas", () => {
  it("round-trip a fleet summary with an aircon source", () => {
    expect(fleetSummarySchema.parse(fleet)).toEqual(fleet);
    expect(fleetClassSchema.safeParse({ ...fleetClass, airconSourceCodes: [] }).success).toBe(false);
    expect(fleetClassSchema.safeParse({ ...fleetClass, aircon: null, airconSourceCodes: [] }).success).toBe(true);
  });

  it("have no e-jeepney class or colour key", () => {
    expect(fleetClassSchema.safeParse({ ...fleetClass, vehicleClass: "e_jeepney" }).success).toBe(false);
    expect(fleetSummarySchema.safeParse({ ...fleet, colourKey: "e_jeepney" }).success).toBe(false);
  });

  it("round-trip a snapshot; a regional fare rule (bus/UV) is refused in it", () => {
    expect(networkSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(networkSnapshotSchema.safeParse({ ...snapshot, fareRules: [fare("F08", "bus_ordinary")] }).success).toBe(false);
    expect(networkSnapshotSchema.safeParse({ ...snapshot, fareRules: [fare("F06", "uv_express_traditional")] }).success).toBe(false);
  });

  it("a terminal coordinate needs its source; a terminal without one is fine", () => {
    expect(snapshotTerminalSchema.safeParse({ ...terminal, coordSource: null }).success).toBe(false);
    expect(snapshotTerminalSchema.safeParse({ ...terminal, lat: null, lng: null, coordSource: null }).success).toBe(true);
  });

  it("operating status always says it confirms service only", () => {
    const status = { status: "operating", label: "Operating (owner-confirmed 2026-10-16)", note: "n", confirmedOn: "2026-10-16",
      confirmsServiceOnly: true, sourceCodes: ["U01"] };
    expect(operatingStatusSchema.parse(status)).toEqual(status);
    expect(operatingStatusSchema.safeParse({ ...status, confirmsServiceOnly: false }).success).toBe(false);
  });
});
