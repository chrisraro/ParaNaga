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
import { decodePolyline, encodePolyline } from "@/domain/geo/polyline";
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

describe("enrichPlan", () => {
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

  it("never drops or relabels options: the planner decides (D14 re-check is gone)", () => {
    const g = buildTestGraph();
    // 1120 m on the graph against a 100 m direct walk: this used to vanish as "walk_shorter".
    const detour = makeOption("opt-detour", ["Recommended", "Fewest transfers"], { lat: 13.621, lng: 123.182 }, { lat: 13.62, lng: 123.185 }, { accessM: 150, egressM: 10 });
    const raw: PlanResponse = { ...basePlan(), plan: { ...basePlan().plan, directWalkEstimateMeters: 100, options: [detour] } };
    for (const enriched of [enrichPlan(raw, g), enrichPlan(raw, null, { walkGraphStatus: "error" }), enrichPlan(raw, null, { walkGraphStatus: "loading" })]) {
      expect(enriched.plan.coverage).toBe("provisional");
      expect(enriched.plan.options.map((o) => ({ id: o.id, labels: o.labels }))).toEqual([{ id: "opt-detour", labels: ["Recommended", "Fewest transfers"] }]);
    }
  });

  it("routes a legacy walk leg (no path) but leaves a planner street path untouched", () => {
    const g = buildTestGraph();
    const opt = makeOption("opt", ["Recommended"], { lat: 13.62, lng: 123.182 }, { lat: 13.62, lng: 123.185 }, { accessM: 180, egressM: 10 });
    const planned = encodePolyline([{ lat: 13.62, lng: 123.18 }, { lat: 13.6203, lng: 123.181 }, { lat: 13.62, lng: 123.182 }]);
    const [access, ride, egress] = opt.legs;
    if (access?.kind !== "walk" || egress?.kind !== "walk" || !ride) throw new Error("fixture shape");
    const mixed: PlanOptionDto = { ...opt, legs: [{ ...access, path: planned, basis: "street_graph", estimateMeters: 321 }, ride, egress] };
    const enriched = enrichPlan({ ...basePlan(), plan: { ...basePlan().plan, options: [mixed] } }, g).plan.options[0]!;
    const [a, , e] = enriched.legs;
    if (a?.kind !== "walk" || e?.kind !== "walk") throw new Error("walk legs expected");
    // Street-graph leg: the planner's own coordinates and length, not re-routed on the phone's graph.
    expect(a.path).toMatchObject({ kind: "path", lengthM: 321, label: WALK_PATH_LABEL });
    expect(a.path.coords).toEqual(decodePolyline(planned));
    // Legacy leg: routed on the walk graph.
    expect(e.path.kind).toBe("path");
    expect(e.path.lengthM).not.toBe(e.estimateMeters);
    // And a planned leg needs no graph at all.
    const noGraph = enrichPlan({ ...basePlan(), plan: { ...basePlan().plan, options: [mixed] } }, null, { walkGraphStatus: "error" }).plan.options[0]!.legs[0]!;
    expect(noGraph.kind === "walk" && noGraph.path.kind).toBe("path");
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
