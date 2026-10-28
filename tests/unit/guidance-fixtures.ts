// Shared builders for the guidance tests: provisional plan options with 0, 1 or 2 rides on a
// straight line of pins near Plaza Rizal (≈ 200 m apart, northward).
import type { PlanOptionDto } from "@/domain/api/plan";
import type { GuidanceTrip } from "@/domain/guidance/steps";
import { fleetSummary } from "@/domain/modes/fleet";
import { ETA_MODEL } from "./eta-fixtures";

export const BASE = { lat: 13.6233869, lng: 123.1846726 };
/** ≈ 200 m of latitude. */
export const STEP_LAT = 0.0018;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type Pin = { id: string; name: string; lat: number; lng: number };
export const pin = (n: number, name = `Stop ${n}`, at = { lat: BASE.lat + n * STEP_LAT, lng: BASE.lng }): Pin => ({ id: uuid(n), name, ...at });

const place = (kind: "origin" | "destination" | "stop", p: { lat: number; lng: number }, s: Pin | null = null) => ({
  kind,
  lat: p.lat,
  lng: p.lng,
  stopId: s ? s.id : null,
  name: s ? s.name : null,
});

export const walk = (from: ReturnType<typeof place>, to: ReturnType<typeof place>, distanceMeters: number) => ({
  kind: "walk" as const,
  from,
  to,
  distanceMeters,
  estimateMeters: Math.round(distanceMeters * 1.3),
  pathVerified: false as const,
  path: null,
  basis: "straight_x1_3" as const,
});

export const ride = (stops: Pin[], variant: number, routeCode: string, routeName: string) => ({
  kind: "ride" as const,
  variantId: uuid(900 + variant),
  routeCode,
  routeName,
  verification: "unverified" as const,
  board: null,
  alight: null,
  notes: [] as string[],
  stops: stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
  distanceMeters: (stops.length - 1) * 200,
  approximate: true as const,
  boardingVerified: false as const,
  pathVerified: false as const,
  fare: {
    minCentavos: 1300,
    maxCentavos: 1500,
    status: "estimate" as const,
    completeness: "estimate" as const,
    approximate: true as const,
    discountsApplied: false as const,
    ruleCodes: ["F01", "F02"] as const,
    span: "rule_span" as const,
    basis: "fare_rules" as const,
    reportCodes: [],
  },
  mode: "jeepney" as const,
  fleet: fleetSummary([], "jeepney"),
  distanceBasis: "stop_to_stop_straight_line" as const,
  boardMeasureM: null as number | null,
  alightMeasureM: null as number | null,
  stopMeasuresM: null as number[] | null,
  /** A body from before the 2026-10-20 revision: no route display. */
  display: null as { letter: string | null; title: string; unverified: boolean } | null,
});

export const ORIGIN = { lat: BASE.lat - 0.001, lng: BASE.lng };
export const DEST = { lat: BASE.lat + 12 * STEP_LAT, lng: BASE.lng + 0.001 };

function option(legs: PlanOptionDto["legs"], rides: number): PlanOptionDto {
  return {
    id: `opt-${rides}`,
    mode: rides > 0 ? "jeepney" : "walk",
    labels: ["Recommended"],
    legs,
    rides,
    walkMeters: 300,
    walkEstimateMeters: 390,
    rideMeters: 1000,
    score: 1,
    fare: { minCentavos: rides ? 1300 : null, maxCentavos: rides ? 1500 : null, status: rides ? "estimate" : "no_ride", completeness: "estimate" },
    evidence: "provisional",
  };
}

export const LOOP_A = Array.from({ length: 6 }, (_, i) => pin(i, i === 0 ? "Plaza Rizal" : i === 5 ? "Naga Cathedral" : `Stop ${i}`));
export const LOOP_B = Array.from({ length: 5 }, (_, i) => pin(10 + i, i === 0 ? "Del Rosario" : i === 4 ? "Mother Seton Hospital" : `Stop ${10 + i}`, { lat: BASE.lat + (5 + i) * STEP_LAT, lng: BASE.lng + 0.0004 }));

export const walkOnly = (): PlanOptionDto => option([walk(place("origin", ORIGIN), place("destination", DEST), 300)], 0);

export const oneRide = (accessM = 110): PlanOptionDto =>
  option(
    [
      walk(place("origin", ORIGIN), place("stop", LOOP_A[0]!, LOOP_A[0]!), accessM),
      ride(LOOP_A, 1, "R01", "Centro–Magsaysay Loop A"),
      walk(place("stop", LOOP_A[5]!, LOOP_A[5]!), place("destination", DEST), 150),
    ],
    1,
  );

