// planTrip (plan E §A–§D, Task 6) on the synthetic street world: path-based rides, graph walks,
// recommendation rules, tricycle and padyak options, the graph-null fallback, and properties.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RouteFareReport } from "@/domain/api/schemas";
import { haversineMeters } from "@/domain/geo/geometry";
import { decodePolyline } from "@/domain/geo/polyline";
import { isInsideNaga } from "@/domain/geo/naga";
import { fleetSummary } from "@/domain/modes/fleet";
import {
  planningNetwork, planTrip, type PadyakLeg, type PlannerNetwork, type PlanOption, type RideLeg, type TricycleLeg, type WalkLeg,
} from "@/domain/planner/plan";
import { LINE_VARIANT_ID, STOP_ID, at } from "../fixtures/synthetic/planner-network";
import { manila, Q_ROUTE_ID, streetSnapshot, syntheticLines, syntheticStreets, synthetic, V_VARIANT_ID } from "../fixtures/synthetic/planner-streets";

const snap = streetSnapshot();
const streets = syntheticStreets();
const lines = syntheticLines();
const NET = { lines, streets };
const TEN = manila(10);
const plan = (o: ReturnType<typeof at>, d: ReturnType<typeof at>, net: PlannerNetwork = NET, now = TEN, s = snap) => planTrip(s, net, o, d, { now });
const rideLegs = (o: PlanOption) => o.legs.filter((l): l is RideLeg => l.kind === "ride");
const walkLegs = (o: PlanOption) => o.legs.filter((l): l is WalkLeg => l.kind === "walk");
const modes = (p: ReturnType<typeof plan>) => p.options.map((o) => o.mode);
const ORDER = ["walk", "jeepney", "tricycle", "padyak"];

describe("planTrip: recommendation rules (plan E §B)", () => {
  it("uses a fixture explicitly marked synthetic, inside Naga", () => {
    expect(synthetic).toBe(true);
    for (const p of [at(-200, -200), at(4000, 3000), at(3200, -200)]) expect(isInsideNaga(p)).toBe(true);
  });

  it("450 m apart: walk first and Recommended, tricycle after it, unlabelled; the jeepney that walks more is dropped", () => {
    const p = plan(at(2400, 300), at(2850, 300));
    expect(p.directWalkEstimateMeters).toBe(450);
    expect(modes(p)).toEqual(["walk", "tricycle", "padyak"]);
    expect(p.options[0]).toMatchObject({ id: "walk", labels: ["Recommended"], rides: 0 });
    expect(walkLegs(p.options[0]!)[0]).toMatchObject({ basis: "street_graph", estimateMeters: 450 });
    expect(p.options[1]).toMatchObject({ id: "tricycle", labels: [] });
    expect(p.jeepneyReason).toBe("walk_shorter"); // Q passes 300 m away: 600 m of walking ≥ 450 m direct
  });

  it("< 500 m, the best jeepney passes the destination (drop-off ≤ 100 m): jeepney Recommended, walk first unlabelled", () => {
    const p = plan(at(2400, 10), at(2850, 10));
    expect(p.directWalkEstimateMeters).toBeLessThan(500);
    expect(modes(p).slice(0, 2)).toEqual(["walk", "jeepney"]);
    expect(p.options[0]!.labels).toEqual([]);
    expect(p.options[1]!.labels[0]).toBe("Recommended");
    expect(p.options.find((o) => o.mode === "tricycle")!.labels).toEqual([]);
  });

  it("< 500 m, the best jeepney drops off > 100 m from the destination: walk Recommended, jeepney keeps its own labels", () => {
    const p = plan(at(2700, 10), at(3000, 150));
    expect(p.directWalkEstimateMeters).toBeLessThan(500);
    expect(modes(p).slice(0, 2)).toEqual(["walk", "jeepney"]);
    expect(p.options[0]!.labels).toEqual(["Recommended"]);
    expect(p.options[1]!.labels).not.toContain("Recommended");
    expect(p.options.find((o) => o.mode === "tricycle")!.labels).toEqual([]);
  });

  it("520 m: no walk card, cheapest jeepney option first and Recommended, tricycle after them", () => {
    const p = plan(at(2400, 10), at(2920, 10));
    expect(p.directWalkEstimateMeters).toBeGreaterThanOrEqual(500);
    expect(modes(p).filter((m) => m !== "padyak")).toEqual(["jeepney", "tricycle"]);
    expect(p.options[0]!.labels).toContain("Recommended");
    expect(p.options.find((o) => o.mode === "tricycle")!.labels).toEqual([]);
    expect(p.notes.some((n) => /Walking the whole way is about \d+ m along streets/.test(n))).toBe(true);
    expect(p.jeepneyReason).toBeNull();
  });

  it("no jeepney near the start: only tricycle (and padyak inside the area), with jeepneyReason", () => {
    const p = plan(at(0, 300), at(800, 300));
    expect(p).toMatchObject({ coverage: "provisional", reason: null, jeepneyReason: "no_path_near_origin" });
    expect(modes(p)).toEqual(["tricycle", "padyak"]);
    expect(p.options[0]!.labels).toEqual(["Recommended"]);
    expect(plan(at(2400, 10), at(0, 300)).jeepneyReason).toBe("no_path_near_destination");
  });

  it("must-save-walking applies inside pair selection: every jeepney option walks less than the direct walk", () => {
    for (const [o, d] of [[at(2400, 10), at(2920, 10)], [at(2100, 200), at(3900, 250)], [at(2400, 300), at(2850, 300)]] as const) {
      const p = plan(o, d);
      for (const x of p.options.filter((y) => y.mode === "jeepney")) expect(x.walkMeters).toBeLessThan(p.directWalkEstimateMeters!);
    }
  });

  it("same place and outside the city plan nothing", () => {
    expect(plan(at(2400, 10), at(2410, 10))).toMatchObject({ coverage: "none", reason: "same_place", options: [] });
    expect(plan({ lat: 14.5, lng: 121 }, at(0, 0))).toMatchObject({ coverage: "none", reason: "outside_city", options: [] });
  });
});

