import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Drizzle mirrors of tables created by hand-written SQL in db/migrations.
// The SQL files are the source of truth; keep these in sync.

export const core = pgSchema("core");

export const userRole = core.table("user_role", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  roleCode: text("role_code").notNull(),
  grantedBy: text("granted_by"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  reason: text("reason").notNull(),
});

export const profile = core.table("profile", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  locale: text("locale").notNull(),
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const preference = core.table("preference", {
  userId: text("user_id").primaryKey(),
  fareCategory: text("fare_category").notNull(),
  maxWalkM: integer("max_walk_m").notNull(),
  avoidStairs: boolean("avoid_stairs").notNull(),
  highContrast: boolean("high_contrast").notNull(),
  reducedMotion: boolean("reduced_motion").notNull(),
  lowData: boolean("low_data").notNull(),
  historyEnabled: boolean("history_enabled").notNull(),
});

// ---------------------------------------------------------------- transit / ingest (0001)
// Public, read-only for the app. Only the tables the app reads are mirrored here; the import
// script writes with plain SQL. Geography columns come back as EWKB hex; read coordinates
// with extensions.ST_X/ST_Y(geog::extensions.geometry) in SQL instead.

const geography = customType<{ data: string; driverData: string }>({
  dataType: () => "extensions.geography(Point, 4326)",
});

export const ingest = pgSchema("ingest");
export const transit = pgSchema("transit");

export const source = ingest.table("source", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  url: text("url"),
  evidenceType: text("evidence_type").notNull(),
  publishedOrEnacted: text("published_or_enacted"),
  checkedOn: date("checked_on"),
});

export const rawFeature = ingest.table("raw_feature", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  sourceIdentity: text("source_identity").notNull(),
  identityMethod: text("identity_method").notNull(),
  sourceLayer: text("source_layer").notNull(),
  sourceCodeRaw: text("source_code_raw"),
  labelRaw: text("label_raw").notNull(),
  descriptionRaw: text("description_raw"),
  // numeric(11,8): kept as strings to preserve source precision.
  lon: numeric("lon").notNull(),
  lat: numeric("lat").notNull(),
  properties: jsonb("properties").notNull(),
  contentHash: text("content_hash").notNull(),
});

export const revision = transit.table("revision", {
  id: uuid("id").primaryKey(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  label: text("label").notNull(),
  kind: text("kind").$type<"provisional" | "verified">().notNull(),
  status: text("status").$type<"draft" | "validating" | "published" | "superseded">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const revisionMember = transit.table("revision_member", {
  revisionId: uuid("revision_id").notNull(),
  entityKind: text("entity_kind").notNull(),
  entityId: uuid("entity_id").notNull(),
  versionId: uuid("version_id").notNull(),
});

export const publishedPointer = transit.table("published_pointer", {
  singleton: boolean("singleton").primaryKey(),
  revisionId: uuid("revision_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const route = transit.table("route", {
  id: uuid("id").primaryKey(),
  publicCode: text("public_code").notNull(),
  officialGroupNumber: integer("official_group_number"),
  name: text("name").notNull(),
  modeCode: text("mode_code").notNull(),
  legalStatus: text("legal_status").notNull(),
  allocatedUnits: integer("allocated_units"),
  allocationIsActiveFleetCount: boolean("allocation_is_active_fleet_count").notNull(),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const routeAlias = transit.table("route_alias", {
  id: uuid("id").primaryKey(),
  routeId: uuid("route_id").notNull(),
  alias: text("alias").notNull(),
  kind: text("kind").notNull(),
  isHistorical: boolean("is_historical").notNull(),
  sourceCode: text("source_code"),
});

export const variant = transit.table("variant", {
  id: uuid("id").primaryKey(),
  routeId: uuid("route_id").notNull(),
  direction: text("direction").notNull(),
  kind: text("kind").notNull(),
});

export type EvidenceLevel = "documentary" | "provisional" | "verified";

export const variantVersion = transit.table("variant_version", {
  id: uuid("id").primaryKey(),
  variantId: uuid("variant_id").notNull(),
  headsign: text("headsign"),
  vehicleClass: text("vehicle_class"),
  legalStreets: jsonb("legal_streets").$type<{ inbound?: string[]; outbound?: string[]; circuit?: string[] }>(),
  trialStatus: text("trial_status"),
  effectiveFrom: date("effective_from"),
  trialDurationDays: integer("trial_duration_days"),
  operatingStatus: text("operating_status").notNull(),
  evidenceLevel: text("evidence_level").$type<EvidenceLevel>().notNull(),
  isCircular: boolean("is_circular").notNull(),
  navigationApproved: boolean("navigation_approved").notNull(),
  sourceCodes: text("source_codes").array().notNull(),
  notes: text("notes"),
});

export const stopPoint = transit.table("stop_point", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  officialStopId: text("official_stop_id"),
});

export const stopPointVersion = transit.table("stop_point_version", {
  id: uuid("id").primaryKey(),
  stopPointId: uuid("stop_point_id").notNull(),
  geog: geography("geog").notNull(),
  status: text("status").notNull(),
  sourceLayer: text("source_layer"),
  sourceCodeRaw: text("source_code_raw"),
  labelRaw: text("label_raw"),
  curbSide: text("curb_side"),
  boardingAllowed: boolean("boarding_allowed"),
  alightingAllowed: boolean("alighting_allowed"),
  signInstalled: boolean("sign_installed"),
  navigationApproved: boolean("navigation_approved").notNull(),
});

export const stopPointSource = transit.table("stop_point_source", {
  stopPointId: uuid("stop_point_id").notNull(),
  rawFeatureId: uuid("raw_feature_id").notNull(),
});

export const routeStop = transit.table("route_stop", {
  id: uuid("id").primaryKey(),
  variantVersionId: uuid("variant_version_id").notNull(),
  stopPointVersionId: uuid("stop_point_version_id").notNull(),
  seq: integer("seq").notNull(),
  distAlongM: numeric("dist_along_m"),
  evidenceLevel: text("evidence_level").$type<EvidenceLevel>().notNull(),
});

export const terminal = transit.table("terminal", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  locationText: text("location_text"),
  modes: text("modes").array().notNull(),
  evidenceStatus: text("evidence_status"),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
});

export const fareRule = transit.table("fare_rule", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull(),
  modeCode: text("mode_code").notNull(),
  vehicleClass: text("vehicle_class"),
});

export const fareRuleVersion = transit.table("fare_rule_version", {
  id: uuid("id").primaryKey(),
  fareRuleId: uuid("fare_rule_id").notNull(),
  baseCentavos: integer("base_centavos"),
  baseKm: numeric("base_km"),
  incrementCentavosPerKm: integer("increment_centavos_per_km"),
  discountPercent: numeric("discount_percent"),
  discountedBaseCentavos: integer("discounted_base_centavos"),
  discountGroups: text("discount_groups").array(),
  rounding: text("rounding"),
  effectiveFrom: date("effective_from"),
  evidenceStatus: text("evidence_status"),
  status: text("status").notNull(),
  publishExact: boolean("publish_exact").notNull(),
  sourceCodes: text("source_codes").array().notNull(),
});
