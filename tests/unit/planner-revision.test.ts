// Planner revision 2026-10-20 (owner): jeepneys never loop or roam the rider (detour guard), the tricycle is the top
// option inside the city centre, rides carry their sign letter and title, tricycles carry the terminal near each end.
import { describe, expect, it } from "vitest";
import { buildPlanResponse, planResponseSchema } from "@/domain/api/plan";
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";
import { CENTRO, inCentro } from "@/domain/planner/centro";
import { JEEP_DETOUR_SLACK_M, JEEP_FAR_DROP_MAX_M, JEEP_MAX_DETOUR, planTrip, type TripPlan } from "@/domain/planner/plan";
import { ROUTE_DISPLAY, isActiveRoute, routeChipText, routeDisplay, routeLabel, routeProvenance } from "@/domain/planner/route-display";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const snap = realLinesSnapshot();
const lines = realLines();
const NET = { lines, streets: realStreets() };
/** 10:00 Manila: daytime tricycle rules. */
const TEN = { now: new Date("2026-10-17T02:00:00Z") };
const plan = (o: LatLng, d: LatLng) => planTrip(snap, NET, o, d, TEN);
const anchor = (code: string): LatLng => {
  const a = CENTRO.anchors.find((x) => x.code === code)!;
  return { lat: a.lat, lng: a.lng };
};
const recommended = (p: TripPlan) => p.options.filter((o) => o.labels.includes("Recommended"));
const jeepneys = (p: TripPlan) => p.options.filter((o) => o.mode === "jeepney");
const withinGuard = (p: TripPlan, o: LatLng, d: LatLng) =>
  jeepneys(p).every((x) => x.rideMeters <= JEEP_MAX_DETOUR * haversineMeters(o, d) + JEEP_DETOUR_SLACK_M);

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const ATENEO = { lat: 13.6309527, lng: 123.1845589 };

describe("detour guard (JEEP_MAX_DETOUR)", () => {
  it("is 2.0 × the straight-line trip plus 300 m", () => {
    expect(JEEP_MAX_DETOUR).toBe(2);
    expect(JEEP_DETOUR_SLACK_M).toBe(300);
  });

  it("589 m trip near Ateneo: the 6.75 km R8-C near-lap (audit #5) is not offered", () => {
    const o = { lat: 13.6282396, lng: 123.1831725 };
    const d = { lat: 13.6255265, lng: 123.1873318 };
    const p = plan(o, d);
    expect(withinGuard(p, o, d)).toBe(true);
    expect(jeepneys(p).some((x) => x.rideMeters > 6000)).toBe(false);
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).not.toBe("jeepney");
  });

  it("642 m trip near Ateneo: the 5.4 km two-ride R8-C > R4 (audit #7) is not offered", () => {
    const o = { lat: 13.6295961, lng: 123.1831725 };
    const d = { lat: 13.6255265, lng: 123.1845589 };
    const p = plan(o, d);
    expect(withinGuard(p, o, d)).toBe(true);
    expect(jeepneys(p).some((x) => x.rides === 2 && x.rideMeters > 3000)).toBe(false);
    expect(recommended(p)).toHaveLength(1);
  });

  it("drops every jeepney with a calm reason when all of them roam", () => {
    const o = { lat: 13.6282396, lng: 123.1831725 };
    const d = { lat: 13.6255265, lng: 123.1873318 };
    const p = plan(o, d);
    if (jeepneys(p).length === 0) expect(["roundabout", "centro"]).toContain(p.jeepneyReason);
  });

  it("Plaza Rizal → Ateneo keeps a direct Recommended jeepney", () => {
    const p = plan(PLAZA_RIZAL, ATENEO);
    expect(withinGuard(p, PLAZA_RIZAL, ATENEO)).toBe(true);
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).toBe("jeepney");
  });

  it.each([
    ["Panicuason", { lat: 13.6632922, lng: 123.3179196 }, "R7"],
    ["Pacol", { lat: 13.6595434, lng: 123.2511904 }, "R6"],
    ["San Isidro", { lat: 13.6323904, lng: 123.2695351 }, "R1"],
  ])("far zone Plaza Rizal → %s still rides %s, Recommended, no tricycle", (_n, d, route) => {
    const p = plan(PLAZA_RIZAL, d);
    expect(recommended(p)[0]!.legs.some((l) => l.kind === "ride" && l.routeCode === route)).toBe(true);
    expect(p.options.some((o) => o.mode === "tricycle")).toBe(false);
  });

  it("Plaza Rizal → Del Rosario keeps its via chips", () => {
    const p = plan(PLAZA_RIZAL, { lat: 13.6173903, lng: 123.2375487 });
    expect(jeepneys(p).filter((o) => o.via).length).toBeGreaterThanOrEqual(2);
    expect(recommended(p)[0]!.mode).toBe("jeepney");
  });
});

