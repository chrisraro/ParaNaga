// Request-interception fixtures for POST /api/v1/plan (tests only). Shapes follow
// planResponseSchema (src/domain/api/plan.ts); the client validates them, so a drift fails the
// e2e run. Values are illustrative (Loop A pins near Plaza Rizal), not planner output.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The published revision every captured network fixture names (fixtures/network/*.json).
export const REVISION = { revisionId: "20ca7d87-d4b2-46bc-93e4-10fced9935c6", label: "modes-lines-2026-10-16", kind: "provisional", publishedAt: "2026-10-16T08:27:21.544Z" };
// The published Loop A (R8-A clockwise) variant, so trip lines match its drawn line by variant id.
const LOOP_A = "9ca597b8-615b-4fdd-8d5d-136a2a663c90";

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

/** D13 ride fields: along the approximate path (Loop A here) or the straight-line sum (Loop B here). */
const alongPath = (board: number, alight: number) => ({ distanceBasis: "approximate_path", boardMeasureM: board, alightMeasureM: alight });
const straightLine = { distanceBasis: "stop_to_stop_straight_line", boardMeasureM: null, alightMeasureM: null };

const asStop = (s: typeof A1) => ({ kind: "stop", lat: s.lat, lng: s.lng, stopId: s.id, name: s.name });

const recommended = {
  id: `${LOOP_A}:${A1.id}:${A5.id}`,
  labels: ["Recommended", "Fewest transfers"],
  legs: [
    { kind: "walk", from: ORIGIN, to: asStop(A1), distanceMeters: 177, estimateMeters: 230, pathVerified: false },
    {
      kind: "ride", variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", verification: "unverified",
      stops: [A1, A2, A3, A4, A5], distanceMeters: 1240, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFare(1400, 1400), mode: "jeepney", fleet: traditionalFleet("R8-A"), ...alongPath(0, 1240),
    },
    { kind: "walk", from: asStop(A5), to: DESTINATION, distanceMeters: 92, estimateMeters: 120, pathVerified: false },
  ],
  rides: 1, walkMeters: 269, walkEstimateMeters: 350, rideMeters: 1240, score: 660, fare: { minCentavos: 1400, maxCentavos: 1400, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
};

const leastWalking = {
  id: `${LOOP_A}:${A2.id}:${A4.id}`,
  labels: ["Least walking"],
  legs: [
    { kind: "walk", from: ORIGIN, to: asStop(A2), distanceMeters: 60, estimateMeters: 78, pathVerified: false },
    {
      kind: "ride", variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", verification: "unverified",
      stops: [A2, A3, A4], distanceMeters: 5486, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFare(1600, 1800), mode: "jeepney", fleet: traditionalFleet("R8-A"), ...alongPath(265.6, 5751.6),
    },
    { kind: "walk", from: asStop(A4), to: DESTINATION, distanceMeters: 30, estimateMeters: 39, pathVerified: false },
  ],
  rides: 1, walkMeters: 90, walkEstimateMeters: 117, rideMeters: 5486, score: 1488, fare: { minCentavos: 1600, maxCentavos: 1800, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
};

export const PROVISIONAL_PLAN = {
  revision: REVISION,
  plan: {
    revisionId: REVISION.revisionId,
    coverage: "provisional",
    reason: null,
    directWalkEstimateMeters: 1450,
    options: [recommended, leastWalking],
    notes: ["Unverified route — confirm with the driver"],
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
  plan: { revisionId: REVISION.revisionId, coverage: "none", reason: "no_route", directWalkEstimateMeters: 1450, options: [], notes: [] },
  stops: [],
  variants: [],
};

export const WALK_SHORTER_PLAN = {
  ...NO_ROUTE_PLAN,
  plan: { ...NO_ROUTE_PLAN.plan, reason: "walk_shorter", directWalkEstimateMeters: 845 },
};

/** The same trip after a replan in which the "Recommended" option is gone. */
export const LEAST_WALKING_ONLY_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: { ...PROVISIONAL_PLAN.plan, options: [{ ...leastWalking, labels: ["Recommended", "Fewest transfers", "Least walking"] }] },
};

/** The origin is the boarding stop itself: the first walk is 0 m (F-20). */
export const AT_STOP_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: {
    ...PROVISIONAL_PLAN.plan,
    options: [
      {
        ...recommended,
        legs: [
          { kind: "walk", from: { ...ORIGIN, lat: A1.lat, lng: A1.lng }, to: asStop(A1), distanceMeters: 0, estimateMeters: 0, pathVerified: false },
          ...recommended.legs.slice(1),
        ],
        walkMeters: 92, walkEstimateMeters: 120,
      },
    ],
  },
};

/** A short trip: walking first (no ride, so no driver badge), one ride option for least walking (F-05). */
export const WALK_FIRST_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: {
    ...PROVISIONAL_PLAN.plan,
    directWalkEstimateMeters: 390,
    options: [
      {
        id: "walk",
        labels: ["Recommended", "Fewest transfers"],
        legs: [{ kind: "walk", from: ORIGIN, to: DESTINATION, distanceMeters: 300, estimateMeters: 390, pathVerified: false }],
        rides: 0, walkMeters: 300, walkEstimateMeters: 390, rideMeters: 0, score: 390,
        fare: { minCentavos: 0, maxCentavos: 0, status: "no_ride", completeness: "estimate" },
        evidence: "provisional",
      },
      { ...leastWalking, labels: ["Least walking"] },
    ],
  },
};

