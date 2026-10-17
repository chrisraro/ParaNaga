// Request-interception fixtures for POST /api/v1/plan (tests only). Shapes follow
// planResponseSchema (src/domain/api/plan.ts) as Increment E planned them: a `mode` on every option,
// free board/alight points on rides, tricycle and padyak legs, the route-not-confirmed state, and
// plan-level `jeepneyReason` and `notes`. The client validates them, so a drift fails the e2e run.
// Values are illustrative (Loop A pins near Plaza Rizal, R2 and Loop C away from any pin), not
// planner output, but the recommendation rules follow planTrip (src/domain/planner/plan.ts):
//   at least 500 m   no walk card; jeepneys, then the tricycle (Recommended), then padyak;
//   under 500 m      the walk card is Recommended, or the best jeepney when it passes within 100 m.
import { encodePolyline } from "../../../src/domain/geo/polyline";
import { parseWalkGraph, routeWalk } from "../../../src/domain/walk/walk-graph";
import snapshot from "./network/snapshot.json" with { type: "json" };
import walkGraphJson from "./network/walk-graph.json" with { type: "json" };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The published revision every captured network fixture names (fixtures/network/*.json).
export const REVISION = { revisionId: "20ca7d87-d4b2-46bc-93e4-10fced9935c6", label: "modes-lines-2026-10-16", kind: "provisional", publishedAt: "2026-10-16T08:27:21.544Z" };
// The published Loop A (R8-A clockwise) variant, so trip lines match its drawn line by variant id.
const LOOP_A = "9ca597b8-615b-4fdd-8d5d-136a2a663c90";
// Path-only routes (no pins): R2 outbound and Loop C clockwise, as drawn in fixtures/network/lines.json.
const R2_OUT = "ebc3ac41-09bc-4845-959d-19cf82c5ab1b";
const LOOP_C = "7a669c39-638e-402f-abb8-c7449c012d6a";

/** A published route's fleet summary and reviewed notes, exactly as the snapshot carries them. */
const routeOf = (code: string) => snapshot.routes.find((r) => r.routeCode === code)!;

const ORIGIN = { kind: "origin", lat: 13.6224, lng: 123.1838, stopId: null, name: null };
const DESTINATION = { kind: "destination", lat: 13.6305, lng: 123.1912, stopId: null, name: null };

const A1 = { id: id(11), name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726 };
const A2 = { id: id(12), name: "Naga Cathedral", lat: 13.6249, lng: 123.1871 };
const A3 = { id: id(13), name: "Magsaysay Junction", lat: 13.6268, lng: 123.1889 };
const A4 = { id: id(14), name: "Bichara Mall", lat: 13.6284, lng: 123.1899 };
const A5 = { id: id(15), name: "Avenue Square", lat: 13.6299, lng: 123.1905 };

/** The Loops run traditional jeepneys only, so a leg prices from F01 alone (ruling 2026-10-16). */
const legFare = (min: number, max: number) => ({
  minCentavos: min, maxCentavos: max, status: "estimate", completeness: "estimate", approximate: true, discountsApplied: false,
  ruleCodes: ["F01"], span: "traditional_rule", basis: "fare_rules", reportCodes: [],
});

/** The Loops' fleet as published (snapshot routes[]): traditional jeepneys, owner-confirmed. */
const traditionalFleet = (route: "R8-A" | "R8-B") => ({
  label: "Traditional jeepneys",
  chip: "Jeepney · traditional",
  colourKey: "traditional_puj",
  classes: [
    {
      code: `FL-${route}-TRAD`, vehicleClass: "traditional_puj", evidenceLevels: ["legal_plan", "owner_confirmation"], status: "operating",
      firstReportedOn: null, lastReportedOn: "2026-10-16", unitsNote: "PUJ Class 2 in the 2025 route plan", aircon: null,
      airconSourceCodes: [], cooperatives: [], sourceCodes: ["N30", "U01"],
      label: "Traditional jeepney · operating (owner-confirmed October 2026)",
    },
  ],
});

/** D13 ride fields: the distance runs along the approximate path, between the board and alight measures. */
const alongPath = (board: number, alight: number) => ({ distanceBasis: "approximate_path", boardMeasureM: board, alightMeasureM: alight });

/** A pre-Increment-E ride: stop-to-stop straight line, no path measures, no free points (Loop B here, untraced). */
const straightLine = { distanceBasis: "stop_to_stop_straight_line", boardMeasureM: null, alightMeasureM: null, board: null, alight: null };

const asStop = (s: typeof A1) => ({ kind: "stop", lat: s.lat, lng: s.lng, stopId: s.id, name: s.name });
/** A free point along a path (Increment E): named by a pin within 100 m, else unnamed. */
const freePoint = (lat: number, lng: number, measureM: number, pin: typeof A1 | null = null) => ({
  lat: pin?.lat ?? lat, lng: pin?.lng ?? lng, measureM, stopId: pin?.id ?? null, name: pin?.name ?? null,
});
const place = (kind: "origin" | "destination" | "point", lat: number, lng: number) => ({ kind, lat, lng, stopId: null, name: null });

const parsedStreets = parseWalkGraph(walkGraphJson);
if (!parsedStreets.ok) throw new Error(`walk-graph.json: ${parsedStreets.error}`);
const STREETS = parsedStreets.graph;

type At = { lat: number; lng: number };
/**
 * A walk leg as the planner builds it (plan.ts walkLeg): `distanceMeters` is the straight line,
 * `estimateMeters` the street length. With `routed` the leg carries the encoded street path routed on the
 * (synthetic Centro) street graph, as a plan made with the graph does. Without it (the plans the older
 * specs and unit tests share), or where the graph does not reach, it is the straight line x1.3 with no
 * path, as a plan made without the graph is; the phone then routes it itself. The lengths are illustrative.
 */
const walkLeg = (from: At, to: At, distanceMeters: number, estimateMeters: number, routed = false) => {
  const route = routed ? routeWalk(STREETS, from, to) : null;
  const onStreets = route?.kind === "path";
  return {
    kind: "walk", from, to, distanceMeters, estimateMeters, pathVerified: false,
    path: onStreets ? encodePolyline(route.coords) : null, basis: onStreets ? "street_graph" : "straight_x1_3",
  };
};

type Leg = { kind: string; estimateMeters?: number; distanceMeters?: number | null };
/** The option's walk, ride and score totals as the planner sums them (score: walk + 0.25 x ride + 600 per transfer). */
function withTotals<T extends { legs: Leg[] }>(option: T) {
  const walk = option.legs.filter((l) => l.kind === "walk").reduce((m, l) => m + (l.estimateMeters ?? 0), 0);
  const ride = option.legs.filter((l) => l.kind === "ride").reduce((m, l) => m + (l.distanceMeters ?? 0), 0);
  const rides = option.legs.filter((l) => l.kind === "ride").length;
  return { ...option, rides, walkMeters: walk, walkEstimateMeters: walk, rideMeters: ride, score: Math.round(walk + 0.25 * ride + 600 * Math.max(0, rides - 1)) };
}

type RideInit = {
  variantId: string;
  routeCode: string;
  routeName: string;
  stops: (typeof A1)[];
  distanceMeters: number;
  board: ReturnType<typeof freePoint>;
  alight: ReturnType<typeof freePoint>;
  fare: ReturnType<typeof legFare>;
  fleet: unknown;
  notes?: string[];
  /** True: a legacy straight-line ride (see `straightLine`). */
  untraced?: boolean;
};
const rideLeg = (r: RideInit) => ({
  kind: "ride", variantId: r.variantId, routeCode: r.routeCode, routeName: r.routeName, verification: "unverified",
  board: r.board, alight: r.alight, stops: r.stops, distanceMeters: r.distanceMeters, approximate: true,
  boardingVerified: false, pathVerified: false, fare: r.fare, mode: "jeepney", fleet: r.fleet,
  ...(r.untraced ? straightLine : alongPath(r.board.measureM, r.alight.measureM)), stopMeasuresM: null, notes: r.notes ?? [],
});

/** The planner's tricycle notes (plan.ts tricycleOption): the rule line, the fare line and the honest copy. */
const TRICYCLE_NOTES = [
  "Avoids the restricted roads we could locate (Ordinance 2006-005/015 · check for updates; allowed 9 pm–5 am)",
  "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver",
  "Tricycle time not estimated",
  "Tricycles serve their franchise zone; a long trip may need a change (Ord 2020-113)",
];
const NOT_CONFIRMED = "Route not confirmed: no street route found on the map; straight-line distance shown";
const tricycleFare = { minCentavos: 1500, maxCentavos: null, status: "minimum", ruleCodes: ["F03"], discountsApplied: false };

type StreetInit = {
  from: unknown;
  to: unknown;
  /** A routed leg's points; absent for "Route not confirmed" and "Street route not available". */
  coords?: { lat: number; lng: number }[];
  distanceMeters: number | null;
  notes: string[];
};
const streetBasis = (s: StreetInit) => {
  if (s.coords) return { path: encodePolyline(s.coords), basis: "street_graph" };
  return { path: null, basis: s.distanceMeters === null ? "unavailable" : "straight_line" };
};

/** The always-present tricycle option (labelled Recommended at 500 m and above). */
const tricycleOption = (s: StreetInit, recommended: boolean) => ({
  id: "tricycle",
  mode: "tricycle",
  labels: recommended ? ["Recommended"] : [],
  legs: [{ kind: "tricycle", from: s.from, to: s.to, distanceMeters: s.distanceMeters, ...streetBasis(s), notes: s.notes, ruleCodes: [], fare: tricycleFare }],
  rides: 0, walkMeters: 0, walkEstimateMeters: 0, rideMeters: 0, score: 0,
  fare: { minCentavos: 1500, maxCentavos: null, status: "minimum", completeness: "estimate" },
  evidence: "provisional",
});

const padyakOption = (s: StreetInit) => ({
  id: "padyak:PA01",
  mode: "padyak",
  labels: ["Short local ride"],
  legs: [
    {
      kind: "padyak", from: s.from, to: s.to, distanceMeters: s.distanceMeters, ...streetBasis(s), notes: s.notes, ruleCodes: [],
      fare: { minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger", discountedCentavos: 800, ruleCodes: ["F04"] },
    },
  ],
  rides: 0, walkMeters: 0, walkEstimateMeters: 0, rideMeters: 0, score: 0,
  fare: { minCentavos: 1000, maxCentavos: 1000, status: "flat_per_passenger", completeness: "estimate" },
  evidence: "provisional",
});

const TRICYCLE_ROUTED: StreetInit = {
  from: ORIGIN, to: DESTINATION, distanceMeters: 1710, notes: TRICYCLE_NOTES,
  coords: [{ lat: 13.6224, lng: 123.1838 }, { lat: 13.6262, lng: 123.1851 }, { lat: 13.6288, lng: 123.1894 }, { lat: 13.6305, lng: 123.1912 }],
};

const recommended = withTotals({
  id: `${LOOP_A}:${A1.id}:${A5.id}`,
  mode: "jeepney",
  labels: ["Fewest transfers"],
  legs: [
    walkLeg(ORIGIN, asStop(A1), 177, 230),
    rideLeg({
      variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", stops: [A1, A2, A3, A4, A5], distanceMeters: 1240,
      board: freePoint(A1.lat, A1.lng, 0, A1), alight: freePoint(A5.lat, A5.lng, 1240, A5), fare: legFare(1400, 1400), fleet: traditionalFleet("R8-A"),
    }),
    walkLeg(asStop(A5), DESTINATION, 92, 120),
  ],
  fare: { minCentavos: 1400, maxCentavos: 1400, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
});

const leastWalking = withTotals({
  id: `${LOOP_A}:${A2.id}:${A4.id}`,
  mode: "jeepney",
  labels: ["Least walking"],
  legs: [
    walkLeg(ORIGIN, asStop(A2), 60, 78),
    rideLeg({
      variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", stops: [A2, A3, A4], distanceMeters: 5486,
      board: freePoint(A2.lat, A2.lng, 265.6, A2), alight: freePoint(A4.lat, A4.lng, 5751.6, A4), fare: legFare(1600, 1800), fleet: traditionalFleet("R8-A"),
    }),
    walkLeg(asStop(A4), DESTINATION, 30, 39),
  ],
  fare: { minCentavos: 1600, maxCentavos: 1800, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
});

/** The Loop A pins and the tricycle: a 1.45 km trip, so no walk card and the tricycle is Recommended. */
export const PROVISIONAL_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId,
    coverage: "provisional",
    reason: null,
    directWalkEstimateMeters: 1450,
    jeepneyReason: null,
    options: [recommended, leastWalking, tricycleOption(TRICYCLE_ROUTED, true)],
    notes: ["Unverified route — confirm with the driver", "Walking the whole way is about 1450 m (straight-line estimate)"],
  },
  stops: [
    { id: A1.id, name: A1.name, code: "A1" },
    { id: A2.id, name: A2.name, code: "A2" },
    { id: A3.id, name: A3.name, code: "A3" },
    { id: A4.id, name: A4.name, code: "A4" },
    { id: A5.id, name: A5.name, code: "A5" },
  ],
  variants: [{ variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", isCircular: true, loopDirection: "clockwise" }],
};

export const NO_ROUTE_PLAN = {
  revision: REVISION,
  plan: { revisionId: REVISION.revisionId, coverage: "none", reason: "no_route", directWalkEstimateMeters: 1450, jeepneyReason: null, options: [], notes: [] },
  stops: [],
  variants: [],
};

export const WALK_SHORTER_PLAN = {
  ...NO_ROUTE_PLAN,
  plan: { ...NO_ROUTE_PLAN.plan, reason: "walk_shorter", directWalkEstimateMeters: 845 },
};

/** The same trip after a replan in which the first jeepney option is gone (the tricycle stays Recommended). */
export const LEAST_WALKING_ONLY_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: { ...PROVISIONAL_PLAN.plan, options: [leastWalking, tricycleOption(TRICYCLE_ROUTED, true)] },
};

/** The origin is the boarding stop itself: the first walk is 0 m (F-20). */
export const AT_STOP_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: {
    ...PROVISIONAL_PLAN.plan,
    options: [
      withTotals({ ...recommended, legs: [walkLeg({ ...ORIGIN, lat: A1.lat, lng: A1.lng }, asStop(A1), 0, 0), ...recommended.legs.slice(1)] }),
      tricycleOption(TRICYCLE_ROUTED, true),
    ],
  },
};

const WALK_ONLY = withTotals({
  mode: "walk",
  legs: [walkLeg(ORIGIN, DESTINATION, 300, 390)],
  fare: { minCentavos: 0, maxCentavos: 0, status: "no_ride", completeness: "estimate" },
  evidence: "provisional",
});
const SHORT_TRICYCLE: StreetInit = {
  from: ORIGIN, to: DESTINATION, distanceMeters: 330, notes: TRICYCLE_NOTES,
  coords: [{ lat: 13.6224, lng: 123.1838 }, { lat: 13.6268, lng: 123.1889 }, { lat: 13.6305, lng: 123.1912 }],
};

/**
 * A trip under 500 m where no jeepney passes the destination (its drop-off is 210 m away): the walk
 * card is first and the one Recommended; the jeepney keeps its own label; the tricycle is unlabelled (F-05).
 */
export const WALK_FIRST_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: {
    ...PROVISIONAL_PLAN.plan,
    directWalkEstimateMeters: 390,
    options: [
      { id: "walk", labels: ["Recommended"], ...WALK_ONLY },
      { ...leastWalking, labels: ["Least walking"] },
      tricycleOption(SHORT_TRICYCLE, false),
    ],
    notes: ["Unverified route — confirm with the driver"],
  },
};

/**
 * The same short trip when the best jeepney passes within 100 m of the destination: that jeepney is
 * Recommended (and Least walking), the walk card is still first but unlabelled, the tricycle unlabelled.
 */
export const SHORT_JEEP_PASSES_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: {
    ...PROVISIONAL_PLAN.plan,
    directWalkEstimateMeters: 390,
    options: [
      { id: "walk", labels: [], ...WALK_ONLY },
      { ...leastWalking, labels: ["Recommended", "Least walking"] },
      tricycleOption(SHORT_TRICYCLE, false),
    ],
    notes: ["Unverified route — confirm with the driver"],
  },
};

