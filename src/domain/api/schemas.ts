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
import { OSM_ELEMENT_TYPES, OSM_PLACE_CATEGORIES } from "../places/osm-categories";

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
});

export const networkSnapshotSchema = z.object({
  revision: revisionMetaSchema,
  stops: z.array(stopSummarySchema),
  variants: z.array(snapshotVariantSchema),
  fareRules: z.array(fareRuleEstimateSchema),
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
});
export type LegalStreets = z.infer<typeof legalStreetsSchema>;

const routeVariantSchema = z.object({
  variantId: z.uuid(),
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
});

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
  /** Legacy and local names (historical ones flagged). */
  aliases: z.array(routeAliasSchema),
  fareEvidence: z.object({
    /** How the rules were associated: inferred from the route's mode (no stored route↔fare link). */
    basis: z.literal("route_mode"),
    rules: z.array(fareRuleEstimateSchema),
    observations: z.array(fareObservationSchema),
    conflicts: z.array(
      z.object({ ruleCode: z.string(), observationCode: z.string().nullable(), status: z.string(), note: z.string().nullable() }),
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
});

export const searchTerminalSchema = z.object({
  code: z.string().regex(/^T\d{2}$/),
  name: z.string(),
  locationText: z.string().nullable(),
  modes: z.array(z.string()),
  /** No coordinates, entrances or bays are on file. */
  location: z.null(),
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
  barangays: z.array(searchBarangaySchema),
  studyLabels: z.array(searchStudyLabelSchema),
  destinationCategories: z.array(searchDestinationCategorySchema),
  feederLeads: z.array(searchFeederLeadSchema),
  legacyNames: z.array(legacyRouteNameSchema),
});
export type SearchIndex = z.infer<typeof searchIndexSchema>;

/**
 * The index is cached as immutable, so an empty read is never sent: a published revision always
 * has labelled candidate pins and routes (same rule as isCompleteSnapshot, which needs stops).
 */
export function isCompleteSearchIndex(index: Pick<SearchIndex, "pinPlaces" | "routes">): boolean {
  return index.pinPlaces.length > 0 && index.routes.length > 0;
}

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

// ---------------------------------------------------------------- GET /api/v1/sources

export const sourceListSchema = z.object({
  revision: revisionMetaSchema,
  sources: z.array(sourceSchema),
});
export type SourceList = z.infer<typeof sourceListSchema>;

// ---------------------------------------------------------------- errors

export const API_ERROR_CODES = ["bad_request", "not_found", "payload_too_large", "unavailable", "internal"] as const;
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
  return routeMode !== null && /^PUJ(_|$)/.test(routeMode) ? ["traditional_jeepney", "modern_jeepney"] : [];
}
