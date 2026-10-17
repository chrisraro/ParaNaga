// Far areas in the planner (Increment F, T3): zone membership, no point-to-point tricycle at a far end,
// the special-trip exception near a tricycle terminal serving the zone, ruling (e) and the 1,500 m
// far-end walk cap. Real committed Lines, snapshot and street graph (10:00 Manila).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import { RULE_EVIDENCE } from "@/domain/import/modes-seed";
import { anchorRadiusM, FAR_AREAS, FAR_EVIDENCE, FAR_ZONE_RADIUS_M, zoneOf } from "@/domain/planner/far-areas";
import {
  ACCESS_TRICYCLE_MIN_WALK_M, accessTricycleOk, accessWanted, FAR_END_APPROACH_RADIUS_M, FAR_END_WALK_CAP_M, planTrip, SPECIAL_TRIP_TERMINAL_WALK_M, type PlanOption, type TripPlan,
} from "@/domain/planner/plan";
import { buildPlanResponse, planResponseSchema } from "@/domain/api/plan";
import { routeStreet } from "@/domain/walk/walk-graph";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const snap = realLinesSnapshot();
const lines = realLines();
const streets = realStreets();
const TEN = { now: new Date("2026-10-17T02:00:00Z") };
const plan = (o: LatLng, d: LatLng, s: Parameters<typeof planTrip>[0] = snap, net: { lines: typeof lines | null; streets: typeof streets | null } = { lines, streets }) =>
  planTrip(s, net, o, d, TEN);
const near = (p: LatLng, east: number, north: number): LatLng => ({ lat: p.lat + north / 110_574, lng: p.lng + east / 108_190 });

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const PACOL = { lat: 13.6595434, lng: 123.2511904 };
const PANICUASON = { lat: 13.6632922, lng: 123.3179196 };
const CARARAYAN = { lat: 13.6288288, lng: 123.2406424 };
const SM_CITY = { lat: 13.6210765, lng: 123.1904389 };
/** Magsaysay Avenue, about 640 m straight from T14 (the Balatas Rd corner itself is 75 m from T14). */
const MAGSAYSAY = { lat: 13.6270099, lng: 123.2005168 };
/** Magsaysay Ave at Balatas-Cararayan Road: within 300 m of T14 (Balatas Tricycle Terminal). */
const NEAR_T14 = { lat: 13.6314016, lng: 123.1967731 };

/** The far-trip fallback (C1): unlabelled, fare unavailable, special-trip copy, no terminal named. */
function assertSpecialFallback(t: PlanOption) {
  expect(t).toMatchObject({ id: "tricycle", labels: [], fare: { minCentavos: null, status: "unavailable" } });
  const leg = t.legs[0]!;
  if (leg.kind !== "tricycle") throw new Error("tricycle leg");
  expect(leg.notes).toContain("Special trip · fare not fixed · confirm with the driver");
  expect(leg.notes).toContain("Special trip by local report, unconfirmed");
  expect(leg.notes.some((n) => n.startsWith("Minimum fare") || n.startsWith("From "))).toBe(false);
}
const recommended = (p: TripPlan) => p.options.filter((o) => o.labels.includes("Recommended"));
const rideCodes = (o: PlanOption) => o.legs.flatMap((l) => (l.kind === "ride" ? [l.routeCode] : []));
const tricycle = (p: TripPlan) => p.options.find((o) => o.mode === "tricycle");
const access = (p: TripPlan) => p.options.find((o) => o.id.startsWith("tri>"));
/** Mabolo barangay anchor: its best Pacol jeepney walks 311 m to the first ride (no access option). */
const MABOLO = { lat: 13.6145058, lng: 123.1826654 };
/** City proper south of Centro: no jeepney to Pacol or Cararayan within the walk caps. */
const SOUTH = { lat: 13.609, lng: 123.183 };
// The base note grew from 16 words to a documented limit of 32 (the UI adds one short sentence per tricycle card shown).
const FAR_NOTE_MAX_WORDS = 32; // base note, "Cararayan and San Isidro" is the longest at 31
const farNote = (zone: string, dir = "to") => `Local report: tricycles ${dir} ${zone} charge special-trip fares that are not fixed, so we do not recommend one for the whole trip. Take the jeepney from the terminal.`;

