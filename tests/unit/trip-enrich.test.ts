import { describe, expect, it } from "vitest";
import { planResponseSchema, type PlanOptionDto, type PlanResponse } from "@/domain/api/plan";
import {
  WALK_LOADING_LABEL,
  WALK_PATH_LABEL,
  WALK_STRAIGHT_LABEL,
  enrichOptionWalks,
  enrichPlan,
  walkPathLengths,
} from "@/domain/trip/enrich";
import { parseWalkGraph, type WalkGraph } from "@/domain/walk/walk-graph";
import walkGraphFixture from "../e2e/fixtures/network/walk-graph.json";
import { extractWalkLengths } from "@/ui/trip/eta-text";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";

const parsedFixture = parseWalkGraph(walkGraphFixture);
if (!parsedFixture.ok) throw new Error(parsedFixture.error);
const centroGraph = parsedFixture.graph;

/**
 * Small synthetic walk graph along latitude 13.6200:
 *   node 0: (13.62000, 123.18000)
 *   node 1: (13.62000, 123.18200)  ~ 216 m east, stored length 220.0 m (2200 dm)
 *   node 2: (13.62000, 123.18500)  ~ 325 m east, stored length 330.0 m (3300 dm)
 *   node 3: (13.62100, 123.18200)  detour north from node 1, stored length 900.0 m (9000 dm)
 */
function buildTestGraph(): WalkGraph {
  const res = parseWalkGraph({
    v: 1,
    roadSource: "OSMR-2026-10-16",
    bbox: [1361900, 12317900, 1362200, 12318600],
    nodes: [
      1362000, 12318000, // node 0
      0, 200, // node 1: 13.62000, 123.18200
      0, 300, // node 2: 13.62000, 123.18500
      100, -300, // node 3: 13.62100, 123.18200
    ],
    edges: [
      0, 1, 2200, 0, // 220 m
      1, 2, 3300, 0, // 330 m (direct walk 0 -> 2 is 550 m)
      1, 3, 9000, 0, // 900 m detour to node 3
    ],
    geom: [],
  });
  if (!res.ok) throw new Error(res.error);
  return res.graph;
}

const basePlan = (): PlanResponse => structuredClone(planResponseSchema.parse(PROVISIONAL_PLAN));

function makeOption(
  id: string,
  labels: PlanOptionDto["labels"],
  accessTo: { lat: number; lng: number },
  egressFrom: { lat: number; lng: number },
  opts: {
    origin?: { lat: number; lng: number };
    destination?: { lat: number; lng: number };
    accessM?: number;
    egressM?: number;
    rides?: number;
    rideMeters?: number;
    score?: number;
  } = {},
): PlanOptionDto {
  const base = basePlan().plan.options[0]!;
  const origin = opts.origin ?? { lat: 13.62, lng: 123.18 };
  const destination = opts.destination ?? { lat: 13.62, lng: 123.185 };
  const accessM = opts.accessM ?? 50;
  const egressM = opts.egressM ?? 50;
  const walkMeters = accessM + egressM;
  const walkEstimateMeters = Math.round(accessM * 1.3) + Math.round(egressM * 1.3);
  const rideLeg = base.legs.find((l) => l.kind === "ride")!;
  return {
    ...base,
    id,
    labels,
    rides: opts.rides ?? 1,
    walkMeters,
    walkEstimateMeters,
    rideMeters: opts.rideMeters ?? 1500,
    score: opts.score ?? walkEstimateMeters + 0.25 * (opts.rideMeters ?? 1500),
    legs: [
      {
        kind: "walk",
        from: { kind: "origin", lat: origin.lat, lng: origin.lng, stopId: null, name: null },
        to: { kind: "stop", lat: accessTo.lat, lng: accessTo.lng, stopId: rideLeg.stops[0]!.id, name: "Board Stop" },
        distanceMeters: accessM,
        estimateMeters: Math.round(accessM * 1.3),
        pathVerified: false,
        path: null,
        basis: "straight_x1_3",
      },
      rideLeg,
      {
        kind: "walk",
        from: { kind: "stop", lat: egressFrom.lat, lng: egressFrom.lng, stopId: rideLeg.stops.at(-1)!.id, name: "Alight Stop" },
        to: { kind: "destination", lat: destination.lat, lng: destination.lng, stopId: null, name: null },
        distanceMeters: egressM,
        estimateMeters: Math.round(egressM * 1.3),
        pathVerified: false,
        path: null,
        basis: "straight_x1_3",
      },
    ],
  };
}

