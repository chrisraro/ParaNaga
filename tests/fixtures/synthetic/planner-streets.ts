// SYNTHETIC street world for the planner tests (plan E Task 6). Not real streets, routes or fares:
// a metre grid near Plaza Rizal (planner-network.ts `at`). Never imported by src/ or shipped.
//
//   n = 300  ── "Upper St" (residential), e = −200 … 4000, nodes every 200 m
//   cross streets (residential) every 400 m (e = −200, 200, 600, …)
//   n = 0    ── "Roxas Avenue" (primary, tricycle rule TRI-2006 on the whole way), nodes every 200 m
//   spur     ── residential dead end from Roxas at e = 3200 south to n = −200 (a daytime tricycle pocket)
//   padyak area PX-T: anchors at (0, 150) and (2400, 150) (1,000 m each)
//   Lines: Q (jeepney, outbound) along n = 0 from e = 2000 to 4000 (snapshot variant Q's id, pins Q1–Q3);
//          V (jeepney, outbound) north from (4000, 0) to (4000, 3000), off the street grid.
import type { FareRuleEstimate, NetworkSnapshot } from "@/domain/api/schemas";
import { encodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import type { ModesSeedPadyakArea, ModesSeedRoadRule } from "@/domain/import/modes-seed";
import type { PlaceNode, RoadWay } from "@/domain/import/osm-roads";
import type { PlanningLine } from "@/domain/planner/paths";
import { decodeWalkGraph, type WalkGraph } from "@/domain/walk/walk-graph";
import { buildStreetGraph } from "@/domain/walk/walk-graph-build";
import { at, fareRule, LINE_VARIANT_ID, SYNTHETIC_FARE_RULES, syntheticSnapshot } from "./planner-network";

export const synthetic = true as const;

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const xs = Array.from({ length: 22 }, (_, k) => -200 + 200 * k); // −200 … 4000
const nodes = new Map<number, LatLng>();
xs.forEach((e, k) => {
  nodes.set(1000 + k, at(e, 0));
  nodes.set(2000 + k, at(e, 300));
});
nodes.set(3000, at(3200, -200));
const way = (id: number, nodeIds: number[], tags: RoadWay["tags"]): RoadWay => ({ id, version: 1, timestamp: "2026-10-16T00:00:00Z", nodeIds, tags });
const ways: RoadWay[] = [
  way(1, xs.map((_, k) => 1000 + k), { highway: "primary", name: "Roxas Avenue" }),
  way(2, xs.map((_, k) => 2000 + k), { highway: "residential", name: "Upper St" }),
  ...xs.flatMap((_, k) => (k % 2 === 0 ? [way(10 + k, [1000 + k, 2000 + k], { highway: "residential" })] : [])),
  way(50, [1017, 3000], { highway: "residential", name: "Spur" }),
];
const places: PlaceNode[] = [
  { id: 9001, name: "Synthetic West", place: "neighbourhood", ...at(0, 150) },
  { id: 9002, name: "Synthetic East", place: "neighbourhood", ...at(2400, 150) },
];

const review = { decision: "import" as const, reason: "test", reviewedOn: "2026-10-17" };
const rules: ModesSeedRoadRule[] = [{
  code: "TRI-2006-P3", ruleCode: "TRI-2006", kind: "exclude", appliesTo: ["tricycle"], streets: ["Roxas Avenue"], ruleText: "test",
  enacted: "2006", exceptWindow: { from: "21:00", to: "05:00" }, geometry: "ways", wayIds: [1], clips: [], junctionNodeId: null,
  clipNote: "test", evidence: "official", sourceCodes: ["RT01", "RT02"], review,
}];
const areas: ModesSeedPadyakArea[] = [{
  code: "PX-T", area: "Synthetic", associations: [], barangays: ["Synthetic"], placeNodeIds: [9001, 9002], documentedYear: 2001,
  evidence: "official", sourceCodes: ["RP01"], review,
}];

/** The decoded synthetic street graph v2. */
export function syntheticStreets(): WalkGraph {
  return decodeWalkGraph(buildStreetGraph({ nodes, ways, places }, rules, areas, { roadSource: "TEST", minComponentNodes: 1 }).payload);
}

export const Q_ROUTE_ID = uuid(202);
export const V_VARIANT_ID = uuid(301);

const line = (variantId: string, routeId: string, routeCode: string, points: LatLng[]): PlanningLine => ({
  variantId, routeId, routeCode, routeName: `Synthetic line ${routeCode}`, mode: "jeepney", kind: "permanent", direction: "outbound",
  status: "ok", encoded: encodePolyline(points),
});

export function syntheticLines(): { lines: PlanningLine[] } {
  return {
    lines: [
      line(LINE_VARIANT_ID, Q_ROUTE_ID, "SYN-Q", [at(2000, 0), at(3000, 0), at(4000, 0)]),
      line(V_VARIANT_ID, uuid(302), "SYN-V", [at(4000, 0), at(4000, 1500), at(4000, 3000)]),
    ],
  };
}

export const TRIKE_PADYAK_RULES: FareRuleEstimate[] = [
  { ...fareRule("F03", 1500, 0), modeCode: "trimobile_e_trike_taxicle", baseKm: null, incrementCentavosPerKm: null },
  { ...fareRule("F04", 1000, 0), modeCode: "padyak", baseKm: null, incrementCentavosPerKm: null, discountedBaseCentavos: 800 },
];

/** The synthetic snapshot (pins Q1–Q3 on Q) with tricycle and padyak fare rules. */
export function streetSnapshot(): NetworkSnapshot {
  return { ...syntheticSnapshot(), fareRules: [...SYNTHETIC_FARE_RULES, ...TRIKE_PADYAK_RULES] };
}

/** A date at hh:mm Manila (UTC+8) on 2026-10-17. */
export const manila = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 17, hh - 8, mm));
