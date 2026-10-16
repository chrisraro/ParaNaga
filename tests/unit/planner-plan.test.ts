import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { isInsideNaga } from "@/domain/geo/naga";
import type { RouteFareReport } from "@/domain/api/schemas";
import { fleetSummary } from "@/domain/modes/fleet";
import { PLAN_LABELS, planTrip, savesWalking, type PlanOption, type RideLeg } from "@/domain/planner/plan";
import { LINE_VARIANT_ID, LOOP_VARIANT_ID, STOP_ID, at, synthetic, syntheticSnapshot } from "../fixtures/synthetic/planner-network";

const snap = syntheticSnapshot();
const rideLegs = (o: PlanOption) => o.legs.filter((l): l is RideLeg => l.kind === "ride");
const seqKey = (o: PlanOption) => rideLegs(o).map((l) => l.variantId).join(">");

describe("planTrip on the synthetic network", () => {
  it("uses a fixture explicitly marked synthetic, inside Naga", () => {
    expect(synthetic).toBe(true);
    for (const p of [at(-700, 0), at(0, -100), at(4000, -100), at(2000, 1000), at(500, 300), at(500, -300), at(1300, -300)]) expect(isInsideNaga(p)).toBe(true);
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

  it("never rides backward: P3 → P1 goes forward round most of the loop (it saves walking)", () => {
    const plan = planTrip(snap, at(2000, -100), at(0, -100));
    expect(plan.coverage).toBe("provisional");
    const order = snap.variants[0]!.stopIds;
    for (const o of plan.options) {
      for (const leg of rideLegs(o)) {
        expect(leg.variantId).toBe(LOOP_VARIANT_ID);
        const idx = leg.stops.map((s) => order.indexOf(s.id));
        idx.slice(1).forEach((x, i) => expect(x).toBe((idx[i]! + 1) % order.length)); // each step is the next stop
      }
    }
    const ride = rideLegs(plan.options[0]!)[0]!;
    expect(ride.stops.map((s) => s.id)).toEqual(["P3", "P4", "P5", "P6", "P1"].map((c) => STOP_ID[c]));
    expect(Number.isInteger(ride.distanceMeters)).toBe(true);
    expect(ride.distanceMeters).toBeGreaterThan(3990);
    expect(ride.distanceMeters).toBeLessThan(4010);
  });

  it("keeps a ride option only when it saves walking (estimate vs estimate)", () => {
    expect(savesWalking(1039, 1040)).toBe(true);
    expect(savesWalking(1040, 1040)).toBe(false);
    for (const [o, d] of [[at(0, -100), at(2000, -100)], [at(2000, -100), at(0, -100)], [at(0, -100), at(4000, -100)]] as const) {
      const plan = planTrip(snap, o, d);
      for (const opt of plan.options) expect(savesWalking(opt.walkEstimateMeters, plan.directWalkEstimateMeters!)).toBe(true);
    }
  });

  it("reports walk_shorter when rides connect but none saves walking", () => {
    // P1 → P2 connects, but 583 m + 424 m of walking is more than walking the 800 m directly.
    const plan = planTrip(snap, at(500, -300), at(1300, -300));
    expect(plan).toMatchObject({ coverage: "none", reason: "walk_shorter", options: [] });
    expect(plan.directWalkEstimateMeters).toBe(Math.round(Math.round(haversineMeters(at(500, -300), at(1300, -300))) * 1.3));
  });

  it("reports no_route when stops are in reach at both ends but no ride connects them", () => {
    const plan = planTrip(snap, at(4000, -100), at(0, -100)); // Q3 is the end of line Q
    expect(plan).toMatchObject({ coverage: "none", reason: "no_route", options: [] });
    expect(plan.directWalkEstimateMeters).toBe(Math.round(Math.round(haversineMeters(at(4000, -100), at(0, -100))) * 1.3));
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
    expect(planTrip(snap, at(0, -100), at(2000, -100)).coverage).toBe("provisional");
    expect(planTrip(snap, at(0, -100), at(2000, -100), { maxAccessWalkM: 50 })).toMatchObject({ coverage: "none", reason: "no_stop_near_origin" });
  });

  it("puts a walk-only option first, labelled Recommended and Fewest transfers, within the access cap", () => {
    const plan = planTrip(snap, at(500, -100), at(500, 300));
    expect(plan.coverage).toBe("provisional");
    const first = plan.options[0]!;
    expect(first.labels).toEqual(["Recommended", "Fewest transfers"]);
    for (const o of plan.options.slice(1)) expect(o.labels).toEqual(["Least walking"]);
    expect(first.legs).toHaveLength(1);
    expect(first).toMatchObject({ rides: 0, fare: { minCentavos: 0, maxCentavos: 0, status: "no_ride" } });
    expect(plan.notes.join(" ")).toMatch(/walk/i);
  });

  it("refuses ends 25 m apart or closer as the same place (no walk-only option, no badge note)", () => {
    for (const d of [at(0, -100), at(15, -100), at(25, -100)]) {
      expect(planTrip(snap, at(0, -100), d)).toMatchObject({ coverage: "none", reason: "same_place", options: [], notes: [] });
    }
    expect(planTrip(snap, at(0, -100), at(30, -100)).reason).not.toBe("same_place");
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
    expect(() => planTrip(snap, at(0, 0), at(1, 1), { maxAccessWalkM: 601 })).toThrow(/600/);
    expect(() => planTrip(snap, at(0, 0), at(1, 1), { maxTransferWalkM: 401 })).toThrow(/400/);
  });
});

describe("ride legs: D13 distance basis, mode and fleet (Task 8)", () => {
  const MIXED = fleetSummary([
    { code: "FL-SYN-TRAD", vehicleClass: "traditional_puj", evidenceLevels: ["legal_plan", "owner_confirmation"], status: "operating",
      firstReportedOn: null, lastReportedOn: "2026-10-16", unitsNote: null, aircon: null, airconSourceCodes: [], cooperatives: [], sourceCodes: ["SYN"] },
    { code: "FL-SYN-MOD", vehicleClass: "modern_puj", evidenceLevels: ["owner_confirmation"], status: "operating",
      firstReportedOn: null, lastReportedOn: "2026-10-16", unitsNote: null, aircon: true, airconSourceCodes: ["SYN"], cooperatives: [], sourceCodes: ["SYN"] },
  ], "jeepney");
  const REPORT: RouteFareReport = { code: "FO-SYN-MOD", vehicleClass: "modern_puj", deltaQualifier: "range", deltaCentavosLow: 300,
    deltaCentavosHigh: 500, observedOn: "2026-10-16", sourceCodes: ["SYN"] };
  const route = (i: number, fleet = fleetSummary([], "jeepney"), fareReports: RouteFareReport[] = []) => {
    const v = snap.variants[i]!;
    return { routeId: v.routeId, routeCode: v.routeCode, routeName: v.routeName, mode: "jeepney" as const, serviceStatus: null, fleet, fareReports };
  };
  /** Loop S with path measures 2300 m apart (ring 13 800 m): P1 → P3 is 4600 m along the path, ~2000 m straight. */
  const measured = () => {
    const s = syntheticSnapshot();
    s.variants[0] = { ...s.variants[0]!, measuresM: [0, 2300, 4600, 6900, 9200, 11500], pathLengthM: 13_800 };
    return s;
  };

  it("without measures: straight-line distance, labelled so, no measures", () => {
    const ride = rideLegs(planTrip(snap, at(0, -100), at(2000, -100)).options[0]!)[0]!;
    expect(ride).toMatchObject({ distanceBasis: "stop_to_stop_straight_line", boardMeasureM: null, alightMeasureM: null });
    expect(ride.distanceMeters).toBeLessThan(2010);
  });

  it("with measures: distance along the approximate path, the measures, and a fare on that distance", () => {
    const plan = planTrip(measured(), at(0, -100), at(2000, -100));
    const o = plan.options[0]!;
    const ride = rideLegs(o)[0]!;
    expect(ride).toMatchObject({
      distanceMeters: 4600, distanceBasis: "approximate_path", boardMeasureM: 0, alightMeasureM: 4600, approximate: true, pathVerified: false,
    });
    expect(ride.fare).toMatchObject({ minCentavos: 1400, maxCentavos: 2000, status: "estimate" }); // 4.6 km, not ~2.0 km
    expect(o.rideMeters).toBe(4600);
  });

  it("wraps a circuit ride that passes the start of the path", () => {
    // P5 → P6 → P1 → P2: (2300 − 9200) mod 13 800 = 6900 m
    const plan = planTrip(measured(), at(1000, 1100), at(1000, -100));
    const ride = rideLegs(plan.options[0]!).find((l) => l.variantId === LOOP_VARIANT_ID)!;
    expect(ride.stops.map((s) => s.id)).toEqual(["P5", "P6", "P1", "P2"].map((c) => STOP_ID[c]));
    expect(ride).toMatchObject({ distanceMeters: 6900, boardMeasureM: 9200, alightMeasureM: 2300 });
  });

  it("copies the mode and the route's fleet (by routeId) onto the ride leg", () => {
    const s = { ...syntheticSnapshot(), routes: [route(0, MIXED), route(1)] };
    const ride = rideLegs(planTrip(s, at(0, -100), at(2000, -100)).options[0]!)[0]!;
    expect(ride.mode).toBe("jeepney");
    expect(ride.fleet).toEqual(MIXED);
    expect(ride.fleet.classes.find((c) => c.vehicleClass === "modern_puj")).toMatchObject({ aircon: true, evidenceLevels: ["owner_confirmation"] });
  });

  it("an older snapshot without routes[]: fleet 'Vehicle type not confirmed', never a guessed class", () => {
    const ride = rideLegs(planTrip(snap, at(0, -100), at(2000, -100)).options[0]!)[0]!;
    expect(ride.fleet).toMatchObject({ label: "Vehicle type not confirmed", classes: [] });
  });

  it("prices a mixed-fleet ride from the traditional minimum to the modern maximum, with the riders' report", () => {
    const s = { ...syntheticSnapshot(), routes: [route(0, MIXED, [REPORT]), route(1)] };
    const o = planTrip(s, at(0, -100), at(2000, -100)).options[0]!;
    expect(rideLegs(o)[0]!.fare).toMatchObject({
      minCentavos: 1400, maxCentavos: 1900, span: "traditional_to_modern", basis: "fare_rules_and_reports", reportCodes: ["FO-SYN-MOD"],
    });
    expect(o.fare).toMatchObject({ minCentavos: 1400, maxCentavos: 1900, status: "estimate" });
  });

  it("prices a traditional-only route from F01 alone (ruling 2026-10-16), even with a report on file", () => {
    const TRAD = fleetSummary([MIXED.classes[0]!], "jeepney");
    const s = { ...measured(), routes: [route(0, TRAD, [REPORT]), route(1, TRAD)] };
    const o = planTrip(s, at(0, -100), at(2000, -100)).options[0]!; // 4.6 km along the path
    expect(rideLegs(o)[0]!.fare).toMatchObject({
      minCentavos: 1400, maxCentavos: 1600, span: "traditional_rule", ruleCodes: ["F01"], basis: "fare_rules", reportCodes: [],
    });
    expect(o.fare).toMatchObject({ minCentavos: 1400, maxCentavos: 1600 });
  });

  it("keeps the option id (saved trips stay valid): variant:board:alight, whatever the new fields", () => {
    const a = planTrip(snap, at(0, -100), at(2000, -100)).options[0]!;
    const b = planTrip({ ...measured(), routes: [route(0, MIXED, [REPORT])] }, at(0, -100), at(2000, -100)).options[0]!;
    expect(a.id).toBe(`${LOOP_VARIANT_ID}:${STOP_ID.P1}:${STOP_ID.P3}`);
    expect(b.id).toBe(a.id);
  });
});
