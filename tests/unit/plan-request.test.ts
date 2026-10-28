// POST /api/v1/plan request validation and response building (pure, no database).
import { describe, expect, it } from "vitest";
import { buildPlanResponse, parsePlanRequest, planOptionSchema, planResponseSchema, type TricycleLegDto } from "@/domain/api/plan";
import { encodePolyline } from "@/domain/geo/polyline";
import { isCircuitLine } from "@/domain/planner/paths";
import { planTrip } from "@/domain/planner/plan";
import { ringDirection } from "@/domain/trip/present";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };
/** Pili, Camarines Sur: outside Naga City. */
const PILI = { lat: 13.5828, lng: 123.2756 };
const lines = realLines();
const NET = { lines, streets: realStreets() };
const NOW = { now: new Date("2026-10-17T02:00:00Z") };

describe("parsePlanRequest", () => {
  it("accepts two points inside Naga", () => {
    expect(parsePlanRequest({ origin: PLAZA_RIZAL, destination: BISCAST })).toEqual({
      ok: true,
      value: { origin: PLAZA_RIZAL, destination: BISCAST },
    });
  });

  it.each([
    ["no body", undefined],
    ["null", null],
    ["an array", [PLAZA_RIZAL, BISCAST]],
    ["a missing destination", { origin: PLAZA_RIZAL }],
    ["string numbers", { origin: { lat: "13.62", lng: "123.18" }, destination: BISCAST }],
    ["extra keys", { origin: PLAZA_RIZAL, destination: BISCAST, debug: true }],
    ["extra point keys", { origin: { ...PLAZA_RIZAL, accuracy: 5 }, destination: BISCAST }],
    ["latitude out of range", { origin: { lat: 91, lng: 123.18 }, destination: BISCAST }],
    ["infinity", { origin: { lat: Infinity, lng: 123.18 }, destination: BISCAST }],
    ["NaN", { origin: PLAZA_RIZAL, destination: { lat: NaN, lng: 123.19 } }],
  ])("rejects %s", (_name, body) => {
    const r = parsePlanRequest(body);
    expect(r.ok).toBe(false);
  });

  it("rejects points outside Naga without echoing them", () => {
    const origin = parsePlanRequest({ origin: PILI, destination: BISCAST });
    const destination = parsePlanRequest({ origin: PLAZA_RIZAL, destination: PILI });
    expect(origin).toEqual({ ok: false, message: "origin must be inside Naga City." });
    expect(destination).toEqual({ ok: false, message: "destination must be inside Naga City." });
    for (const r of [origin, destination]) if (!r.ok) expect(r.message).not.toMatch(/\d/);
  });
});