// Two rides with a transfer (guidance, Task 10): Loop A from Plaza Rizal to Magsaysay Junction,
// walk to a Loop B pin, Loop B two stops on, walk to the destination.
// The published Loop B (R8-B counterclockwise) variant.
const LOOP_B = "9ddd04ca-ab7d-413e-8fd3-7d7f1a3ed7eb";
const B1 = { id: id(21), name: "Del Rosario", lat: 13.6272, lng: 123.1893 };
const B2 = { id: id(22), name: "Mother Seton Hospital", lat: 13.6287, lng: 123.1902 };
const B3 = { id: id(23), name: "Avenue Plaza", lat: 13.6301, lng: 123.1909 };

const twoRides = withTotals({
  id: `${LOOP_A}:${A1.id}:${A3.id}|${LOOP_B}:${B1.id}:${B3.id}`,
  mode: "jeepney",
  labels: ["Fewest transfers"],
  legs: [
    walkLeg(ORIGIN, asStop(A1), 177, 230),
    rideLeg({
      variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", stops: [A1, A2, A3], distanceMeters: 560,
      board: freePoint(A1.lat, A1.lng, 0, A1), alight: freePoint(A3.lat, A3.lng, 560, A3), fare: legFare(1400, 1400), fleet: traditionalFleet("R8-A"),
    }),
    walkLeg(asStop(A3), asStop(B1), 60, 78),
    rideLeg({
      variantId: LOOP_B, routeCode: "R8-B", routeName: "Centro–Panganiban Loop B", stops: [B1, B2, B3], distanceMeters: 380,
      board: freePoint(B1.lat, B1.lng, 0, B1), alight: freePoint(B3.lat, B3.lng, 380, B3), fare: legFare(1400, 1400), fleet: traditionalFleet("R8-B"), untraced: true,
    }),
    walkLeg(asStop(B3), DESTINATION, 50, 65),
  ],
  fare: { minCentavos: 2800, maxCentavos: 2800, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
});

export const TWO_RIDE_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: { ...PROVISIONAL_PLAN.plan, options: [twoRides, tricycleOption(TRICYCLE_ROUTED, true)] },
  stops: [
    ...PROVISIONAL_PLAN.stops,
    { id: B1.id, name: B1.name, code: "B1" },
    { id: B2.id, name: B2.name, code: "B2" },
    { id: B3.id, name: B3.name, code: "B3" },
  ],
  variants: [
    ...PROVISIONAL_PLAN.variants,
    { variantId: LOOP_B, routeCode: "R8-B", routeName: "Centro–Panganiban Loop B", isCircular: true, loopDirection: "counterclockwise" },
  ],
};

