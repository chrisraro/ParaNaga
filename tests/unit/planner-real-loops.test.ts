// planTrip on the real network (plan E Task 6): the committed real Lines and snapshot, and the real
// street graph v2 built from the pinned OSM road snapshot. Properties, real trips, the R8-A/B pin
// measures against the Lines paths, and the regression baseline (rebaselined at 10:00 Manila).
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { projectOnLine } from "@/domain/geo/measure";
import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import { fareClasses, legFareEstimate } from "@/domain/planner/fares";
import { planningNetwork, planTrip, type OptionMode, type PlanOption, type TripPlan } from "@/domain/planner/plan";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realLoopsSnapshot } from "../fixtures/real-loops";
import { realStreets } from "../fixtures/real-streets";

const snap = realLinesSnapshot();
const lines = realLines();
const streets = realStreets();
const NET = { lines, streets };
/** 10:00 Manila, 2026-10-17: daytime tricycle rules apply. */
const TEN = { now: new Date("2026-10-17T02:00:00Z") };
const plan = (o: LatLng, d: LatLng) => planTrip(snap, NET, o, d, TEN);
const near = (p: LatLng, east: number, north: number): LatLng => ({ lat: p.lat + north / 110_574, lng: p.lng + east / 108_190 });
const ORDER: OptionMode[] = ["walk", "jeepney", "tricycle", "padyak"];

/** Every option: order, unique ids, contiguous legs, walk caps, must-save-walking, ride distance and fare. */
function assertWellFormed(p: TripPlan, origin: LatLng, destination: LatLng) {
  if (p.coverage === "none") return;
  expect(p.options.length).toBeLessThanOrEqual(6);
  const idx = p.options.map((o) => ORDER.indexOf(o.mode));
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  expect(new Set(p.options.map((o) => o.id)).size).toBe(p.options.length);
  expect((p.jeepneyReason === null) === p.options.some((o) => o.mode === "jeepney")).toBe(true);
  expect(p.options.filter((o) => o.labels.includes("Recommended"))).toHaveLength(1);
  for (const o of p.options.filter((x: PlanOption) => x.mode === "jeepney")) {
    const legs = o.legs;
    legs.forEach((l, i) => expect(l.kind).toBe(i % 2 === 0 ? "walk" : "ride"));
    const first = legs[0]!;
    const last = legs.at(-1)!;
    if (first.kind !== "walk" || last.kind !== "walk") throw new Error("must start and end walking");
    expect(first.from).toMatchObject(origin);
    expect(last.to).toMatchObject(destination);
    const walks = legs.filter((l) => l.kind === "walk");
    walks.forEach((w, i) => expect(w.estimateMeters).toBeLessThanOrEqual(i === 0 || i === walks.length - 1 ? 750 : 450));
    expect(o.walkMeters).toBe(walks.reduce((s, w) => s + w.estimateMeters, 0));
    expect(o.walkMeters).toBeLessThan(p.directWalkEstimateMeters!);
    expect(o.rides).toBeLessThanOrEqual(2);
    for (const r of legs) {
      if (r.kind !== "ride") continue;
      const v = planningNetwork(snap, lines).variants.find((x) => x.variantId === r.variantId)!;
      const d = r.alightMeasureM - r.boardMeasureM;
      expect(r.distanceMeters).toBe(Math.round(v.isCircuit ? ((d % v.lengthM) + v.lengthM) % v.lengthM : d));
      expect(r.distanceMeters).toBeGreaterThanOrEqual(200);
      const route = snap.routes.find((x) => x.routeId === v.routeId)!;
      expect(r.fare).toEqual(legFareEstimate(r.distanceMeters, snap.fareRules, { classes: fareClasses(route.fleet.colourKey), reports: route.fareReports }));
      expect(r).toMatchObject({ boardingVerified: false, pathVerified: false, distanceBasis: "approximate_path", mode: "jeepney" });
    }
  }
}

