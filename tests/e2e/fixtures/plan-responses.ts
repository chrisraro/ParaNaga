// Request-interception fixtures for POST /api/v1/plan (tests only). Shapes follow
// planResponseSchema (src/domain/api/plan.ts); the client validates them, so a drift fails the
// e2e run. Values are illustrative (Loop A pins near Plaza Rizal), not planner output.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const REVISION = { revisionId: id(1), label: "provisional-loops-2026-10-15", kind: "provisional", publishedAt: "2026-10-15T00:00:00.000Z" };
const LOOP_A = id(100);

const ORIGIN = { kind: "origin", lat: 13.6224, lng: 123.1838, stopId: null, name: null };
const DESTINATION = { kind: "destination", lat: 13.6305, lng: 123.1912, stopId: null, name: null };

const A1 = { id: id(11), name: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726 };
const A2 = { id: id(12), name: "Naga Cathedral", lat: 13.6249, lng: 123.1871 };
const A3 = { id: id(13), name: "Magsaysay Junction", lat: 13.6268, lng: 123.1889 };
const A4 = { id: id(14), name: "Bichara Mall", lat: 13.6284, lng: 123.1899 };
const A5 = { id: id(15), name: "Avenue Square", lat: 13.6299, lng: 123.1905 };

const legFare = (min: number, max: number) => ({
  minCentavos: min, maxCentavos: max, status: "estimate", completeness: "estimate", approximate: true, discountsApplied: false,
  ruleCodes: ["F01", "F02"],
});

const asStop = (s: typeof A1) => ({ kind: "stop", lat: s.lat, lng: s.lng, stopId: s.id, name: s.name });

const recommended = {
  id: `${LOOP_A}:${A1.id}:${A5.id}`,
  labels: ["Recommended", "Fewest transfers"],
  legs: [
    { kind: "walk", from: ORIGIN, to: asStop(A1), distanceMeters: 177, estimateMeters: 230, pathVerified: false },
    {
      kind: "ride", variantId: LOOP_A, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A", verification: "unverified",
      stops: [A1, A2, A3, A4, A5], distanceMeters: 1240, approximate: true, boardingVerified: false, pathVerified: false,
      fare: legFare(1400, 1700),
    },
    { kind: "walk", from: asStop(A5), to: DESTINATION, distanceMeters: 92, estimateMeters: 120, pathVerified: false },
  ],
  rides: 1, walkMeters: 269, walkEstimateMeters: 350, rideMeters: 1240, score: 660, fare: { minCentavos: 1400, maxCentavos: 1700, status: "estimate", completeness: "estimate" },
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
      fare: legFare(1400, 2000),
    },
    { kind: "walk", from: asStop(A4), to: DESTINATION, distanceMeters: 30, estimateMeters: 39, pathVerified: false },
  ],
  rides: 1, walkMeters: 90, walkEstimateMeters: 117, rideMeters: 5486, score: 1488, fare: { minCentavos: 1400, maxCentavos: 2000, status: "estimate", completeness: "estimate" },
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