// ---------------------------------------------------------------- Increment E flows

/**
 * A path-only route (R2 has no pins): the rider boards and gets off anywhere along the approximate path.
 * The board point is unnamed ("Get on near your start"), the drop-off unnamed ("Get off near your destination").
 */
const r2Ride = (notes: string[] = []): RideInit => ({
  variantId: R2_OUT, routeCode: "R2", routeName: "Centro–Del Rosario via Magsaysay Avenue", stops: [], distanceMeters: 3120,
  board: freePoint(13.6231, 123.1842, 410), alight: freePoint(13.6294, 123.1904, 3530), fare: legFare(1400, 1400), fleet: routeOf("R2").fleet, notes,
});
const r2Option = (notes: string[] = [], labels: string[] = ["Fewest transfers"]) => withTotals({
  id: `${R2_OUT}:pt:410:pt:3530`,
  mode: "jeepney",
  labels,
  legs: [
    walkLeg(ORIGIN, place("point", 13.6231, 123.1842), 90, 117, true),
    rideLeg(r2Ride(notes)),
    walkLeg(place("point", 13.6294, 123.1904), DESTINATION, 140, 182, true),
  ],
  fare: { minCentavos: 1400, maxCentavos: 1400, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
});
const R2_VARIANT = { variantId: R2_OUT, routeCode: "R2", routeName: "Centro–Del Rosario via Magsaysay Avenue", isCircular: false, loopDirection: null };

/** (a) A jeepney that boards and drops off at free points, plus the Recommended tricycle after it. */
export const ANYWHERE_DROP_OFF_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 1450, jeepneyReason: null,
    options: [r2Option(), tricycleOption(TRICYCLE_ROUTED, true)],
    notes: ["Unverified route — confirm with the driver", "Walking the whole way is about 1450 m (straight-line estimate)"],
  },
  stops: [],
  variants: [R2_VARIANT],
};

