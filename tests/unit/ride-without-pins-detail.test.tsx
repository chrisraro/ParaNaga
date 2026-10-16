// @vitest-environment jsdom
// Trip detail for a ride on a route without marked stops (R1-R7): steps read from the free board/alight points.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildPlanResponse, planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import { linesSchema, networkSnapshotSchema } from "@/domain/api/schemas";
import { planTrip } from "@/domain/planner/plan";
import { enrichPlan } from "@/domain/trip/enrich";
import { highlightsFor } from "@/ui/home/home-screen";
import { TripDetail } from "@/ui/trip/trip-detail";
import linesJson from "../e2e/fixtures/network/lines.json";
import snapshotJson from "../e2e/fixtures/network/snapshot.json";

afterEach(cleanup);

const snapshot = networkSnapshotSchema.parse(snapshotJson);
const lines = linesSchema.parse(linesJson);

const plan = planTrip(snapshot, { lines, streets: null }, { lat: 13.6233869, lng: 123.1846726 }, { lat: 13.6323904, lng: 123.2695351 }, { now: new Date("2026-10-17T02:00:00Z") });
const data = planResponseSchema.parse(buildPlanResponse(snapshot, plan, lines)) as unknown as PlanResponse;
const option = data.plan.options.find((o) => o.legs.some((l) => l.kind === "ride" && l.routeCode === "R1"))!;

describe("a ride without pins (R1)", () => {
  it("highlightsFor marks the free board and alight points", () => {
    const ride = option.legs.find((l) => l.kind === "ride")!;
    expect(ride.kind === "ride" && ride.stops).toEqual([]);
    const marks = highlightsFor(data, option.id);
    expect(marks.map((m) => m.role)).toEqual(["board", "alight"]);
    if (ride.kind === "ride") expect(marks[0]).toMatchObject({ lat: ride.board!.lat, lng: ride.board!.lng });
  });

  it("trip detail shows the boarding and getting-off steps with no stop count", () => {
    const enriched = enrichPlan(data, null, { walkGraphStatus: "skipped" });
    render(<TripDetail data={enriched} option={enriched.plan.options.find((o) => o.id === option.id)!} onBack={() => undefined} />);
    expect(screen.getByText(/^Board R1/)).toBeTruthy();
    expect(screen.getByText(/Get off at/)).toBeTruthy();
    expect(screen.getByText(/Ride along the approximate path/)).toBeTruthy();
  });
});
