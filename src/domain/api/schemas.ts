// Public read API (/api/v1): request parameter parsing and response schemas, shared by the
// route handlers, the client and the tests. Pure: no I/O.
//
// Honesty rules carried by the shapes:
//  - every response names the published revision and its kind ("provisional" until verified);
//  - every variant carries `verification`, "unverified" unless a verified, navigation-approved
//    version is published, so the UI can badge it;
//  - fares are estimate data only (`isEstimate: true`); nothing here computes a trip fare;
//  - NULL from the database stays null (unknown), never 0 or false.
import { z } from "zod";
import { NAGA_MAX_BOUNDS } from "../geo/naga";
import { decodePolyline } from "../geo/polyline";
import { ETA_PARAM_KEYS } from "../eta/params";
import { LINES_FORMAT_VERSION } from "./lines-format";
import { OSM_ELEMENT_TYPES, OSM_PLACE_CATEGORIES } from "../places/osm-categories";
import {
  COLOUR_KEYS,
  COOPERATIVE_BASES,
  FLEET_EVIDENCE_LEVELS,
  FLEET_STATUSES,
  ROUTE_MODES,
  VEHICLE_CLASSES,
  fleetSummary,
} from "../modes/fleet";
import {
  ACCESS_NOTE_CODES,
  DAY_TYPES,
  DEPARTURE_BASES,
  DEPARTURE_PATTERNS,
  DESTINATION_GROUPS,
  DESTINATION_KINDS,
  INTERCITY_MODES,
  OBSERVATION_BASES,
  SERVICE_STATUSES as INTERCITY_SERVICE_STATUSES,
  STATUS_NOTE_CODES,
} from "../import/intercity-seed";

// ---------------------------------------------------------------- shared pieces

export const STOP_STATUSES = [
  "candidate", "documentary", "installed", "field_verified", "published", "temporary", "relocated", "retired",
] as const;
export const DIRECTIONS = ["inbound", "outbound", "circuit", "clockwise", "counterclockwise", "branch"] as const;
export const VARIANT_KINDS = ["permanent", "trial", "event", "construction"] as const;
export const EVIDENCE_LEVELS = ["documentary", "provisional", "verified"] as const;

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const revisionMetaSchema = z.object({
  revisionId: z.uuid(),
  label: z.string(),
  kind: z.enum(["provisional", "verified"]),
  publishedAt: isoDateTime.nullable(),
});
export type RevisionMeta = z.infer<typeof revisionMetaSchema>;

export const verificationSchema = z.enum(["unverified", "verified"]);
export type Verification = z.infer<typeof verificationSchema>;

/** Only a verified, navigation-approved version counts as verified. */
export function variantVerification(evidenceLevel: string, navigationApproved: boolean): Verification {
  return evidenceLevel === "verified" && navigationApproved ? "verified" : "unverified";
}

export const stopSourceSchema = z.object({
  layer: z.string().nullable(),
  code: z.string().nullable(),
  label: z.string().nullable(),
});

export const stopSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lat: latitude,
  lng: longitude,
  status: z.enum(STOP_STATUSES),
  navigationApproved: z.boolean(),
  source: stopSourceSchema,
});
export type StopSummary = z.infer<typeof stopSummarySchema>;

export const fareRuleEstimateSchema = z.object({
  code: z.string(),
  modeCode: z.string(),
  vehicleClass: z.string().nullable(),
  baseCentavos: z.number().int().nullable(),
  baseKm: z.number().nullable(),
  incrementCentavosPerKm: z.number().int().nullable(),
  discountPercent: z.number().nullable(),
  discountedBaseCentavos: z.number().int().nullable(),
  discountGroups: z.array(z.string()).nullable(),
  rounding: z.string().nullable(),
  effectiveFrom: isoDate.nullable(),
  enactedOn: isoDate.nullable(),
  evidenceStatus: z.string().nullable(),
  status: z.string(),
  publishExact: z.boolean(),
  /** Always true: reported/estimate data, never an exact trip fare. */
  isEstimate: z.literal(true),
  sourceCodes: z.array(z.string()),
});
export type FareRuleEstimate = z.infer<typeof fareRuleEstimateSchema>;

// ---------------------------------------------------------------- modes and fleets (Increment D)

export const routeModeSchema = z.enum(ROUTE_MODES);
export const SERVICE_STATUSES = ["legal_plan", "authorized_feeder", "historical_unknown"] as const;
export const PLANNING_FLAGS = ["provisional", "none"] as const;

/**
 * One vehicle class on a route (transit.route_vehicle_class), with its evidence: every class is
 * shown with its evidence levels, status and dates; aircon only with its sources (null = no
 * source states it). There is no e-jeepney class.
 */
export const fleetClassSchema = z
  .object({
    code: z.string(),
    vehicleClass: z.enum(VEHICLE_CLASSES),
    evidenceLevels: z.array(z.enum(FLEET_EVIDENCE_LEVELS)).min(1),
    status: z.enum(FLEET_STATUSES),
    firstReportedOn: isoDate.nullable(),
    lastReportedOn: isoDate.nullable(),
    unitsNote: z.string().nullable(),
    aircon: z.boolean().nullable(),
    airconSourceCodes: z.array(z.string()),
    /** Cooperative names only. */
    cooperatives: z.array(z.string()),
    sourceCodes: z.array(z.string()).min(1),
    /** Evidence text, e.g. "Modern jeepney · air-conditioned · operating (owner-confirmed October 2026)". */
    label: z.string(),
  })
  .refine((c) => (c.aircon === null) === (c.airconSourceCodes.length === 0), { message: "aircon needs its sources" });

/** The route's fleet: label, option chip (C7), line colour key (D3) and the classes. No record → "Vehicle type not confirmed". */
export const fleetSummarySchema = z.object({
  label: z.string(),
  chip: z.string(),
  colourKey: z.enum(COLOUR_KEYS),
  classes: z.array(fleetClassSchema),
});
export type FleetSummaryOut = z.infer<typeof fleetSummarySchema>;

/**
 * For responses cached under an older shape (before the modes fields existed): a stale body reads
 * as "Vehicle type not confirmed" instead of failing the client parse. Never asserts a class.
 */
const unconfirmedFleet = () => fleetSummary([], "jeepney");
/** Every route before the modes seed was a jeepney route (migration 0006 default). */
const legacyRouteMode = () => routeModeSchema.default("jeepney");

