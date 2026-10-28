// Owner 2026-10-20: "When showing trip option for some destination that may have 300 to 400 meters away from a jeepney
// usual route and nearest drop, suggest it anyway, but it was not the top option." A jeepney route the planner did not
// already show, whose drop-off is over the near limit (300 m; city centre 100 m) and within JEEP_FAR_DROP_MAX_M (400 m),
// is now offered after the other options, never Recommended.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildPlanResponse, planResponseSchema } from "@/domain/api/plan";
import { haversineMeters } from "@/domain/geo/geometry";
import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import { inCentro } from "@/domain/planner/centro";
import { FAR_AREAS, zoneOf } from "@/domain/planner/far-areas";
import {
  JEEP_DETOUR_SLACK_M, JEEP_FAR_DROP_DISTINCT_M, JEEP_FAR_DROP_MAX_EXTRA, JEEP_FAR_DROP_MAX_M, JEEP_MAX_DETOUR, JEEP_NEAR_DROP_M, PASSES_DESTINATION_M, planTrip, UNVERIFIED_ROUTE_BADGE, type PlanOption, type TripPlan,
} from "@/domain/planner/plan";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const snap = realLinesSnapshot();
const lines = realLines();
const NET = { lines, streets: realStreets() };
/** 10:00 Manila: daytime tricycle rules. */
const TEN = { now: new Date("2026-10-17T02:00:00Z") };
const plan = (o: LatLng, d: LatLng) => planTrip(snap, NET, o, d, TEN);
const recommended = (p: TripPlan) => p.options.filter((o) => o.labels.includes("Recommended"));
const jeepneys = (p: TripPlan) => p.options.filter((o) => o.mode === "jeepney");
const lastRide = (o: PlanOption) => {
  const r = o.legs.filter((l) => l.kind === "ride").at(-1);
  if (r?.kind !== "ride") throw new Error("a ride");
  return r;
};
/** Straight-line metres from the last drop-off to the destination. */
const dropM = (o: PlanOption, d: LatLng) => haversineMeters(lastRide(o).alight, d);
/** The jeepney options listed after the tricycle (and padyak): the far drop-off ones. */
const afterStreet = (p: TripPlan) => {
  const last = Math.max(...p.options.map((x, i) => (x.mode === "tricycle" || x.mode === "padyak" ? i : -1)));
  return p.options.filter((x, i) => x.mode === "jeepney" && i > last && last >= 0);
};

/** At most JEEP_FAR_DROP_MAX_EXTRA far drop-offs, each at its own spot (over 50 m from every other drop-off shown). */
const expectCappedAndDistinct = (p: TripPlan) => {
  const extra = afterStreet(p);
  expect(extra.length).toBeLessThanOrEqual(JEEP_FAR_DROP_MAX_EXTRA);
  const all = jeepneys(p).filter((j) => !j.id.startsWith("tri>"));
  for (const j of extra) {
    for (const k of all) if (k !== j) expect(haversineMeters(lastRide(j).alight, lastRide(k).alight)).toBeGreaterThan(JEEP_FAR_DROP_DISTINCT_M);
  }
};

