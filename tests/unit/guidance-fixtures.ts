// Shared builders for the guidance tests: provisional plan options with 0, 1 or 2 rides on a
// straight line of pins near Plaza Rizal (≈ 200 m apart, northward).
import type { PlanOptionDto } from "@/domain/api/plan";
import type { GuidanceTrip } from "@/domain/guidance/steps";
import { fleetSummary } from "@/domain/modes/fleet";

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
});

export const ride = (stops: Pin[], variant: number, routeCode: string, routeName: string) => ({
  kind: "ride" as const,
  variantId: uuid(900 + variant),
  routeCode,
  routeName,
  verification: "unverified" as const,
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
  boardMeasureM: null,
  alightMeasureM: null,
});

export const ORIGIN = { lat: BASE.lat - 0.001, lng: BASE.lng };
export const DEST = { lat: BASE.lat + 12 * STEP_LAT, lng: BASE.lng + 0.001 };

function option(legs: PlanOptionDto["legs"], rides: number): PlanOptionDto {
  return {
    id: `opt-${rides}`,
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