/**
 * Owner-confirmed service (user decision 2026-10-16). Confirms SERVICE only: stop locations,
 * stop order and paths stay unverified (`confirmsServiceOnly`), and the trip badge stays.
 */
export const operatingStatusSchema = z.object({
  status: z.literal("operating"),
  label: z.string(),
  note: z.string(),
  confirmedOn: isoDate,
  confirmsServiceOnly: z.literal(true),
  sourceCodes: z.array(z.string()).min(1),
});

/** OpenStreetMap coordinate provenance (ODbL): the terminal coordinate is never an entrance. */
export const terminalCoordinateSchema = z.object({
  source: z.enum(["osm_node", "osm_way_centroid"]),
  osmType: z.enum(["node", "way"]),
  osmId: z.number().int().positive(),
  osmVersion: z.number().int().min(1).nullable(),
  osmTimestamp: isoDateTime.nullable(),
  note: z.string().nullable(),
  licence: z.literal("ODbL 1.0"),
  attribution: z.literal("Map data © OpenStreetMap contributors"),
  attributionUrl: z.literal("https://www.openstreetmap.org/copyright"),
});
/** `airport` since 0029 (IC1: T17, Naga Airport, no coordinate). */
export const TERMINAL_KINDS = ["terminal", "loading_point", "waiting_area", "station", "airport"] as const;

/**
 * What riders report paying for one vehicle class on a route, as a delta over the traditional
 * fare (transit.route_fare_observation). An observation, never a rule: "range" has both bounds,
 * "at_least" only the low one.
 */
export const routeFareReportSchema = z
  .object({
    code: z.string(),
    vehicleClass: z.enum(VEHICLE_CLASSES),
    deltaQualifier: z.enum(["range", "at_least"]),
    deltaCentavosLow: z.number().int().min(0),
    deltaCentavosHigh: z.number().int().min(0).nullable(),
    observedOn: isoDate,
    sourceCodes: z.array(z.string()).min(1),
  })
  .refine((r) => (r.deltaQualifier === "at_least") === (r.deltaCentavosHigh === null), { message: "a range has an upper bound; at_least has none" })
  .refine((r) => r.deltaCentavosHigh === null || r.deltaCentavosLow <= r.deltaCentavosHigh, { message: "low is above high" });
export type RouteFareReport = z.infer<typeof routeFareReportSchema>;

/** Fare modes the intra-city planner may use: never the regional bus/UV rules (F06–F12). */
export const INTRA_CITY_FARE_MODES = ["traditional_jeepney", "modern_jeepney", "trimobile_e_trike_taxicle", "padyak"] as const;

// ---------------------------------------------------------------- GET /api/v1/network/head

export const networkHeadSchema = revisionMetaSchema;
export type NetworkHead = z.infer<typeof networkHeadSchema>;

// ---------------------------------------------------------------- GET /api/v1/network/snapshot/:revisionId

export const snapshotVariantSchema = z.object({
  variantId: z.uuid(),
  routeId: z.uuid(),
  routeCode: z.string(),
  routeName: z.string(),
  direction: z.enum(DIRECTIONS),
  kind: z.enum(VARIANT_KINDS),
  evidenceLevel: z.enum(EVIDENCE_LEVELS),
  verification: verificationSchema,
  isCircular: z.boolean(),
  /** Ordered stop ids (route_stop seq 1…n). */
  stopIds: z.array(z.uuid()).min(1),
  mode: legacyRouteMode(),
  // No `fleet`: the route's fleet is in `routes[]` (join by routeId), sent once per route.
  /**
   * D13: metres along the variant's approximate path at each stop (same order as stopIds; a
   * circuit's measures wrap at pathLengthM), or null when the variant has no published path.
   */
  measuresM: z.array(z.number().min(0)).nullable().default(null),
  /** Length of the variant's approximate path in metres, or null when it has none. */
  pathLengthM: z.number().positive().nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.measuresM === null) return;
  if (v.pathLengthM === null) ctx.addIssue({ code: "custom", message: "stop measures need the path length" });
  if (v.measuresM.length !== v.stopIds.length) ctx.addIssue({ code: "custom", message: "one measure per stop" });
  if (v.pathLengthM !== null && v.measuresM.some((m) => m > v.pathLengthM!)) {
    ctx.addIssue({ code: "custom", message: "a stop measure lies beyond the path length" });
  }
});

export { ETA_PARAM_KEYS };
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * One time-estimate parameter with its basis: sourced (sourceCodes) or an assumption with its
 * note (A1–A3); a mixed band is an assumption that also lists its sources.
 */
export const etaParamSchema = z
  .object({
    key: z.enum(ETA_PARAM_KEYS),
    low: z.number().positive().nullable(),
    high: z.number().positive().nullable(),
    unit: z.enum(["km_per_h", "factor", "windows"]),
    /** Asia/Manila clock times (fixed UTC+8). */
    windows: z.array(z.object({ start: clockTime, end: clockTime })).min(1).nullable(),
    days: z.enum(["every_day"]).nullable(),
    appliesTo: z.array(z.enum(["walk", "jeepney"])).min(1),
    isAssumption: z.boolean(),
    assumptionNote: z.string().nullable(),
    basis: z.string().min(1),
    sourceCodes: z.array(z.string()),
  })
  .refine((p) => p.isAssumption || p.sourceCodes.length > 0, { message: "a value that is not an assumption needs sources" })
  .refine((p) => !p.isAssumption || p.assumptionNote !== null, { message: "an assumption needs its note" })
  .refine((p) => (p.unit === "windows") === (p.windows !== null) && (p.unit === "windows") === (p.low === null && p.high === null), {
    message: "windows, or a low–high value",
  })
  .refine((p) => p.low === null || p.high === null || p.low <= p.high, { message: "low is above high" });
export type EtaParam = z.infer<typeof etaParamSchema>;

/** Every time-estimate parameter of the revision (all five, each once); times are computed on the device. */
export const etaModelSchema = z
  .object({
    timeZone: z.literal("Asia/Manila"),
    /** Fixed UTC+8, no daylight saving (D9). */
    utcOffsetMinutes: z.literal(480),
    params: z.array(etaParamSchema),
  })
  .refine((m) => m.params.length === ETA_PARAM_KEYS.length && ETA_PARAM_KEYS.every((k) => m.params.some((p) => p.key === k)), {
    message: "the time-estimate model needs each of the five parameters once",
  });