describe("far areas: zone membership and the far note", () => {
  it("far-areas evidence levels equal the modes seed's", () => {
    expect(FAR_EVIDENCE).toEqual(RULE_EVIDENCE);
  });

  it("the far note is 32 words or fewer for every zone", () => {
    for (const z of FAR_AREAS.farZones) {
      expect(farNote(z.name).split(/\s+/).length).toBeLessThanOrEqual(FAR_NOTE_MAX_WORDS);
      // 14 words for one- and three-word zones; "Cararayan and San Isidro" makes it 15 (the plan's limit is 16).
      expect(farNote(z.name, "from").split(/\s+/).length).toBeLessThanOrEqual(FAR_NOTE_MAX_WORDS);
    }
  });

  it("1 Plaza Rizal → Pacol: an R6/R7 jeepney is Recommended, no tricycle, far note", () => {
    const p = plan(PLAZA_RIZAL, PACOL);
    expect(recommended(p)).toHaveLength(1);
    const r = recommended(p)[0]!;
    expect(r.mode).toBe("jeepney");
    expect(rideCodes(r).some((c) => c === "R6" || c === "R7")).toBe(true);
    expect(tricycle(p)).toBeUndefined();
    expect(p.farNote).toBe(farNote("Pacol"));
  });

  it("2 Plaza Rizal → Panicuason: R7 Recommended, no tricycle", () => {
    const p = plan(PLAZA_RIZAL, PANICUASON);
    expect(recommended(p)).toHaveLength(1);
    expect(rideCodes(recommended(p)[0]!)).toContain("R7");
    expect(tricycle(p)).toBeUndefined();
    expect(p.farNote).toBe(farNote("Carolina and Panicuason"));
  });

  it("3 Magsaysay Ave → Cararayan: R1 Recommended, no tricycle (over 300 m from T14)", () => {
    const p = plan(MAGSAYSAY, CARARAYAN);
    expect(recommended(p)).toHaveLength(1);
    expect(rideCodes(recommended(p)[0]!)).toContain("R1");
    expect(tricycle(p)).toBeUndefined();
    expect(p.farNote).toBe(farNote("Cararayan and San Isidro"));
  });

  it("4 a start within 300 m of T14 → Cararayan: R1 Recommended; special-trip tricycle unlabelled, fare unavailable", () => {
    const p = plan(NEAR_T14, CARARAYAN);
    expect(recommended(p)).toHaveLength(1);
    expect(rideCodes(recommended(p)[0]!)).toContain("R1");
    const t = tricycle(p)!;
    expect(t.labels).toEqual([]);
    expect(t.specialTrip).toBe(true); // the structured flag the UI reads
    expect(p.options.filter((o) => o.specialTrip)).toHaveLength(1);
    expect(t.fare).toEqual({ minCentavos: null, maxCentavos: null, status: "unavailable", completeness: "estimate" });
    const leg = t.legs[0]!;
    if (leg.kind !== "tricycle") throw new Error("tricycle leg");
    expect(leg.fare).toMatchObject({ minCentavos: null, status: "unavailable" });
    expect(leg.notes).toContain("Special trip · fare not fixed · confirm with the driver");
    expect(leg.notes).toContain("From Balatas Tricycle Terminal: local report, unconfirmed");
    expect(leg.notes.some((n) => n.startsWith("Minimum fare"))).toBe(false);
    expect(p.options.map((o) => o.mode).at(-1)).not.toBe("walk");
    expect(SPECIAL_TRIP_TERMINAL_WALK_M).toBe(300);
  });

  it("7 Cararayan → Plaza Rizal: R1 Recommended, no tricycle", () => {
    const p = plan(CARARAYAN, PLAZA_RIZAL);
    expect(recommended(p)).toHaveLength(1);
    expect(rideCodes(recommended(p)[0]!)).toContain("R1");
    expect(tricycle(p)).toBeUndefined();
    expect(p.farNote).toBe(farNote("Cararayan and San Isidro", "from"));
  });

  it("far note: both ends far names the destination zone ('to')", () => {
    expect(plan(CARARAYAN, PACOL).farNote).toBe(farNote("Pacol"));
    expect(plan(PACOL, CARARAYAN).farNote).toBe(farNote("Cararayan and San Isidro"));
  });

  it("8 Pacol → a point in Pacol 900 m away (no jeepney): ONE unlabelled special-trip tricycle, no long walk card, nothing Recommended", () => {
    const to = near(PACOL, 0, -900);
    expect(zoneOf(to, FAR_AREAS)).toBe("FZ02");
    const p = plan(PACOL, to);
    expect(p.farNote).toBe(farNote("Pacol"));
    expect(p.jeepneyReason).not.toBeNull();
    expect(p.options.map((o) => o.mode)).toEqual(["tricycle"]);
    expect(recommended(p)).toHaveLength(0);
    assertSpecialFallback(tricycle(p)!);
  });

  it("10 Plaza Rizal → SM City: not far, tricycle Recommended, no far note", () => {
    const p = plan(PLAZA_RIZAL, SM_CITY);
    expect(p.farNote).toBeUndefined();
    expect(tricycle(p)!.labels).toEqual(["Recommended"]);
    expect(recommended(p)).toHaveLength(1);
  });

  it("12 a snapshot without terminals (or with unknown codes only) gives no special trip and does not crash", () => {
    const bare = { ...snap, terminals: [] };
    expect(tricycle(plan(NEAR_T14, CARARAYAN, bare))).toBeUndefined();
    const unknown = { ...snap, terminals: snap.terminals.map((t) => (t.code === "T14" ? { ...t, code: "T99" } : t)) };
    expect(tricycle(plan(NEAR_T14, CARARAYAN, unknown))).toBeUndefined();
    const noCoord = { ...snap, terminals: snap.terminals.map((t) => (t.code === "T14" ? { ...t, lat: null, lng: null, coordSource: null } : t)) };
    expect(tricycle(plan(NEAR_T14, CARARAYAN, noCoord))).toBeUndefined();
    const older: Parameters<typeof planTrip>[0] = { ...snap, terminals: undefined };
    expect(tricycle(plan(NEAR_T14, CARARAYAN, older))).toBeUndefined();
  });

  it("13 offline without a street graph: far rules apply, walks are ×1.3 estimates, the special trip has no street route", () => {
    const off = { lines, streets: null };
    const a = plan(PLAZA_RIZAL, PACOL, snap, off);
    expect(tricycle(a)).toBeUndefined();
    expect(recommended(a)[0]!.mode).toBe("jeepney");
    for (const l of recommended(a)[0]!.legs) if (l.kind === "walk") expect(l.basis).toBe("straight_x1_3");
    const b = plan(NEAR_T14, CARARAYAN, snap, off);
    const leg = tricycle(b)!.legs[0]!;
    expect(leg).toMatchObject({ kind: "tricycle", basis: "unavailable" });
    expect(leg.kind === "tricycle" && leg.notes).toContain("Street route not available");
  });

  it("the far note survives buildPlanResponse and the response schema; an older body reads farNote null", () => {
    const p = plan(PLAZA_RIZAL, PACOL);
    const body = planResponseSchema.parse(buildPlanResponse(snap, p, lines));
    expect(body.plan.farNote).toBe(farNote("Pacol"));
    const raw = JSON.parse(JSON.stringify(buildPlanResponse(snap, p, lines)));
    delete raw.plan.farNote;
    expect(planResponseSchema.parse(raw).plan.farNote).toBeNull();
  });

  it("11 property: ≤ 6 options, one Recommended (none only far with no jeepney), far tricycle only as a special trip, far walk cap", () => {
    const city = fc.record({ lat: fc.double({ min: 13.6, max: 13.67, noNaN: true }), lng: fc.double({ min: 123.17, max: 123.32, noNaN: true }) });
    const farEnd = fc.constantFrom(PACOL, PANICUASON, CARARAYAN, near(PACOL, 300, -400), near(CARARAYAN, -200, 300), NEAR_T14);
    const point = fc.oneof(city, farEnd);
    const terminal = snap.terminals.find((t) => t.code === "T14")!;
    fc.assert(
      fc.property(point, point, (o, d) => {
        fc.pre(isInsideNaga(o) && isInsideNaga(d));
        const p = plan(o, d);
        if (p.coverage === "none") return;
        const oz = zoneOf(o, FAR_AREAS);
        const dz = zoneOf(d, FAR_AREAS);
        const far = oz !== null || dz !== null;
        expect(p.options.length).toBeLessThanOrEqual(6);
        const jeep = p.options.some((x) => x.mode === "jeepney");
        const short = p.directWalkEstimateMeters! < 500;
        expect(recommended(p)).toHaveLength(far && !jeep && !short ? 0 : 1);
        if (far && !jeep && short) expect(recommended(p)[0]!.mode).toBe("walk");
        if (far && jeep) expect(recommended(p)[0]!.mode).toBe("jeepney");
        expect(p.farNote !== undefined).toBe(far);
        const t = tricycle(p);
        const fromTerminal = t?.legs[0]?.kind === "tricycle" && t.legs[0].notes.some((n) => n.startsWith("From "));
        if (far && t && !fromTerminal) {
          expect(jeep).toBe(false);
          assertSpecialFallback(t);
        }
        if (far && t && fromTerminal) {
          expect(oz).toBeNull();
          expect(FAR_AREAS.tricycleTerminals.find((x) => x.terminalCode === "T14")!.serves).toContainEqual({ farZone: dz });
          expect(haversineMeters(o, { lat: terminal.lat!, lng: terminal.lng! })).toBeLessThanOrEqual(SPECIAL_TRIP_TERMINAL_WALK_M);
          expect(t.labels).toEqual([]);
        }
        for (const x of p.options.filter((y) => y.mode === "jeepney")) {
          const walks = x.legs.filter((l) => l.kind === "walk");
          expect(walks[0]!.estimateMeters).toBeLessThanOrEqual(oz ? FAR_END_WALK_CAP_M : 750);
          expect(walks.at(-1)!.estimateMeters).toBeLessThanOrEqual(dz ? FAR_END_WALK_CAP_M : 750);
        }
      }),
      { seed: 20261018, numRuns: 120 },
    );
  }, 120_000);
});

