// Far areas in the planner (Increment F, T3): zone membership, no point-to-point tricycle at a far end,
// the special-trip exception near a tricycle terminal serving the zone, ruling (e) and the 1,500 m
// far-end walk cap. Real committed Lines, snapshot and street graph (10:00 Manila).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import { RULE_EVIDENCE } from "@/domain/import/modes-seed";
import { FAR_AREAS, FAR_EVIDENCE, zoneOf } from "@/domain/planner/far-areas";
import { FAR_END_WALK_CAP_M, planTrip, SPECIAL_TRIP_TERMINAL_WALK_M, type PlanOption, type TripPlan } from "@/domain/planner/plan";
import { buildPlanResponse, planResponseSchema } from "@/domain/api/plan";
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

const recommended = (p: TripPlan) => p.options.filter((o) => o.labels.includes("Recommended"));
const rideCodes = (o: PlanOption) => o.legs.flatMap((l) => (l.kind === "ride" ? [l.routeCode] : []));
const tricycle = (p: TripPlan) => p.options.find((o) => o.mode === "tricycle");
const farNote = (zone: string, dir = "to") => `Local report: tricycles ${dir} ${zone} charge special-trip fares, so none is suggested.`;

describe("far areas: zone membership and the far note", () => {
  it("far-areas evidence levels equal the modes seed's", () => {
    expect(FAR_EVIDENCE).toEqual(RULE_EVIDENCE);
  });

  it("the far note is 16 words or fewer for every zone", () => {
    for (const z of FAR_AREAS.farZones) {
      expect(farNote(z.name).split(/\s+/).length).toBeLessThanOrEqual(16);
      // 14 words for one- and three-word zones; "Cararayan and San Isidro" makes it 15 (the plan's limit is 16).
      expect(farNote(z.name, "from").split(/\s+/).length).toBeLessThanOrEqual(16);
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

  it("8 Pacol → a point in Pacol 900 m away: no tricycle; a jeepney Recommended, else an unlabelled walk card", () => {
    const to = near(PACOL, 0, -900);
    expect(zoneOf(to, FAR_AREAS)).toBe("FZ02");
    const p = plan(PACOL, to);
    expect(tricycle(p)).toBeUndefined();
    expect(p.farNote).toBe(farNote("Pacol"));
    if (p.options.some((o) => o.mode === "jeepney")) expect(recommended(p)[0]!.mode).toBe("jeepney");
    else {
      expect(recommended(p)).toHaveLength(0);
      expect(p.options[0]).toMatchObject({ mode: "walk", labels: [] });
    }
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
        expect(recommended(p)).toHaveLength(far && !jeep ? 0 : 1);
        if (far && jeep) expect(recommended(p)[0]!.mode).toBe("jeepney");
        expect(p.farNote !== undefined).toBe(far);
        const t = tricycle(p);
        if (far && t) {
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