export type EtaModel = z.infer<typeof etaModelSchema>;

/** A published terminal or loading point; lat/lng null when no coordinate is on file. */
export const snapshotTerminalSchema = z
  .object({
    code: z.string().regex(/^T\d{2}$/),
    name: z.string(),
    /** Null for a legacy terminal row (revisions before the modes seed). */
    kind: z.enum(TERMINAL_KINDS).nullable(),
    modes: z.array(z.string()),
    lat: latitude.nullable(),
    lng: longitude.nullable(),
    coordSource: z.enum(["osm_node", "osm_way_centroid"]).nullable(),
    verification: z.string().nullable(),
  })
  .refine((t) => (t.lat === null) === (t.lng === null) && (t.lat === null) === (t.coordSource === null), {
    message: "a coordinate always comes with its source",
  });
export type SnapshotTerminal = z.infer<typeof snapshotTerminalSchema>;

/**
 * A reviewed note on a route (E-J7, <= 120 characters). With `near` it shows when the board or alight
 * point (or the destination) is within radiusM of it; without, in route and ride detail only.
 * Evidence is the research's own level; owner reports are never presented as verified.
 */
export const routeNoteSchema = z.object({
  text: z.string().min(1).max(120),
  evidence: z.enum(["official", "news", "community", "owner_report_unverified"]),
  sourceCodes: z.array(z.string()).min(1),
  near: z.object({ lat: latitude, lng: longitude, radiusM: z.number().int().min(50).max(2000) }).nullable(),
});
export type RouteNote = z.infer<typeof routeNoteSchema>;

export const networkSnapshotSchema = z.object({
  revision: revisionMetaSchema,
  stops: z.array(stopSummarySchema),
  variants: z.array(snapshotVariantSchema),
  /** Intra-city fare rules only (INTRA_CITY_FARE_MODES): regional rules never reach the planner. */
  fareRules: z.array(fareRuleEstimateSchema).refine(
    (rules) => rules.every((r) => (INTRA_CITY_FARE_MODES as readonly string[]).includes(r.modeCode)),
    { message: "the snapshot carries intra-city fare rules only" },
  ),
  terminals: z.array(snapshotTerminalSchema).default(() => []),
  /**
   * Every published route with its mode and fleet, including routes without a stop order (which
   * have no variant above): chips and labels work offline for the whole network.
   */
  routes: z.array(
    z.object({
      routeId: z.uuid(),
      routeCode: z.string(),
      routeName: z.string(),
      mode: legacyRouteMode(),
      serviceStatus: z.enum(SERVICE_STATUSES).nullable().default(null),
      fleet: fleetSummarySchema.default(unconfirmedFleet),
      /** Rider fare reports for this route (mixed-fleet fare maximum, fares.ts); [] for older snapshots. */
      fareReports: z.array(routeFareReportSchema).default(() => []),
      /** Reviewed route notes (E-J7); [] for older snapshots. */
      notes: z.array(routeNoteSchema).default(() => []),
    }),
  ).default(() => []),
  /** The time-estimate parameters (D8/D9), or null for a revision published without them. */
  etaModel: etaModelSchema.nullable().default(null),
});
export type NetworkSnapshot = z.infer<typeof networkSnapshotSchema>;

/**
 * A snapshot is cached as immutable, so one without stops is never sent: a published revision
 * always has stops, and an empty read means something went wrong. Variants are NOT required —
 * publish does not enforce routable variants (a revision may carry candidate stops only), and
 * the planner then reports no coverage.
 */
export function isCompleteSnapshot(snapshot: Pick<NetworkSnapshot, "stops" | "variants">): boolean {
  return snapshot.stops.length > 0;
}

// ---------------------------------------------------------------- GET /api/v1/stops?bbox=

/** A map pin: the stop plus the public codes of routes whose published stop order lists it. */
export const stopPinSchema = stopSummarySchema.extend({ routeCodes: z.array(z.string()) });
export type StopPin = z.infer<typeof stopPinSchema>;

export const stopsInBboxSchema = z.object({
  revision: revisionMetaSchema,
  stops: z.array(stopPinSchema),
});
export type StopsInBbox = z.infer<typeof stopsInBboxSchema>;

// ---------------------------------------------------------------- GET /api/v1/stops/:id

export const stopSourceRecordSchema = z.object({
  layer: z.string(),
  code: z.string().nullable(),
  label: z.string(),
  description: z.string().nullable(),
  /** Verbatim source text, e.g. "123.1846726,13.6233869,0". */
  coordinatesRaw: z.string(),
  lat: latitude,
  lng: longitude,
  /** Retrieved date of the source snapshot this pin was imported from; null when not recorded. */
  retrievedOn: isoDate.nullable(),
});

export const stopDetailSchema = z.object({
  revision: revisionMetaSchema,
  stop: stopSummarySchema.extend({
    accuracyM: z.number().nullable(),
    curbSide: z.string().nullable(),
    boardingAllowed: z.boolean().nullable(),
    alightingAllowed: z.boolean().nullable(),
    signInstalled: z.boolean().nullable(),
  }),
  /** Raw source pins behind this candidate, newest first. */
  sourceRecords: z.array(stopSourceRecordSchema),
  /** Public attribution of the source map; identity never presented as verified unless it is. */
  sourceMap: z
    .object({ ownerDisplayName: z.string().nullable(), ownerIdentityVerified: z.boolean().nullable() })
    .nullable(),
  /** Published stops from OTHER source layers whose source pin has exactly the same coordinates. */
  sharedCoordinate: z.array(
    z.object({ stopId: z.uuid(), name: z.string(), source: stopSourceSchema }),
  ),
  /** Variants that list this stop in their published stop order (route_stop only). */
  servingRoutes: z.array(
    z.object({
      routeCode: z.string(),
      routeName: z.string(),
      variantId: z.uuid(),
      direction: z.enum(DIRECTIONS),
      kind: z.enum(VARIANT_KINDS),
      evidenceLevel: z.enum(EVIDENCE_LEVELS),
      verification: verificationSchema,
      isCircular: z.boolean(),
      seq: z.number().int().min(1),
    }),
  ),
  /** Routes passing nearby. Documentary street lists are not stops, so this stays empty for now. */
  passingNearby: z.array(z.object({ routeCode: z.string(), routeName: z.string() })),
});
export type StopDetail = z.infer<typeof stopDetailSchema>;

