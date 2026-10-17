// Via groups in the planner (Increment F, T5): the Centro-Del Rosario corridor shows each via route (R2 Magsaysay,
// R3 Roxas (Diversion), R4 Panganiban) that yields a one-ride candidate, within the 6-option budget. Driven by the
// far-areas viaGroups data (a 4th via is a data edit). Real committed Lines, snapshot and street graph (10:00 Manila).
// The group applies only to a trip with an end at its endAnchors (Del Rosario). Tests were written after the code; the
// viaGroups: [] checks prove R4 is hidden (and the chips absent) without the feature.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildPlanResponse, planOptionSchema, planResponseSchema } from "@/domain/api/plan";
import { isInsideNaga } from "@/domain/geo/naga";
import type { LatLng } from "@/domain/geo/types";
import { FAR_AREAS, nearestAnchorId, type ViaGroup } from "@/domain/planner/far-areas";
import { MAX_OPTIONS, planTrip, type PlanOption, type TripPlan } from "@/domain/planner/plan";
import { realLines, realLinesSnapshot } from "../fixtures/real-lines";
import { realStreets } from "../fixtures/real-streets";

const snap = realLinesSnapshot();
const lines = realLines();
const streets = realStreets();
const TEN = new Date("2026-10-17T02:00:00Z");
const plan = (o: LatLng, d: LatLng, viaGroups?: readonly ViaGroup[]) => planTrip(snap, { lines, streets }, o, d, { now: TEN, ...(viaGroups && { viaGroups }) });

const PLAZA_RIZAL = { lat: 13.6233869, lng: 123.1846726 };
const SM_CITY = { lat: 13.6210765, lng: 123.1904389 };
/** The Del Rosario barangay node. */
const DEL_ROSARIO = { lat: 13.6173903, lng: 123.2375487 };
/** Only R3 and R4 reach this short trip. */
const TWO_VIA: [LatLng, LatLng] = [{ lat: 13.617, lng: 123.235 }, { lat: 13.62, lng: 123.231 }];
/** A walk-card trip: R4 and R4>R2 are the Pareto picks; with every route a via, the budget is 3. */
const TRIM: [LatLng, LatLng] = [{ lat: 13.621, lng: 123.2002 }, { lat: 13.622, lng: 123.2012 }];
/** R1 and R8-D reach this trip; none of R2-R4 does. */
const R1_R8D: [LatLng, LatLng] = [{ lat: 13.62, lng: 123.19 }, { lat: 13.63, lng: 123.2 }];

const group = FAR_AREAS.viaGroups[0]!;
const rideCodes = (o: PlanOption) => o.legs.flatMap((l) => (l.kind === "ride" ? [l.routeCode] : []));
const jeeps = (p: TripPlan) => p.options.filter((o) => o.mode === "jeepney");
const vias = (p: TripPlan) => p.options.filter((o) => o.via !== undefined);
const recommended = (p: TripPlan) => p.options.filter((o) => o.labels.includes("Recommended"));
const allRoutes = [...new Set(lines.lines.map((l) => l.routeCode))];
const everyRouteAVia: ViaGroup = { ...group, endAnchors: undefined, code: "ALL", routes: allRoutes.map((routeCode) => ({ routeCode, via: `via ${routeCode}` })) };