// T14 Balatas Tricycle Terminal is at 13.63187, 123.19733 (the snapshot's tricycle terminal with a coordinate).
const NEAR_T14 = place("destination", 13.6322, 123.1968);
const T14_TRICYCLE: StreetInit = {
  from: place("origin", 13.6262, 123.1912), to: NEAR_T14, distanceMeters: 1180, notes: TRICYCLE_NOTES,
  coords: [{ lat: 13.6262, lng: 123.1912 }, { lat: 13.6291, lng: 123.1941 }, { lat: 13.6322, lng: 123.1968 }],
};

/** (c) A trip of 500 m or more that ends near the Balatas tricycle terminal: tricycle Recommended after the jeepneys. */
export const TRICYCLE_RECOMMENDED_PLAN = {
  ...ANYWHERE_DROP_OFF_PLAN,
  plan: {
    ...ANYWHERE_DROP_OFF_PLAN.plan,
    directWalkEstimateMeters: 1260,
    options: [r2Option(), tricycleOption(T14_TRICYCLE, true)],
    notes: ["Unverified route — confirm with the driver", "Walking the whole way is about 1260 m along streets"],
  },
};

/** (d) No jeepney passes near the start: the tricycle is still offered, and its route is not confirmed. */
export const NO_JEEPNEY_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 2300, jeepneyReason: "no_path_near_origin",
    options: [tricycleOption({ from: ORIGIN, to: DESTINATION, distanceMeters: 1800, notes: [NOT_CONFIRMED, ...TRICYCLE_NOTES.slice(1)] }, true)],
    notes: ["Walking the whole way is about 2300 m (straight-line estimate)"],
  },
  stops: [],
  variants: [],
};

