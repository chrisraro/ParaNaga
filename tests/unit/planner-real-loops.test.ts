// Planner over the real provisional Loop A / Loop B order, plus a seeded property test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import { planTrip, savesWalking, type PlanLeg, type TripPlan } from "@/domain/planner/plan";
import { realLoopsSnapshot } from "../fixtures/real-loops";

const snap = realLoopsSnapshot();
const stop = (code: string) => snap.stops.find((s) => s.source.code === code)!;
const near = (p: LatLng, east: number, north: number): LatLng => ({ lat: p.lat + north / 110_574, lng: p.lng + east / 108_190 });

const OPTS = { maxAccessWalkM: 600, maxTransferWalkM: 400, maxRides: 2 };

/** Every option: walk (→ ride → walk)+ contiguous, or a single walk; caps respected. */
function assertWellFormed(plan: TripPlan, origin: LatLng, destination: LatLng) {
  for (const o of plan.options) {
    const legs: PlanLeg[] = o.legs;
    expect(legs.length % 2).toBe(1);
    legs.forEach((l, i) => expect(l.kind).toBe(i % 2 === 0 ? "walk" : "ride"));
    const first = legs[0]!;
    const last = legs.at(-1)!;
    if (first.kind !== "walk" || last.kind !== "walk") throw new Error("must start and end walking");
    expect(first.from.kind).toBe("origin");
    expect(first.from).toMatchObject(origin);
    expect(last.to.kind).toBe("destination");
    expect(last.to).toMatchObject(destination);
    for (let i = 0; i + 1 < legs.length; i++) {
      const a = legs[i]!;
      const b = legs[i + 1]!;
      if (a.kind === "walk" && b.kind === "ride") expect(a.to.stopId).toBe(b.stops[0]!.id);
      if (a.kind === "ride" && b.kind === "walk") expect(b.from.stopId).toBe(a.stops.at(-1)!.id);
    }
    const walks = legs.filter((l) => l.kind === "walk");
    expect(o.rides).toBe(legs.length === 1 ? 0 : (legs.length - 1) / 2);
    expect(o.rides).toBeLessThanOrEqual(OPTS.maxRides);
    walks.forEach((w, i) => {
      const isTransfer = i > 0 && i < walks.length - 1;
      expect(w.distanceMeters).toBeLessThanOrEqual(isTransfer ? OPTS.maxTransferWalkM : OPTS.maxAccessWalkM);
      expect(w.pathVerified).toBe(false);
    });
    const cap = o.rides === 0 ? OPTS.maxAccessWalkM : 2 * OPTS.maxAccessWalkM + (o.rides - 1) * OPTS.maxTransferWalkM;
    expect(o.walkMeters).toBeLessThanOrEqual(cap);
    for (const r of legs.filter((l) => l.kind === "ride")) {
      expect(r.pathVerified).toBe(false);
      expect(r.boardingVerified).toBe(false);
      expect(r.stops.length).toBeGreaterThanOrEqual(2);
    }
    // a ride option is kept only when it saves walking (the planner's own predicate)
    expect(plan.directWalkEstimateMeters).toBe(Math.round(Math.round(haversineMeters(origin, destination)) * 1.3));
    if (o.rides > 0) expect(savesWalking(o.walkEstimateMeters, plan.directWalkEstimateMeters!)).toBe(true);
    expect(Number.isInteger(o.rideMeters)).toBe(true);
  }
}

describe("planTrip on real Loop A / Loop B", () => {
  it("plans from the Plaza Rizal area along Loop B", () => {
    const origin = near(stop("B1"), 0, -50);
    const dest = near(stop("B3"), 60, 0);
    const plan = planTrip(snap, origin, dest);
    expect(plan.coverage).toBe("provisional");
    assertWellFormed(plan, origin, dest);
    expect(plan.options.some((o) => o.legs.some((l) => l.kind === "ride" && l.routeCode === "R8-B"))).toBe(true);
  });

  it("finds an A↔B transfer somewhere on a grid over the city centre", () => {
    let found: TripPlan | null = null;
    const c = stop("A1");
    outer: for (let e1 = -2000; e1 <= 2000; e1 += 500) {
      for (let n1 = -2000; n1 <= 2000; n1 += 500) {
        for (let e2 = -2000; e2 <= 2000; e2 += 500) {
          for (let n2 = -2000; n2 <= 2000; n2 += 500) {
            const o = near(c, e1, n1);
            const d = near(c, e2, n2);
            if (!isInsideNaga(o) || !isInsideNaga(d)) continue;
            const plan = planTrip(snap, o, d);
            assertWellFormed(plan, o, d);
            if (plan.options.some((x) => new Set(x.legs.flatMap((l) => (l.kind === "ride" ? [l.routeCode] : []))).size === 2)) {
              found = plan;
              break outer;
            }
          }
        }
      }
    }
    expect(found).not.toBeNull();
  });

  it("returns coverage none from a point in Naga far from both loops", () => {
    const c = stop("A1");
    let far: LatLng | null = null;
    for (let k = 1500; k <= 8000 && !far; k += 500) {
      for (const [e, n] of [[k, 0], [0, k], [-k, 0], [0, -k], [k, k], [-k, -k]] as const) {
        const p = near(c, e, n);
        if (isInsideNaga(p) && snap.stops.every((s) => haversineMeters(p, s) > 1000)) {
          far = p;
          break;
        }
      }
    }
    expect(far).not.toBeNull();
    expect(planTrip(snap, far!, stop("B12"))).toMatchObject({ coverage: "none", reason: "no_stop_near_origin" });
  });

  it("walk-only mode: no ride option walks as much as walking directly (review counterexample)", () => {
    const origin = near(stop("A1"), -200, 200);
    const dest = near(stop("A1"), 237, -189);
    const plan = planTrip(snap, origin, dest);
    const walk = plan.options[0]!;
    expect(walk.rides).toBe(0);
    expect(walk.labels).toEqual(["Recommended", "Fewest transfers"]);
    for (const o of plan.options.slice(1)) {
      expect(o.labels).toEqual(["Least walking"]);
      expect(o.walkEstimateMeters).toBeLessThan(walk.walkEstimateMeters);
    }
    assertWellFormed(plan, origin, dest);
  });

  it("property: options are contiguous and within the walk caps (seeded, points near stops)", () => {
    // Points are a random stop plus up to ±450 m each way, so most runs produce options.
    const point = fc
      .record({ i: fc.integer({ min: 0, max: snap.stops.length - 1 }), e: fc.integer({ min: -450, max: 450 }), n: fc.integer({ min: -450, max: 450 }) })
      .map(({ i, e, n }) => near(snap.stops[i]!, e, n));
    let runs = 0;
    let withOptions = 0;
    fc.assert(
      fc.property(point, point, (o, d) => {
        fc.pre(isInsideNaga(o) && isInsideNaga(d));
        const plan = planTrip(snap, o, d);
        runs++;
        if (plan.options.length > 0) withOptions++;
        expect(plan.coverage).toBe(plan.options.length > 0 ? "provisional" : "none");
        assertWellFormed(plan, o, d);
      }),
      { seed: 20261015, numRuns: 300 },
    );
    expect(withOptions / runs).toBeGreaterThan(0.6);
  });
});
