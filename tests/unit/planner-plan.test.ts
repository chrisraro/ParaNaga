import { describe, expect, it } from "vitest";
import { isInsideNaga } from "@/domain/geo/naga";
import { PLAN_LABELS, planTrip, type PlanOption, type RideLeg } from "@/domain/planner/plan";
import { LINE_VARIANT_ID, LOOP_VARIANT_ID, STOP_ID, at, synthetic, syntheticSnapshot } from "../fixtures/synthetic/planner-network";

const snap = syntheticSnapshot();
const rideLegs = (o: PlanOption) => o.legs.filter((l): l is RideLeg => l.kind === "ride");
const seqKey = (o: PlanOption) => rideLegs(o).map((l) => l.variantId).join(">");

describe("planTrip on the synthetic network", () => {
  it("uses a fixture explicitly marked synthetic, inside Naga", () => {
    expect(synthetic).toBe(true);
    for (const p of [at(-700, 0), at(0, -100), at(4000, -100), at(2000, 1000), at(500, 300)]) expect(isInsideNaga(p)).toBe(true);
  });

  it("rides the loop forward: P1 → P2 → P3", () => {
    const plan = planTrip(snap, at(0, -100), at(2000, -100));
    expect(plan.coverage).toBe("provisional");
    expect(plan.revisionId).toBe(snap.revision.revisionId);
    const o = plan.options[0]!;
    expect(o.legs.map((l) => l.kind)).toEqual(["walk", "ride", "walk"]);
    const ride = rideLegs(o)[0]!;
    expect(ride.variantId).toBe(LOOP_VARIANT_ID);
    expect(ride.stops.map((s) => s.id)).toEqual(["P1", "P2", "P3"].map((c) => STOP_ID[c]));
    expect(ride).toMatchObject({ boardingVerified: false, pathVerified: false, approximate: true, routeCode: "SYN-S" });
    expect(ride.distanceMeters).toBeGreaterThan(1990);
    expect(ride.distanceMeters).toBeLessThan(2010);
    expect(ride.fare).toMatchObject({ minCentavos: 1400, maxCentavos: 1700, status: "estimate" });
    const walk = o.legs[0]!;
    expect(walk).toMatchObject({ kind: "walk", pathVerified: false });
    if (walk.kind !== "walk") throw new Error("expected walk");
    expect(walk.estimateMeters).toBe(Math.round(walk.distanceMeters * 1.3));
    expect(o).toMatchObject({ rides: 1, evidence: "provisional", fare: { minCentavos: 1400, maxCentavos: 1700, status: "estimate" } });
  });

  it("never rides backward: P3 → P1 would need most of the loop, longer than walking, so no option", () => {
    const plan = planTrip(snap, at(2000, -100), at(0, -100));
    expect(plan).toMatchObject({ coverage: "none", reason: "no_route", options: [] });
  });

  it("transfers loop → line within 400 m and labels the single option with every label", () => {
    const plan = planTrip(snap, at(0, -100), at(4000, -100));
    expect(plan.coverage).toBe("provisional");
    expect(plan.options).toHaveLength(1);
    const o = plan.options[0]!;
    expect(o.labels).toEqual([...PLAN_LABELS]);
    expect(o.legs.map((l) => l.kind)).toEqual(["walk", "ride", "walk", "ride", "walk"]);
    expect(rideLegs(o).map((l) => l.variantId)).toEqual([LOOP_VARIANT_ID, LINE_VARIANT_ID]);
    const transfer = o.legs[2]!;
    if (transfer.kind !== "walk") throw new Error("expected walk");
    expect(transfer.from.stopId).toBe(STOP_ID.P3);
    expect(transfer.to.stopId).toBe(STOP_ID.Q1);
    expect(transfer.distanceMeters).toBeLessThan(205);
    expect(o.rides).toBe(2);
    expect(o.fare).toEqual({ minCentavos: 2800, maxCentavos: 3400, status: "estimate", completeness: "estimate" });
  });

  it("respects the transfer cap and maxRides", () => {
    expect(planTrip(snap, at(0, -100), at(4000, -100), { maxTransferWalkM: 150 }).coverage).toBe("none");
    expect(planTrip(snap, at(0, -100), at(4000, -100), { maxRides: 1 }).coverage).toBe("none");
  });

  it("respects the access cap (straight-line)", () => {
    const far = planTrip(snap, at(-700, 0), at(2000, -100));
    expect(far).toMatchObject({ coverage: "none", reason: "no_stop_near_origin", options: [] });
    const farDest = planTrip(snap, at(0, -100), at(-700, 0));
    expect(farDest).toMatchObject({ coverage: "none", reason: "no_stop_near_destination" });
    const wider = planTrip(snap, at(-700, 0), at(2000, -100), { maxAccessWalkM: 800 });
    expect(wider.coverage).toBe("provisional");
    expect((wider.options[0]!.legs[0] as { distanceMeters: number }).distanceMeters).toBeLessThanOrEqual(800);
  });

  it("puts a walk-only option first, labelled Recommended, when the destination is within the access cap", () => {
    const plan = planTrip(snap, at(500, -100), at(500, 300));
    expect(plan.coverage).toBe("provisional");
    const first = plan.options[0]!;
    expect(first.labels).toEqual(["Recommended"]);
    expect(first.legs).toHaveLength(1);
    expect(first).toMatchObject({ rides: 0, fare: { minCentavos: 0, maxCentavos: 0, status: "no_ride" } });
    expect(plan.notes.join(" ")).toMatch(/walk/i);
  });

  it("rejects points outside Naga", () => {
    expect(planTrip(snap, { lat: 14.5, lng: 121 }, at(0, 0))).toMatchObject({ coverage: "none", reason: "outside_city", options: [] });
  });

  it("marks fares unavailable instead of inventing them when the rules are missing", () => {
    const plan = planTrip({ ...snap, fareRules: [] }, at(0, -100), at(2000, -100));
    expect(plan.options[0]!.fare).toEqual({ minCentavos: null, maxCentavos: null, status: "unavailable", completeness: "estimate" });
  });

  it("is deterministic regardless of input order", () => {
    const a = planTrip(snap, at(0, -100), at(4000, -100));
    const shuffled = { ...snap, stops: [...snap.stops].reverse(), variants: [...snap.variants].reverse() };
    expect(planTrip(shuffled, at(0, -100), at(4000, -100))).toEqual(a);
  });

  it("uses each label at most once, at most 3 options, unique variant sequences", () => {
    for (const [o, d] of [[at(0, -100), at(2000, -100)], [at(0, -100), at(4000, -100)], [at(500, -100), at(500, 300)]] as const) {
      const plan = planTrip(snap, o, d);
      expect(plan.options.length).toBeLessThanOrEqual(3);
      const labels = plan.options.flatMap((x) => x.labels);
      expect(new Set(labels).size).toBe(labels.length);
      for (const l of labels) expect(PLAN_LABELS).toContain(l);
      const keys = plan.options.map(seqKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("validates options", () => {
    expect(() => planTrip(snap, at(0, 0), at(1, 1), { maxRides: 0 })).toThrow();
    expect(() => planTrip(snap, at(0, 0), at(1, 1), { maxAccessWalkM: -1 })).toThrow();
  });
});