describe("via groups: the Del Rosario corridor", () => {
  it("the data names three vias: R2 Magsaysay (Francia alias), R3 Roxas (Diversion), R4 Panganiban", () => {
    expect(group.routes.map((r) => [r.routeCode, r.via])).toEqual([["R2", "Magsaysay"], ["R3", "Roxas (Diversion)"], ["R4", "Panganiban"]]);
  });

  it("9 Plaza Rizal to Del Rosario: R2, R3 and R4 are each shown with their via; the tricycle is Recommended; 6 or fewer", () => {
    const p = plan(PLAZA_RIZAL, DEL_ROSARIO);
    const shown = vias(p);
    expect(shown.map((o) => rideCodes(o))).toEqual(expect.arrayContaining([["R2"], ["R3"], ["R4"]]));
    expect(shown).toHaveLength(3);
    const via = Object.fromEntries(shown.map((o) => [rideCodes(o)[0], o.via]));
    expect(via.R2).toEqual({ group: "VG-CENTRO-DELROSARIO", routeCode: "R2", label: "Magsaysay", note: "Locals may call it Francia (unconfirmed)" });
    expect(via.R3).toEqual({ group: "VG-CENTRO-DELROSARIO", routeCode: "R3", label: "Roxas (Diversion)", note: null });
    expect(via.R4).toEqual({ group: "VG-CENTRO-DELROSARIO", routeCode: "R4", label: "Panganiban", note: null });
    expect(p.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).toBe("tricycle");
    // Jeepneys stay ordered by score, before the tricycle.
    const scores = jeeps(p).map((o) => o.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(p.options.map((o) => o.mode).at(-1)).toBe("tricycle");
  });

  it("without the via data the same trip hides R4 (siblings on the shared corridor win)", () => {
    const base = plan(PLAZA_RIZAL, DEL_ROSARIO, []);
    expect(vias(base)).toHaveLength(0);
    expect(jeeps(base).flatMap(rideCodes)).not.toContain("R4");
  });

  it("only two vias qualify: just those two are shown with chips, no third", () => {
    const p = plan(...TWO_VIA);
    expect(vias(p).flatMap(rideCodes).sort()).toEqual(["R3", "R4"]);
    expect(jeeps(p).flatMap(rideCodes)).not.toContain("R2");
    expect(recommended(p)).toHaveLength(1);
  });

  it("Del Rosario to Plaza Rizal shows the vias too (either end)", () => {
    const p = plan(DEL_ROSARIO, PLAZA_RIZAL);
    expect(vias(p).flatMap(rideCodes).sort()).toEqual(["R2", "R3", "R4"]);
    expect(recommended(p)).toHaveLength(1);
  });

  it("an ordinary Centro hop served by R2 and R4 has no via options (the group needs an end at Del Rosario)", () => {
    const o = { lat: 13.624424756282671, lng: 123.18201845070709 };
    const d = { lat: 13.626305849487222, lng: 123.18997667235419 };
    expect(group.endAnchors).toEqual([12717296946]);
    expect(vias(plan(o, d))).toHaveLength(0);
    expect(JSON.stringify(plan(o, d))).toBe(JSON.stringify(plan(o, d, [])));
    // The same hop with the filter removed from a test-only copy of the data did show them.
    expect(vias(plan(o, d, [{ ...group, endAnchors: undefined }])).length).toBeGreaterThanOrEqual(2);
  });

  it("a trip outside Del Rosario is unchanged: no chips and the same plan as with no via data", () => {
    const p = plan(PLAZA_RIZAL, SM_CITY);
    expect(vias(p)).toHaveLength(0);
    expect(JSON.stringify(p)).toBe(JSON.stringify(plan(PLAZA_RIZAL, SM_CITY, [])));
  });

  it("a via chip appears only on a one-ride option of a group route; a plan without chips equals the plan without via data", () => {
    const city = fc.record({ lat: fc.double({ min: 13.6, max: 13.67, noNaN: true }), lng: fc.double({ min: 123.17, max: 123.32, noNaN: true }) });
    fc.assert(
      fc.property(city, city, (o, d) => {
        fc.pre(isInsideNaga(o) && isInsideNaga(d));
        const p = plan(o, d);
        if (p.coverage === "none") return;
        expect(p.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
        const chips = vias(p);
        for (const x of chips) {
          expect(x.rides).toBe(1);
          expect(group.routes.map((r) => r.routeCode)).toContain(x.via!.routeCode);
          expect(rideCodes(x)).toEqual([x.via!.routeCode]);
        }
        // A group is active only with 2+ routes, so one route's chip never stands alone.
        expect(new Set(chips.map((x) => x.via!.routeCode)).size).not.toBe(1);
        if (chips.length === 0) expect(JSON.stringify(p)).toBe(JSON.stringify(plan(o, d, [])));
        expect(recommended(p).length).toBeLessThanOrEqual(1);
      }),
      { seed: 20261018, numRuns: 100 },
    );
  }, 60_000);
});

describe("via groups: data-driven, budget and trim order", () => {
  it("a 4th via is a data edit: appended to a test-only copy of the data, it gets a chip like the others", () => {
    const [o, d] = R1_R8D;
    // Real data: none of R2-R4 reaches this trip, so no chips. Adding R1 alone leaves one route: still none.
    expect(vias(plan(o, d))).toHaveLength(0);
    // The fake group is anchored at this trip's own nearest barangay anchors, so the geography filter passes.
    const here = [nearestAnchorId(o, FAR_AREAS)!, nearestAnchorId(d, FAR_AREAS)!];
    const withR1: ViaGroup = { ...group, endAnchors: [...here, ...group.endAnchors!], routes: [...group.routes, { routeCode: "R1", via: "Fake Road" }] };
    expect(vias(plan(o, d, [withR1]))).toHaveLength(0);
    // R1 and R8-D appended: two routes of the group qualify, each shown with its own via label and note.
    const withBoth: ViaGroup = { ...withR1, routes: [...withR1.routes, { routeCode: "R8-D", via: "Other Road", aliasNote: "Fake alias" }] };
    const p = plan(o, d, [withBoth]);
    expect(vias(p).map((x) => x.via)).toEqual(expect.arrayContaining([
      { group: group.code, routeCode: "R1", label: "Fake Road", note: null },
      { group: group.code, routeCode: "R8-D", label: "Other Road", note: "Fake alias" },
    ]));
    // The real corridor on the real trip is unaffected by the copy.
    expect(vias(plan(PLAZA_RIZAL, DEL_ROSARIO, [withBoth])).flatMap(rideCodes).sort()).toEqual(["R2", "R3", "R4"]);
  });

  it("the budget is 6 minus the walk, tricycle and padyak options; non-via extras are trimmed first and their label goes with them", () => {
    const [o, d] = TRIM;
    const base = plan(o, d, []);
    expect(base.options.map((x) => x.mode)).toEqual(["walk", "jeepney", "jeepney", "tricycle", "padyak"]);
    const baseExtra = jeeps(base).find((x) => rideCodes(x).length === 2)!; // R4>R2, a non-via extra holding "Least walking"
    expect(baseExtra.labels).toContain("Least walking");
    const p = plan(o, d, [everyRouteAVia]);
    expect(p.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
    const block = jeeps(p);
    expect(block).toHaveLength(MAX_OPTIONS - (p.options.length - block.length));
    expect(block).toHaveLength(3); // walk + tricycle + padyak leave 3
    // The best-score option stays; the two-ride non-via extra is dropped and its label is not moved to another option.
    expect(block[0]!.id).toBe(jeeps(base)[0]!.id);
    expect(block.map((x) => x.id)).not.toContain(baseExtra.id);
    expect(p.options.flatMap((x) => x.labels)).not.toContain("Least walking");
    expect(block.every((x) => x.via !== undefined)).toBe(true);
    // Vias are kept by score, ordered by score.
    expect(block.map((x) => x.score)).toEqual([...block.map((x) => x.score)].sort((a, b) => a - b));
    expect(recommended(p)).toHaveLength(1);
    expect(recommended(p)[0]!.mode).toBe("walk");
  });

  it("with every route a via, plans stay within budget, keep the best-score option and Recommended, and never move a label", () => {
    const point = fc.record({ lat: fc.double({ min: 13.6, max: 13.67, noNaN: true }), lng: fc.double({ min: 123.17, max: 123.32, noNaN: true }) });
    fc.assert(
      fc.property(point, fc.double({ min: -0.006, max: 0.006, noNaN: true }), fc.double({ min: -0.006, max: 0.006, noNaN: true }), (o, dLat, dLng) => {
        const d = { lat: o.lat + dLat, lng: o.lng + dLng };
        fc.pre(isInsideNaga(o) && isInsideNaga(d));
        const base = plan(o, d, []);
        const p = plan(o, d, [everyRouteAVia]);
        if (p.coverage === "none") return;
        expect(p.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
        const others = p.options.length - jeeps(p).length;
        expect(jeeps(p).length).toBeLessThanOrEqual(Math.max(1, MAX_OPTIONS - others));
        expect(recommended(p).length).toBe(recommended(base).length);
        if (jeeps(base).length > 0) expect(jeeps(p)[0]!.id).toBe(jeeps(base)[0]!.id);
        // Labels stay on the option that had them (or vanish with it).
        for (const x of p.options) for (const l of x.labels) expect(base.options.find((b) => b.id === x.id)?.labels).toContain(l);
        expect(new Set(p.options.map((x) => x.id)).size).toBe(p.options.length);
      }),
      { seed: 20261019, numRuns: 120 },
    );
  }, 120_000);
});

describe("via groups: response schema and old bodies", () => {
  it("the via survives buildPlanResponse and the response schema", () => {
    const p = plan(PLAZA_RIZAL, DEL_ROSARIO);
    const body = planResponseSchema.parse(buildPlanResponse(snap, p, lines));
    expect(body.plan.options.flatMap((o) => (o.via ? [o.via.label] : [])).sort()).toEqual(["Magsaysay", "Panganiban", "Roxas (Diversion)"]);
    expect(body.plan.options.find((o) => o.via?.routeCode === "R2")!.via!.note).toBe("Locals may call it Francia (unconfirmed)");
  });

  it("an older body without via parses, with no via; a non-chip plan serializes without a via key", () => {
    const p = plan(PLAZA_RIZAL, SM_CITY);
    expect(JSON.stringify(p)).not.toContain('"via"');
    const raw = JSON.parse(JSON.stringify(buildPlanResponse(snap, plan(PLAZA_RIZAL, DEL_ROSARIO), lines)));
    for (const o of raw.plan.options) delete o.via;
    const parsed = planResponseSchema.parse(raw);
    expect(parsed.plan.options.every((o) => o.via === undefined)).toBe(true);
    const one = raw.plan.options.find((o: { mode: string }) => o.mode === "jeepney");
    expect(planOptionSchema.parse(one).via).toBeUndefined();
    expect(planOptionSchema.safeParse({ ...one, via: { group: "G", routeCode: "R2" } }).success).toBe(false);
  });
});
