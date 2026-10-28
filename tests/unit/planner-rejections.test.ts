// AC-5: the planner rejects wrong-direction, prohibited, disconnected and unavailable boarding.
// One fixture per rejection reason, through the real entry points (planTrip, rideMeters, routeStreet).
// Synthetic world: Line Q runs EAST only, n = 0, e = 2000 → 4000; Roxas Avenue (n = 0) is tricycle-restricted
// 05:00–21:00; the spur pocket at (3200, −200) is reachable only over Roxas.
import { describe, expect, it } from "vitest";
import { rideMeters, pathVariant } from "@/domain/planner/paths";
import type { PlanningLine } from "@/domain/planner/paths";
import { planTrip, type PlanOption, type PlannerNetwork, type TricycleLeg } from "@/domain/planner/plan";
import { routeStreet } from "@/domain/walk/walk-graph";
import { at } from "../fixtures/synthetic/planner-network";
import { manila, streetSnapshot, syntheticLines, syntheticStreets } from "../fixtures/synthetic/planner-streets";

const snap = streetSnapshot();
const streets = syntheticStreets();
const lines = syntheticLines();
const NET: PlannerNetwork = { lines, streets };
const plan = (o: ReturnType<typeof at>, d: ReturnType<typeof at>, net: PlannerNetwork = NET, now = manila(10)) => planTrip(snap, net, o, d, { now });
const jeepneys = (p: ReturnType<typeof plan>): PlanOption[] => p.options.filter((o) => o.mode === "jeepney");

describe("AC-5 rejection: wrong direction", () => {
  const Q = lines.lines[0]!;

  it("riding against the line's direction is not a ride (rideMeters is null), along it is", () => {
    const v = pathVariant(Q);
    expect(rideMeters(v, 100, 1500)).toBe(1400);
    expect(rideMeters(v, 1500, 100)).toBeNull();
  });

  it("planTrip offers the east-bound trip but no jeepney for the same trip reversed", () => {
    const west = at(2100, 10);
    const east = at(3900, 10);
    expect(jeepneys(plan(west, east)).length).toBeGreaterThan(0);
    const back = plan(east, west);
    expect(jeepneys(back)).toEqual([]);
    expect(back.jeepneyReason).not.toBeNull();
    expect(back.options.some((o) => o.mode === "tricycle")).toBe(true); // the rest of the plan is unaffected
  });
});

describe("AC-5 rejection: prohibited (restricted road, mode not allowed)", () => {
  const pocket = at(3200, -200);
  const away = at(600, 300);

  it("a tricycle never uses a restricted road in the restricted hours: no drawn path, no straight line: the tricycle is 'restricted'", () => {
    const route = routeStreet(streets, pocket, away, { mode: "tricycle", now: manila(10) });
    expect(route).toMatchObject({ kind: "straight", reason: "no_path" });
    const leg = plan(pocket, away).options.find((o) => o.mode === "tricycle")!.legs[0] as TricycleLeg;
    expect(leg).toMatchObject({ basis: "restricted", path: null, distanceMeters: null });
    expect(leg.notes[0]).toMatch(/^No tricycle route right now: restricted roads .* allowed 9 pm–5 am$/);
  });

  it("the same trip is routed once the restriction is lifted (21:00-05:00)", () => {
    expect(routeStreet(streets, pocket, away, { mode: "tricycle", now: manila(22) })).toMatchObject({ kind: "path" });
  });

  it("a mode that is not a permanent jeepney is not planned as a jeepney ride", () => {
    const tricycleLine: PlanningLine = { ...lines.lines[0]!, mode: "tricycle" };
    const p = plan(at(2100, 10), at(3900, 10), { lines: { lines: [tricycleLine] }, streets });
    expect(jeepneys(p)).toEqual([]);
  });
});

describe("AC-5 rejection: disconnected", () => {
  it("no line within reach of the origin or the destination: no jeepney, with the reason", () => {
    expect(plan(at(0, 300), at(800, 300)).jeepneyReason).toBe("no_path_near_origin");
    expect(plan(at(2400, 10), at(0, 300)).jeepneyReason).toBe("no_path_near_destination");
  });

  it("a point too far from any street is not connected: straight line, never a drawn path", () => {
    expect(routeStreet(streets, at(0, 2000), at(600, 300), { mode: "walk", now: manila(10) })).toMatchObject({ kind: "straight", reason: "no_edge_near_start" });
    expect(routeStreet(streets, at(600, 300), at(0, 2000), { mode: "walk", now: manila(10) })).toMatchObject({ kind: "straight", reason: "no_edge_near_end" });
  });
});

describe("AC-5 rejection: unavailable (not in service)", () => {
  const trip = [at(2100, 10), at(3900, 10)] as const;

  it("an untraced path is not in the network", () => {
    const off = { lines: lines.lines.map((l) => ({ ...l, status: "untraced" as never })) };
    expect(jeepneys(plan(...trip, { lines: off, streets }))).toEqual([]);
  });

  it("a non-permanent (temporary) variant is not offered", () => {
    const temporary = { lines: lines.lines.map((l) => ({ ...l, kind: "temporary" as never })) };
    expect(jeepneys(plan(...trip, { lines: temporary, streets }))).toEqual([]);
  });

  it("no Lines at all: no jeepney options, the tricycle is still offered", () => {
    const p = plan(...trip, { lines: null, streets });
    expect(jeepneys(p)).toEqual([]);
    expect(p.options.some((o) => o.mode === "tricycle")).toBe(true);
  });

  it("control: the same trip with the line in service is offered", () => {
    expect(jeepneys(plan(...trip)).length).toBeGreaterThan(0);
  });
});
