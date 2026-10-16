import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { guidanceSteps } from "@/domain/guidance/steps";
import { BASE, DEST, LOOP_A, LOOP_B, oneRide, pathRide, streetOnly, tripOf, twoRides, walkOnly } from "./guidance-fixtures";

describe("guidanceSteps", () => {
  it("a walk-only option is one walk_to_destination step", () => {
    const steps = guidanceSteps(tripOf(walkOnly()));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "walk_to_destination", index: 0, from: null, estimateMeters: 390, distanceMeters: 300, negligible: false });
    expect(steps[0]!.kind === "walk_to_destination" && steps[0]!.target).toEqual({ name: "SM City Naga", lat: DEST.lat, lng: DEST.lng });
  });

  it("one ride: walk to board, ride, walk to destination", () => {
    const steps = guidanceSteps(tripOf(oneRide()));
    expect(steps.map((s) => s.kind)).toEqual(["walk_to_board", "ride", "walk_to_destination"]);
    const walk = steps[0]!;
    const ride = steps[1]!;
    const last = steps[2]!;
    expect(walk).toMatchObject({ kind: "walk_to_board", negligible: false, estimateMeters: 143, distanceMeters: 110 });
    // The stop's code comes from the plan's stop list.
    expect(walk!.kind === "walk_to_board" && walk!.target.label).toBe("Plaza Rizal (A1)");
    expect(walk!.kind === "walk_to_board" && walk!.nextRide).toEqual({
      variantId: expect.any(String),
      routeCode: "R01",
      routeName: "Centro–Magsaysay Loop A",
      routeChip: "Loop A",
      loopDirection: "clockwise",
    });
    if (ride.kind !== "ride") throw new Error("ride");
    expect(ride.stops.map((s) => s.name)).toEqual(LOOP_A.map((p) => p.name));
    expect(ride.board.name).toBe("Plaza Rizal");
    expect(ride.alight.name).toBe("Naga Cathedral");
    expect(ride.stopsToRide).toBe(5);
    expect(last).toMatchObject({ kind: "walk_to_destination", negligible: false });
    expect(last!.kind === "walk_to_destination" && last!.from?.name).toBe("Naga Cathedral");
  });

  it("two rides: the walk between them is a transfer from the alighting stop to the next boarding stop", () => {
    const steps = guidanceSteps(tripOf(twoRides()));
    expect(steps.map((s) => s.kind)).toEqual(["walk_to_board", "ride", "transfer", "ride", "walk_to_destination"]);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    const transfer = steps[2]!;
    if (transfer.kind !== "transfer") throw new Error("transfer");
    expect(transfer.from.name).toBe("Naga Cathedral");
    expect(transfer.target.name).toBe("Del Rosario");
    expect(transfer.estimateMeters).toBe(59);
    expect(transfer.nextRide.routeChip).toBe("Loop B");
    // No loop direction known for this variant.
    expect(transfer.nextRide.loopDirection).toBeNull();
    const second = steps[3]!;
    expect(second.kind === "ride" && second.stops.map((s) => s.name)).toEqual(LOOP_B.map((p) => p.name));
  });

  it("walks under 15 m (estimate) are flagged negligible: 'Start at {stop}', never 'Walk ≈ 0 m'", () => {
    const steps = guidanceSteps(tripOf(oneRide(5)));
    expect(steps[0]).toMatchObject({ kind: "walk_to_board", negligible: true });
    const near = guidanceSteps(tripOf(twoRides(10)));
    expect(near[2]).toMatchObject({ kind: "transfer", negligible: true });
    expect(guidanceSteps(tripOf(twoRides(12)))[2]).toMatchObject({ negligible: false });
  });

  it("names the destination 'your destination' when no label is given; an unnamed pin keeps its code wording", () => {
    const steps = guidanceSteps(tripOf(walkOnly(), null));
    expect(steps[0]!.kind === "walk_to_destination" && steps[0]!.target.name).toBe("your destination");
    const trip = tripOf(oneRide());
    const unnamed = { ...trip, stops: [{ id: LOOP_A[0]!.id, name: "B18", code: "B18" }] };
    const opt = structuredClone(trip.option);
    const first = opt.legs[0]!;
    if (first.kind === "walk") first.to.name = "B18";
    const r = opt.legs[1]!;
    if (r.kind === "ride") r.stops[0]!.name = "B18";
    const s = guidanceSteps({ ...unnamed, option: opt });
    expect(s[0]!.kind === "walk_to_board" && s[0]!.target.label).toBe("Unnamed pin B18");
  });

  it("tolerates a ride with no walk before it or after it (0 m, negligible steps)", () => {
    const opt = oneRide();
    const rideOnly = { ...opt, legs: [opt.legs[1]!] };
    const steps = guidanceSteps(tripOf(rideOnly));
    expect(steps.map((s) => s.kind)).toEqual(["walk_to_board", "ride", "walk_to_destination"]);
    expect(steps[0]).toMatchObject({ negligible: true, estimateMeters: 0 });
    expect(steps[2]).toMatchObject({ negligible: true, estimateMeters: 0 });
  });
});