describe("far areas: the access option (tricycle to the jeepney loading point, T4)", () => {
  const T10 = snap.terminals.find((t) => t.code === "T10")!;
  const T11 = snap.terminals.find((t) => t.code === "T11")!;

  const assertAccess = (o: PlanOption, routes: string[]) => {
    expect(o.legs.map((l) => l.kind)).toEqual(["tricycle", "walk", "ride", "walk"]);
    expect(o).toMatchObject({ mode: "jeepney", rides: 1 });
    const [tri, walk, ride] = o.legs;
    if (tri?.kind !== "tricycle" || walk?.kind !== "walk" || ride?.kind !== "ride") throw new Error("legs");
    expect(zoneOf(tri.to, FAR_AREAS)).toBeNull();
    expect(walk.from).toMatchObject({ lat: tri.to.lat, lng: tri.to.lng });
    expect(routes).toContain(ride.routeCode);
    expect(o.id).toBe(`tri>${ride.variantId}@${Math.round(ride.boardMeasureM / 10) * 10}-${Math.round(ride.alightMeasureM / 10) * 10}`);
    expect(tri.fare).toMatchObject({ status: "minimum", minCentavos: 1500 });
    expect(tri.notes.some((n) => n.startsWith("Minimum fare ₱15"))).toBe(true);
    expect(o.fare.minCentavos).toBeGreaterThan(1500);
  };

  it("5 a city point over 600 m from the R6/R7 paths → Pacol: one access option via T10 or T11, no point-to-point tricycle", () => {
    const p = plan(SOUTH, PACOL);
    expect(ACCESS_TRICYCLE_MIN_WALK_M).toBe(600);
    expect(p.options.filter((o) => o.id.startsWith("tri>"))).toHaveLength(1);
    const a = access(p)!;
    assertAccess(a, ["R6", "R7"]);
    expect([T10.name, T11.name]).toContain(a.legs[0]!.kind === "tricycle" && a.legs[0]!.to.name);
    expect(tricycle(p)).toBeUndefined();
    expect(() => planResponseSchema.parse(buildPlanResponse(snap, p, lines))).not.toThrow();
    expect(a.fare).toMatchObject({ status: "minimum", maxCentavos: null });
    const modes = p.options.map((o) => (o.id.startsWith("tri>") ? "access" : o.mode));
    expect(modes.indexOf("access")).toBeGreaterThan(modes.lastIndexOf("jeepney"));
    expect(recommended(p)).toHaveLength(1);
    // SOUTH has no other jeepney option: the access option is the Recommended one (ruling e).
    expect(p.options.filter((o) => o.mode === "jeepney")).toEqual([a]);
    expect(a.labels).toEqual(["Recommended"]);
  });

  it("5 Pacol access boards R6 outbound at T10 when T10's tricycle street route is shorter than T11's; Panicuason boards R7 at T11", () => {
    const o = { lat: 13.605, lng: 123.187 };
    const len = (t: typeof T10) => {
      const r = routeStreet(streets, o, { lat: t.lat!, lng: t.lng! }, { mode: "tricycle", now: TEN.now });
      return r.kind === "path" ? r.lengthM : Infinity;
    };
    expect(len(T10)).toBeLessThan(len(T11));
    const a = access(plan(o, PACOL))!;
    assertAccess(a, ["R6"]);
    const [tri, walk, ride] = a.legs;
    if (tri?.kind !== "tricycle" || walk?.kind !== "walk" || ride?.kind !== "ride") throw new Error("legs");
    expect(tri).toMatchObject({ basis: "street_graph", distanceMeters: Math.round(len(T10)) });
    expect(tri.to.name).toBe(T10.name);
    expect(lines.lines.find((l) => l.variantId === ride.variantId)!.direction).toBe("outbound");
    expect(ride.boardMeasureM).toBe(0);
    const b = access(plan(o, PANICUASON))!;
    assertAccess(b, ["R7"]);
    expect(b.legs[0]!.kind === "tricycle" && b.legs[0]!.to.name).toBe(T11.name);
  });

  it("5 a city point → Cararayan: the access option boards R1 where it starts (route plan); the only jeepney-family option is Recommended", () => {
    const p = plan(SOUTH, CARARAYAN);
    const a = access(p)!;
    assertAccess(a, ["R1"]);
    expect(a.legs[0]!.kind === "tricycle" && a.legs[0]!.to.name).toBe("where R1 starts (route plan)");
    expect(a.legs[1]).toMatchObject({ kind: "walk", estimateMeters: 0 });
    expect(p.jeepneyReason).toBeNull();
    expect(a.labels).toEqual(["Recommended"]);
    expect(p.options.some((o) => o.mode === "walk")).toBe(false);
  });

  it("6 city points whose zone jeepney walks 600 m or less to board → Pacol: no access option", () => {
    for (const o of [PLAZA_RIZAL, MABOLO]) {
      const p = plan(o, PACOL);
      const zoneBest = p.options.find((x) => x.mode === "jeepney" && ["R6", "R7"].includes(rideCodes(x).at(-1)!))!;
      expect(zoneBest.legs[0]!.kind === "walk" && zoneBest.legs[0]!.estimateMeters).toBeLessThanOrEqual(600);
      expect(access(p)).toBeUndefined();
    }
  });

  it("no access option when the origin is far or the destination is not", () => {
    expect(access(plan(PACOL, SOUTH))).toBeUndefined();
    expect(access(plan(SOUTH, SM_CITY))).toBeUndefined();
    expect(access(plan(CARARAYAN, PACOL))).toBeUndefined();
  });

  it("12 a snapshot without T10/T11 (or with T10 off its path): no access via them, no crash", () => {
    const bare = { ...snap, terminals: snap.terminals.filter((t) => t.code !== "T10" && t.code !== "T11") };
    expect(() => plan(SOUTH, PACOL, bare)).not.toThrow();
    expect(access(plan(SOUTH, PACOL, bare))).toBeUndefined();
    const moved = { ...snap, terminals: snap.terminals.map((t) => (t.code === "T10" ? { ...t, lat: t.lat! - 0.003 } : t)) };
    // From a point whose shortest tricycle goes to T10, moving T10 330 m off R6 sends the access option to T11 (R7).
    const o = { lat: 13.605, lng: 123.187 };
    expect(access(plan(o, PACOL))!.legs[0]).toMatchObject({ kind: "tricycle", to: { name: T10.name } });
    const a = access(plan(o, PACOL, moved))!;
    assertAccess(a, ["R7"]);
    expect(a.legs[0]).toMatchObject({ kind: "tricycle", to: { name: T11.name } });
  });

  it("13 offline without a street graph: the access tricycle says 'Street route not available', walks are ×1.3", () => {
    const p = plan(SOUTH, PACOL, snap, { lines, streets: null });
    const a = access(p)!;
    assertAccess(a, ["R6", "R7"]);
    expect(a.legs[0]).toMatchObject({ kind: "tricycle", basis: "unavailable", distanceMeters: null });
    expect(a.legs[0]!.kind === "tricycle" && a.legs[0]!.notes).toContain("Street route not available");
    for (const l of a.legs) if (l.kind === "walk") expect(l.basis).toBe("straight_x1_3");
  });

  it("property: every access tricycle leg ends in the city proper; ≤ 6 options; ≤ 1 Recommended; at most one access option", () => {
    const city = fc.record({ lat: fc.double({ min: 13.6, max: 13.67, noNaN: true }), lng: fc.double({ min: 123.17, max: 123.32, noNaN: true }) });
    const farEnd = fc.constantFrom(PACOL, PANICUASON, CARARAYAN, near(PACOL, 300, -400), near(CARARAYAN, -200, 300));
    fc.assert(
      fc.property(city, farEnd, (o, d) => {
        fc.pre(isInsideNaga(o));
        const p = plan(o, d);
        expect(p.options.length).toBeLessThanOrEqual(6);
        expect(recommended(p).length).toBeLessThanOrEqual(1);
        const as = p.options.filter((x) => x.id.startsWith("tri>"));
        expect(as.length).toBeLessThanOrEqual(1);
        for (const a of as) {
          expect(zoneOf(o, FAR_AREAS)).toBeNull();
          const t = a.legs[0]!;
          if (t.kind !== "tricycle") throw new Error("an access option starts with a tricycle");
          expect(zoneOf(t.to, FAR_AREAS)).toBeNull();
        }
      }),
      { seed: 20261019, numRuns: 60 },
    );
  }, 120_000);
});

