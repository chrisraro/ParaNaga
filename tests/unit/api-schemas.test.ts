import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  fareModesForRouteMode,
  fleetClassSchema,
  fleetSummarySchema,
  networkHeadSchema,
  networkSnapshotSchema,
  operatingStatusSchema,
  routeDetailSchema,
  routeNoteSchema,
  snapshotTerminalSchema,
  parseBbox,
  parseRouteCodeParam,
  parseUuidParam,
  searchIndexSchema,
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
  etaModel: null,
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

  it("a stale old-shape snapshot (no terminals, routes, mode or fleet) degrades instead of failing", () => {
    const routeId = "33333333-3333-4333-8333-333333333333";
    const old = {
      revision: snapshot.revision, stops: [], fareRules: [],
      variants: [{ variantId: "22222222-2222-4222-8222-222222222222", routeId, routeCode: "R8-A", routeName: "Loop A",
        direction: "clockwise", kind: "permanent", evidenceLevel: "provisional", verification: "unverified", isCircular: true,
        stopIds: ["11111111-1111-4111-8111-111111111111"] }],
    };
    const parsed = networkSnapshotSchema.parse(old);
    expect(parsed.terminals).toEqual([]);
    expect(parsed.routes).toEqual([]);
    expect(parsed.variants[0]!.mode).toBe("jeepney");
    const withRoute = networkSnapshotSchema.parse({ ...old, routes: [{ routeId, routeCode: "R8-A", routeName: "Loop A", mode: "jeepney", serviceStatus: null }] });
    expect(withRoute.routes[0]!.fleet).toMatchObject({ label: "Vehicle type not confirmed", colourKey: "unconfirmed", classes: [] });
  });

  it("a snapshot route without notes parses to [] (older revisions); a note keeps its evidence and near circle", () => {
    const routeId = "33333333-3333-4333-8333-333333333333";
    const route = { routeId, routeCode: "R8-C", routeName: "Loop C", mode: "jeepney", serviceStatus: null };
    expect(networkSnapshotSchema.parse({ ...snapshot, routes: [route] }).routes[0]!.notes).toEqual([]);
    const note = { text: "Ask the driver.", evidence: "community", sourceCodes: ["RL01"], near: { lat: 13.6256, lng: 123.199, radiusM: 450 } };
    expect(networkSnapshotSchema.parse({ ...snapshot, routes: [{ ...route, notes: [note] }] }).routes[0]!.notes).toEqual([note]);
    expect(routeNoteSchema.safeParse({ ...note, text: "x".repeat(121) }).success).toBe(false);
    expect(routeNoteSchema.safeParse({ ...note, evidence: "verified" }).success).toBe(false);
    expect(routeNoteSchema.safeParse({ ...note, sourceCodes: [] }).success).toBe(false);
    expect(routeNoteSchema.safeParse({ ...note, near: { lat: 13.6, lng: 123.2, radiusM: 10 } }).success).toBe(false);
    expect(routeDetailSchema.shape.notes.parse(undefined)).toEqual([]);
  });

  it("snapshot variants carry no fleet (clients join routes[] by routeId)", () => {
    const v = { variantId: "22222222-2222-4222-8222-222222222222", routeId: "33333333-3333-4333-8333-333333333333", routeCode: "R8-A",
      routeName: "Loop A", direction: "clockwise", kind: "permanent", evidenceLevel: "provisional", verification: "unverified",
      isCircular: true, stopIds: ["11111111-1111-4111-8111-111111111111"], mode: "jeepney", fleet: fleet };
    expect(networkSnapshotSchema.parse({ ...snapshot, variants: [v] }).variants[0]).not.toHaveProperty("fleet");
  });

  it("a stale old-shape search index (no mode, fleetLabel, kind or location) degrades instead of failing", () => {
    const index = {
      revision: snapshot.revision, osmPlaces: [], pinPlaces: [], barangays: [], studyLabels: [], destinationCategories: [],
      feederLeads: [], legacyNames: [],
      routes: [{ code: "R1", name: "Route 1", groupNumber: 1, evidenceLevel: null, hasTrial: false, streets: [] }],
      terminals: [{ code: "T01", name: "Bus terminal", locationText: null, modes: [] }],
    };
    const parsed = searchIndexSchema.parse(index);
    expect(parsed.routes[0]).toMatchObject({ mode: "jeepney", fleetLabel: "Vehicle type not confirmed" });
    expect(parsed.terminals[0]).toMatchObject({ kind: null, location: null });
  });

  it("operating status always says it confirms service only", () => {
    const status = { status: "operating", label: "Operating (owner-confirmed 2026-10-16)", note: "n", confirmedOn: "2026-10-16",
      confirmsServiceOnly: true, sourceCodes: ["U01"] };
    expect(operatingStatusSchema.parse(status)).toEqual(status);
    expect(operatingStatusSchema.safeParse({ ...status, confirmsServiceOnly: false }).success).toBe(false);
  });
});