/** (d) The same, with no street graph on the device at all: "Street route not available", never a distance. */
export const NO_JEEPNEY_NO_STREETS_PLAN = {
  ...NO_JEEPNEY_PLAN,
  plan: {
    ...NO_JEEPNEY_PLAN.plan,
    options: [tricycleOption({ from: ORIGIN, to: DESTINATION, distanceMeters: null, notes: ["Street route not available", ...TRICYCLE_NOTES.slice(1)] }, true)],
  },
};

/** (e) Both ends in one padyak area: the padyak card comes after the Recommended tricycle, PHP 10 per passenger. */
export const PADYAK_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 1150, jeepneyReason: "no_path_near_origin",
    options: [
      tricycleOption({ from: ORIGIN, to: DESTINATION, distanceMeters: 1190, notes: TRICYCLE_NOTES, coords: TRICYCLE_ROUTED.coords }, true),
      padyakOption({
        from: ORIGIN, to: DESTINATION, distanceMeters: 1240, coords: TRICYCLE_ROUTED.coords,
        notes: [
          "₱10 per passenger (₱8 with ID discount) · city fare set Sep 2022 · confirm with the driver · up to 2 passengers",
          "Area per city ordinance · approximate boundary · service not confirmed today",
          "Not allowed in the city centre 6 am–8 pm (Ord 93-049 Sec 132)",
          "Padyak time not estimated",
        ],
      }),
    ],
    notes: ["Walking the whole way is about 1150 m along streets"],
  },
  stops: [],
  variants: [],
};