describe("far areas: far-end approaches and the no-jeepney fallback (review C1)", () => {
  it.each([
    ["Ateneo de Naga JHS", { lat: 13.6464862, lng: 123.233849 }],
    ["Metro Naga Sports Complex", { lat: 13.6470607, lng: 123.2367197 }],
    ["Ponte Cielo Park", { lat: 13.6235529, lng: 123.2401103 }],
    ["Camella Heights", { lat: 13.6263, lng: 123.2417 }],
  ])("Plaza Rizal → %s is never a walk-only plan; something is Recommended", (_n, d) => {
    const p = plan(PLAZA_RIZAL, d);
    expect(p.options.some((o) => o.mode !== "walk")).toBe(true);
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).not.toBe("walk");
  });

  it("a far end 500–1,150 m straight from the route path gets a jeepney (approach radius FAR_END_APPROACH_RADIUS_M)", () => {
    expect(FAR_END_APPROACH_RADIUS_M).toBe(1150);
    const p = plan(PLAZA_RIZAL, { lat: 13.6263, lng: 123.2417 });
    const r = recommended(p)[0]!;
    expect(r.mode).toBe("jeepney");
    const egress = r.legs.at(-1)!;
    expect(egress.kind === "walk" && egress.estimateMeters).toBeGreaterThan(750);
  });
});