describe("buildPlanResponse", () => {
  const snapshot = realLinesSnapshot();
  const plan = planTrip(snapshot, NET, PLAZA_RIZAL, BISCAST, NOW);
  const body = planResponseSchema.parse(buildPlanResponse(snapshot, plan, lines));
  const rides = body.plan.options.flatMap((o) => o.legs.filter((l) => l.kind === "ride"));

  it("names the pins passed and the ridden variants (from the Lines), with loop directions from the pin order", () => {
    expect(body.plan.coverage).toBe("provisional");
    expect(body.revision.revisionId).toBe(snapshot.revision.revisionId);
    expect(rides.length).toBeGreaterThan(0);
    const named = new Set(body.stops.map((s) => s.id));
    for (const r of rides) {
      for (const s of r.stops) expect(named.has(s.id)).toBe(true);
      for (const id of [r.board?.stopId, r.alight?.stopId]) if (id) expect(named.has(id)).toBe(true);
    }
    for (const s of body.stops) expect(s.code).toMatch(/^[AB]\d+$/);
    const ridden = new Set(rides.map((r) => r.variantId));
    expect(body.variants.map((v) => v.variantId).sort()).toEqual([...ridden].sort());
    for (const v of body.variants) {
      const line = lines.lines.find((l) => l.variantId === v.variantId)!;
      expect(v.routeCode).toBe(line.routeCode);
      expect(v.routeName).toBe(line.routeName);
      expect(v.isCircular).toBe(isCircuitLine(line));
      if (!v.isCircular || !snapshot.variants.some((x) => x.variantId === v.variantId)) expect(v.loopDirection).toBeNull();
      else expect(["clockwise", "counterclockwise"]).toContain(v.loopDirection);
    }
  });

  it("pin order A1…A30 runs clockwise and B1…B31 counterclockwise (agrees with the seed labels)", () => {
    const byId = new Map(snapshot.stops.map((s) => [s.id, s]));
    const dirs = snapshot.variants.map((v) => [v.routeCode, ringDirection(v.stopIds.map((id) => byId.get(id)!))]);
    expect(dirs).toEqual([["R8-A", "clockwise"], ["R8-B", "counterclockwise"]]);
  });

  it("a no-coverage plan names no stops or variants", () => {
    const none = planTrip(snapshot, NET, PLAZA_RIZAL, PILI, NOW);
    const out = planResponseSchema.parse(buildPlanResponse(snapshot, none, lines));
    expect(out.plan.coverage).toBe("none");
    expect(out.stops).toEqual([]);
    expect(out.variants).toEqual([]);
  });

  it("carries tricycle legs, option modes, free points and the planner output unchanged", () => {
    const modes = new Set(body.plan.options.map((o) => o.mode));
    expect(modes.has("jeepney")).toBe(true);
    expect(modes.has("tricycle")).toBe(true);
    const tri = body.plan.options.find((o) => o.mode === "tricycle")!.legs[0]!;
    expect(tri).toMatchObject({ kind: "tricycle", fare: { minCentavos: 1500, maxCentavos: null, status: "minimum", ruleCodes: ["F03"], discountsApplied: false } });
    for (const r of rides) {
      expect(r.board).not.toBeNull();
      expect(r.board!.measureM).toBe(r.boardMeasureM);
      expect(r.alight!.measureM).toBe(r.alightMeasureM);
      expect(r.distanceBasis).toBe("approximate_path");
    }
    expect(body.plan.options).toMatchObject(JSON.parse(JSON.stringify(plan.options)));
    expect(body.plan.jeepneyReason).toBe(plan.jeepneyReason);
  });

  it("every plan made on a sample of trips, by day and by night, parses (shape, refinements, caps)", () => {
    const pts = [PLAZA_RIZAL, BISCAST, { lat: 13.6055, lng: 123.2109 }, { lat: 13.6385, lng: 123.2022 }, { lat: 13.6261, lng: 123.1987 }];
    for (const o of pts) {
      for (const d of pts) {
        if (o === d) continue;
        for (const now of [NOW.now, new Date("2026-10-17T14:30:00Z")]) {
          const p = planTrip(snapshot, NET, o, d, { now });
          expect(planResponseSchema.safeParse(buildPlanResponse(snapshot, p, lines)).success).toBe(true);
        }
      }
    }
  });
});

describe("plan response: D13 distance basis, mode and fleet on ride legs", () => {
  const measured = realLinesSnapshot();
  const body = planResponseSchema.parse(buildPlanResponse(measured, planTrip(measured, NET, PLAZA_RIZAL, BISCAST, NOW), lines));
  const rides = body.plan.options.flatMap((o) => o.legs.filter((l) => l.kind === "ride"));
  type Ride = (typeof rides)[number];
  const jeepney = body.plan.options.find((o) => o.mode === "jeepney")!;
  const wrap = (l: unknown) => ({ ...jeepney, legs: [l] });

  it("validates path distances, measures, mode, fleet and the fare basis (server and offline build the same body)", () => {
    expect(rides.length).toBeGreaterThan(0);
    for (const r of rides) {
      expect(r).toMatchObject({ distanceBasis: "approximate_path", mode: "jeepney" });
      expect(r.boardMeasureM).not.toBeNull();
      expect(r.fare.basis).toBe("fare_rules");
    }
  });

  it("reads a ride leg cached or saved before Increment E as straight-line, unconfirmed fleet, no free points", () => {
    const old = JSON.parse(JSON.stringify(rides[0])) as Record<string, unknown> & { fare: Record<string, unknown> };
    for (const k of ["mode", "fleet", "distanceBasis", "boardMeasureM", "alightMeasureM", "stopMeasuresM", "board", "alight", "notes"]) delete old[k];
    for (const k of ["span", "basis", "reportCodes"]) delete old.fare[k];
    old.fare.ruleCodes = ["F01", "F02"]; // every leg before Task 8 cited both rules
    const parsed = planOptionSchema.parse(wrap(old)).legs[0] as Ride;
    expect(parsed).toMatchObject({
      distanceBasis: "stop_to_stop_straight_line", boardMeasureM: null, alightMeasureM: null, stopMeasuresM: null, mode: "jeepney",
      board: null, alight: null, notes: [],
      fleet: { label: "Vehicle type not confirmed", classes: [] },
      fare: { span: "rule_span", basis: "fare_rules", reportCodes: [] },
    });
  });

  it("refuses a path distance without its measures, and measures without the path basis", () => {
    const leg = rides[0]!;
    expect(planOptionSchema.safeParse(wrap({ ...leg, boardMeasureM: null })).success).toBe(false);
    expect(planOptionSchema.safeParse(wrap({ ...leg, distanceBasis: "stop_to_stop_straight_line" })).success).toBe(false);
    expect(planOptionSchema.safeParse(wrap({ ...leg, fare: { ...leg.fare, basis: "fare_rules_and_reports", reportCodes: [] } })).success).toBe(false);
    // the rules must match the span; reports only on a mixed fleet
    expect(planOptionSchema.safeParse(wrap({ ...leg, fare: { ...leg.fare, ruleCodes: ["F01", "F02"] } })).success).toBe(false);
    expect(planOptionSchema.safeParse(wrap({ ...leg, fare: { ...leg.fare, basis: "fare_rules_and_reports", reportCodes: ["FO-X"] } })).success).toBe(false);
    // the free points repeat the measures
    expect(planOptionSchema.safeParse(wrap({ ...leg, board: { ...leg.board, measureM: leg.board!.measureM + 5 } })).success).toBe(false);
  });
});

