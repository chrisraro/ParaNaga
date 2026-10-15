// SYNTHETIC test data for the planner unit tests. Not real stops, routes or fares: invented
// positions laid out on a metre grid near Plaza Rizal so distances are easy to reason about.
// Lives under tests/fixtures/synthetic/ only and must never be imported by src/ or shipped.
import type { FareRuleEstimate, NetworkSnapshot } from "@/domain/api/schemas";
import type { LatLng } from "@/domain/geo/types";

export const synthetic = true as const;

export const ORIGIN_OF_GRID: LatLng = { lat: 13.6233869, lng: 123.1846726 };
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN_OF_GRID.lat * Math.PI) / 180);

/** A point `east` / `north` metres from the grid origin (flat approximation, fine at this scale). */
export function at(east: number, north: number): LatLng {
  return { lat: ORIGIN_OF_GRID.lat + north / M_PER_DEG_LAT, lng: ORIGIN_OF_GRID.lng + east / M_PER_DEG_LNG };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

type Spec = { code: string; e: number; n: number };
// Loop S (circular, 6 km rectangle): P1 → P2 → P3 → P4 → P5 → P6 → back to P1.
const LOOP: Spec[] = [
  { code: "P1", e: 0, n: 0 },
  { code: "P2", e: 1000, n: 0 },
  { code: "P3", e: 2000, n: 0 },
  { code: "P4", e: 2000, n: 1000 },
  { code: "P5", e: 1000, n: 1000 },
  { code: "P6", e: 0, n: 1000 },
];
// Line Q (not circular): starts 200 m east of P3 and runs east.
const LINE: Spec[] = [
  { code: "Q1", e: 2200, n: 0 },
  { code: "Q2", e: 3000, n: 0 },
  { code: "Q3", e: 4000, n: 0 },
];

export const STOP_ID: Record<string, string> = Object.fromEntries(
  [...LOOP, ...LINE].map((s, i) => [s.code, uuid(i + 1)]),
);
export const STOP_POS: Record<string, LatLng> = Object.fromEntries([...LOOP, ...LINE].map((s) => [s.code, at(s.e, s.n)]));

export const LOOP_VARIANT_ID = uuid(101);
export const LINE_VARIANT_ID = uuid(102);

export function fareRule(code: string, base: number, inc: number): FareRuleEstimate {
  return {
    code, modeCode: code === "F01" ? "traditional_jeepney" : "modern_jeepney", vehicleClass: null,
    baseCentavos: base, baseKm: 4, incrementCentavosPerKm: inc, discountPercent: null, discountedBaseCentavos: null,
    discountGroups: null, rounding: null, effectiveFrom: null, enactedOn: null, evidenceStatus: "synthetic",
    status: "reported", publishExact: false, isEstimate: true, sourceCodes: [],
  };
}

export const SYNTHETIC_FARE_RULES: FareRuleEstimate[] = [fareRule("F01", 1400, 200), fareRule("F02", 1700, 240)];

export function syntheticSnapshot(): NetworkSnapshot {
  return {
    revision: { revisionId: uuid(900), label: "SYNTHETIC test revision", kind: "provisional", publishedAt: null },
    stops: [...LOOP, ...LINE].map((s) => ({
      id: STOP_ID[s.code]!, name: `Synthetic ${s.code}`, ...STOP_POS[s.code]!, status: "candidate" as const,
      navigationApproved: false, source: { layer: "SYNTHETIC", code: s.code, label: `Synthetic ${s.code}` },
    })),
    variants: [
      {
        variantId: LOOP_VARIANT_ID, routeId: uuid(201), routeCode: "SYN-S", routeName: "Synthetic loop S",
        direction: "clockwise", kind: "permanent", evidenceLevel: "provisional", verification: "unverified",
        isCircular: true, stopIds: LOOP.map((s) => STOP_ID[s.code]!), mode: "jeepney",
      },
      {
        variantId: LINE_VARIANT_ID, routeId: uuid(202), routeCode: "SYN-Q", routeName: "Synthetic line Q",
        direction: "outbound", kind: "permanent", evidenceLevel: "provisional", verification: "unverified",
        isCircular: false, stopIds: LINE.map((s) => STOP_ID[s.code]!), mode: "jeepney",
      },
    ],
    fareRules: SYNTHETIC_FARE_RULES,
    terminals: [],
    routes: [],
  };
}