describe("far areas: short trips keep their Recommended walk (review I2)", () => {
  it("Pacol → a point 300 m south: the walk card is Recommended; the fallback tricycle is unlabelled", () => {
    const p = plan(PACOL, near(PACOL, 0, -300));
    expect(p.directWalkEstimateMeters!).toBeLessThan(500);
    expect(p.options.some((o) => o.mode === "jeepney")).toBe(false);
    expect(recommended(p).map((o) => o.mode)).toEqual(["walk"]);
    assertSpecialFallback(tricycle(p)!);
  });
});

describe("far areas: access W is the shortest first walk among the jeepney options shown (review I3)", () => {
  const access = (p: TripPlan) => p.options.find((o) => o.id.startsWith("tri>"));
  const firstWalks = (p: TripPlan) =>
    p.options.filter((o) => o.mode === "jeepney" && !o.id.startsWith("tri>")).map((o) => (o.legs[0]!.kind === "walk" ? o.legs[0]!.estimateMeters : Infinity));

  it.each([
    ["(13.618, 123.184) → Pacol: R8-C>R6 walks about 106 m", { lat: 13.618, lng: 123.184 }, PACOL],
    ["(13.618, 123.190) → Cararayan: R8-A>R1 walks about 398 m", { lat: 13.618, lng: 123.19 }, CARARAYAN],
    ["Plaza Rizal → Ponte Cielo: R2 walks 9 m", PLAZA_RIZAL, { lat: 13.6235529, lng: 123.2401103 }],
  ])("%s, so no access option", (_n, o, d) => {
    const p = plan(o, d);
    expect(Math.min(...firstWalks(p))).toBeLessThanOrEqual(600);
    expect(access(p)).toBeUndefined();
  });
});