// ---------------------------------------------------------------- GET /api/v1/routes

export const routeAliasSchema = z.object({
  alias: z.string(),
  kind: z.string(),
  isHistorical: z.boolean(),
  sourceCode: z.string().nullable(),
});

export const routeSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  groupNumber: z.number().int().nullable(),
  modeCode: z.string().nullable(),
  legalStatus: z.string().nullable(),
  allocatedUnits: z.number().int().nullable(),
  allocationIsActiveFleetCount: z.boolean().nullable(),
  /** Units allocated to the whole group when no per-route count exists (group 8). */
  groupAllocatedUnits: z.number().int().nullable(),
  aliases: z.array(routeAliasSchema),
  /** Strongest evidence level among the route's published variants. */
  evidenceLevel: z.enum(EVIDENCE_LEVELS).nullable(),
  verification: verificationSchema,
  hasProvisionalStops: z.boolean(),
  hasTrial: z.boolean(),
  mode: routeModeSchema,
  /** legal_plan (LPTRP), authorized_feeder (tricycle ordinances); null when not stated. */
  serviceStatus: z.enum(SERVICE_STATUSES).nullable(),
  planning: z.enum(PLANNING_FLAGS),
  fleet: fleetSummarySchema,
  /** Null: no owner confirmation on file. Never implies verified stops or paths. */
  operatingStatus: operatingStatusSchema.nullable(),
});
export type RouteSummary = z.infer<typeof routeSummarySchema>;

export const routeListSchema = z.object({
  revision: revisionMetaSchema,
  groups: z.array(z.object({ groupNumber: z.number().int().nullable(), routes: z.array(routeSummarySchema) })),
});
export type RouteList = z.infer<typeof routeListSchema>;

// ---------------------------------------------------------------- GET /api/v1/routes/:code

export const legalStreetsSchema = z.object({
  inbound: z.array(z.string()).nullable(),
  outbound: z.array(z.string()).nullable(),
  circuit: z.array(z.string()).nullable(),
  /** Street text of feeder branch variants (tricycle ordinances), verbatim. */
  branch: z.array(z.string()).nullable(),
});
export type LegalStreets = z.infer<typeof legalStreetsSchema>;

const routeVariantSchema = z.object({
  variantId: z.uuid(),
  /** Feeder branch name; null for LPTRP variants. */
  name: z.string().nullable(),
  direction: z.enum(DIRECTIONS),
  kind: z.enum(VARIANT_KINDS),
  evidenceLevel: z.enum(EVIDENCE_LEVELS),
  verification: verificationSchema,
  isCircular: z.boolean(),
  headsign: z.string().nullable(),
  vehicleClass: z.string().nullable(),
  operatingStatus: z.string().nullable(),
  trialStatus: z.string().nullable(),
  effectiveFrom: isoDate.nullable(),
  trialDurationDays: z.number().int().nullable(),
  legalStreets: legalStreetsSchema,
  notes: z.string().nullable(),
  sourceCodes: z.array(z.string()),
  /** Published ordered stops; empty when the variant has no stop order. */
  stops: z.array(stopSummarySchema.extend({ seq: z.number().int().min(1) })),
  /** Its approximate path (Task 7); "not_traced" for revisions published without paths. */
  pathStatus: z.lazy(() => pathStatusSchema).default(() => ({ ...NOT_TRACED })),
});

/**
 * Whether a variant has an approximate path: traced (ok) or flagged (drawn, see the lines
 * resource), untraced ("Path could not be traced from the street list", with the reason), or
 * not_traced (no road outputs in this revision). Copy (Task 12): "Traced along {matched} of
 * {listed} listed streets".
 */
export const pathStatusSchema = z.object({
  status: z.enum(["traced", "flagged", "untraced", "not_traced"]),
  /** The flag reason (flagged) or the failure reason (untraced); null otherwise. */
  reason: z.string().nullable(),
  listedStreets: z.number().int().min(0).nullable(),
  matchedStreets: z.number().int().min(0).nullable(),
  unmatchedStreets: z.array(z.string()),
});
export type PathStatus = z.infer<typeof pathStatusSchema>;
export const NOT_TRACED: PathStatus = { status: "not_traced", reason: null, listedStreets: null, matchedStreets: null, unmatchedStreets: [] };

export const fareObservationSchema = z.object({
  code: z.string().nullable(),
  modeCode: z.string(),
  amountCentavos: z.number().int(),
  category: z.string(),
  kind: z.string(),
  observedAt: isoDate.nullable(),
  evidenceStatus: z.string().nullable(),
  sourceCodes: z.array(z.string()),
});

export const sourceSchema = z.object({
  code: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  evidenceType: z.string().nullable(),
  publishedOrEnacted: z.string().nullable(),
  checkedOn: isoDate.nullable(),
});

export const routeDetailSchema = z.object({
  revision: revisionMetaSchema,
  route: routeSummarySchema.omit({ aliases: true }).extend({
    notes: z.string().nullable(),
    sourceCodes: z.array(z.string()),
    /** Street order per direction, from the published permanent variants. */
    legalStreets: legalStreetsSchema,
    /** Further street structures the source lists for this route; never merged into legalStreets. */
    additionalSourceStructures: z.array(z.array(z.string())),
    normalizationNote: z.string().nullable(),
  }),
  variants: z.array(routeVariantSchema),
  trials: z.array(routeVariantSchema),
  /** Reviewed route notes (E-J7); [] for older revisions. */
  notes: z.array(routeNoteSchema).default(() => []),
  /** Legacy and local names (historical ones flagged). */
  aliases: z.array(routeAliasSchema),
  /** Cooperative NAMES on this corridor (C8), with source and date: never chair names or addresses. */
  cooperatives: z.array(
    z
      .object({
        name: z.string(),
        basis: z.enum(COOPERATIVE_BASES),
        label: z.string(),
        /** YYYY-MM or YYYY-MM-DD. */
        reportedOn: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).nullable(),
        notes: z.string().nullable(),
        sourceCodes: z.array(z.string()).min(1),
      })
      .strict(),
  ),
  fareEvidence: z.object({
    /** How the rules were associated: inferred from the route's mode (no stored route↔fare link). */
    basis: z.literal("route_mode"),
    rules: z.array(fareRuleEstimateSchema),
    observations: z.array(fareObservationSchema),
    conflicts: z.array(
      z.object({ ruleCode: z.string(), observationCode: z.string().nullable(), status: z.string(), note: z.string().nullable() }),
    ),
    /** What riders report paying for one vehicle class, as a delta over the traditional fare. Never a rule. */
    reportedPractice: z.array(
      z.object({
        code: z.string(),
        vehicleClass: z.enum(VEHICLE_CLASSES),
        deltaQualifier: z.enum(["range", "at_least"]),
        deltaCentavosLow: z.number().int().min(0),
        deltaCentavosHigh: z.number().int().min(0).nullable(),
        observedOn: isoDate,
        reportText: z.string(),
        sourceCodes: z.array(z.string()).min(1),
      }),
    ),
  }),
  sources: z.array(sourceSchema),
});
export type RouteDetail = z.infer<typeof routeDetailSchema>;