describe("enrichPlan (Task 10, D14)", () => {
  it("routes each walk leg on the walk graph and attaches path metadata and label", () => {
    const insideCentro = makeOption(
      "centro-opt",
      ["Recommended"],
      { lat: 13.6238, lng: 123.1852 },
      { lat: 13.6258, lng: 123.1872 },
      {
        origin: { lat: 13.6234, lng: 123.1847 },
        destination: { lat: 13.6262, lng: 123.1876 },
        accessM: 60,
        egressM: 60,
      },
    );
    const plan: PlanResponse = {
      ...basePlan(),
      plan: {
        ...basePlan().plan,
        directWalkEstimateMeters: 600,
        options: [insideCentro],
      },
    };
    const enriched = enrichPlan(plan, centroGraph);
    expect(enriched.plan.coverage).toBe("provisional");
    expect(enriched.plan.options.length).toBe(1);
    for (const option of enriched.plan.options) {
      for (const leg of option.legs) {
        if (leg.kind !== "walk") continue;
        expect(leg.path).toBeDefined();
        expect(leg.path.kind).toBe("path");
        expect(leg.path.coords.length).toBeGreaterThanOrEqual(2);
        expect(leg.path.lengthM).toBeGreaterThan(0);
        expect(leg.path.label).toBe(WALK_PATH_LABEL);
      }
    }
  });

  it("keeps an option whose graph walk is shorter than the direct graph walk and drops one that is longer", () => {
    const g = buildTestGraph();
    // Direct walk from node 0 (13.62, 123.18) to node 2 (13.62, 123.185) is 220 + 330 = 550 m on the graph.
    // Option "short-walk": boards at node 1 (220 m graph walk) and alights at node 2 (0 m walk) -> 220 m < 550 m -> KEPT.
    // Option "detour-walk": boards at node 3 (220 + 900 = 1120 m graph walk, even though straight-line was short) -> 1120 m >= 550 m -> DROPPED.
    const shortOpt = makeOption(
      "opt-short",
      ["Least walking"],
      { lat: 13.62, lng: 123.182 }, // node 1
      { lat: 13.62, lng: 123.185 }, // node 2
      { accessM: 180, egressM: 10, score: 500 },
    );
    const detourOpt = makeOption(
      "opt-detour",
      ["Recommended", "Fewest transfers"],
      { lat: 13.621, lng: 123.182 }, // node 3 (900 m edge on graph!)
      { lat: 13.62, lng: 123.185 }, // node 2
      { accessM: 150, egressM: 10, score: 400 },
    );
    const raw: PlanResponse = {
      ...basePlan(),
      plan: {
        ...basePlan().plan,
        directWalkEstimateMeters: 700,
        options: [detourOpt, shortOpt],
      },
    };

    const enriched = enrichPlan(raw, g);
    expect(enriched.plan.coverage).toBe("provisional");
    expect(enriched.plan.options.map((o) => o.id)).toEqual(["opt-short"]);
    // Because "Recommended" was dropped, the remaining option is relabelled via pickLabelled.
    expect(enriched.plan.options[0]!.labels).toEqual(["Recommended", "Fewest transfers", "Least walking"]);
  });

  it("sets coverage to none and reason to walk_shorter when every ride option fails the D14 re-check", () => {
    const g = buildTestGraph();
    const detourOpt = makeOption(
      "opt-detour",
      ["Recommended", "Fewest transfers", "Least walking"],
      { lat: 13.621, lng: 123.182 }, // 1120 m on graph vs 550 m direct
      { lat: 13.62, lng: 123.185 },
      { accessM: 150, egressM: 10 },
    );
    const raw: PlanResponse = {
      ...basePlan(),
      plan: {
        ...basePlan().plan,
        directWalkEstimateMeters: 700,
        options: [detourOpt],
      },
    };

    const enriched = enrichPlan(raw, g);
    expect(enriched.plan.coverage).toBe("none");
    expect(enriched.plan.reason).toBe("walk_shorter");
    expect(enriched.plan.options).toEqual([]);
  });

  it("falls back to ×1.3 estimate comparisons when any walk leg or the direct walk is straight", () => {
    const g = buildTestGraph();
    // Egress stop is far from any graph edge (13.625, 123.185 > 100 m from bbox), so egress leg is straight.
    // Even if the access graph walk is 220 m, D14 must compare like-with-like using ×1.3 estimates:
    //   option estimate = round(100 * 1.3) + round(100 * 1.3) = 260 m < directWalkEstimateMeters (700 m) -> kept;
    //   failing option estimate = round(300 * 1.3) + round(300 * 1.3) = 780 m >= 700 m -> dropped.
    const keptOpt = makeOption(
      "opt-kept-straight",
      ["Recommended", "Fewest transfers"],
      { lat: 13.621, lng: 123.182 }, // node 3 (would fail graph comparison if mixed, 1120 m > 550 m)
      { lat: 13.625, lng: 123.185 }, // > 100 m off graph -> straight leg!
      { accessM: 100, egressM: 100, score: 400 },
    );
    const droppedOpt = makeOption(
      "opt-dropped-straight",
      ["Least walking"],
      { lat: 13.62, lng: 123.182 },
      { lat: 13.625, lng: 123.185 },
      { accessM: 300, egressM: 300, score: 900 },
    );
    const raw: PlanResponse = {
      ...basePlan(),
      plan: {
        ...basePlan().plan,
        directWalkEstimateMeters: 700,
        options: [keptOpt, droppedOpt],
      },
    };

    const enriched = enrichPlan(raw, g);
    expect(enriched.plan.options.map((o) => o.id)).toEqual(["opt-kept-straight"]);
    // Recommended was kept, so its existing labels stay intact.
    expect(enriched.plan.options[0]!.labels).toEqual(["Recommended", "Fewest transfers"]);
    const egress = enriched.plan.options[0]!.legs[2]!;
    expect(egress.kind === "walk" && egress.path.kind).toBe("straight");
    expect(egress.kind === "walk" && egress.path.label).toBe(WALK_STRAIGHT_LABEL);
  });

  it("relabels deterministically in PLAN_LABELS order when the Recommended option is dropped", () => {
    const g = buildTestGraph();
    const droppedRec = makeOption(
      "opt-a-dropped",
      ["Recommended"],
      { lat: 13.621, lng: 123.182 }, // 1120 m graph walk -> dropped
      { lat: 13.62, lng: 123.185 },
      { accessM: 80, egressM: 10, rides: 1, rideMeters: 800, score: 300 },
    );
    const fewTransfers = makeOption(
      "opt-b-fewest",
      ["Fewest transfers"],
      { lat: 13.62, lng: 123.182 }, // 220 m graph walk -> kept
      { lat: 13.62, lng: 123.185 },
      { accessM: 160, egressM: 20, rides: 1, rideMeters: 1600, score: 634 },
    );
    const leastWalk = makeOption(
      "opt-c-least-walk",
      ["Least walking"],
      { lat: 13.62, lng: 123.182 }, // 220 m graph walk -> kept
      { lat: 13.62, lng: 123.185 },
      { accessM: 90, egressM: 10, rides: 2, rideMeters: 900, score: 955 },
    );
    const raw: PlanResponse = {
      ...basePlan(),
      plan: {
        ...basePlan().plan,
        directWalkEstimateMeters: 700,
        options: [droppedRec, fewTransfers, leastWalk],
      },
    };

    const first = enrichPlan(raw, g);
    const second = enrichPlan(raw, g);
    expect(first).toEqual(second);
    expect(first.plan.options.map((o) => ({ id: o.id, labels: o.labels }))).toEqual([
      { id: "opt-b-fewest", labels: ["Recommended", "Fewest transfers"] },
      { id: "opt-c-least-walk", labels: ["Least walking"] },
    ]);
  });

  it("marks walk legs with the polite loading label while the walk graph is loading", () => {
    const plan = basePlan();
    const loading = enrichPlan(plan, null, { walkGraphStatus: "loading" });
    const firstWalk = loading.plan.options[0]!.legs[0]!;
    expect(firstWalk.kind).toBe("walk");
    if (firstWalk.kind === "walk") {
      expect(firstWalk.path.kind).toBe("straight");
      expect(firstWalk.path.label).toBe(WALK_LOADING_LABEL);
    }

    const failed = enrichPlan(plan, null, { walkGraphStatus: "error" });
    const failedWalk = failed.plan.options[0]!.legs[0]!;
    if (failedWalk.kind === "walk") {
      expect(failedWalk.path.kind).toBe("straight");
      expect(failedWalk.path.label).toBe(WALK_STRAIGHT_LABEL);
    }
  });

  it("D14 waits for the walk graph: no option is dropped while it loads, the check runs once it settles", () => {
    const g = buildTestGraph();
    const detourOpt = makeOption(
      "opt-detour",
      ["Recommended", "Fewest transfers", "Least walking"],
      { lat: 13.621, lng: 123.182 }, // 1120 m on the graph vs 550 m direct
      { lat: 13.62, lng: 123.185 },
      { accessM: 150, egressM: 10 },
    );
    const raw: PlanResponse = {
      ...basePlan(),
      plan: { ...basePlan().plan, directWalkEstimateMeters: 100, options: [detourOpt] },
    };
    const loading = enrichPlan(raw, null, { walkGraphStatus: "loading" });
    expect(loading.plan.coverage).toBe("provisional");
    expect(loading.plan.options.map((o) => o.id)).toEqual(["opt-detour"]);
    // Settled with the graph: the same option now fails D14 (it would have vanished a moment after showing).
    const ready = enrichPlan(raw, g, { walkGraphStatus: "ready" });
    expect(ready.plan.reason).toBe("walk_shorter");
    expect(ready.plan.options).toEqual([]);
    // Settled without a graph (error): the estimate comparison runs (160 m of walking vs a 100 m direct walk).
    expect(enrichPlan(raw, null, { walkGraphStatus: "error" }).plan.reason).toBe("walk_shorter");
  });
});

