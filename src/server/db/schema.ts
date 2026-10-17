import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  smallint,
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

export const mediaObject = core.table("media_object", {
  id: uuid("id").primaryKey(),
  bucket: text("bucket").notNull(),
  objectKey: text("object_key").notNull(),
  mime: text("mime"),
  bytes: bigint("bytes", { mode: "number" }),
  expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256"),
  ownerId: text("owner_id").notNull(),
  purpose: text("purpose").$type<"community_photo" | "correction_evidence" | "stop_photo" | "complaint_evidence">().notNull(),
  status: text("status").$type<"slot" | "verified" | "rejected" | "deleted">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export const savedPlace = core.table("saved_place", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  label: text("label").notNull(),
  point: text("point").notNull(),
  source: text("source").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const savedTrip = core.table("saved_trip", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  revisionId: uuid("revision_id").notNull(),
  revisionLabel: text("revision_label").notNull(),
  revisionKind: text("revision_kind").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  startLabel: text("start_label").notNull(),
  startPoint: text("start_point").notNull(),
  startPlace: text("start_place"),
  destLabel: text("dest_label").notNull(),
  destPoint: text("dest_point").notNull(),
  destPlace: text("dest_place"),
  option: jsonb("option").notNull(),
  stops: jsonb("stops").notNull(),
  variants: jsonb("variants").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
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
  evidenceType: text("evidence_type"),
  publishedOrEnacted: text("published_or_enacted"),
  checkedOn: date("checked_on"),
  // 0006
  publisher: text("publisher"),
  licence: text("licence"),
  extraUrls: text("extra_urls").array().notNull(),
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
  /** Verbatim source coordinate text, e.g. "123.1846726,13.6233869,0". */
  coordinatesRaw: text("coordinates_raw").notNull(),
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

export type TransitMode = "jeepney" | "tricycle" | "uv_express" | "bus" | "rail";

export const route = transit.table("route", {
  id: uuid("id").primaryKey(),
  publicCode: text("public_code").notNull(),
  officialGroupNumber: integer("official_group_number"),
  name: text("name").notNull(),
  modeCode: text("mode_code"),
  legalStatus: text("legal_status"),
  allocatedUnits: integer("allocated_units"),
  allocationIsActiveFleetCount: boolean("allocation_is_active_fleet_count"),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  properties: jsonb("properties").$type<Record<string, unknown>>().notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
  // 0006
  mode: text("mode").$type<TransitMode>().notNull(),
  serviceStatus: text("service_status").$type<"legal_plan" | "authorized_feeder" | "historical_unknown">(),
  planning: text("planning").$type<"provisional" | "none">().notNull(),
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
  /** 0006: tells apart the branch variants of one feeder route; NULL for LPTRP variants. */
  name: text("name"),
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
  operatingStatus: text("operating_status"),
  evidenceLevel: text("evidence_level").$type<EvidenceLevel>().notNull(),
  isCircular: boolean("is_circular").notNull(),
  navigationApproved: boolean("navigation_approved").notNull(),
  sourceCodes: text("source_codes").array().notNull(),
  notes: text("notes"),
  /** 0006: tracing anchors of a feeder variant, verbatim from the reviewed modes seed. */
  anchors: jsonb("anchors").$type<unknown[]>(),
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
  stopPointVersionId: uuid("stop_point_version_id").notNull(),
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
  // 0006
  ruleText: text("rule_text"),
  notes: text("notes"),
});

// ---------------------------------------------------------------- modes, fleets, terminals (0006)

export const terminalVersion = transit.table("terminal_version", {
  id: uuid("id").primaryKey(),
  terminalId: uuid("terminal_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<"terminal" | "loading_point" | "waiting_area" | "station">().notNull(),
  locationText: text("location_text"),
  modes: text("modes").array().$type<TransitMode[]>().notNull(),
  modesRaw: text("modes_raw").array().notNull(),
  modeSources: jsonb("mode_sources").$type<Partial<Record<TransitMode, string[]>>>().notNull(),
  geog: geography("geog"),
  coordSource: text("coord_source").$type<"osm_node" | "osm_way_centroid">(),
  osmType: text("osm_type").$type<"node" | "way">(),
  osmId: bigint("osm_id", { mode: "number" }),
  osmVersion: integer("osm_version"),
  osmTimestamp: timestamp("osm_timestamp", { withTimezone: true }),
  coordNote: text("coord_note"),
  coordReadFrom: text("coord_read_from"),
  verification: text("verification").notNull(),
  statusNote: text("status_note"),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export type VehicleClass = "traditional_puj" | "modern_puj" | "tricycle" | "e_tricycle" | "uv_express" | "bus";

export const routeVehicleClass = transit.table("route_vehicle_class", {
  id: uuid("id").primaryKey(),
  routeId: uuid("route_id").notNull(),
  code: text("code").notNull(),
  vehicleClass: text("vehicle_class").$type<VehicleClass>().notNull(),
  evidenceLevels: text("evidence_levels").array().notNull(),
  status: text("status").$type<"planned" | "reported" | "reported_not_confirmed" | "operating">().notNull(),
  firstReportedOn: date("first_reported_on"),
  lastReportedOn: date("last_reported_on"),
  unitsNote: text("units_note"),
  aircon: boolean("aircon"),
  airconSourceCodes: text("aircon_source_codes").array().notNull(),
  cooperatives: text("cooperatives").array().notNull(),
  conflictNotes: text("conflict_notes").array().notNull(),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

/** Cooperative names only: there is no chair or address column (C8). */
export const routeCooperative = transit.table("route_cooperative", {
  id: uuid("id").primaryKey(),
  routeId: uuid("route_id").notNull(),
  name: text("name").notNull(),
  basis: text("basis").$type<"corridor_reported" | "name_matches_corridor">().notNull(),
  reportedOn: text("reported_on"),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const routeOperatingStatus = transit.table("route_operating_status", {
  id: uuid("id").primaryKey(),
  routeId: uuid("route_id").notNull(),
  operatingStatus: text("operating_status").$type<"operating">().notNull(),
  statusNote: text("status_note").notNull(),
  confirmedOn: date("confirmed_on").notNull(),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const routeFareObservation = transit.table("route_fare_observation", {
  id: uuid("id").primaryKey(),
  routeId: uuid("route_id").notNull(),
  code: text("code").notNull(),
  vehicleClass: text("vehicle_class").$type<VehicleClass>().notNull(),
  kind: text("kind").$type<"reported_practice">().notNull(),
  relativeTo: text("relative_to").$type<"traditional_fare">().notNull(),
  deltaQualifier: text("delta_qualifier").$type<"range" | "at_least">().notNull(),
  deltaCentavosLow: integer("delta_centavos_low").notNull(),
  deltaCentavosHigh: integer("delta_centavos_high"),
  observedOn: date("observed_on").notNull(),
  reportText: text("report_text").notNull(),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const regionalService = transit.table("regional_service", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const regionalServiceVersion = transit.table("regional_service_version", {
  id: uuid("id").primaryKey(),
  regionalServiceId: uuid("regional_service_id").notNull(),
  mode: text("mode").$type<"uv_express" | "bus" | "jeepney">().notNull(),
  name: text("name").notNull(),
  operators: text("operators").array().notNull(),
  terminalCode: text("terminal_code").notNull(),
  terminalNote: text("terminal_note"),
  destination: text("destination").notNull(),
  osmRelationIds: bigint("osm_relation_ids", { mode: "number" }).array().notNull(),
  osmRelationVersions: integer("osm_relation_versions").array(),
  distanceKm: numeric("distance_km"),
  distanceBasis: text("distance_basis"),
  status: text("status").$type<"community_mapped">().notNull(),
  fareRuleCodes: text("fare_rule_codes").array().notNull(),
  notes: text("notes"),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

// ---------------------------------------------------------------- paths, walk graph, time-estimate parameters (0007)

export const shape = transit.table("shape", {
  id: uuid("id").primaryKey(),
  variantId: uuid("variant_id").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const shapeVersion = transit.table("shape_version", {
  id: uuid("id").primaryKey(),
  shapeId: uuid("shape_id").notNull(),
  variantVersionId: uuid("variant_version_id").notNull(),
  traceStatus: text("trace_status").$type<"ok" | "flagged" | "untraced">().notNull(),
  flagReason: text("flag_reason").$type<"oneway_conflict" | "off_list_detour">(),
  untracedReason: text("untraced_reason"),
  geog: geography("geog"),
  lengthM: numeric("length_m"),
  evidenceKind: text("evidence_kind").$type<"approximate_street_trace">().notNull(),
  approximate: boolean("approximate").notNull(),
  label: text("label").notNull(),
  stopMeasures: jsonb("stop_measures").$type<{ seq: number; stopPointVersionId: string; measureM: number; snapM: number }[]>(),
  offListSegments: jsonb("off_list_segments").notNull(),
  traceQuality: jsonb("trace_quality").notNull(),
  inputsHash: text("inputs_hash").notNull(),
  roadSourceCode: text("road_source_code").notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const walkGraph = transit.table("walk_graph", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const walkGraphVersion = transit.table("walk_graph_version", {
  id: uuid("id").primaryKey(),
  walkGraphId: uuid("walk_graph_id").notNull(),
  formatVersion: integer("format_version").notNull(),
  payload: text("payload").notNull(),
  bytes: integer("bytes").notNull(),
  gzipBytes: integer("gzip_bytes").notNull(),
  sha256: text("sha256").notNull(),
  nodeCount: integer("node_count").notNull(),
  edgeCount: integer("edge_count").notNull(),
  roadSourceCode: text("road_source_code").notNull(),
  builderVersion: text("builder_version").notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const etaParam = transit.table("eta_param", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

export const etaParamVersion = transit.table("eta_param_version", {
  id: uuid("id").primaryKey(),
  etaParamId: uuid("eta_param_id").notNull(),
  valueLow: numeric("value_low"),
  valueHigh: numeric("value_high"),
  unit: text("unit").$type<"km_per_h" | "factor" | "windows">().notNull(),
  windows: jsonb("windows").$type<{ start: string; end: string }[]>(),
  days: text("days").$type<"every_day">(),
  appliesTo: text("applies_to").array().notNull(),
  isAssumption: boolean("is_assumption").notNull(),
  assumptionNote: text("assumption_note"),
  basis: text("basis").notNull(),
  sourceCodes: text("source_codes").array().notNull(),
  contentHash: text("content_hash").notNull(),
  isSynthetic: boolean("is_synthetic").notNull(),
});

// ---------------------------------------------------------------- ops (0000, 0014)

export const ops = pgSchema("ops");

export const job = ops.table("job", {
  id: uuid("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").$type<"queued" | "running" | "retry" | "done" | "dead">().notNull(),
  attempts: integer("attempts").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const rateLimitBucket = ops.table("rate_limit_bucket", {
  keyHash: text("key_hash").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});


// ---------------------------------------------------------------- community (0016)
export const community = pgSchema("community");

export const correction = community.table("correction", {
  id: uuid("id").primaryKey(),
  authorId: text("author_id").notNull(),
  clientRequestId: uuid("client_request_id").notNull(),
  entityType: text("entity_type").$type<"stop" | "route" | "fare" | "trip">().notNull(),
  entityId: text("entity_id").notNull(),
  entityLabel: text("entity_label"),
  entityRevisionId: uuid("entity_revision_id"),
  kind: text("kind").notNull(),
  description: text("description").notNull(),
  proposed: jsonb("proposed").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  locationAccuracyM: numeric("location_accuracy_m"),
  mediaIds: uuid("media_ids").array().notNull(),
  status: text("status").notNull(),
  moderationReason: text("moderation_reason"),
  duplicateOf: uuid("duplicate_of"),
  reviewerNote: text("reviewer_note"),
  incorporatedRevisionId: uuid("incorporated_revision_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const correctionEvent = community.table("correction_event", {
  id: uuid("id").primaryKey(),
  correctionId: uuid("correction_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorId: text("actor_id"),
  actorRole: text("actor_role"),
  reasonCode: text("reason_code"),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------- community hub (0017)
export const communityPost = community.table("post", {
  id: uuid("id").primaryKey(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  authorId: text("author_id").notNull(),
  clientRequestId: uuid("client_request_id").notNull(),
  topic: text("topic").$type<"commute_tips" | "first_time" | "route_stop_feedback">().notNull(),
  routeCode: text("route_code"),
  label: text("label").$type<"community" | "official_notice" | "incorporated_change">().notNull(),
  publishedVersionId: uuid("published_version_id"),
  helpfulCount: integer("helpful_count").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const communityPostVersion = community.table("post_version", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").notNull(),
  n: integer("n").notNull(),
  authorId: text("author_id").notNull(),
  clientRequestId: uuid("client_request_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tags: text("tags").array().notNull(),
  moderationStatus: text("moderation_status").$type<"pending" | "published" | "rejected" | "human_review" | "superseded">().notNull(),
  moderationReason: text("moderation_reason"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const communityComment = community.table("comment", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").notNull(),
  parentCommentId: uuid("parent_comment_id"),
  depth: smallint("depth").notNull(),
  authorId: text("author_id").notNull(),
  clientRequestId: uuid("client_request_id").notNull(),
  body: text("body").notNull(),
  moderationStatus: text("moderation_status").$type<"pending" | "published" | "rejected" | "human_review">().notNull(),
  moderationReason: text("moderation_reason"),
  helpfulCount: integer("helpful_count").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const communityReaction = community.table("reaction", {
  userId: text("user_id").notNull(),
  targetType: text("target_type").$type<"post" | "comment">().notNull(),
  targetId: uuid("target_id").notNull(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const communityBookmark = community.table("bookmark", {
  userId: text("user_id").notNull(),
  postId: uuid("post_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const communityUserBlock = community.table("user_block", {
  id: uuid("id").primaryKey(),
  blockerId: text("blocker_id").notNull(),
  blockedId: text("blocked_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const communityContentReport = community.table("content_report", {
  id: uuid("id").primaryKey(),
  reporterId: text("reporter_id").notNull(),
  targetType: text("target_type").$type<"post" | "comment">().notNull(),
  targetId: uuid("target_id").notNull(),
  reason: text("reason").notNull(),
  note: text("note"),
  status: text("status").$type<"open" | "actioned" | "dismissed">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ---------------------------------------------------------------- priv (0018, task B8)
// Private driver reports. paranaga_app may SELECT only the reporter's own rows and only the
// reporter-facing columns (column grants in 0018); every write goes through priv.* definer
// functions. The geography column is left out (written only by priv.submit_complaint).
export const priv = pgSchema("priv");

export const complaint = priv.table("complaint", {
  id: uuid("id").primaryKey(),
  publicRef: text("public_ref").notNull(),
  reporterId: text("reporter_id").notNull(),
  clientRequestId: uuid("client_request_id").notNull(),
  category: text("category")
    .$type<"overcharging" | "reckless_driving" | "discount_refused" | "harassment" | "improper_loading" | "other">()
    .notNull(),
  description: text("description").notNull(),
  incidentAt: timestamp("incident_at", { withTimezone: true }).notNull(),
  locationAccuracyM: numeric("location_accuracy_m"),
  locationSource: text("location_source").$type<"gps" | "manual" | "none">().notNull(),
  locationText: text("location_text"),
  operatorText: text("operator_text"),
  plateText: text("plate_text"),
  bodyNumberText: text("body_number_text"),
  status: text("status").$type<"submitted" | "under_review" | "needs_information" | "closed" | "withdrawn">().notNull(),
  outcomeCode: text("outcome_code"),
  queue: text("queue").$type<"queue_normal" | "queue_priority" | "queue_check_completeness">().notNull(),
  legalHold: boolean("legal_hold").notNull(),
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const complaintMedia = priv.table("complaint_media", {
  id: uuid("id").primaryKey(),
  complaintId: uuid("complaint_id").notNull(),
  mediaObjectId: uuid("media_object_id").notNull(),
  captureKind: text("capture_kind").$type<"in_app_camera" | "file_upload">().notNull(),
  capturedAtClient: timestamp("captured_at_client", { withTimezone: true }),
  receivedAtServer: timestamp("received_at_server", { withTimezone: true }).notNull(),
  sha256: text("sha256").notNull(),
  gpsAccuracyM: numeric("gps_accuracy_m"),
  originalKey: text("original_key").notNull(),
  redactedKey: text("redacted_key"),
});

export const complaintEvent = priv.table("complaint_event", {
  id: uuid("id").primaryKey(),
  complaintId: uuid("complaint_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorRole: text("actor_role").$type<"reporter" | "complaint_reviewer" | "system">().notNull(),
  actorId: text("actor_id"),
  visibility: text("visibility").$type<"reporter" | "reviewer_only">().notNull(),
  outcomeCode: text("outcome_code"),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

export const evidenceAccess = priv.table("evidence_access", {
  id: uuid("id").primaryKey(),
  complaintId: uuid("complaint_id").notNull(),
  mediaObjectId: uuid("media_object_id").notNull(),
  accessorId: text("accessor_id").notNull(),
  accessorRole: text("accessor_role").$type<"reporter" | "complaint_reviewer">().notNull(),
  purpose: text("purpose").$type<"reporter_download" | "complaint_review">().notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  requestId: text("request_id"),
});

// ---------------------------------------------------------------- priv.external_handoff (0019, task B9)
// What the reporter says they did in the official MyNaga app. Self-reported; written only by
// priv.set_mynaga_handoff (definer); readable only by the reporter.
export const externalHandoff = priv.table("external_handoff", {
  complaintId: uuid("complaint_id").primaryKey(),
  target: text("target").$type<"mynaga">().notNull(),
  submittedExternallyAt: timestamp("submitted_externally_at", { withTimezone: true }),
  selfReportedReference: text("self_reported_reference"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