describe("planTrip: jeepney rides on free points (plan E §A, §D)", () => {
  it("boards and gets off along the path, named by the nearest pin, priced on the ride", () => {
    const p = plan(at(2950, 20), at(3980, 20));
    const o = p.options.find((x) => x.mode === "jeepney")!;
    const r = rideLegs(o)[0]!;
    expect(r).toMatchObject({
      variantId: LINE_VARIANT_ID, distanceBasis: "approximate_path", approximate: true, boardingVerified: false, pathVerified: false,
      board: { stopId: STOP_ID.Q2, name: "Synthetic Q2" }, alight: { stopId: STOP_ID.Q3 },
    });
    expect(r.distanceMeters).toBe(Math.round(r.alightMeasureM! - r.boardMeasureM!));
    expect(r.stops.map((s) => s.id)).toEqual([STOP_ID.Q2, STOP_ID.Q3]); // the named end pins (Q3, 20 m past the alight point, ends the ride)
    expect(o.id).toBe(`${LINE_VARIANT_ID}@${Math.round(r.boardMeasureM! / 10) * 10}-${Math.round(r.alightMeasureM! / 10) * 10}`);
    expect(r.fare).toMatchObject({ minCentavos: 1400, status: "estimate" });
    const [access, egress] = walkLegs(o);
    expect(access).toMatchObject({ basis: "street_graph", to: { kind: "point", stopId: STOP_ID.Q2 } });
    expect(decodePolyline(access!.path!).length).toBeGreaterThanOrEqual(2);
    expect(egress!.to.kind).toBe("destination");
  });

  it("transfers between two lines (0 m on a shared point), at most two rides", () => {
    const p = plan(at(2100, -50), at(4050, 2000), { lines, streets: null });
    const o = p.options.find((x) => x.mode === "jeepney")!;
    expect(rideLegs(o).map((r) => r.variantId)).toEqual([LINE_VARIANT_ID, V_VARIANT_ID]);
    expect(o.rides).toBe(2);
    expect(o.id.split(">")).toHaveLength(2);
    expect(walkLegs(o)[1]).toMatchObject({ estimateMeters: 0 });
  });

  it("adds route notes near the board/alight point or destination, general notes, and the flagged-path note", () => {
    const s = {
      ...snap,
      routes: [{
        routeId: Q_ROUTE_ID, routeCode: "SYN-Q", routeName: "Synthetic line Q", mode: "jeepney" as const, serviceStatus: null,
        fleet: fleetSummary([], "jeepney"), fareReports: [],
        notes: [
          { text: "Near Q3 note", evidence: "community" as const, sourceCodes: ["SYN"], near: { ...at(4000, 0), radiusM: 150 } },
          { text: "Far note", evidence: "community" as const, sourceCodes: ["SYN"], near: { ...at(0, 3000), radiusM: 150 } },
          { text: "General note", evidence: "owner_report_unverified" as const, sourceCodes: ["SYN"], near: null },
        ],
      }],
    };
    const flagged = { lines: { lines: lines.lines.map((l) => ({ ...l, status: "flagged" as const })) }, streets };
    const r = rideLegs(plan(at(2950, 20), at(3980, 20), flagged, TEN, s).options.find((x) => x.mode === "jeepney")!)[0]!;
    expect(r.notes[0]).toBe("Near Q3 note");
    expect(r.notes[1]).toBe("General note");
    expect(r.notes[2]).toMatch(/^Part of this approximate path disagrees with the street map/);
    expect(r.notes).not.toContain("Far note");
  });

  it("copies the route's fleet and prices a mixed fleet with the riders' report", () => {
    const MIXED = fleetSummary([
      { code: "FL-SYN-TRAD", vehicleClass: "traditional_puj", evidenceLevels: ["legal_plan"], status: "operating",
        firstReportedOn: null, lastReportedOn: null, unitsNote: null, aircon: null, airconSourceCodes: [], cooperatives: [], sourceCodes: ["SYN"] },
      { code: "FL-SYN-MOD", vehicleClass: "modern_puj", evidenceLevels: ["owner_confirmation"], status: "operating",
        firstReportedOn: null, lastReportedOn: null, unitsNote: null, aircon: null, airconSourceCodes: [], cooperatives: [], sourceCodes: ["SYN"] },
    ], "jeepney");
    const REPORT: RouteFareReport = { code: "FO-SYN-MOD", vehicleClass: "modern_puj", deltaQualifier: "range", deltaCentavosLow: 300,
      deltaCentavosHigh: 500, observedOn: "2026-10-16", sourceCodes: ["SYN"] };
    const s = { ...snap, routes: [{ routeId: Q_ROUTE_ID, routeCode: "SYN-Q", routeName: "Q", mode: "jeepney" as const, serviceStatus: null, fleet: MIXED, fareReports: [REPORT], notes: [] }] };
    const r = rideLegs(plan(at(2950, 20), at(3980, 20), NET, TEN, s).options.find((x) => x.mode === "jeepney")!)[0]!;
    expect(r.fleet).toEqual(MIXED);
    expect(r.fare).toMatchObject({ span: "traditional_to_modern", basis: "fare_rules_and_reports", reportCodes: ["FO-SYN-MOD"] });
  });
});