/** (f) Two jeepney options whose routes carry reviewed notes (owner report on R2, community on Loop C). */
const loopCOption = (notes: string[]) => withTotals({
  id: `${LOOP_C}:pt:900:pt:3700`,
  mode: "jeepney",
  labels: ["Least walking"],
  legs: [
    walkLeg(ORIGIN, place("point", 13.6228, 123.1845), 60, 78, true),
    rideLeg({
      variantId: LOOP_C, routeCode: "R8-C", routeName: "Centro–Magsaysay Loop C", stops: [], distanceMeters: 2800,
      board: freePoint(13.6228, 123.1845, 900), alight: freePoint(13.6299, 123.1909, 3700), fare: legFare(1400, 1400), fleet: routeOf("R8-C").fleet, notes,
    }),
    walkLeg(place("point", 13.6299, 123.1909), DESTINATION, 70, 91, true),
  ],
  fare: { minCentavos: 1400, maxCentavos: 1400, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
});
export const OWNER_REPORT_NOTE = routeOf("R2").notes[0]!.text;
export const COMMUNITY_NOTE = routeOf("R8-C").notes[0]!.text;
export const ROUTE_NOTES_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 1450, jeepneyReason: null,
    options: [r2Option([OWNER_REPORT_NOTE]), loopCOption([COMMUNITY_NOTE]), tricycleOption(TRICYCLE_ROUTED, true)],
    notes: ["Unverified route — confirm with the driver", "Walking the whole way is about 1450 m (straight-line estimate)"],
  },
  stops: [],
  variants: [R2_VARIANT, { variantId: LOOP_C, routeCode: "R8-C", routeName: "Centro–Magsaysay Loop C", isCircular: true, loopDirection: null }],
};

/** Loop A pins, for fake location fixes along the ride. */
export const LOOP_A_PINS = { A1, A2, A3, A4, A5 };

// ---------------------------------------------------------------- Increment F: vias, access, special trips, far note

