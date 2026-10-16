// A ride on a route without marked stops (R1-R7: `stops: []`, free board/alight points) must work at every
// place that used to read stops[0] / stops[length - 1] (review I1). Built from a real planned R1 ride.
import { describe, expect, it } from "vitest";
import { buildPlanResponse, planResponseSchema, type PlanOptionDto, type PlanResponse, type RideLegDto } from "@/domain/api/plan";
import { currentStep, reduceSession, startSession } from "@/domain/guidance/session";
import { guidanceSteps, type GuidanceTrip } from "@/domain/guidance/steps";
import { guidanceView } from "@/domain/guidance/view";
import { planTrip } from "@/domain/planner/plan";
import { resolveReopen, revalidateSavedTrip, shareText, buildSavedTrip } from "@/domain/saved/saved";
import { rideEnds } from "@/domain/trip/ride-ends";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const snapshot = realLinesSnapshot();
const lines = realLines();
const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const SAN_ISIDRO = { lat: 13.6323904, lng: 123.2695351 };
const NOW = new Date("2026-10-17T02:00:00Z");
const data = planResponseSchema.parse(buildPlanResponse(snapshot, planTrip(snapshot, { lines, streets: realStreets() }, PLAZA_RIZAL, SAN_ISIDRO, { now: NOW }), lines)) as unknown as PlanResponse;
const option = data.plan.options.find((o) => o.legs.some((l) => l.kind === "ride" && l.routeCode === "R1"))!;
const ride = option.legs.find((l): l is RideLegDto => l.kind === "ride")!;
const trip: GuidanceTrip = { option, stops: data.stops, variants: data.variants, destinationLabel: "San Isidro" };

describe("a real R1 ride has no pins", () => {
  it("fixture: stops empty, free points present, never a fake stop name", () => {
    expect(ride.stops).toEqual([]);
    expect(ride.board).not.toBeNull();
    const ends = rideEnds(ride)!;
    expect(ends.pinned).toBe(false);
    expect(ends.stops).toHaveLength(2);
    for (const e of [ends.board, ends.alight]) expect(e.name === ride.board!.name || e.name === `your stop along ${ride.routeCode}` || e.name === ride.alight!.name).toBe(true);
  });

  it("guidance steps use the two free points, with path measures and no index of -1", () => {
    const rideStep = guidanceSteps(trip).find((s) => s.kind === "ride")!;
    if (rideStep.kind !== "ride") throw new Error("no ride step");
    expect(rideStep.pinned).toBe(false);
    expect(rideStep.stops).toHaveLength(2);
    expect(rideStep.stopsToRide).toBe(1);
    expect(rideStep.stopMeasuresM).toEqual([ride.boardMeasureM, ride.boardMeasureM! + ride.distanceMeters]);
  });

  it("a guidance session walks through the ride and its view says the route has no marked stops", () => {
    const s = reduceSession(startSession(trip, 1), { type: "boarded" });
    expect(currentStep(s).kind).toBe("ride");
    const view = guidanceView(s, null, 1);
    expect(view.screen).toBe("ride");
    if (view.screen !== "ride") return;
    expect(view.countText).toMatch(/approximate path/);
    expect(view.countNote).toMatch(/no marked stops/);
    expect(view.stops).toHaveLength(2);
  });

  it("share text names the board and alight points", () => {
    const text = shareText({ start: { label: "Plaza Rizal", point: PLAZA_RIZAL }, destination: { label: "San Isidro", point: SAN_ISIDRO }, option, stops: data.stops, variants: data.variants, revisionLabel: "x" });
    expect(text).toMatch(/Board R1 at /);
    expect(text).toMatch(/Ride along the approximate path, get off at /);
    expect(text).not.toMatch(/Ride 0 stops|undefined/);
  });

  it("saved trips: sameRides compares variant and board/alight, not an empty stop list", () => {
    const card = buildSavedTrip({ id: "c1", savedAt: NOW.toISOString(), data, option, start: { label: "a", point: PLAZA_RIZAL }, destination: { label: "b", point: SAN_ISIDRO } });
    const shifted = (m: number): PlanOptionDto => ({ ...option, legs: option.legs.map((l) => (l.kind === "ride" ? { ...l, boardMeasureM: l.boardMeasureM! + m, alightMeasureM: l.alightMeasureM! + m } : l)) });
    const live = (o: PlanOptionDto, rev: string): PlanResponse => ({ ...data, plan: { ...data.plan, revisionId: rev, options: [o] } });
    const newRev = "11111111-1111-4111-8111-111111111111";
    expect(resolveReopen(card, live(shifted(20), newRev))).toEqual({ kind: "replanned", optionId: option.id });
    expect(resolveReopen(card, live(shifted(300), newRev))).toEqual({ kind: "changed" });
    expect(revalidateSavedTrip(card, { ...snapshot, revision: { ...snapshot.revision, revisionId: newRev } })).toBe("unchanged_in_new_revision");
  });
});