// ---------------------------------------------------------------- OpenStreetMap places

/**
 * A named place from the committed OpenStreetMap snapshot (ODbL, © OpenStreetMap contributors).
 * A place, not transport data: the coordinate is the OSM node or the element's centre, never an
 * entrance; no hours, photos or ratings exist.
 */
export const osmPlaceSchema = z.object({
  /** "osm:{type}/{id}", stable across snapshots. */
  key: z.string().regex(/^osm:(node|way|relation)\/[1-9][0-9]*$/),
  name: z.string().min(1),
  /** name:en, name:fil, alt_name, old_name — verbatim. */
  aliases: z.array(z.string()),
  category: z.enum(OSM_PLACE_CATEGORIES),
  lat: latitude,
  lng: longitude,
  osmType: z.enum(OSM_ELEMENT_TYPES),
  osmId: z.number().int().positive(),
  osmVersion: z.number().int().min(1),
  /** ingest.source code of the snapshot, e.g. OSM-2026-10-15. */
  sourceCode: z.string().regex(/^OSM-\d{4}-\d{2}-\d{2}$/),
});
export type OsmPlace = z.infer<typeof osmPlaceSchema>;

// ---------------------------------------------------------------- GET /api/v1/network/search-index/:revisionId

/**
 * One immutable JSON per published revision, searched in the browser (decision D1). Built
 * server-side from the v_published_* views only (src/domain/search/index-build.ts).
 * Only OpenStreetMap places and mapped-pin places carry coordinates. Terminals, barangays and
 * 2025 study labels have NO location on file: `location: null` says so explicitly, and nothing
 * is ever inferred for them. Legacy (1993) names are historical hints, never linked to a route.
 */
export const searchOsmPlaceSchema = osmPlaceSchema.omit({ osmType: true, osmId: true });
export type SearchOsmPlace = z.infer<typeof searchOsmPlaceSchema>;

export const searchPinSchema = z.object({
  stopId: z.uuid(),
  /** Source stop code (A1, B30 …); null when the source has none. */
  code: z.string().nullable(),
  /** Source layer verbatim ("Loop Service A"). */
  layer: z.string().nullable(),
  lat: latitude,
  lng: longitude,
  /** True when a published variant lists this pin in its (provisional) stop order. */
  onRoute: z.boolean(),
});

/** Mapped candidate pins sharing one normalized raw label within 60 m of the group's first pin. */
export const searchPinPlaceSchema = z.object({
  /** sha256(normalized label + first stop id), hex, first 16 chars; stable per revision. */
  key: z.string().regex(/^[0-9a-f]{16}$/),
  /** The most frequent raw spelling. */
  label: z.string().min(1),
  /** Every raw spelling in the group, verbatim, first seen first. */
  spellings: z.array(z.string().min(1)).min(1),
  pins: z.array(searchPinSchema).min(1),
});
export type SearchPinPlace = z.infer<typeof searchPinPlaceSchema>;

export const searchRouteSchema = z.object({
  code: z.string(),
  name: z.string(),
  groupNumber: z.number().int().nullable(),
  evidenceLevel: z.enum(EVIDENCE_LEVELS).nullable(),
  hasTrial: z.boolean(),
  /** Distinct street names from the legal street lists and trial circuits, verbatim. */
  streets: z.array(z.string()),
  mode: legacyRouteMode(),
  /** The route's fleet sentence (fleetLabel), e.g. "Traditional and modern jeepneys". */
  fleetLabel: z.string().default(() => unconfirmedFleet().label),
  /** Current (non-historical) route aliases, e.g. the stop-sign letter "E"; [] for older snapshots. */
  aliases: z.array(z.string()).default(() => []),
});

export const searchTerminalSchema = z.object({
  code: z.string().regex(/^T\d{2}$/),
  name: z.string(),
  locationText: z.string().nullable(),
  modes: z.array(z.string()),
  /** Null for a legacy terminal row. */
  kind: z.enum(TERMINAL_KINDS).nullable().default(null),
  /** The OpenStreetMap coordinate (ODbL) when one is on file; never an entrance or bay. */
  location: z.object({ lat: latitude, lng: longitude, source: z.literal("osm") }).nullable().default(null),
});

export const searchBarangaySchema = z.object({
  /** URL-safe key from the folded name ("bagumbayan-norte"). */
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string(),
  surveyStatus: z.string(),
  sourceCode: z.string().nullable(),
  /** No boundary or centroid is on file. */
  location: z.null(),
});

export const searchStudyLabelSchema = z.object({
  code: z.string(),
  label: z.string(),
  labelType: z.string().nullable(),
  routeCode: z.string().nullable(),
  direction: z.string().nullable(),
  sourceContext: z.string().nullable(),
  sourceCodes: z.array(z.string()),
  /** A schematic label from the 2025 study, not a curb: no coordinate exists. */
  location: z.null(),
});

export const searchDestinationCategorySchema = z.object({
  category: z.string(),
  destinations: z.array(z.string()),
  terminalCode: z.string().nullable(),
});

export const searchFeederLeadSchema = z.object({
  code: z.string(),
  name: z.string(),
  status: z.string().nullable(),
});

export const legacyRouteNameSchema = z.object({
  name: z.string(),
  sourceCode: z.literal("S28"),
  year: z.literal(1993),
  /** Always null: the 1993 names are not mapped to current routes (decision Q2). */
  mappedRouteCode: z.null(),
});
export type LegacyRouteName = z.infer<typeof legacyRouteNameSchema>;