describe("far areas: pinned owner branch and boundaries (review I4)", () => {
  const access = (p: TripPlan) => p.options.find((o) => o.id.startsWith("tri>"));

  it("(13.612, 123.185) → Pacol: the jeepneys walk over 600 m to board; the access option is shown next to them, unlabelled", () => {
    const p = plan({ lat: 13.612, lng: 123.185 }, PACOL);
    const jeeps = p.options.filter((o) => o.mode === "jeepney" && !o.id.startsWith("tri>"));
    expect(jeeps.length).toBeGreaterThan(0);
    for (const j of jeeps) expect(j.legs[0]!.kind === "walk" && j.legs[0]!.estimateMeters).toBeGreaterThan(600);
    expect(recommended(p)[0]).toBe(jeeps[0]);
    const a = access(p)!;
    expect(a.labels).toEqual([]);
    expect(a.legs.map((l) => l.kind)).toEqual(["tricycle", "walk", "ride", "walk"]);
    expect(p.options.indexOf(a)).toBe(p.options.indexOf(jeeps.at(-1)!) + 1);
  });

  it("access thresholds at 600 m: shortest first walk 599/600 → no access, 601 → access; tricycle 600 → dropped, 601 → kept", () => {
    expect(accessWanted([599, 900])).toBe(false);
    expect(accessWanted([600])).toBe(false);
    expect(accessWanted([601, 700])).toBe(true);
    expect(accessWanted([])).toBe(true);
    expect(accessTricycleOk(600)).toBe(false);
    expect(accessTricycleOk(601)).toBe(true);
  });

  it("special trip at the 300 m limit (offline ×1.3): about 290 m from T14 keeps it, about 311 m does not", () => {
    const t = snap.terminals.find((x) => x.code === "T14")!;
    const T14 = { lat: t.lat!, lng: t.lng! };
    const off = { lines, streets: null };
    const at = (northM: number) => near(T14, 0, -northM);
    const walk = (p: LatLng) => Math.round(haversineMeters(p, T14) * 1.3);
    expect(walk(at(222))).toBeLessThanOrEqual(300);
    expect(walk(at(222))).toBeGreaterThanOrEqual(285);
    expect(walk(at(238))).toBeGreaterThan(300);
    expect(walk(at(238))).toBeLessThanOrEqual(315);
    const inside = tricycle(plan(at(222), CARARAYAN, snap, off));
    expect(inside?.legs[0]?.kind === "tricycle" && inside.legs[0].notes).toContain("From Balatas Tricycle Terminal: local report, unconfirmed");
    const outside = tricycle(plan(at(238), CARARAYAN, snap, off));
    expect(outside).toBeUndefined();
  });
});