describe("guidanceSteps: tricycle, padyak and free points (Increment E)", () => {
  it("a tricycle-only option is one street_ride step with the honest copy, and never throws", () => {
    const steps = guidanceSteps(tripOf(streetOnly("tricycle", 1500)));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "street_ride", index: 0, legIndex: 0, mode: "tricycle", distanceMeters: 1500,
      text: "Take a tricycle to SM City Naga · about 1.5 km along streets · minimum fare ₱15 · confirm with the driver",
      target: { name: "SM City Naga", lat: DEST.lat, lng: DEST.lng },
    });
  });

  it("a padyak option says ₱10 per passenger; an unrouted leg says so instead of a distance", () => {
    const [p] = guidanceSteps(tripOf(streetOnly("padyak", 900)));
    expect(p).toMatchObject({ kind: "street_ride", mode: "padyak", text: "Take a padyak to SM City Naga · about 0.9 km along streets · ₱10 per passenger · confirm with the driver" });
    const [u] = guidanceSteps(tripOf(streetOnly("tricycle", null, "unavailable"), null));
    expect(u).toMatchObject({ text: "Take a tricycle to your destination · street route not available · minimum fare ₱15 · confirm with the driver" });
    const [s] = guidanceSteps(tripOf(streetOnly("tricycle", 1234, "straight_line")));
    expect(s).toMatchObject({ text: "Take a tricycle to SM City Naga · about 1.2 km in a straight line, route not confirmed · minimum fare ₱15 · confirm with the driver" });
  });

  it("property: any street option builds exactly one step, never throws", () => {
    fc.assert(
      fc.property(fc.constantFrom("tricycle" as const, "padyak" as const), fc.option(fc.integer({ min: 0, max: 20_000 }), { nil: null }), (kind, m) => {
        const steps = guidanceSteps(tripOf(streetOnly(kind, m, m === null ? "unavailable" : "street_graph")));
        return steps.length === 1 && steps[0]!.kind === "street_ride" && !/undefined|NaN/.test(steps[0]!.text);
      }),
      { seed: 9, numRuns: 200 },
    );
  });

  it("an unnamed free alighting point on the last ride takes the destination's name", () => {
    const at = (m: number) => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng });
    const opt = { ...oneRide(), legs: [pathRide(200, 2000, at)] };
    const ride = guidanceSteps(tripOf(opt)).find((s) => s.kind === "ride")!;
    expect(ride.kind === "ride" && [ride.pinned, ride.board.label, ride.alight.label]).toEqual([false, "your stop along R1", "SM City Naga"]);
    const named = { ...oneRide(), legs: [pathRide(200, 2000, at, "Naga Cathedral")] };
    const r2 = guidanceSteps(tripOf(named)).find((s) => s.kind === "ride")!;
    expect(r2.kind === "ride" && r2.alight.label).toBe("Naga Cathedral");
  });
});