export const searchIndexSchema = z.object({
  revision: revisionMetaSchema,
  osmPlaces: z.array(searchOsmPlaceSchema),
  pinPlaces: z.array(searchPinPlaceSchema),
  routes: z.array(searchRouteSchema),
  terminals: z.array(searchTerminalSchema),
  /** Keys are unique: a place-detail URL names exactly one barangay. */
  barangays: z.array(searchBarangaySchema).refine((list) => new Set(list.map((b) => b.key)).size === list.length, {
    message: "barangay keys must be unique",
  }),
  studyLabels: z.array(searchStudyLabelSchema),
  destinationCategories: z.array(searchDestinationCategorySchema),
  feederLeads: z.array(searchFeederLeadSchema),
  legacyNames: z.array(legacyRouteNameSchema),
});
export type SearchIndex = z.infer<typeof searchIndexSchema>;

// ---------------------------------------------------------------- GET /api/v1/network/search-places/:revisionId

/**
 * Task 14: every other named OpenStreetMap place (restaurants, shops, banks, ... the categories of
 * MORE_PLACE_CATEGORIES) as a second, lazy chunk. Same immutable-per-revision rules as the search
 * index. It may be empty (a revision imported before Task 14 holds none): that is a complete answer.
 */
export const searchPlacesSchema = z.object({
  revision: revisionMetaSchema,
  places: z.array(searchOsmPlaceSchema),
});
export type SearchPlaces = z.infer<typeof searchPlacesSchema>;

/**
 * The index is cached as immutable, so an empty read is never sent: a published revision always
 * has labelled candidate pins and routes (same rule as isCompleteSnapshot, which needs stops).
 */
export function isCompleteSearchIndex(index: Pick<SearchIndex, "pinPlaces" | "routes">): boolean {
  return index.pinPlaces.length > 0 && index.routes.length > 0;
}

// ---------------------------------------------------------------- GET /api/v1/network/lines/:revisionId

/** J1: shown with every ride path. */
export const PATH_LABEL = "Approximate path, not a verified route shape";
export const UNTRACED_MESSAGE = "Path could not be traced from the street list";
export const LINES_ATTRIBUTION = "Map data © OpenStreetMap contributors (ODbL)";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const OFF_LIST_REASONS = ["off_list_detour", "oneway_conflict", "terminal_access"] as const;
export const TRACE_FAILURES = ["anchor_unresolved", "pin_unsnapped", "unmatched_streets", "not_continuous", "empty"] as const;
const roadSource = z.string().regex(/^OSMR-\d{4}-\d{2}-\d{2}$/);

/**
 * A stretch of a path on streets that are not on the legal list, by metres along the path, with
 * its reason. Rendering (Task 12): off_list_detour dashed only on a flagged path; oneway_conflict
 * dashed with the one-way caution on a flagged path, and on an ok path when ≥ 100 m;
 * terminal_access always drawn normally, with the note "terminal access road".
 */
export const lineSegmentSchema = z.object({
  fromM: z.number().min(0),
  toM: z.number().min(0),
  lengthM: z.number().min(0),
  reason: z.enum(OFF_LIST_REASONS),
  /** Normalized OSM street names with metres, longest first ("(unnamed)" for unnamed roads). */
  streets: z.array(z.object({ name: z.string(), m: z.number().min(0) })),
  /** oneway_conflict only: the listed streets mapped one-way against the travel order. */
  against: z.array(z.string()).nullable(),
});

/** Every point of an encoded path (precision 5) lies inside the Naga map bounds. */
function encodedInsideNaga(encoded: string): boolean {
  const points = decodePolyline(encoded);
  const b = NAGA_MAX_BOUNDS;
  return points.length >= 2 && points.every((p) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east);
}

const lineVariantFields = {
  variantId: z.uuid(),
  routeId: z.uuid(),
  routeCode: z.string(),
  routeName: z.string(),
  /** Feeder branch name; null for LPTRP variants. */
  variantName: z.string().nullable(),
  mode: routeModeSchema,
  direction: z.enum(DIRECTIONS),
  kind: z.enum(VARIANT_KINDS),
};

/** One drawn approximate path (trace status ok or flagged). */
export const lineSchema = z
  .object({
    ...lineVariantFields,
    serviceStatus: z.enum(SERVICE_STATUSES).nullable(),
    planning: z.enum(PLANNING_FLAGS),
    fleet: fleetSummarySchema,
    /** D3 line colour key (same as fleet.colourKey). */
    colourKey: z.enum(COLOUR_KEYS),
    status: z.enum(["ok", "flagged"]),
    /** Why a flagged path is over the D6 off-list threshold; null when ok. */
    flagReason: z.enum(["oneway_conflict", "off_list_detour"]).nullable(),
    /** Encoded polyline, precision 5. */
    encoded: z.string().refine(encodedInsideNaga, { message: "the path must decode inside the Naga map bounds" }),
    lengthM: z.number().positive(),
    label: z.literal(PATH_LABEL),
    roadSource,
    attribution: z.literal(LINES_ATTRIBUTION),
    segments: z.array(lineSegmentSchema),
    quality: z.object({
      listedStreets: z.number().int().min(0),
      matchedStreets: z.number().int().min(0),
      unmatchedStreets: z.array(z.string()),
      offListShare: z.number().min(0).max(1).nullable(),
      gateOffListShare: z.number().min(0).max(1).nullable(),
      terminalAccessM: z.number().min(0),
    }),
  })
  .refine((l) => (l.status === "flagged") === (l.flagReason !== null), { message: "a flagged path has its reason" })
  .refine((l) => l.colourKey === l.fleet.colourKey, { message: "colourKey is the fleet's" });

/** A variant with no path: "Path could not be traced from the street list" and the reason. */
export const untracedLineSchema = z.object({
  ...lineVariantFields,
  reason: z.enum(TRACE_FAILURES),
  message: z.literal(UNTRACED_MESSAGE),
  quality: z.object({
    listedStreets: z.number().int().min(0),
    matchedStreets: z.number().int().min(0),
    unmatchedStreets: z.array(z.string()),
    anchorsUnresolved: z.array(z.string()),
  }),
});

export { LINES_FORMAT_VERSION };

