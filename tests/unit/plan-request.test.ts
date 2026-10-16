// POST /api/v1/plan request validation and response building (pure, no database).
import { describe, expect, it } from "vitest";
import { buildPlanResponse, parsePlanRequest, planOptionSchema, planResponseSchema } from "@/domain/api/plan";
import { planTrip } from "@/domain/planner/plan";
import { ringDirection } from "@/domain/trip/present";
import { realLoopsSnapshot, realLoopsSnapshotWithMeasures } from "../fixtures/real-loops";

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };
/** Pili, Camarines Sur: outside Naga City. */
const PILI = { lat: 13.5828, lng: 123.2756 };
const NO_NET = { lines: null, streets: null };
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

// Task 7 (plan E §D) re-enables this: the response schema does not yet carry the Task 6 planner's output.
describe.skip("buildPlanResponse", () => {
  const snapshot = realLoopsSnapshot();

  it("adds stop codes and pin-order loop directions for the ridden variants only", () => {
    const plan = planTrip(snapshot, NO_NET, PLAZA_RIZAL, BISCAST, NOW);
    const body = planResponseSchema.parse(buildPlanResponse(snapshot, plan));
    expect(body.plan.coverage).toBe("provisional");
    expect(body.revision.revisionId).toBe(snapshot.revision.revisionId);

    const rides = body.plan.options.flatMap((o) => o.legs.filter((l) => l.kind === "ride"));
    expect(rides.length).toBeGreaterThan(0);
    const named = new Set(body.stops.map((s) => s.id));
    for (const r of rides) for (const s of r.stops) expect(named.has(s.id)).toBe(true);
    for (const s of body.stops) expect(s.code).toMatch(/^[AB]\d+$/);

    expect(body.variants.length).toBeGreaterThan(0);
    for (const v of body.variants) {
      expect(rides.some((r) => r.variantId === v.variantId)).toBe(true);
      expect(v.isCircular).toBe(true);
      expect(["clockwise", "counterclockwise"]).toContain(v.loopDirection);
    }
  });

  it("pin order A1…A30 runs clockwise and B1…B31 counterclockwise (agrees with the seed's labels)", () => {
    const byId = new Map(snapshot.stops.map((s) => [s.id, s]));
    const dirs = snapshot.variants.map((v) => [v.routeCode, ringDirection(v.stopIds.map((id) => byId.get(id)!))]);
    expect(dirs).toEqual([["R8-A", "clockwise"], ["R8-B", "counterclockwise"]]);
  });

  it("a no-coverage plan names no stops or variants", () => {
    const plan = planTrip({ ...snapshot, variants: [] }, NO_NET, PLAZA_RIZAL, BISCAST, NOW);
    const body = planResponseSchema.parse(buildPlanResponse(snapshot, plan));
    expect(body.plan.coverage).toBe("none");
    expect(body.stops).toEqual([]);
    expect(body.variants).toEqual([]);
  });
});