describe("planTrip: tricycle and padyak (plan E §C)", () => {
  it("tricycle: F03 minimum, no minutes, street path; avoids Roxas Ave at 10:00 and says so", () => {
    const t = plan(at(200, 0), at(1800, 0)).options.find((o) => o.mode === "tricycle")!;
    const leg = t.legs[0] as TricycleLeg;
    expect(leg).toMatchObject({ kind: "tricycle", basis: "street_graph", fare: { minCentavos: 1500, maxCentavos: null, status: "minimum", ruleCodes: ["F03"] } });
    expect(leg.distanceMeters).toBeGreaterThan(2100); // up the cross street, along Upper St, back down
    expect(leg.notes).toContain("Avoids the restricted roads we could locate (Ordinance 2006-005/015 · check for updates; allowed 9 pm–5 am)");
    expect(leg.notes).toContain("Tricycle time not estimated");
    expect(t.fare).toMatchObject({ minCentavos: 1500, maxCentavos: null, status: "minimum" });
    expect(JSON.stringify(t)).not.toMatch(/minute|ETA|arriv/i);
  });

  it("tricycle at 22:00 Manila may use Roxas Ave and says so", () => {
    const leg = plan(at(200, 0), at(1800, 0), NET, manila(22)).options.find((o) => o.mode === "tricycle")!.legs[0] as TricycleLeg;
    expect(leg.distanceMeters).toBeLessThan(1700);
    expect(leg.ruleCodes).toEqual(["TRI-2006"]);
    expect(leg.notes).toContain("Uses roads tricycles may use only 9 pm–5 am (Ordinance 2006-005/015 · check for updates)");
  });

  it("a daytime tricycle pocket gives a straight-line distance flagged 'route not confirmed', never a drawn path", () => {
    const leg = plan(at(3200, -200), at(600, 300)).options.find((o) => o.mode === "tricycle")!.legs[0] as TricycleLeg;
    expect(leg).toMatchObject({ basis: "straight_line", path: null });
    expect(leg.distanceMeters).toBeGreaterThan(0);
    expect(leg.notes[0]).toMatch(/^Route not confirmed/);
    expect(leg.notes.some((n) => n.startsWith("Avoids"))).toBe(false); // no routed avoidance is claimed
  });

  it("padyak only when both ends share the area and the street path is ≤ 2,000 m; ₱10 flat (₱8 with ID), no minutes", () => {
    const p = plan(at(0, 300), at(800, 300));
    const o = p.options.at(-1)!;
    expect(o).toMatchObject({ id: "padyak:PX-T", mode: "padyak", labels: ["Short local ride"] });
    const leg = o.legs[0] as PadyakLeg;
    expect(leg.fare).toEqual({ minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger", discountedCentavos: 800, ruleCodes: ["F04"] });
    expect(leg.notes).toContain("Padyak time not estimated");
    expect(modes(plan(at(0, 300), at(3800, 300)))).not.toContain("padyak"); // the far end is outside the area
    expect(modes(plan(at(0, 300), at(2400, 300)))).not.toContain("padyak"); // both inside, path 2,400 m
  });

  it("without a street graph: ×1.3 walks labelled, tricycle without a distance, no padyak", () => {
    const p = plan(at(2950, 20), at(3980, 20), { lines, streets: null });
    expect(p.directWalkEstimateMeters).toBe(Math.round(haversineMeters(at(2950, 20), at(3980, 20)) * 1.3));
    for (const w of p.options.flatMap(walkLegs)) expect(w).toMatchObject({ basis: "straight_x1_3", path: null });
    const t = p.options.find((o) => o.mode === "tricycle")!.legs[0] as TricycleLeg;
    expect(t).toMatchObject({ distanceMeters: null, path: null, basis: "unavailable" });
    expect(t.notes).toContain("Street route not available");
    expect(modes(p)).not.toContain("padyak");
  });

  it("without Lines: no jeepney options, tricycle still offered", () => {
    expect(modes(plan(at(2950, 20), at(3980, 20), { lines: null, streets }))[0]).toBe("tricycle");
  });
});

describe("planningNetwork memo", () => {
  it("builds once per Lines object and snapshot; another snapshot or Lines object rebuilds", () => {
    const net = planningNetwork(snap, lines);
    expect(planningNetwork(snap, lines)).toBe(net);
    expect(planningNetwork({ ...snap }, lines)).not.toBe(net);
    expect(planningNetwork(snap, { lines: [...lines.lines] })).not.toBe(net);
    expect(planningNetwork(snap, null).variants).toEqual([]);
  });
});

describe("planTrip: cached network and walks give identical plans", () => {
  const trips: [ReturnType<typeof at>, ReturnType<typeof at>][] = [
    [at(2100, -50), at(4050, 2000)],
    [at(2400, 300), at(2850, 300)],
    [at(2100, -50), at(3000, 1500)],
  ];
  it("the same request twice, and a fresh network, plan byte-identically with and without streets", () => {
    for (const net of [NET, { lines, streets: null }]) {
      for (const [o, d] of trips) {
        const fresh = JSON.stringify(plan(o, d, net, TEN, { ...snap }));
        const first = JSON.stringify(plan(o, d, net));
        const again = JSON.stringify(plan(o, d, net));
        expect(again).toBe(first);
        expect(first).toBe(fresh);
      }
    }
  });
});

describe("planTrip: properties", () => {
  it("≤ 6 options in order walk → jeepney → tricycle → padyak, unique ids, walks within caps, deterministic", () => {
    const point = fc.record({ e: fc.integer({ min: -200, max: 4000 }), n: fc.integer({ min: -200, max: 400 }) }).map(({ e, n }) => at(e, n));
    fc.assert(
      fc.property(point, point, fc.integer({ min: 0, max: 23 }), (o, d, hh) => {
        const p = plan(o, d, NET, manila(hh));
        if (p.coverage === "none") return;
        expect(p.options.length).toBeLessThanOrEqual(6);
        const idx = p.options.map((x) => ORDER.indexOf(x.mode));
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        expect(new Set(p.options.map((x) => x.id)).size).toBe(p.options.length);
        expect(p.options.filter((x) => x.mode === "tricycle")).toHaveLength(1);
        expect(p.options.filter((x) => x.labels.includes("Recommended"))).toHaveLength(1);
        for (const x of p.options) expect(x.labels.includes("Short local ride")).toBe(x.mode === "padyak");
        expect(p.options.some((x) => x.mode === "walk")).toBe(p.directWalkEstimateMeters! < 500);
        for (const x of p.options.filter((y) => y.mode === "jeepney")) {
          const w = walkLegs(x);
          w.forEach((l, i) => expect(l.estimateMeters).toBeLessThanOrEqual(i === 0 || i === w.length - 1 ? 750 : 450));
          expect(x.rides).toBeLessThanOrEqual(2);
          expect(x.walkMeters).toBeLessThan(p.directWalkEstimateMeters!);
        }
        expect(plan(o, d, NET, manila(hh))).toEqual(p);
      }),
      { seed: 20261017, numRuns: 150 },
    );
  }, 60_000);
});