export const linesSchema = z.object({
  /** LINES_FORMAT_VERSION: bumped whenever this shape changes (the worker keys its cache by it). */
  formatVersion: z.literal(LINES_FORMAT_VERSION),
  revision: revisionMetaSchema,
  label: z.literal(PATH_LABEL),
  attribution: z.literal(LINES_ATTRIBUTION),
  attributionUrl: z.literal(OSM_COPYRIGHT_URL),
  licence: z.literal("ODbL 1.0"),
  /** The road snapshots the paths were traced on (OSMR-YYYY-MM-DD). */
  roadSources: z.array(roadSource),
  lines: z.array(lineSchema),
  untraced: z.array(untracedLineSchema),
});
export type Lines = z.infer<typeof linesSchema>;
export type Line = z.infer<typeof lineSchema>;
export type UntracedLine = z.infer<typeof untracedLineSchema>;

// ---------------------------------------------------------------- GET /api/v1/terminals/:code

export const terminalCodeParamSchema = z.string().regex(/^T\d{2}$/);

export function parseTerminalCodeParam(raw: unknown): Parsed<string> {
  const parsed = terminalCodeParamSchema.safeParse(typeof raw === "string" ? raw.toUpperCase() : raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: "code must be a terminal code such as T01." };
}

export const TERMINAL_ROUTE_BASES = ["legal_plan", "trial"] as const;

export const terminalDetailSchema = z.object({
  revision: revisionMetaSchema,
  terminal: z.object({
    code: z.string().regex(/^T\d{2}$/),
    name: z.string(),
    locationText: z.string().nullable(),
    modes: z.array(z.string()),
    evidenceStatus: z.string().nullable(),
    notes: z.string().nullable(),
    sourceCodes: z.array(z.string()),
    /** Null: no terminal coordinate is on file. */
    lat: latitude.nullable(),
    lng: longitude.nullable(),
    /** Null for a legacy terminal row (revisions before the modes seed). */
    kind: z.enum(TERMINAL_KINDS).nullable(),
    verification: z.string().nullable(),
    statusNote: z.string().nullable(),
    /** Sources per mode served ({ bus: ["S09", "N02"] }). */
    modeSources: z.record(z.string(), z.array(z.string())),
    /** Present exactly when lat/lng are: where the coordinate comes from (OpenStreetMap, ODbL). */
    coordinate: terminalCoordinateSchema.nullable(),
  }).refine((t) => (t.lat === null) === (t.lng === null) && (t.lat === null) === (t.coordinate === null), {
    message: "a terminal coordinate always carries its provenance",
  }),
  /** Routes whose legal street list (legal_plan) or trial circuit (trial) names this terminal. */
  routes: z.array(
    z.object({
      routeCode: z.string(),
      routeName: z.string(),
      basis: z.enum(TERMINAL_ROUTE_BASES),
      sourceCodes: z.array(z.string()),
    }),
  ),
  /**
   * Regional services (UV Express, buses, regional jeepneys) leaving from this terminal, with fare
   * ESTIMATES from the per-km national rates. Not drawn on the map; never part of trip planning.
   */
  regionalServices: z.array(
    z.object({
      code: z.string().regex(/^RS\d{2}$/),
      name: z.string(),
      mode: z.enum(["uv_express", "bus", "jeepney"]),
      operators: z.array(z.string()),
      destination: z.string(),
      /** Null: distance not on file. */
      distanceKm: z.number().positive().nullable(),
      distanceBasis: z.string().nullable(),
      status: z.literal("community_mapped"),
      terminalNote: z.string().nullable(),
      notes: z.string().nullable(),
      fareRuleCodes: z.array(z.string()),
      fareEstimate: z.object({
        isEstimate: z.literal(true),
        distanceKm: z.number().nullable(),
        lowCentavos: z.number().int().nullable(),
        highCentavos: z.number().int().nullable(),
        text: z.string(),
        ruleCodes: z.array(z.string()),
      }),
      sourceCodes: z.array(z.string()).min(1),
    }),
  ),
  /**
   * A published service leaving from here names at least one out-of-city destination: the
   * "Destinations from here" link to Leaving Naga (IC1). False for responses from before IC1.
   */
  hasIntercity: z.boolean().default(false),
  /** External destination categories whose candidate terminal is this one. */
  destinationCategories: z.array(
    z.object({
      category: z.string(),
      destinations: z.array(z.string()),
      evidenceStatus: z.string().nullable(),
      sourceCodes: z.array(z.string()),
    }),
  ),
  sources: z.array(sourceSchema),
});
export type TerminalDetail = z.infer<typeof terminalDetailSchema>;

// ---------------------------------------------------------------- GET /api/v1/network/intercity/:revisionId

export {
  ACCESS_NOTE_CODES,
  DAY_TYPES,
  DEPARTURE_BASES,
  DEPARTURE_PATTERNS,
  DESTINATION_GROUPS,
  DESTINATION_KINDS,
  INTERCITY_MODES,
  INTERCITY_SERVICE_STATUSES,
  OBSERVATION_BASES,
  STATUS_NOTE_CODES,
};

export const intercityDestinationSchema = z.object({
  code: z.string().regex(/^D-[A-Z0-9-]{2,30}$/),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  groupCode: z.enum(DESTINATION_GROUPS),
  psgcCode: z.string().regex(/^[0-9]{10}$/).nullable(),
  kind: z.enum(DESTINATION_KINDS),
});

/** One departure fact (pattern, basis, the day or month observed); times are HH:MM, Manila. */
export const intercityDepartureSchema = z.object({
  pattern: z.enum(DEPARTURE_PATTERNS),
  times: z.array(clockTime),
  headwayMin: z.number().int().positive().nullable(),
  startTime: clockTime.nullable(),
  endTime: clockTime.nullable(),
  tripsPerDay: z.number().int().positive().nullable(),
  dayType: z.enum(DAY_TYPES),
  basis: z.enum(DEPARTURE_BASES),
  observedOn: isoDate,
  sourceCodes: z.array(z.string()).min(1),
});

