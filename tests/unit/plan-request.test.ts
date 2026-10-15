// POST /api/v1/plan request validation and response building (pure, no database).
import { describe, expect, it } from "vitest";
import { buildPlanResponse, parsePlanRequest, planResponseSchema } from "@/domain/api/plan";
import { planTrip } from "@/domain/planner/plan";
import { ringDirection } from "@/domain/trip/present";
import { realLoopsSnapshot } from "../fixtures/real-loops";

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const BISCAST = { lat: 13.6314651, lng: 123.1927517 };
/** Pili, Camarines Sur: outside Naga City. */
const PILI = { lat: 13.5828, lng: 123.2756 };

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
  const snapshot = realLoopsSnapshot();

  it("adds stop codes and pin-order loop directions for the ridden variants only", () => {
    const plan = planTrip(snapshot, PLAZA_RIZAL, BISCAST);
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
    const plan = planTrip({ ...snapshot, variants: [] }, PLAZA_RIZAL, BISCAST);
    const body = planResponseSchema.parse(buildPlanResponse(snapshot, plan));
    expect(body.plan.coverage).toBe("none");
    expect(body.stops).toEqual([]);
    expect(body.variants).toEqual([]);
  });
});

describe("e2e plan fixtures", () => {
  it("match the response schema the client validates against", async () => {
    const f = await import("../e2e/fixtures/plan-responses");
    for (const body of [f.PROVISIONAL_PLAN, f.NO_ROUTE_PLAN, f.WALK_SHORTER_PLAN, f.LEAST_WALKING_ONLY_PLAN]) {
      expect(planResponseSchema.safeParse(body).success).toBe(true);
    }
  });
});

describe("shouldReplan (GPS refinements)", async () => {
  const { shouldReplan, REPLAN_MIN_MOVE_M } = await import("@/client/trip/use-trip-plan");
  const pair = { origin: PLAZA_RIZAL, destination: BISCAST };
  // ~0.0001° latitude ≈ 11 m; 0.0003° ≈ 33 m.
  const moved = (dLat: number) => ({ origin: { lat: PLAZA_RIZAL.lat + dLat, lng: PLAZA_RIZAL.lng }, destination: BISCAST });
  it("plans the first pair", () => expect(shouldReplan(null, pair)).toBe(true));
  it(`keeps the plan for a move under ${REPLAN_MIN_MOVE_M} m`, () => expect(shouldReplan(pair, moved(0.0001))).toBe(false));
  it("replans for a larger move or a swap", () => {
    expect(shouldReplan(pair, moved(0.0003))).toBe(true);
    expect(shouldReplan(pair, { origin: BISCAST, destination: PLAZA_RIZAL })).toBe(true);
  });
});