describe("snapshot path measures and the time-estimate model (Task 7)", () => {
  const variant = {
    variantId: "22222222-2222-4222-8222-222222222222", routeId: "33333333-3333-4333-8333-333333333333", routeCode: "R8-A",
    routeName: "Loop A", direction: "clockwise", kind: "permanent", evidenceLevel: "provisional", verification: "unverified",
    isCircular: true, stopIds: ["11111111-1111-4111-8111-111111111111", "44444444-4444-4444-8444-444444444444"], mode: "jeepney",
  };
  const param = (key: string, extra: Record<string, unknown> = {}) => ({
    key, low: 10, high: 15, unit: "km_per_h", windows: null, days: null, appliesTo: ["jeepney"], isAssumption: false,
    assumptionNote: null, basis: "b", sourceCodes: ["N16"], ...extra,
  });
  const model = {
    timeZone: "Asia/Manila", utcOffsetMinutes: 480,
    params: [
      param("walk_speed_kmh", { low: 4.238, high: 4.238, appliesTo: ["walk"], sourceCodes: ["N28"] }),
      param("walk_slowdown_factor", { low: 1, high: 1.25, unit: "factor", appliesTo: ["walk"], isAssumption: true, assumptionNote: "A1", sourceCodes: [] }),
      param("jeepney_speed_offpeak_kmh"),
      param("jeepney_speed_peak_kmh", { low: 7, high: 13, isAssumption: true, assumptionNote: "A2", sourceCodes: ["N29"] }),
      param("peak_windows", { low: null, high: null, unit: "windows", windows: [{ start: "06:00", end: "08:00" }], days: "every_day", isAssumption: true, assumptionNote: "A3", sourceCodes: ["N04"] }),
    ],
  };
  const snapshot = (v: Record<string, unknown>, etaModel: unknown = null) => ({
    revision: { revisionId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff", label: "r", kind: "provisional", publishedAt: null },
    stops: [], variants: [v], fareRules: [], etaModel,
  });

  it("older snapshots read with null measures, path length and model", () => {
    const parsed = networkSnapshotSchema.parse({ ...snapshot(variant), etaModel: undefined });
    expect(parsed.variants[0]).toMatchObject({ measuresM: null, pathLengthM: null });
    expect(parsed.etaModel).toBeNull();
  });

  it("accepts one measure per stop within the path length, and refuses anything else", () => {
    expect(networkSnapshotSchema.safeParse(snapshot({ ...variant, measuresM: [0, 812.5], pathLengthM: 8039.1 })).success).toBe(true);
    expect(networkSnapshotSchema.safeParse(snapshot({ ...variant, measuresM: [0], pathLengthM: 8039.1 })).success).toBe(false);
    expect(networkSnapshotSchema.safeParse(snapshot({ ...variant, measuresM: [0, 9000], pathLengthM: 8039.1 })).success).toBe(false);
    expect(networkSnapshotSchema.safeParse(snapshot({ ...variant, measuresM: [0, 10], pathLengthM: null })).success).toBe(false);
  });

  it("accepts the full time-estimate model; refuses a missing key, a bare assumption or an unsourced value", () => {
    expect(networkSnapshotSchema.safeParse(snapshot(variant, model)).success).toBe(true);
    expect(networkSnapshotSchema.safeParse(snapshot(variant, { ...model, params: model.params.slice(1) })).success).toBe(false);
    const bare = model.params.map((p) => (p.key === "walk_slowdown_factor" ? { ...p, assumptionNote: null } : p));
    expect(networkSnapshotSchema.safeParse(snapshot(variant, { ...model, params: bare })).success).toBe(false);
    const unsourced = model.params.map((p) => (p.key === "walk_speed_kmh" ? { ...p, sourceCodes: [] } : p));
    expect(networkSnapshotSchema.safeParse(snapshot(variant, { ...model, params: unsourced })).success).toBe(false);
  });
});