describe("far zones have a radius around their anchors (review I5)", () => {
  it.each([
    ["Ateneo de Naga University Junior High School", { lat: 13.6464862, lng: 123.233849 }],
    ["Metro Naga Sports Complex", { lat: 13.6470607, lng: 123.2367197 }],
    ["Naga City Children's Home", { lat: 13.6467006, lng: 123.2359422 }],
    ["Paseo de San Ignacio", { lat: 13.6449607, lng: 123.2358314 }],
  ])("%s (about 2 km from the Cararayan anchor) is not far; Plaza Rizal → it gets the city tricycle and no far note", (_n, p) => {
    expect(zoneOf(p, FAR_AREAS)).toBeNull();
    const q = plan(PLAZA_RIZAL, p);
    expect(q.farNote).toBeUndefined();
    expect(tricycle(q)!.labels).toEqual(["Recommended"]);
  });

  it("Camella Heights (about 300 m from the Cararayan anchor) stays far (owner decides, Q2)", () => {
    expect(zoneOf({ lat: 13.6263, lng: 123.2417 }, FAR_AREAS)).toBe("FZ01");
  });

  it("every far zone carries radiusM 1,500 (FAR_ZONE_RADIUS_M) in the data", () => {
    expect(FAR_ZONE_RADIUS_M).toBe(1500);
    for (const z of FAR_AREAS.farZones) expect(z.radiusM).toBe(FAR_ZONE_RADIUS_M);
  });

  it("zoneOf honours a zone's radiusM and defaults to FAR_ZONE_RADIUS_M", () => {
    const anchor = { lat: 13.6595434, lng: 123.2511904 };
    const anchors = FAR_AREAS.barangayAnchors.map((x) => ({ ...x, radiusM: undefined }));
    const base = { ...FAR_AREAS, barangayAnchors: anchors, farZones: FAR_AREAS.farZones.map((z) => ({ ...z, radiusM: undefined })) };
    expect(zoneOf(near(anchor, 0, -1400), base)).toBe("FZ02");
    expect(zoneOf(near(anchor, 0, -1600), base)).toBeNull();
    const tight = { ...FAR_AREAS, barangayAnchors: anchors, farZones: FAR_AREAS.farZones.map((z) => ({ ...z, radiusM: 500 })) };
    expect(zoneOf(near(anchor, 0, -450), tight)).toBe("FZ02");
    expect(zoneOf(near(anchor, 0, -550), tight)).toBeNull();
  });
});