export const twoRides = (transferM = 45): PlanOptionDto =>
  option(
    [
      walk(place("origin", ORIGIN), place("stop", LOOP_A[0]!, LOOP_A[0]!), 110),
      ride(LOOP_A, 1, "R01", "Centro–Magsaysay Loop A"),
      walk(place("stop", LOOP_A[5]!, LOOP_A[5]!), place("stop", LOOP_B[0]!, LOOP_B[0]!), transferM),
      ride(LOOP_B, 2, "R02", "Centro–Panganiban Loop B"),
      walk(place("stop", LOOP_B[4]!, LOOP_B[4]!), place("destination", DEST), 150),
    ],
    2,
  );

export const tripOf = (opt: PlanOptionDto, destinationLabel: string | null = "SM City Naga"): GuidanceTrip => ({
  option: opt,
  stops: [{ id: LOOP_A[0]!.id, name: "Plaza Rizal", code: "A1" }],
  variants: [{ variantId: uuid(901), loopDirection: "clockwise" }],
  destinationLabel,
  etaModel: ETA_MODEL,
});

/** A location fix at a point, precise and fresh by default. */
export const fixAt = (p: { lat: number; lng: number }, accuracy = 10, timestamp = 1_000_000) => ({ lat: p.lat, lng: p.lng, accuracy, timestamp });

/**
 * A U-shaped circuit: out north along one street (stops 0–4, 200 m apart), back south along a
 * parallel street ≈ 97 m east (stops 5–9). The alighting stop 9 sits beside the boarding stop 0.
 */
export const U_LOOP = [
  ...Array.from({ length: 5 }, (_, i) => ({ lat: BASE.lat + i * STEP_LAT, lng: BASE.lng })),
  ...Array.from({ length: 5 }, (_, i) => ({ lat: BASE.lat + (4 - i) * STEP_LAT, lng: BASE.lng + 0.0009 })),
];

/** A full circle (radius 300 m, 10 stops); the alighting pin is ≈ 42 m from the boarding pin. */
export const FULL_CIRCLE = [0, 40, 80, 120, 160, 200, 240, 280, 320, 352].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const centre = { lat: BASE.lat + 0.004, lng: BASE.lng };
  return {
    lat: centre.lat - (300 / 111_320) * Math.cos(rad),
    lng: centre.lng + (300 / (111_320 * Math.cos((centre.lat * Math.PI) / 180))) * Math.sin(rad),
  };
});

// ---------------------------------------------------------------- Increment E (Task 9)

/** A tricycle or padyak option: one street leg origin → destination, no walks (as the planner builds it). */
export function streetOnly(kind: "tricycle" | "padyak", distanceMeters: number | null = 1500, basis: "street_graph" | "straight_line" | "unavailable" | "restricted" = "street_graph"): PlanOptionDto {
  const ends = { from: place("origin", ORIGIN), to: place("destination", DEST) };
  const street = { ...ends, distanceMeters, path: basis === "street_graph" ? "_p~iF~ps|U_ulLnnqC" : null, basis, ruleCodes: [] as string[] };
  const leg = kind === "tricycle"
    ? { kind, ...street, notes: ["Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver", "Tricycle time not estimated"],
      fare: { minCentavos: 1500, maxCentavos: null, status: "minimum" as const, ruleCodes: ["F03"] as ["F03"], discountsApplied: false as const } }
    : { kind, ...street, notes: ["Not allowed in the city centre 6 am–8 pm (Ord 93-049 Sec 132)", "Padyak time not estimated"],
      fare: { minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger" as const, discountedCentavos: 800, ruleCodes: ["F04"] as ["F04"] } };
  return {
    id: kind === "tricycle" ? "tricycle" : "padyak:PA01", mode: kind, labels: [], legs: [leg], rides: 0, walkMeters: 0, walkEstimateMeters: 0, rideMeters: 0, score: 0,
    fare: { minCentavos: leg.fare.minCentavos, maxCentavos: leg.fare.maxCentavos, status: leg.fare.status, completeness: "estimate" },
    evidence: "provisional",
  };
}

/** A straight northward path (13 vertices, ≈ 2.4 km) a pinless ride boards and alights on at free points. */
export const PATH_LINE = Array.from({ length: 13 }, (_, i) => ({ lat: BASE.lat + i * STEP_LAT, lng: BASE.lng }));

/** A pinless ride on PATH_LINE from measure boardM to alightM (free points, approximate_path). */
export function pathRide(boardM: number, alightM: number, at: (m: number) => { lat: number; lng: number }, alightName: string | null = null) {
  const base = ride([], 3, "R1", "Centro–San Isidro via Cararayan");
  return {
    ...base,
    stops: [],
    board: { ...at(boardM), measureM: boardM, stopId: null, name: null },
    alight: { ...at(alightM), measureM: alightM, stopId: null, name: alightName },
    distanceMeters: Math.round(alightM - boardM),
    distanceBasis: "approximate_path" as const,
    boardMeasureM: boardM as number | null,
    alightMeasureM: alightM as number | null,
  };
}

export const PATH_VARIANT_ID = uuid(903);