describe("plan response: Increment E compatibility and refinements", () => {
  const snapshot = realLinesSnapshot();
  const parsed = planResponseSchema.parse(buildPlanResponse(snapshot, planTrip(snapshot, NET, PLAZA_RIZAL, BISCAST, NOW), lines));
  const tricycle = parsed.plan.options.find((o) => o.mode === "tricycle")!;
  const triLeg = tricycle.legs[0]! as TricycleLegDto;
  const walkOpt = planOptionSchema.parse({
    ...tricycle,
    id: "walk",
    mode: "walk",
    legs: [{ kind: "walk", from: triLeg.from, to: triLeg.to, distanceMeters: 100, estimateMeters: 130, pathVerified: false }],
  });

  it("a format-1 body (no mode, jeepneyReason, free points or walk paths) still parses, mode read from the legs", () => {
    const old = JSON.parse(JSON.stringify({ ...parsed, plan: { ...parsed.plan, options: [walkOpt] } })) as { plan: Record<string, unknown> & { options: Record<string, unknown>[] } };
    delete old.plan.jeepneyReason;
    delete old.plan.options[0]!.mode;
    const again = planResponseSchema.parse(old);
    expect(again.plan.jeepneyReason).toBeNull();
    expect(again.plan.options[0]).toMatchObject({ mode: "walk", legs: [{ kind: "walk", path: null, basis: "straight_x1_3" }] });
  });

  it("refuses a mode the legs do not travel, seven options, and inconsistent street legs", () => {
    expect(planOptionSchema.safeParse({ ...tricycle, mode: "padyak" }).success).toBe(false);
    const seven = { ...parsed, plan: { ...parsed.plan, options: Array.from({ length: 7 }, () => tricycle) } };
    expect(planResponseSchema.safeParse(seven).success).toBe(false);
    const leg = triLeg as unknown as { path: string | null; basis: string; distanceMeters: number | null; fare: Record<string, unknown> };
    const bad = (l: unknown) => planOptionSchema.safeParse({ ...tricycle, legs: [l] }).success;
    const walk = { ...walkOpt.legs[0]!, path: encodePolyline([{ lat: 13.62, lng: 123.18 }, { lat: 13.621, lng: 123.181 }]), basis: "straight_x1_3" };
    expect(planOptionSchema.safeParse({ ...walkOpt, legs: [walk] }).success).toBe(false);
    expect(planOptionSchema.safeParse({ ...walkOpt, legs: [{ ...walk, basis: "street_graph" }] }).success).toBe(true);
    expect(bad({ ...leg, basis: "street_graph", path: null })).toBe(false);
    expect(bad({ ...leg, basis: "straight_line", path: "abc" })).toBe(false);
    expect(bad({ ...leg, basis: "unavailable", path: null, distanceMeters: 100 })).toBe(false);
    expect(bad({ ...leg, fare: { ...leg.fare, maxCentavos: 2000 } })).toBe(false);
    expect(bad({ ...leg, fare: { ...leg.fare, status: "unavailable" } })).toBe(false);
  });

  it("a padyak leg parses with its flat fare, and refuses a mismatched one", () => {
    const padyak = {
      kind: "padyak", from: triLeg.from, to: triLeg.to, distanceMeters: 900, path: null, basis: "straight_line",
      notes: [], ruleCodes: ["F04"],
      fare: { minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger", discountedCentavos: 800, ruleCodes: ["F04"] },
    };
    const option = { ...tricycle, id: "padyak:PA05", mode: "padyak", legs: [padyak] };
    expect(planOptionSchema.safeParse(option).success).toBe(true);
    expect(planOptionSchema.safeParse({ ...option, legs: [{ ...padyak, fare: { ...padyak.fare, maxCentavos: 1200 } }] }).success).toBe(false);
  });
});