describe("walkPathLengths (saved cards use the cached graph)", () => {
  it("returns the lengths the trip options use: graph path lengths for walks, null for rides and without a graph", () => {
    const option = makeOption(
      "centro-opt",
      ["Recommended"],
      { lat: 13.6238, lng: 123.1852 },
      { lat: 13.6258, lng: 123.1872 },
      { origin: { lat: 13.6234, lng: 123.1847 }, destination: { lat: 13.6262, lng: 123.1876 }, accessM: 60, egressM: 60 },
    );
    const plan: PlanResponse = { ...basePlan(), plan: { ...basePlan().plan, directWalkEstimateMeters: 600, options: [option] } };
    const enriched = enrichPlan(plan, centroGraph).plan.options[0]!;
    const lengths = walkPathLengths(option, centroGraph);
    expect(lengths).toEqual(extractWalkLengths(enriched.legs));
    expect(lengths.some((m) => typeof m === "number")).toBe(true);
    expect(option.legs.every((leg, i) => (leg.kind === "walk") === (lengths[i] !== null))).toBe(true);
    expect(walkPathLengths(option, null)).toEqual(option.legs.map(() => null));
  });
});

describe("enrichOptionWalks (guided walks)", () => {
  const option = () => basePlan().plan.options[0]!;

  it("without a walk graph every walk keeps the straight fallback and rides are untouched", () => {
    const out = enrichOptionWalks(option(), null);
    const walks = out.legs.filter((l) => l.kind === "walk");
    expect(walks.length).toBeGreaterThan(0);
    for (const w of walks) expect(w.kind === "walk" && w.path.kind).toBe("straight");
    expect(out.legs.filter((l) => l.kind === "ride")).toEqual(option().legs.filter((l) => l.kind === "ride"));
  });

  it("with the walk graph on the phone walks get the same routing as the plan's", () => {
    const out = enrichOptionWalks(option(), centroGraph);
    const viaPlan = enrichPlan(basePlan(), centroGraph).plan.options.find((o) => o.id === option().id);
    const paths = (o: typeof out) => o.legs.flatMap((l) => (l.kind === "walk" ? [l.path.kind] : []));
    if (viaPlan) expect(paths(out)).toEqual(paths(viaPlan as typeof out));
    expect(paths(out).length).toBeGreaterThan(0);
  });
});