describe("far zones: per-anchor radius (controller ruling on I5)", () => {
  const anchorNamed = (n: string) => FAR_AREAS.barangayAnchors.find((a) => a.name === n)!;
  const dist = (p: LatLng, n: string) => Math.round(haversineMeters(p, anchorNamed(n)));

  it("anchors carry their provisional radius: Cararayan 1500, San Isidro 1800, Pacol 3000, Carolina 3000, Panicuason 4500", () => {
    const radii = Object.fromEntries(FAR_AREAS.farZones.flatMap((z) => z.nodeIds.map((id) => {
      const a = FAR_AREAS.barangayAnchors.find((x) => x.osmNodeId === id)!;
      return [a.name, anchorRadiusM(a, z)];
    })));
    expect(radii).toEqual({ Cararayan: 1500, "San Isidro": 1800, Pacol: 3000, Carolina: 3000, Panicuason: 4500 });
    for (const z of FAR_AREAS.farZones) expect(z.note).toMatch(/provisional/);
  });

  it.each([
    ["Pacol Elementary School", { lat: 13.6514709, lng: 123.232118 }, "Pacol", 2248],
    ["Pacol Barangay Chapel", { lat: 13.6510262, lng: 123.2332406 }, "Pacol", 2158],
  ])("%s is far (FZ02), %s anchor %i m away; no point-to-point tricycle from Plaza Rizal", (_n, p, anchor, m) => {
    expect(dist(p, anchor)).toBe(m);
    expect(zoneOf(p, FAR_AREAS)).toBe("FZ02");
    expect(tricycle(plan(PLAZA_RIZAL, p))?.labels ?? []).not.toContain("Recommended");
  });

  it.each([
    ["Morada-Ramos Elementary School", { lat: 13.6527245, lng: 123.2775449 }, 1933],
    ["Fazenda de Esperanca (Farm of Hope)", { lat: 13.651721, lng: 123.2785213 }, 1935],
  ])("%s (Carolina, %i m from its anchor) is far (FZ03)", (_n, p, m) => {
    expect(dist(p, "Carolina")).toBe(m);
    expect(zoneOf(p, FAR_AREAS)).toBe("FZ03");
  });

  it("a place 2.3 km from the Panicuason anchor is far (FZ03)", () => {
    expect(zoneOf(near(PANICUASON, 0, -2300), FAR_AREAS)).toBe("FZ03");
  });

  it.each([
    ["Ateneo de Naga University Junior High School", { lat: 13.6464862, lng: 123.233849 }, 2096],
    ["Metro Naga Sports Complex", { lat: 13.6470607, lng: 123.2367197 }, 2071],
    ["Naga City Children's Home", { lat: 13.6467006, lng: 123.2359422 }, 2051],
    ["Paseo de San Ignacio", { lat: 13.6449607, lng: 123.2358314 }, 1868],
  ])("%s stays non-far (nearest anchor Cararayan, %i m, radius 1500)", (_n, p, m) => {
    expect(dist(p, "Cararayan")).toBe(m);
    expect(zoneOf(p, FAR_AREAS)).toBeNull();
  });

  it("Camella Heights stays far (FZ01, about 300 m from Cararayan)", () => {
    const p = { lat: 13.6263, lng: 123.2417 };
    expect(dist(p, "Cararayan")).toBeLessThan(400);
    expect(zoneOf(p, FAR_AREAS)).toBe("FZ01");
  });

  it("an anchor radius overrides the zone radius", () => {
    const pacol = anchorNamed("Pacol");
    const data = { ...FAR_AREAS, barangayAnchors: FAR_AREAS.barangayAnchors.map((a) => (a === pacol ? { ...a, radiusM: 500 } : a)) };
    expect(zoneOf(near(pacol, 0, -450), data)).toBe("FZ02");
    expect(zoneOf(near(pacol, 0, -550), data)).toBeNull();
  });
});
