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
import { inCentro } from "@/domain/planner/centro";
import { FAR_AREAS, zoneOf } from "@/domain/planner/far-areas";
import { fareClasses, legFareEstimate } from "@/domain/planner/fares";
import { JEEP_DETOUR_SLACK_M, JEEP_FAR_DROP_MAX_M, JEEP_MAX_DETOUR, JEEP_NEAR_DROP_M, PASSES_DESTINATION_M, planningNetwork, planTrip, type OptionMode, type PlanOption, type TripPlan } from "@/domain/planner/plan";
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
  // Revision 2026-10-20: inside the city centre the Recommended tricycle is listed first; the rest keep the order.
  const centro = inCentro(origin) && inCentro(destination) && zoneOf(origin, FAR_AREAS) === null && zoneOf(destination, FAR_AREAS) === null;
  const rest = centro && p.options[0]?.mode === "tricycle" ? p.options.slice(1) : p.options;
  if (rest !== p.options) expect(p.options[0]!.labels).toContain("Recommended");
  if (centro) expect(p.options.filter((o) => o.mode === "jeepney" && o.labels.includes("Recommended"))).toHaveLength(0);
  // Owner 2026-10-20: far drop-off jeepneys (over 300 m, city centre 100 m, up to 400 m) come after the tricycle and padyak.
  const street = Math.max(...rest.map((o, i) => (o.mode === "tricycle" || o.mode === "padyak" ? i : -1)));
  const farDrops = street < 0 ? [] : rest.slice(street + 1);
  for (const o of farDrops) {
    expect(o.mode).toBe("jeepney");
    expect(o.labels).toEqual([]);
    const last = o.legs.filter((l) => l.kind === "ride").at(-1)!;
    if (last.kind !== "ride") throw new Error("a ride");
    expect(haversineMeters(last.alight, destination)).toBeGreaterThan((centro ? PASSES_DESTINATION_M : JEEP_NEAR_DROP_M) - 0.5);
    expect(haversineMeters(last.alight, destination)).toBeLessThanOrEqual(JEEP_FAR_DROP_MAX_M + 0.5);
  }
  const idx = rest.slice(0, rest.length - farDrops.length).map((o) => ORDER.indexOf(o.mode));
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  expect(new Set(p.options.map((o) => o.id)).size).toBe(p.options.length);
  expect((p.jeepneyReason === null) === p.options.some((o) => o.mode === "jeepney")).toBe(true);
  // Increment F ruling (e): a far end with no jeepney option has no Recommended option.
  const farO = zoneOf(origin, FAR_AREAS) !== null;
  const farD = zoneOf(destination, FAR_AREAS) !== null;
  // Increment F (review C1/I2): a long far trip with no jeepney shows only an unlabelled special-trip tricycle.
  const noneRecommended = (farO || farD) && !p.options.some((o) => o.mode === "jeepney") && p.directWalkEstimateMeters! >= 500;
  expect(p.options.filter((o) => o.labels.includes("Recommended"))).toHaveLength(noneRecommended ? 0 : 1);
  // Under 500 m a jeepney is Recommended only when it passes the destination (its last drop-off within 100 m).
  const rec = p.options.find((o) => o.labels.includes("Recommended"));
  const lastRide = rec?.legs.filter((l) => l.kind === "ride").at(-1);
  if (p.directWalkEstimateMeters! < 500 && lastRide?.kind === "ride") expect(haversineMeters(lastRide.alight, destination)).toBeLessThanOrEqual(100);
  for (const o of p.options.filter((x: PlanOption) => x.mode === "jeepney")) {
    // An access option (Increment F, T4) starts with a tricycle to the loading point, which is in the city proper.
    const tri = o.id.startsWith("tri>") ? o.legs[0]! : null;
    if (tri) {
      if (tri.kind !== "tricycle") throw new Error("an access option starts with a tricycle");
      expect(tri.from).toMatchObject(origin);
      expect(zoneOf(tri.to, FAR_AREAS)).toBeNull();
    }
    const legs = tri ? o.legs.slice(1) : o.legs;
    legs.forEach((l, i) => expect(l.kind).toBe(i % 2 === 0 ? "walk" : "ride"));
    const first = legs[0]!;
    const last = legs.at(-1)!;
    if (first.kind !== "walk" || last.kind !== "walk") throw new Error("must start and end walking");
    if (!tri) expect(first.from).toMatchObject(origin);
    expect(last.to).toMatchObject(destination);
    const walks = legs.filter((l) => l.kind === "walk");
    walks.forEach((w, i) => expect(w.estimateMeters).toBeLessThanOrEqual(
      i === 0 ? (farO ? 1500 : 750) : i === walks.length - 1 ? (farD ? 1500 : 750) : 450));
    expect(o.walkMeters).toBe(walks.reduce((s, w) => s + w.estimateMeters, 0));
    expect(o.walkMeters).toBeLessThan(p.directWalkEstimateMeters!);
    expect(o.rides).toBeLessThanOrEqual(2);
    // Detour guard: no jeepney loops or roams past the trip (access options ride from their loading point).
    if (!tri) expect(o.rideMeters).toBeLessThanOrEqual(JEEP_MAX_DETOUR * haversineMeters(origin, destination) + JEEP_DETOUR_SLACK_M);
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
  ])("Plaza Rizal → %s (far zone, Increment F) rides %s; that jeepney is Recommended, no tricycle", (_name, d, route) => {
    const p = plan(PLAZA_RIZAL, d);
    assertWellFormed(p, PLAZA_RIZAL, d);
    expect(p.options.some((o) => o.legs.some((l) => l.kind === "ride" && l.routeCode === route))).toBe(true);
    expect(p.options.find((o) => o.labels.includes("Recommended"))!.mode).toBe("jeepney");
    expect(p.options.some((o) => o.mode === "tricycle")).toBe(false);
  });

  it.each([
    ["Del Rosario", { lat: 13.6173903, lng: 123.2375487 }, "R2"],
    ["City Hall (J. Miranda Ave)", { lat: 13.6261, lng: 123.1987 }, "R8-A"],
  ])("Plaza Rizal → %s rides %s (former stop planner: unplannable or Loops only); cheapest jeepney Recommended first, tricycle last", (_name, d, route) => {
    const p = plan(PLAZA_RIZAL, d);
    assertWellFormed(p, PLAZA_RIZAL, d);
    expect(p.options.some((o) => o.legs.some((l) => l.kind === "ride" && l.routeCode === route))).toBe(true);
    expect(p.options[0]!.mode).toBe("jeepney");
    expect(p.options[0]!.labels).toContain("Recommended");
    expect(p.options.find((o) => o.mode === "tricycle")!.labels).toEqual([]);
  });

  it("Plaza Rizal → Ateneo de Naga centroid keeps a jeepney: the drop-off is the run point with the shortest street walk (prod regression)", () => {
    // Production revision d093494a (its Lines and street graph equal these fixtures) offered only a
    // tricycle: the straight-line nearest points of the loops to the campus centroid are 820+ m
    // around the campus by street, while USI/Ateneo Ave along the same runs is under 750 m.
    const ATENEO = { lat: 13.6309527, lng: 123.1845589 };
    const p = plan(PLAZA_RIZAL, ATENEO);
    assertWellFormed(p, PLAZA_RIZAL, ATENEO);
    expect(p.jeepneyReason).toBeNull();
    const o = p.options.find((x) => x.mode === "jeepney")!;
    const egress = o.legs.at(-1)!;
    expect(egress.kind === "walk" ? egress.estimateMeters : Infinity).toBeLessThanOrEqual(750);
  });

  it("393 m Dayangdang → Balatas: the cheapest jeepney (a near-full R8-C lap) does not pass the destination, so the walk is Recommended (audit 2026-10-18)", () => {
    const o = { lat: 13.63077649346346, lng: 123.19734154386518 };
    const d = { lat: 13.632291139243893, lng: 123.19838304531253 };
    const p = plan(o, d);
    assertWellFormed(p, o, d);
    expect(p.directWalkEstimateMeters).toBeLessThan(500);
    expect(p.options.find((x) => x.labels.includes("Recommended"))!.mode).toBe("walk");
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
  options: 613,
  byMode: { jeepney: 395, tricycle: 200, padyak: 8, walk: 10 },
  // Re-recorded after 3d2ea38: the fixture snapshot gained the reviewed route notes, so 254 of 417
  // ride legs (160 trips) now carry notes; with notes stripped the digest is still d0930a3e….
  // Re-recorded for the approach-run walk fallback (Ateneo fix): 22 trips change; 5 gain a jeepney
  // (4 were no_path_near_origin, 1 walk_shorter), 17 get other or more jeepney options (+13 options).
  // Re-recorded for cheapest jeepney Recommended first at >= 500 m (bdefab1e…).
  // Re-recorded for the planner revision 2026-10-20: every ride gains `display`, tricycles near a published tricycle
  // terminal gain `tricycleTerminals`; 96 of 200 trips change otherwise, each checked against the previous planner:
  // 62 by the detour guard (a jeepney over 2 × the straight line + 300 m dropped, 70 jeepney options fewer in all),
  // 18 by the city-centre rule (tricycle Recommended and first) and 16 by both. None unexplained.
  // Re-recorded for far drop-offs (owner 2026-10-20; was 5d21552d…, 468 options), at most 2 per trip at distinct spots
  // (over 50 m from every shown drop-off): 138 trips unchanged; 62 gain 84 far drop-off jeepney options (1–2 each,
  // drop-offs 102–400 m; 12 city-centre trips lose reason "centro"), appended after the tricycle/padyak, every earlier
  // option byte-identical; Recommended changed on 0 trips; none trimmed.
  // Also re-recorded for the route tally 2026-10-20 (ride display letters/titles only).
  digest: "e897f944d8ca92a01e322123a4519a238b4db3d394452675566bb3385636c71a",
};