describe("city centre (CENTRO anchors)", () => {
  it("every anchor cites a source and the Plaza Rizal anchor does not reach Ateneo", () => {
    for (const a of CENTRO.anchors) expect(a.source.length).toBeGreaterThan(5);
    expect(inCentro(PLAZA_RIZAL)).toBe(true);
    expect(inCentro(ATENEO)).toBe(false);
  });

  it.each([
    ["Integrated Southbound Terminal (LCC) → SM City Naga", "C04", "C05"],
    ["SM City Naga → Robinsons Place Naga", "C05", "C06"],
    ["Robinsons Place Naga → Plaza Rizal", "C06", "C01"],
  ])("%s: the tricycle is Recommended and listed first; a jeepney only when direct and dropping off within 100 m (400 m, owner 2026-10-20, never Recommended)", (_n, a, b) => {
    const o = anchor(a);
    const d = anchor(b);
    const p = plan(o, d);
    expect(p.directWalkEstimateMeters).toBeGreaterThanOrEqual(500);
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).toBe("tricycle");
    expect(p.options[0]!.mode).toBe("tricycle");
    expect(withinGuard(p, o, d)).toBe(true);
    for (const j of jeepneys(p)) {
      const last = j.legs.filter((l) => l.kind === "ride").at(-1)!;
      if (last.kind !== "ride") throw new Error("a ride");
      expect(haversineMeters(last.alight, d)).toBeLessThanOrEqual(j.labels.length === 0 ? JEEP_FAR_DROP_MAX_M : 100);
      expect(j.labels).not.toContain("Recommended");
    }
    expect((p.jeepneyReason === null) === (jeepneys(p).length > 0)).toBe(true);
  });
});