describe("far drop-off jeepney (JEEP_NEAR_DROP_M, JEEP_FAR_DROP_MAX_M)", () => {
  it("constants: near 300 m, offered up to 400 m (owner-tunable)", () => {
    expect(JEEP_NEAR_DROP_M).toBe(300);
    expect(JEEP_FAR_DROP_MAX_M).toBe(400);
    expect(JEEP_FAR_DROP_MAX_EXTRA).toBe(2);
    expect(JEEP_FAR_DROP_DISTINCT_M).toBe(50);
  });

  it("other routes dropping off 300–400 m away are offered after the Recommended jeepney and the tricycle, not Recommended", () => {
    const o = { lat: 13.6194594, lng: 123.2382769 };
    const d = { lat: 13.6299791, lng: 123.1858234 };
    const p = plan(o, d);
    const extra = afterStreet(p);
    expect(extra.length).toBeGreaterThan(0);
    expect(recommended(p)).toHaveLength(1);
    const rec = p.options.indexOf(recommended(p)[0]!);
    const tri = p.options.findIndex((x) => x.mode === "tricycle");
    const shownLast = new Set(p.options.slice(0, tri).filter((x) => x.mode === "jeepney").map((x) => lastRide(x).routeCode));
    for (const j of extra) {
      expect(j.labels).toEqual([]);
      expect(p.options.indexOf(j)).toBeGreaterThan(Math.max(rec, tri));
      expect(dropM(j, d)).toBeGreaterThan(JEEP_NEAR_DROP_M);
      expect(dropM(j, d)).toBeLessThanOrEqual(JEEP_FAR_DROP_MAX_M);
      expect(shownLast.has(lastRide(j).routeCode)).toBe(false);
      // The honest walk after the drop-off is the existing egress walk leg.
      const walk = j.legs.at(-1)!;
      expect(walk.kind === "walk" && walk.to.kind === "destination" && walk.estimateMeters >= JEEP_NEAR_DROP_M).toBe(true);
    }
    expect(new Set(extra.map((j) => lastRide(j).routeCode)).size).toBe(extra.length);
    expectCappedAndDistinct(p);
  });

  it("a far drop-off at the spot of a shown jeepney's drop-off (loops sharing a street) is not added again", () => {
    // The Recommended jeepney drops off 338 m away; other loops drop off at the same spot.
    const o = { lat: 13.6178965, lng: 123.2227801 };
    const d = { lat: 13.624256, lng: 123.2068474 };
    const p = plan(o, d);
    expect(jeepneys(p).length).toBeGreaterThan(0);
    expect(afterStreet(p)).toHaveLength(0);
  });

  it("city centre: jeepneys dropping off 100–400 m away are offered after the Recommended tricycle (formerly none)", () => {
    const o = { lat: 13.6261385, lng: 123.186453 };
    const d = { lat: 13.6197844, lng: 123.1807512 };
    expect(inCentro(o) && inCentro(d)).toBe(true);
    const p = plan(o, d);
    expect(p.options[0]!.mode).toBe("tricycle");
    expect(p.options[0]!.labels).toContain("Recommended");
    expect(recommended(p)).toHaveLength(1);
    expect(jeepneys(p).length).toBeGreaterThan(0);
    for (const j of jeepneys(p)) {
      expect(j.labels).toEqual([]);
      expect(dropM(j, d)).toBeGreaterThan(PASSES_DESTINATION_M);
      expect(dropM(j, d)).toBeLessThanOrEqual(JEEP_FAR_DROP_MAX_M);
    }
    expect(p.jeepneyReason).toBeNull();
    expect(p.notes[0]).toBe(UNVERIFIED_ROUTE_BADGE);
    // Five routes drop off 327–398 m away (loops sharing streets): two distinct spots are kept, nearest first.
    expect(jeepneys(p)).toHaveLength(2);
    expect(dropM(jeepneys(p)[0]!, d)).toBeLessThanOrEqual(dropM(jeepneys(p)[1]!, d));
    expectCappedAndDistinct(p);
  });

  it("a drop-off over 400 m is still not offered (city centre: no jeepney, calm centre reason)", () => {
    // The search finds jeepneys here (the reason is "centro", not a no-path reason), all dropping off over 400 m away.
    const o = { lat: 13.6166846, lng: 123.1897196 };
    const d = { lat: 13.6277491, lng: 123.181704 };
    const p = plan(o, d);
    expect(jeepneys(p)).toHaveLength(0);
    expect(p.jeepneyReason).toBe("centro");
    expect(recommended(p).map((x) => x.mode)).toEqual(["tricycle"]);
  });

  it("the detour guard still drops a far drop-off jeepney that goes the long way around", () => {
    // A 4.8 km ride dropping off 300–400 m away; the guard allows 2 × 1.07 km + 300 m.
    const o = { lat: 13.6297104, lng: 123.2090769 };
    const d = { lat: 13.6251328, lng: 123.2177639 };
    const p = plan(o, d);
    expect(jeepneys(p)).toHaveLength(0);
    expect(p.jeepneyReason).toBe("roundabout");
  });

  it("a far start keeps its Recommended jeepney (Increment F); the plan never has two", () => {
    const o = { lat: 13.6533026, lng: 123.2264674 };
    const d = { lat: 13.613227, lng: 123.1962724 };
    expect(zoneOf(o, FAR_AREAS)).not.toBeNull();
    const p = plan(o, d);
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).toBe("jeepney");
    expect(p.options.some((x) => x.mode === "tricycle" && !x.specialTrip)).toBe(false);
  });

  it("property: one Recommended; far drop-offs listed last, never Recommended, within 400 m and the guard; schema parses", () => {
    const point = fc.record({ lat: fc.double({ min: 13.6, max: 13.67, noNaN: true }), lng: fc.double({ min: 123.17, max: 123.32, noNaN: true }) });
    fc.assert(
      fc.property(point, point, (o, d) => {
        fc.pre(isInsideNaga(o) && isInsideNaga(d));
        const p = plan(o, d);
        if (p.coverage === "none") return;
        const farO = zoneOf(o, FAR_AREAS) !== null;
        const farD = zoneOf(d, FAR_AREAS) !== null;
        const noneRecommended = (farO || farD) && jeepneys(p).length === 0 && p.directWalkEstimateMeters! >= 500;
        // A restricted tricycle (street banned at this hour) is never Recommended, so there may be none.
        if (p.options.some((x) => x.legs.some((l) => l.kind === "tricycle" && l.basis === "restricted"))) expect(recommended(p).length).toBeLessThanOrEqual(1);
        else expect(recommended(p)).toHaveLength(noneRecommended ? 0 : 1);
        if (farD) expect(afterStreet(p)).toHaveLength(0);
        const nearM = inCentro(o) && inCentro(d) && !farO ? PASSES_DESTINATION_M : JEEP_NEAR_DROP_M;
        for (const j of afterStreet(p)) {
          expect(j.labels).toEqual([]);
          expect(dropM(j, d)).toBeGreaterThan(nearM - 0.5);
          expect(dropM(j, d)).toBeLessThanOrEqual(JEEP_FAR_DROP_MAX_M + 0.5);
          expect(j.rideMeters).toBeLessThanOrEqual(JEEP_MAX_DETOUR * haversineMeters(o, d) + JEEP_DETOUR_SLACK_M);
          expect(j.walkMeters).toBeLessThan(p.directWalkEstimateMeters!);
        }
        expectCappedAndDistinct(p);
        planResponseSchema.parse(buildPlanResponse(snap, p, lines));
      }),
      { seed: 20261020, numRuns: 150 },
    );
  }, 120_000);
});