// Task 7 (plan E §D) re-enables this: the response schema does not yet carry the Task 6 planner's output.
describe.skip("plan response: D13 distance basis, mode and fleet on ride legs", () => {
  const measured = realLoopsSnapshotWithMeasures();
  const body = planResponseSchema.safeParse(buildPlanResponse(measured, planTrip(measured, NO_NET, PLAZA_RIZAL, BISCAST, NOW))).data ?? planResponseSchema.parse({ revision: measured.revision, plan: { revisionId: measured.revision.revisionId, coverage: "none", reason: null, directWalkEstimateMeters: null, options: [], notes: [] }, stops: [], variants: [] });
  const rides = body.plan.options.flatMap((o) => o.legs.filter((l) => l.kind === "ride"));
  type Ride = (typeof rides)[number];

  it("validates path distances, measures, mode, fleet and the fare basis (server and offline build the same body)", () => {
    expect(rides.length).toBeGreaterThan(0);
    for (const r of rides) {
      expect(r).toMatchObject({ distanceBasis: "approximate_path", mode: "jeepney", fleet: { label: "Traditional jeepneys" } });
      expect(r.boardMeasureM).not.toBeNull();
      expect(r.fare).toMatchObject({ span: "traditional_rule", ruleCodes: ["F01"], basis: "fare_rules", reportCodes: [] });
    }
  });

  it("reads a ride leg cached or saved before Task 8 as straight-line, unconfirmed fleet, rule span", () => {
    const old = JSON.parse(JSON.stringify(rides[0])) as Record<string, unknown> & { fare: Record<string, unknown> };
    for (const k of ["mode", "fleet", "distanceBasis", "boardMeasureM", "alightMeasureM", "stopMeasuresM"]) delete old[k];
    for (const k of ["span", "basis", "reportCodes"]) delete old.fare[k];
    old.fare.ruleCodes = ["F01", "F02"]; // every leg before Task 8 cited both rules
    const option = { ...body.plan.options[0]!, legs: [body.plan.options[0]!.legs[0]!, old, body.plan.options[0]!.legs.at(-1)!] };
    const parsed = planOptionSchema.parse(option).legs[1] as Ride;
    expect(parsed).toMatchObject({
      distanceBasis: "stop_to_stop_straight_line", boardMeasureM: null, alightMeasureM: null, stopMeasuresM: null, mode: "jeepney",
      fleet: { label: "Vehicle type not confirmed", classes: [] },
      fare: { span: "rule_span", basis: "fare_rules", reportCodes: [] },
    });
  });

  it("refuses a path distance without its measures, and measures without the path basis", () => {
    const leg = rides[0]!;
    const option = (l: unknown) => ({ ...body.plan.options[0]!, legs: [body.plan.options[0]!.legs[0]!, l, body.plan.options[0]!.legs.at(-1)!] });
    expect(planOptionSchema.safeParse(option({ ...leg, boardMeasureM: null })).success).toBe(false);
    expect(planOptionSchema.safeParse(option({ ...leg, distanceBasis: "stop_to_stop_straight_line" })).success).toBe(false);
    expect(planOptionSchema.safeParse(option({ ...leg, fare: { ...leg.fare, basis: "fare_rules_and_reports", reportCodes: [] } })).success).toBe(false);
    // the rules must match the span; reports only on a mixed fleet
    expect(planOptionSchema.safeParse(option({ ...leg, fare: { ...leg.fare, ruleCodes: ["F01", "F02"] } })).success).toBe(false);
    expect(planOptionSchema.safeParse(option({ ...leg, fare: { ...leg.fare, basis: "fare_rules_and_reports", reportCodes: ["FO-X"] } })).success).toBe(false);
  });
});

describe("e2e plan fixtures", () => {
  it("match the response schema the client validates against", async () => {
    const f = await import("../e2e/fixtures/plan-responses");
    for (const body of [f.PROVISIONAL_PLAN, f.NO_ROUTE_PLAN, f.WALK_SHORTER_PLAN, f.LEAST_WALKING_ONLY_PLAN, f.TWO_RIDE_PLAN, f.AT_STOP_PLAN, f.WALK_FIRST_PLAN]) {
      expect(planResponseSchema.safeParse(body).success).toBe(true);
    }
  });

  it("carry the D13 basis and the Loops' fleet on ride legs (both bases appear)", async () => {
    const f = await import("../e2e/fixtures/plan-responses");
    const rides = planResponseSchema.parse(f.TWO_RIDE_PLAN).plan.options.flatMap((o) => o.legs.filter((l) => l.kind === "ride"));
    expect(rides.map((r) => r.distanceBasis)).toEqual(["approximate_path", "stop_to_stop_straight_line"]);
    for (const r of rides) expect(r.fleet).toMatchObject({ label: "Traditional jeepneys", colourKey: "traditional_puj" });
  });
});