describe("route display (letter + title)", () => {
  it("every jeepney route of the published data has an entry, with a source", () => {
    const codes = (snap.routes ?? []).filter((r) => r.mode === "jeepney").map((r) => r.routeCode);
    expect(codes.length).toBeGreaterThanOrEqual(11);
    for (const c of codes) {
      expect(ROUTE_DISPLAY[c], c).toBeDefined();
      expect(ROUTE_DISPLAY[c]!.source.length).toBeGreaterThan(10);
    }
    for (const l of lines.lines) expect(ROUTE_DISPLAY[l.routeCode], l.routeCode).toBeDefined();
  });

  it("the letter tally: loops A-D have letters; R1-R7 have none", () => {
    expect(Object.fromEntries(Object.entries(ROUTE_DISPLAY).map(([k, v]) => [k, v.letter]))).toEqual({
      R1: null, R2: null, R3: null, R4: null, R5: null, R6: null, R7: null, "R8-A": "A", "R8-B": "B", "R8-C": "C", "R8-D": "D",
    });
    expect(routeDisplay("R9", "Centro–Somewhere")).toEqual({ letter: null, title: "Centro–Somewhere", unverified: true });
  });

  it("every ride leg of a plan carries its display, and the response schema keeps it", () => {
    const p = plan(PLAZA_RIZAL, { lat: 13.6173903, lng: 123.2375487 });
    const rides = p.options.flatMap((o) => o.legs).filter((l) => l.kind === "ride");
    expect(rides.length).toBeGreaterThan(0);
    for (const r of rides) if (r.kind === "ride") expect(r.display).toEqual(routeDisplay(r.routeCode, r.routeName));
    const parsed = planResponseSchema.parse(buildPlanResponse(snap, p, lines));
    const r2 = parsed.plan.options.flatMap((o) => o.legs).find((l) => l.kind === "ride" && l.routeCode === "R2");
    expect(r2 && r2.kind === "ride" ? r2.display : null).toEqual({ letter: null, title: "Centro-Del Rosario via Magsaysay Ave", unverified: true });
  });

  it("the helpers: label, chip, provenance and the active list; no special code is an active route", () => {
    expect(routeLabel("R2", "x")).toBe("Centro-Del Rosario via Magsaysay Ave");
    expect(routeLabel("R1", "x")).toBe("Centro-Cararayan-San Isidro");
    expect(routeLabel("R8-A", "x")).toBe("Centro-Magsaysay Loop A (clockwise)");
    expect(routeLabel("TRI-VISTODA", "VISTODA trimobile")).toBe("VISTODA trimobile");
    expect(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8-A", "R8-B", "R8-C", "R8-D"].map(routeChipText)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "Loop A", "Loop B", "Loop C", "Loop D"]);
    expect(Object.keys(ROUTE_DISPLAY)).toHaveLength(11);
    expect(isActiveRoute("R4") && isActiveRoute("R8-D")).toBe(true);
    for (const code of ["TRI-VISTODA", "TRI-DECALANGON", "R9", "toString"]) expect(isActiveRoute(code), code).toBe(false);
    const units = (c: string) => ROUTE_DISPLAY[c]!.authorisedUnits;
    expect(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].reduce((n, c) => n + units(c), 0) + units("R8-A")).toBe(282);
    expect(routeProvenance("R2")).toEqual({ plan: "Route 2 of the City of Naga route plan, Ordinance 2025-070 · 22 units authorised", letter: null });
    expect(routeProvenance("R3")!.letter).toBeNull();
    expect(routeProvenance("R4")!.letter).toBeNull();
    expect(routeProvenance("R1")!.letter).toBeNull();
    expect(routeProvenance("R8-C")!.plan).toContain("71 units shared by Loops A-D");
    expect(routeProvenance("R8-B")!.letter).toBe("Letter seen on the signboard");
  });

  it("an older body without display still parses (display null)", () => {
    const p = plan(PLAZA_RIZAL, ATENEO);
    const body = JSON.parse(JSON.stringify(buildPlanResponse(snap, p, lines)));
    for (const o of body.plan.options) for (const l of o.legs) delete l.display;
    const parsed = planResponseSchema.parse(body);
    const ride = parsed.plan.options.flatMap((o) => o.legs).find((l) => l.kind === "ride");
    expect(ride && ride.kind === "ride" ? ride.display : "none").toBeNull();
  });
});

describe("tricycle terminals", () => {
  const BALATAS_TERMINAL = { lat: 13.6318672, lng: 123.1973306 };

  it("a tricycle option names the published terminal near its start, with its TODAs (none on file) and a source", () => {
    const o = { lat: BALATAS_TERMINAL.lat + 100 / 110_574, lng: BALATAS_TERMINAL.lng };
    const p = plan(o, PLAZA_RIZAL);
    const tri = p.options.find((x) => x.id === "tricycle")!;
    expect(tri.tricycleTerminals).toEqual([
      expect.objectContaining({ side: "origin", code: "T14", name: "Balatas Tricycle Terminal", todas: [], source: expect.any(String) }),
    ]);
    const parsed = planResponseSchema.parse(buildPlanResponse(snap, p, lines));
    expect(parsed.plan.options.find((x) => x.id === "tricycle")!.tricycleTerminals![0]!.code).toBe("T14");
  });

  it("no terminal near either end: the field is absent", () => {
    const p = plan(anchor("C04"), anchor("C05"));
    expect(p.options.find((x) => x.id === "tricycle")!.tricycleTerminals).toBeUndefined();
  });
});