// Two rides with a transfer (guidance, Task 10): Loop A from Plaza Rizal to Magsaysay Junction,
// walk to a Loop B pin, Loop B two stops on, walk to the destination.
// The published Loop B (R8-B counterclockwise) variant.
const LOOP_B = "9ddd04ca-ab7d-413e-8fd3-7d7f1a3ed7eb";
const B1 = { id: id(21), name: "Del Rosario", lat: 13.6272, lng: 123.1893 };
const B2 = { id: id(22), name: "Mother Seton Hospital", lat: 13.6287, lng: 123.1902 };
const B3 = { id: id(23), name: "Avenue Plaza", lat: 13.6301, lng: 123.1909 };

const twoRides = {
  id: `${LOOP_A}:${A1.id}:${A3.id}|${LOOP_B}:${B1.id}:${B3.id}`,
  labels: ["Recommended"],
  legs: [
    { kind: "walk", from: ORIGIN, to: asStop(A1), distanceMeters: 177, estimateMeters: 230, pathVerified: false },
    {
      kind: "ride", variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", verification: "unverified",
      stops: [A1, A2, A3], distanceMeters: 560, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFare(1400, 1400), mode: "jeepney", fleet: traditionalFleet("R8-A"), ...alongPath(0, 560),
    },
    { kind: "walk", from: asStop(A3), to: asStop(B1), distanceMeters: 60, estimateMeters: 78, pathVerified: false },
    {
      kind: "ride", variantId: LOOP_B, routeCode: "R8-B", routeName: "Centro–Panganiban Loop B", verification: "unverified",
      stops: [B1, B2, B3], distanceMeters: 380, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFare(1400, 1400), mode: "jeepney", fleet: traditionalFleet("R8-B"), ...straightLine,
    },
    { kind: "walk", from: asStop(B3), to: DESTINATION, distanceMeters: 50, estimateMeters: 65, pathVerified: false },
  ],
  rides: 2, walkMeters: 287, walkEstimateMeters: 373, rideMeters: 940, score: 900, fare: { minCentavos: 2800, maxCentavos: 2800, status: "estimate", completeness: "estimate" },
  evidence: "provisional",
};

export const TWO_RIDE_PLAN = {
  ...PROVISIONAL_PLAN,
  plan: { ...PROVISIONAL_PLAN.plan, options: [twoRides] },
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

/** Loop A pins, for fake location fixes along the ride. */
export const LOOP_A_PINS = { A1, A2, A3, A4, A5 };