const R3_CIRCUIT = "70cda719-c174-4cd1-8487-e89c7e1352cc";
const R4_CIRCUIT = "07fe8536-6780-4361-bb05-29868c08d8d0";
const R6_OUT = "c0c3643a-e541-464a-b831-a9a1def04c20";
const R1_OUT = "40578b72-5444-429e-8ab7-ad0adc4bcf51";
const VIA_GROUP = "VG-CENTRO-DELROSARIO";
export const FRANCIA_NOTE = "Locals may call it Francia (unconfirmed)";

/** One jeepney option on a Del Rosario via (T5): the chip text is `via.label`, R2's `via.note` is the Francia line. */
const viaOption = (variantId: string, routeCode: string, routeName: string, label: string, note: string | null, labels: string[]) => withTotals({
  id: `${variantId}:pt:410:pt:3530`,
  mode: "jeepney",
  labels,
  via: { group: VIA_GROUP, routeCode, label, note },
  legs: [
    walkLeg(ORIGIN, place("point", 13.6231, 123.1842), 90, 117, true),
    rideLeg({
      variantId, routeCode, routeName, stops: [], distanceMeters: 3120,
      board: freePoint(13.6231, 123.1842, 410), alight: freePoint(13.6294, 123.1904, 3530), fare: legFare(1400, 1400), fleet: routeOf(routeCode).fleet,
    }),
    walkLeg(place("point", 13.6294, 123.1904), DESTINATION, 140, 182, true),
  ],
  fare: { minCentavos: 1400, maxCentavos: 1400, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
});

/** Plaza Rizal to Del Rosario: R2 via Magsaysay (with the unconfirmed Francia line), R3 via Roxas (Diversion), R4 via Panganiban, tricycle Recommended. */
export const VIA_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 1450, jeepneyReason: null,
    options: [
      viaOption(R2_OUT, "R2", "Centro–Del Rosario via Magsaysay Avenue", "Magsaysay", FRANCIA_NOTE, ["Fewest transfers"]),
      viaOption(R3_CIRCUIT, "R3", "Centro–Del Rosario via Roxas Avenue (Diversion)", "Roxas (Diversion)", null, []),
      viaOption(R4_CIRCUIT, "R4", "Centro–Del Rosario via Panganiban Drive", "Panganiban", null, []),
      tricycleOption(TRICYCLE_ROUTED, true),
    ],
    notes: ["Unverified route — confirm with the driver", "Walking the whole way is about 1450 m (straight-line estimate)"],
  },
  stops: [],
  variants: [
    R2_VARIANT,
    { variantId: R3_CIRCUIT, routeCode: "R3", routeName: "Centro–Del Rosario via Roxas Avenue (Diversion)", isCircular: true, loopDirection: null },
    { variantId: R4_CIRCUIT, routeCode: "R4", routeName: "Centro–Del Rosario via Panganiban Drive", isCircular: true, loopDirection: null },
  ],
};

const FAR_NOTE_PACOL = "Local report: tricycles to Pacol charge special-trip fares that are not fixed, so we do not recommend one for the whole trip. Take the jeepney from the terminal.";
const PACOL_TERMINAL = { kind: "point", lat: 13.6209809, lng: 123.1846467, stopId: null, name: "Jeepney station to Pacol" };
const SOUTH = place("origin", 13.605, 123.187);
const PACOL = place("destination", 13.6575, 123.2475);
const ACCESS_NOTES = [
  "Avoids the restricted roads we could locate (Ordinance 2006-005/015 · check for updates; allowed 9 pm–5 am)",
  "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver",
  "Tricycle time not estimated",
  "Tricycles serve their franchise zone; a long trip may need a change (Ord 2020-113)",
];