describe("planTrip on the real network (Lines, street graph v2, 10:00 Manila)", () => {
  const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };

  it.each([
    ["Panicuason", { lat: 13.6632922, lng: 123.3179196 }, "R7"],
    ["Pacol", { lat: 13.6595434, lng: 123.2511904 }, "R6"],
    ["San Isidro", { lat: 13.6323904, lng: 123.2695351 }, "R1"],
    ["Del Rosario", { lat: 13.6173903, lng: 123.2375487 }, "R2"],
    ["City Hall (J. Miranda Ave)", { lat: 13.6261, lng: 123.1987 }, "R8-A"],
  ])("Plaza Rizal → %s rides %s (former stop planner: unplannable or Loops only); tricycle Recommended last", (_name, d, route) => {
    const p = plan(PLAZA_RIZAL, d);
    assertWellFormed(p, PLAZA_RIZAL, d);
    expect(p.options.some((o) => o.legs.some((l) => l.kind === "ride" && l.routeCode === route))).toBe(true);
    expect(p.options.find((o) => o.mode === "tricycle")!.labels).toEqual(["Recommended"]);
  });

  it("property: options are well formed on seeded trips across the city", () => {
    const point = fc.record({ lat: fc.double({ min: 13.6, max: 13.67, noNaN: true }), lng: fc.double({ min: 123.17, max: 123.32, noNaN: true }) });
    fc.assert(
      fc.property(point, point, (o, d) => {
        fc.pre(isInsideNaga(o) && isInsideNaga(d));
        assertWellFormed(plan(o, d), o, d);
      }),
      { seed: 20261017, numRuns: 120 },
    );
  }, 60_000);
});

describe("R8-A/B pins: the published measuresM lie on the Lines paths", () => {
  it("each pin's published measure is a point of the Lines path as near the pin as its nearest projection (± 2 m)", () => {
    for (const sv of snap.variants) {
      const v = planningNetwork(snap, lines).variants.find((x) => x.variantId === sv.variantId)!;
      expect(Math.abs(sv.pathLengthM! - v.lengthM)).toBeLessThan(5);
      const pointAt = (m: number): LatLng => {
        const i = Math.max(1, v.cumM.findIndex((c) => c >= m));
        const t = (m - v.cumM[i - 1]!) / (v.cumM[i]! - v.cumM[i - 1]!);
        const a = v.points[i - 1]!;
        const b = v.points[i]!;
        return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
      };
      sv.stopIds.forEach((id, k) => {
        const stop = snap.stops.find((s) => s.id === id)!;
        expect(haversineMeters(stop, pointAt(sv.measuresM![k]!))).toBeLessThanOrEqual(projectOnLine(v.points, stop).distM + 2);
      });
    }
    expect(snap.variants.map((v) => v.routeCode)).toEqual(["R8-A", "R8-B"]);
  });
});

// ---------------------------------------------------------------- regression baseline

/** 200 seeded trips near the real Loop A/B pins (the same generator as the pre-Increment-E baseline). */
function regressionTrips(): [LatLng, LatLng][] {
  const pins = realLoopsSnapshot().stops;
  const point = fc
    .record({ i: fc.integer({ min: 0, max: pins.length - 1 }), e: fc.integer({ min: -450, max: 450 }), n: fc.integer({ min: -450, max: 450 }) })
    .map(({ i, e, n }) => near(pins[i]!, e, n));
  return fc.sample(fc.tuple(point, point), { seed: 20261016, numRuns: 200 });
}

describe("regression baseline (Increment E Task 6: real Lines + street graph v2, 10:00 Manila)", () => {
  it("is identical to the recorded planner output on 200 seeded trips", () => {
    const plans = regressionTrips().map(([o, d]) => plan(o, d));
    const digest = createHash("sha256").update(JSON.stringify(plans)).digest("hex");
    const byMode: Record<string, number> = {};
    for (const o of plans.flatMap((p) => p.options)) byMode[o.mode] = (byMode[o.mode] ?? 0) + 1;
    const options = plans.reduce((s, p) => s + p.options.length, 0);
    expect({ options, byMode, digest }).toEqual(REGRESSION_BASELINE);
  }, 60_000);
});

/**
 * Recorded at Task 6 and re-recorded for review I1 (exactly one Recommended; walk card on every trip < 500 m).
 * Former baseline: 308 options (273 ride options on R8-A/R8-B, 35 walk-only).
 */
const REGRESSION_BASELINE = {
  options: 525,
  byMode: { jeepney: 307, tricycle: 200, padyak: 8, walk: 10 },
  // Re-recorded after 3d2ea38: the fixture snapshot gained the reviewed route notes, so 254 of 417
  // ride legs (160 trips) now carry notes; with notes stripped the digest is still d0930a3e….
  digest: "28368f6d4414c7f5beed538bfd3cbf0a866e12b130830b942488fc57ebeeba85",
};