/** One observed amount (or range) with its basis and month (first day): never an estimate, never summed. */
export const intercityObservationSchema = z
  .object({
    amountCentavos: z.number().int().nonnegative(),
    amountHighCentavos: z.number().int().nonnegative().nullable(),
    seatClassText: z.string().nullable(),
    destinationCode: z.string().nullable(),
    basis: z.enum(OBSERVATION_BASES),
    observedAt: isoDate,
    sourceCodes: z.array(z.string()).min(1),
  })
  .refine((o) => o.amountHighCentavos === null || o.amountHighCentavos >= o.amountCentavos, {
    message: "a fare range never ends below its start",
  });

export const intercityServiceSchema = z.object({
  code: z.string().regex(/^RS\d{2}$/),
  mode: z.enum(INTERCITY_MODES),
  name: z.string(),
  operators: z.array(z.string()),
  /** Null when the terminal is not published. lat/lng null: no coordinate on file ("Location being confirmed"). */
  terminal: z
    .object({
      code: z.string().regex(/^T\d{2}$/),
      name: z.string(),
      locationText: z.string().nullable(),
      lat: latitude.nullable(),
      lng: longitude.nullable(),
    })
    .refine((t) => (t.lat === null) === (t.lng === null), { message: "a coordinate has both lat and lng" })
    .nullable(),
  destinationCodes: z.array(z.string()),
  /** Null: distance not on file (the on-device rule estimate then gives rates only). */
  distanceKm: z.number().positive().nullable(),
  distanceBasis: z.string().nullable(),
  status: z.enum(INTERCITY_SERVICE_STATUSES),
  statusSince: isoDate.nullable(),
  statusNoteCode: z.enum(STATUS_NOTE_CODES).nullable(),
  /** Null only for community_mapped (the 0029 CHECK). */
  asOf: isoDate.nullable(),
  reviewBy: isoDate.nullable(),
  accessNoteCode: z.enum(ACCESS_NOTE_CODES).nullable(),
  fareRuleCodes: z.array(z.string()),
  departures: z.array(intercityDepartureSchema),
  observations: z.array(intercityObservationSchema),
  sourceCodes: z.array(z.string()).min(1),
  /** The distinct reviewer-assigned evidence types of sourceCodes (evidence chips; never ai_confidence). */
  sourceEvidenceTypes: z.array(z.string()),
});

/** A reviewed intercity_* dataset note (rail status, "planned, not funded", …). */
export const intercityNoteSchema = z.object({
  key: z.string().regex(/^intercity_[a-z0-9_]+$/),
  value: z.looseObject({ sourceCodes: z.array(z.string()).min(1), asOf: isoDate }),
});

/**
 * The Leaving Naga guide of one published revision (IC1): immutable, cached CacheFirst. Status,
 * staleness and the rule estimate are computed on the device (Manila time), so the body never
 * depends on the time it was read. Missing facts stay null or [] ("not found"), never 0.
 */
export const intercitySchema = z.object({
  revision: revisionMetaSchema,
  destinations: z.array(intercityDestinationSchema),
  services: z.array(intercityServiceSchema),
  /** The published regional rules the services cite (F06–F12, F01): estimate inputs only, never the planner's. */
  fareRules: z.array(fareRuleEstimateSchema),
  notes: z.array(intercityNoteSchema),
});
export type Intercity = z.infer<typeof intercitySchema>;
export type IntercityService = z.infer<typeof intercityServiceSchema>;
export type IntercityDestination = z.infer<typeof intercityDestinationSchema>;
export type IntercityDeparture = z.infer<typeof intercityDepartureSchema>;
export type IntercityObservation = z.infer<typeof intercityObservationSchema>;
export type IntercityNote = z.infer<typeof intercityNoteSchema>;

// ---------------------------------------------------------------- GET /api/v1/sources

export const sourceListSchema = z.object({
  revision: revisionMetaSchema,
  sources: z.array(sourceSchema),
});
export type SourceList = z.infer<typeof sourceListSchema>;

// ---------------------------------------------------------------- errors

export const API_ERROR_CODES = ["bad_request", "not_found", "payload_too_large", "unavailable", "internal", "too_many_requests", "unauthorized", "forbidden", "step_up_required", "conflict"] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({ code: z.enum(API_ERROR_CODES), message: z.string(), requestId: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------- parameters

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export const uuidParamSchema = z.uuid();

export function parseUuidParam(raw: unknown, name: string): Parsed<string> {
  const parsed = uuidParamSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data.toLowerCase() } : { ok: false, message: `${name} must be a UUID.` };
}

/** Public route codes such as R1 or R8-A. */
export const routeCodeParamSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/);

export function parseRouteCodeParam(raw: unknown): Parsed<string> {
  const parsed = routeCodeParamSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data.toUpperCase() } : { ok: false, message: "code must be a route code such as R8-A." };
}

/** [west, south, east, north] in degrees. */
export type Bbox = { west: number; south: number; east: number; north: number };

const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * `w,s,e,n`: four finite decimal numbers, west < east, south < north, entirely inside the
 * Naga max bounds. Error messages never echo the given values.
 */
export function parseBbox(raw: string | null | undefined): Parsed<Bbox> {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ok: false, message: "bbox is required as w,s,e,n." };
  }
  if (raw.length > 120) return { ok: false, message: "bbox is too long." };
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) {
    return { ok: false, message: "bbox must be four decimal numbers: w,s,e,n." };
  }
  const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
  if (![west, south, east, north].every(Number.isFinite)) {
    return { ok: false, message: "bbox values must be finite numbers." };
  }
  if (!(west < east) || !(south < north)) {
    return { ok: false, message: "bbox must have west < east and south < north." };
  }
  const b = NAGA_MAX_BOUNDS;
  if (west < b.west || east > b.east || south < b.south || north > b.north) {
    return { ok: false, message: "bbox must lie within the Naga City map bounds." };
  }
  return { ok: true, value: { west, south, east, north } };
}

// ---------------------------------------------------------------- fares by route mode

/**
 * Fare rule modes that apply to a route mode. PUJ (jeepney) routes use the traditional (F01)
 * and modern (F02) jeepney minimums because the vehicle class is unknown; anything else has
 * no known rule.
 */
export function fareModesForRouteMode(routeMode: string | null): string[] {
  if (routeMode !== null && /^PUJ(_|$)/.test(routeMode)) return ["traditional_jeepney", "modern_jeepney"];
  // Tricycle feeders: the ₱15 minimum (Ordinance 2024-002, F03); discounts are never applied.
  if (routeMode === "tricycle") return ["trimobile_e_trike_taxicle"];
  return [];
}