/** The access option (T4): [tricycle to the loading point, walk, ride, walk]; mode jeepney, fare = ride minimum + PHP 15 with no maximum. */
const accessOptionOf = (labels: string[]) => ({
  ...withTotals({
    id: `tri>${R6_OUT}@120-8880`,
    mode: "jeepney",
    labels,
    legs: [
      {
        kind: "tricycle", from: SOUTH, to: PACOL_TERMINAL, distanceMeters: 2920, path: encodePolyline([{ lat: 13.605, lng: 123.187 }, { lat: 13.6125, lng: 123.1862 }, { lat: 13.6209809, lng: 123.1846467 }]),
        basis: "street_graph", notes: ACCESS_NOTES, ruleCodes: [], fare: tricycleFare,
      },
      walkLeg(PACOL_TERMINAL, place("point", 13.62152, 123.18541), 100, 130),
      rideLeg({
        variantId: R6_OUT, routeCode: "R6", routeName: "Centro–Pacol", stops: [], distanceMeters: 8760,
        board: freePoint(13.62152, 123.18541, 120), alight: freePoint(13.6596, 123.25116, 8880), fare: legFare(1800, 2000), fleet: routeOf("R6").fleet,
      }),
      walkLeg(place("point", 13.6596, 123.25116), PACOL, 90, 117),
    ],
    fare: { minCentavos: 3300, maxCentavos: null, status: "minimum", completeness: "estimate" },
    evidence: "provisional",
  }),
});
const R6_VARIANT = { variantId: R6_OUT, routeCode: "R6", routeName: "Centro–Pacol", isCircular: false, loopDirection: null };

/** To Pacol from the south: the access option is the only way (Recommended), with the far note. */
export const ACCESS_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 7400, jeepneyReason: null,
    options: [accessOptionOf(["Recommended"])],
    notes: ["Unverified route — confirm with the driver", "Walking the whole way is about 7400 m (straight-line estimate)"],
    farNote: FAR_NOTE_PACOL,
  },
  stops: [],
  variants: [R6_VARIANT],
};

const SPECIAL_NOTES = [
  "Special trip · fare not fixed · confirm with the driver",
  "From Balatas Tricycle Terminal: local report, unconfirmed",
  "Tricycle time not estimated",
  "Tricycles serve their franchise zone; a long trip may need a change (Ord 2020-113)",
];
const specialOption = () => ({
  id: "tricycle", mode: "tricycle", labels: [] as string[], specialTrip: true,
  legs: [{
    kind: "tricycle", from: place("origin", 13.6262, 123.1912), to: PACOL, distanceMeters: 4200,
    path: encodePolyline([{ lat: 13.6262, lng: 123.1912 }, { lat: 13.6291, lng: 123.2150 }, { lat: 13.6575, lng: 123.2475 }]), basis: "street_graph", notes: SPECIAL_NOTES, ruleCodes: [],
    fare: { minCentavos: null, maxCentavos: null, status: "unavailable", ruleCodes: ["F03"], discountsApplied: false },
  }],
  rides: 0, walkMeters: 0, walkEstimateMeters: 0, rideMeters: 0, score: 0,
  fare: { minCentavos: null, maxCentavos: null, status: "unavailable", completeness: "estimate" }, evidence: "provisional",
});

/** Near the Balatas terminal to Cararayan: R1 Recommended, then the unlabelled special-trip tricycle; the far note names the zone. */
export const SPECIAL_TRIP_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 4200, jeepneyReason: null,
    options: [
      withTotals({
        id: `${R1_OUT}:pt:900:pt:4100`, mode: "jeepney", labels: ["Recommended"],
        legs: [
          walkLeg(place("origin", 13.6262, 123.1912), place("point", 13.6285, 123.1925), 350, 455),
          rideLeg({
            variantId: R1_OUT, routeCode: "R1", routeName: "Centro–Cararayan", stops: [], distanceMeters: 3200,
            board: freePoint(13.6285, 123.1925, 900), alight: freePoint(13.6322, 123.2372, 4100), fare: legFare(1400, 1600), fleet: routeOf("R1").fleet,
          }),
          walkLeg(place("point", 13.6322, 123.2372), PACOL, 120, 156),
        ],
        fare: { minCentavos: 1400, maxCentavos: 1600, status: "estimate", completeness: "estimate" },
        evidence: "provisional",
      }),
      specialOption(),
    ],
    notes: ["Unverified route — confirm with the driver"],
    farNote: "Local report: tricycles to Cararayan and San Isidro charge special-trip fares that are not fixed, so we do not recommend one for the whole trip. Take the jeepney from the terminal.",
  },
  stops: [],
  variants: [{ variantId: R1_OUT, routeCode: "R1", routeName: "Centro–Cararayan", isCircular: false, loopDirection: null }],
};

/** A long far trip with no jeepney: only the special-trip card (nothing Recommended) under the far note. */
export const SPECIAL_ONLY_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 7400, jeepneyReason: "no_path_near_destination",
    options: [specialOption()],
    notes: ["Walking the whole way is about 7400 m (straight-line estimate)"],
    farNote: FAR_NOTE_PACOL,
  },
  stops: [],
  variants: [],
};
