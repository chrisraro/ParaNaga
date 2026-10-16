import "server-only";
import { sql, type SQL } from "drizzle-orm";
import {
  fareModesForRouteMode,
  INTRA_CITY_FARE_MODES,
  LINES_ATTRIBUTION,
  LINES_FORMAT_VERSION,
  NOT_TRACED,
  OSM_COPYRIGHT_URL,
  PATH_LABEL,
  UNTRACED_MESSAGE,
  variantVerification,
  type Bbox,
  type EtaModel,
  type EtaParam,
  type Line,
  type Lines,
  type PathStatus,
  type FareRuleEstimate,
  type LegalStreets,
  type NetworkSnapshot,
  type RevisionMeta,
  type RouteDetail,
  type RouteList,
  type RouteNote,
  type RouteSummary,
  type StopDetail,
  type StopPin,
  type StopSummary,
} from "@/domain/api/schemas";
import {
  cooperativeLabel,
  fleetSummary,
  operatingStatusLabel,
  type CooperativeBasis,
  type FleetRecord,
  type RouteMode,
} from "@/domain/modes/fleet";
import { encodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import type { Db } from "@/server/db/context";

// Reads the published network ONLY through the published views, v_published_* (security_invoker,
// pointer → revision_member, synthetic rows hidden). tests/unit/repo-views.test.ts fails if any
// file in src/server/repos names another transit.* or ingest.* relation.
// Every query is filtered by the revision id read first, so one response never mixes revisions.

type Row = Record<string, unknown>;

async function rows(db: Db, query: SQL): Promise<Row[]> {
  return (await db.execute(query)).rows as Row[];
}

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const boolOrNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const strArrayOrNull = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);
const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

// ---------------------------------------------------------------- fleets and service status

const FLEET_COLUMNS = sql`route_id, code, vehicle_class, evidence_levels::text[] as evidence_levels, status,
  first_reported_on::text as first_reported_on, last_reported_on::text as last_reported_on, units_note, aircon,
  aircon_source_codes::text[] as aircon_source_codes, cooperatives::text[] as cooperatives, source_codes::text[] as source_codes`;

/** The published vehicle-class records per route id (v_published_route_vehicle_classes). */
export async function fleetByRoute(db: Db, revisionId: string): Promise<Map<string, FleetRecord[]>> {
  const found = await rows(db, sql`
    select ${FLEET_COLUMNS} from transit.v_published_route_vehicle_classes
     where revision_id = ${revisionId}::uuid order by route_id, code`);
  const out = new Map<string, FleetRecord[]>();
  for (const r of found) {
    const list = out.get(str(r.route_id)) ?? [];
    list.push({
      code: str(r.code),
      vehicleClass: r.vehicle_class as FleetRecord["vehicleClass"],
      evidenceLevels: strArray(r.evidence_levels) as FleetRecord["evidenceLevels"][number][],
      status: r.status as FleetRecord["status"],
      firstReportedOn: strOrNull(r.first_reported_on),
      lastReportedOn: strOrNull(r.last_reported_on),
      unitsNote: strOrNull(r.units_note),
      aircon: boolOrNull(r.aircon),
      airconSourceCodes: strArray(r.aircon_source_codes),
      cooperatives: strArray(r.cooperatives),
      sourceCodes: strArray(r.source_codes),
    });
    out.set(str(r.route_id), list);
  }
  return out;
}

type OperatingStatus = NonNullable<RouteSummary["operatingStatus"]>;

/** Owner-confirmed service per route id (confirms service only, never stops or paths). */
async function operatingByRoute(db: Db, revisionId: string): Promise<Map<string, OperatingStatus>> {
  const found = await rows(db, sql`
    select route_id, operating_status, status_note, confirmed_on::text as confirmed_on, source_codes::text[] as source_codes
      from transit.v_published_route_operating_statuses where revision_id = ${revisionId}::uuid`);
  return new Map(found.map((r) => [str(r.route_id), {
    status: "operating" as const,
    label: operatingStatusLabel(str(r.confirmed_on)),
    note: str(r.status_note),
    confirmedOn: str(r.confirmed_on),
    confirmsServiceOnly: true as const,
    sourceCodes: strArray(r.source_codes),
  }]));
}

/** The published reviewed notes per route id (v_published_route_notes), in note-code order. */
async function notesByRoute(db: Db, revisionId: string): Promise<Map<string, RouteNote[]>> {
  const found = await rows(db, sql`
    select route_id, text, evidence, near_lat, near_lng, near_radius_m, source_codes::text[] as source_codes
      from transit.v_published_route_notes where revision_id = ${revisionId}::uuid order by route_id, note_code, text`);
  const out = new Map<string, RouteNote[]>();
  for (const r of found) {
    const list = out.get(str(r.route_id)) ?? [];
    list.push({
      text: str(r.text),
      evidence: r.evidence as RouteNote["evidence"],
      sourceCodes: strArray(r.source_codes),
      near: r.near_lat === null || r.near_lat === undefined ? null
        : { lat: Number(r.near_lat), lng: Number(r.near_lng), radiusM: Number(r.near_radius_m) },
    });
    out.set(str(r.route_id), list);
  }
  return out;
}

type RouteExtras = { fleet: Map<string, FleetRecord[]>; operating: Map<string, OperatingStatus> };

const routeExtras = async (db: Db, revisionId: string): Promise<RouteExtras> => ({
  fleet: await fleetByRoute(db, revisionId),
  operating: await operatingByRoute(db, revisionId),
});

// ---------------------------------------------------------------- revision

export async function getPublishedRevision(db: Db): Promise<RevisionMeta | null> {
  const [r] = await rows(db, sql`select id, label, kind, published_at from transit.v_published_revision`);
  if (!r) return null;
  return { revisionId: str(r.id), label: str(r.label), kind: r.kind as RevisionMeta["kind"], publishedAt: isoOrNull(r.published_at) };
}

// ---------------------------------------------------------------- stops

const STOP_COLUMNS = sql`stop_point_id, name, lat, lon, status, navigation_approved, source_layer, source_code_raw, label_raw`;

function toStop(r: Row): StopSummary {
  return {
    id: str(r.stop_point_id),
    name: str(r.name),
    lat: Number(r.lat),
    lng: Number(r.lon),
    status: r.status as StopSummary["status"],
    navigationApproved: Boolean(r.navigation_approved),
    source: { layer: strOrNull(r.source_layer), code: strOrNull(r.source_code_raw), label: strOrNull(r.label_raw) },
  };
}

// Natural order by layer then code (A1, A2 … A10), then id for stability.
const STOP_ORDER = sql`source_layer nulls last, length(source_code_raw) nulls last, source_code_raw, stop_point_id`;

export async function getStopsInBbox(db: Db, revisionId: string, bbox: Bbox): Promise<StopPin[]> {
  const found = await rows(db, sql`
    select ${STOP_COLUMNS},
           array(select distinct r.public_code
                   from transit.v_published_route_stops rs
                   join transit.v_published_variants v
                     on v.revision_id = rs.revision_id and v.variant_version_id = rs.variant_version_id
                   join transit.v_published_routes r on r.revision_id = v.revision_id and r.id = v.route_id
                  where rs.revision_id = s.revision_id and rs.stop_point_id = s.stop_point_id
                  order by r.public_code)::text[] as route_codes
      from transit.v_published_stops s
     where s.revision_id = ${revisionId}::uuid
       and s.lon between ${bbox.west} and ${bbox.east} and s.lat between ${bbox.south} and ${bbox.north}
     order by ${STOP_ORDER}`);
  return found.map((r) => ({ ...toStop(r), routeCodes: strArray(r.route_codes) }));
}

export async function getStopDetail(db: Db, revisionId: string, stopId: string): Promise<Omit<StopDetail, "revision"> | null> {
  const [s] = await rows(db, sql`
    select ${STOP_COLUMNS}, geog_accuracy_m, curb_side, boarding_allowed, alighting_allowed, sign_installed
      from transit.v_published_stops where revision_id = ${revisionId}::uuid and stop_point_id = ${stopId}::uuid`);
  if (!s) return null;

  const sources = await rows(db, sql`
    select source_layer, source_code_raw, label_raw, description_raw, coordinates_raw, lon::float8 as lon, lat::float8 as lat,
           retrieved_on::text as retrieved_on
      from transit.v_published_stop_sources
     where revision_id = ${revisionId}::uuid and stop_point_id = ${stopId}::uuid
     order by created_at desc, raw_feature_id`);

  const shared = await rows(db, sql`
    select distinct st.stop_point_id, st.name, st.source_layer, st.source_code_raw, st.label_raw
      from transit.v_published_stop_sources me
      join transit.v_published_stop_sources other
        on other.revision_id = me.revision_id and other.lon = me.lon and other.lat = me.lat
       and other.stop_point_id <> me.stop_point_id and other.source_layer <> me.source_layer
      join transit.v_published_stops st on st.revision_id = me.revision_id and st.stop_point_id = other.stop_point_id
     where me.revision_id = ${revisionId}::uuid and me.stop_point_id = ${stopId}::uuid
     order by st.source_layer, st.source_code_raw, st.stop_point_id`);

  const serving = await rows(db, sql`
    select r.public_code, r.name, v.variant_id, v.direction, v.kind, v.evidence_level, v.navigation_approved,
           v.is_circular, rs.seq
      from transit.v_published_route_stops rs
      join transit.v_published_variants v on v.revision_id = rs.revision_id and v.variant_version_id = rs.variant_version_id
      join transit.v_published_routes r on r.revision_id = rs.revision_id and r.id = v.route_id
     where rs.revision_id = ${revisionId}::uuid and rs.stop_point_id = ${stopId}::uuid
     order by r.public_code, rs.seq`);

  const [note] = await rows(db, sql`
    select value from transit.v_published_dataset_notes
     where revision_id = ${revisionId}::uuid and key = 'public_stop_map'`);
  const map = note?.value && typeof note.value === "object" ? (note.value as Row) : null;

  return {
    stop: {
      ...toStop(s),
      accuracyM: numOrNull(s.geog_accuracy_m),
      curbSide: strOrNull(s.curb_side),
      boardingAllowed: boolOrNull(s.boarding_allowed),
      alightingAllowed: boolOrNull(s.alighting_allowed),
      signInstalled: boolOrNull(s.sign_installed),
    },
    sourceRecords: sources.map((r) => ({
      layer: str(r.source_layer),
      code: strOrNull(r.source_code_raw),
      label: str(r.label_raw),
      description: strOrNull(r.description_raw),
      coordinatesRaw: str(r.coordinates_raw),
      lat: Number(r.lat),
      lng: Number(r.lon),
      retrievedOn: strOrNull(r.retrieved_on),
    })),
    sourceMap: map
      ? {
          ownerDisplayName: typeof map.public_owner_display_name === "string" ? map.public_owner_display_name : null,
          ownerIdentityVerified:
            typeof map.owner_identity_or_official_role_verified === "boolean" ? map.owner_identity_or_official_role_verified : null,
        }
      : null,
    sharedCoordinate: shared.map((r) => ({
      stopId: str(r.stop_point_id),
      name: str(r.name),
      source: { layer: strOrNull(r.source_layer), code: strOrNull(r.source_code_raw), label: strOrNull(r.label_raw) },
    })),
    servingRoutes: serving.map((r) => ({
      routeCode: str(r.public_code),
      routeName: str(r.name),
      variantId: str(r.variant_id),
      direction: r.direction as StopDetail["servingRoutes"][number]["direction"],
      kind: r.kind as StopDetail["servingRoutes"][number]["kind"],
      evidenceLevel: r.evidence_level as StopDetail["servingRoutes"][number]["evidenceLevel"],
      verification: variantVerification(str(r.evidence_level), Boolean(r.navigation_approved)),
      isCircular: Boolean(r.is_circular),
      seq: Number(r.seq),
    })),
    // Documentary street lists are not stops; nothing is inferred from them.
    passingNearby: [],
  };
}

// ---------------------------------------------------------------- fares

const FARE_COLUMNS = sql`code, mode_code, vehicle_class, base_centavos, base_km::float8 as base_km, increment_centavos_per_km,
  discount_percent::float8 as discount_percent, discounted_base_centavos, discount_groups::text[] as discount_groups, rounding,
  effective_from::text as effective_from, enacted_on::text as enacted_on, evidence_status, status, publish_exact,
  source_codes::text[] as source_codes, fare_rule_id`;

function toFareRule(r: Row): FareRuleEstimate {
  return {
    code: str(r.code),
    modeCode: str(r.mode_code),
    vehicleClass: strOrNull(r.vehicle_class),
    baseCentavos: numOrNull(r.base_centavos),
    baseKm: numOrNull(r.base_km),
    incrementCentavosPerKm: numOrNull(r.increment_centavos_per_km),
    discountPercent: numOrNull(r.discount_percent),
    discountedBaseCentavos: numOrNull(r.discounted_base_centavos),
    discountGroups: strArrayOrNull(r.discount_groups),
    rounding: strOrNull(r.rounding),
    effectiveFrom: strOrNull(r.effective_from),
    enactedOn: strOrNull(r.enacted_on),
    evidenceStatus: strOrNull(r.evidence_status),
    status: str(r.status),
    publishExact: Boolean(r.publish_exact),
    isEstimate: true,
    sourceCodes: strArray(r.source_codes),
  };
}

/** Published fare rules with these codes (any mode), ordered by code; [] for no codes. */
export async function fareRulesByCode(db: Db, revisionId: string, codes: readonly string[]): Promise<FareRuleEstimate[]> {
  if (codes.length === 0) return [];
  const found = await rows(db, sql`
    select ${FARE_COLUMNS} from transit.v_published_fare_rules
     where revision_id = ${revisionId}::uuid and code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
     order by code`);
  return found.map(toFareRule);
}

// ---------------------------------------------------------------- snapshot

/** The whole published network, or null when `revisionId` is not the published revision. */
export async function getSnapshot(db: Db, revisionId: string): Promise<NetworkSnapshot | null> {
  const revision = await getPublishedRevision(db);
  if (!revision || revision.revisionId !== revisionId) return null;

  const stops = await rows(db, sql`
    select ${STOP_COLUMNS} from transit.v_published_stops where revision_id = ${revisionId}::uuid order by ${STOP_ORDER}`);
  const variants = await rows(db, sql`
    select v.variant_id, v.route_id, r.public_code, r.name, r.mode, v.direction, v.kind, v.evidence_level, v.navigation_approved,
           v.is_circular, array_agg(rs.stop_point_id::text order by rs.seq) as stop_ids
      from transit.v_published_variants v
      join transit.v_published_routes r on r.revision_id = v.revision_id and r.id = v.route_id
      join transit.v_published_route_stops rs on rs.revision_id = v.revision_id and rs.variant_version_id = v.variant_version_id
     where v.revision_id = ${revisionId}::uuid
     group by v.variant_id, v.route_id, r.public_code, r.name, r.mode, v.direction, v.kind, v.evidence_level,
              v.navigation_approved, v.is_circular
     order by r.public_code, v.direction, v.kind`);
  // Intra-city rules only: the regional bus/UV rules (F06–F12) are never planner inputs; they
  // appear only on regional service / terminal detail.
  const fares = await rows(db, sql`
    select ${FARE_COLUMNS} from transit.v_published_fare_rules
     where revision_id = ${revisionId}::uuid
       and mode_code in (${sql.join(INTRA_CITY_FARE_MODES.map((m) => sql`${m}`), sql`, `)})
     order by code`);
  const terminals = await rows(db, sql`
    select code, name, kind, modes::text[] as modes, lat, lon, coord_source, evidence_status
      from transit.v_published_terminals where revision_id = ${revisionId}::uuid order by code`);
  const fleet = await fleetByRoute(db, revisionId);
  const notes = await notesByRoute(db, revisionId);
  const routes = await rows(db, sql`
    select id, public_code, name, mode, service_status from transit.v_published_routes
     where revision_id = ${revisionId}::uuid order by official_group_number nulls last, length(public_code), public_code`);
  // Rider fare reports per route (an observation, never a rule): the mixed-fleet fare maximum.
  const reports = await rows(db, sql`
    select route_id, code, vehicle_class, delta_qualifier, delta_centavos_low, delta_centavos_high,
           observed_on::text as observed_on, source_codes::text[] as source_codes
      from transit.v_published_route_fare_observations
     where revision_id = ${revisionId}::uuid and relative_to = 'traditional_fare'
     order by code`);
  const reportsOf = (routeId: string): NetworkSnapshot["routes"][number]["fareReports"] =>
    reports.filter((o) => str(o.route_id) === routeId).map((o) => ({
      code: str(o.code),
      vehicleClass: o.vehicle_class as NetworkSnapshot["routes"][number]["fareReports"][number]["vehicleClass"],
      deltaQualifier: o.delta_qualifier as "range" | "at_least",
      deltaCentavosLow: Number(o.delta_centavos_low),
      deltaCentavosHigh: numOrNull(o.delta_centavos_high),
      observedOn: str(o.observed_on),
      sourceCodes: strArray(o.source_codes),
    }));
  // D13: the traced path of each variant (length and stop measures by seq); untraced → none.
  const shapes = await rows(db, sql`
    select variant_id, length_m::float8 as length_m, stop_measures from transit.v_published_shapes
     where revision_id = ${revisionId}::uuid and trace_status <> 'untraced'`);
  const pathOf = new Map(shapes.map((s) => [str(s.variant_id), s]));
  const measuresOf = (variantId: string, stopCount: number): { measuresM: number[] | null; pathLengthM: number | null } => {
    const s = pathOf.get(variantId);
    if (!s) return { measuresM: null, pathLengthM: null };
    const list = Array.isArray(s.stop_measures) ? (s.stop_measures as Row[]) : [];
    const bySeq = new Map(list.map((m) => [Number(m.seq), Number(m.measureM)]));
    const measures = Array.from({ length: stopCount }, (_, i) => bySeq.get(i + 1));
    return {
      measuresM: stopCount > 0 && measures.every((m) => m !== undefined && Number.isFinite(m)) ? (measures as number[]) : null,
      pathLengthM: Number(s.length_m),
    };
  };
  const etaModel = await getEtaModel(db, revisionId);

  return {
    revision,
    stops: stops.map(toStop),
    variants: variants.map((r) => ({
      variantId: str(r.variant_id),
      routeId: str(r.route_id),
      routeCode: str(r.public_code),
      routeName: str(r.name),
      direction: r.direction as NetworkSnapshot["variants"][number]["direction"],
      kind: r.kind as NetworkSnapshot["variants"][number]["kind"],
      evidenceLevel: r.evidence_level as NetworkSnapshot["variants"][number]["evidenceLevel"],
      verification: variantVerification(str(r.evidence_level), Boolean(r.navigation_approved)),
      isCircular: Boolean(r.is_circular),
      stopIds: strArray(r.stop_ids),
      mode: r.mode as RouteMode,
      ...measuresOf(str(r.variant_id), strArray(r.stop_ids).length),
    })),
    fareRules: fares.map(toFareRule),
    terminals: terminals.map((t) => {
      const hasCoordinate = t.lat !== null && t.lat !== undefined && t.coord_source !== null && t.coord_source !== undefined;
      return {
        code: str(t.code),
        name: str(t.name),
        kind: strOrNull(t.kind) as NetworkSnapshot["terminals"][number]["kind"],
        modes: strArray(t.modes),
        lat: hasCoordinate ? Number(t.lat) : null,
        lng: hasCoordinate ? Number(t.lon) : null,
        coordSource: hasCoordinate ? (str(t.coord_source) as "osm_node" | "osm_way_centroid") : null,
        verification: strOrNull(t.evidence_status),
      };
    }),
    routes: routes.map((r) => ({
      routeId: str(r.id),
      routeCode: str(r.public_code),
      routeName: str(r.name),
      mode: r.mode as RouteMode,
      serviceStatus: strOrNull(r.service_status) as NetworkSnapshot["routes"][number]["serviceStatus"],
      fleet: fleetSummary(fleet.get(str(r.id)) ?? [], r.mode as RouteMode),
      fareReports: reportsOf(str(r.id)),
      notes: notes.get(str(r.id)) ?? [],
    })),
    etaModel,
  };
}

// ---------------------------------------------------------------- time-estimate parameters

const numOrNullFinite = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The published time-estimate parameters (all five), or null when the revision has none. */
export async function getEtaModel(db: Db, revisionId: string): Promise<EtaModel | null> {
  const found = await rows(db, sql`
    select key, value_low::float8 as value_low, value_high::float8 as value_high, unit, windows, days,
           applies_to::text[] as applies_to, is_assumption, assumption_note, basis, source_codes::text[] as source_codes
      from transit.v_published_eta_params where revision_id = ${revisionId}::uuid order by key`);
  if (found.length === 0) return null;
  return {
    timeZone: "Asia/Manila",
    utcOffsetMinutes: 480,
    params: found.map((p) => ({
      key: p.key as EtaParam["key"],
      low: numOrNullFinite(p.value_low),
      high: numOrNullFinite(p.value_high),
      unit: p.unit as EtaParam["unit"],
      windows: Array.isArray(p.windows) ? (p.windows as { start: string; end: string }[]).map((w) => ({ start: String(w.start), end: String(w.end) })) : null,
      days: strOrNull(p.days) as EtaParam["days"],
      appliesTo: strArray(p.applies_to) as EtaParam["appliesTo"],
      isAssumption: Boolean(p.is_assumption),
      assumptionNote: strOrNull(p.assumption_note),
      basis: str(p.basis),
      sourceCodes: strArray(p.source_codes),
    })),
  };
}

// ---------------------------------------------------------------- approximate paths (lines)

export type LinesRead =
  | { status: "not_published" }
  /** The published revision has no paths (published before the road outputs). */
  | { status: "none" }
  /** Some member variants have no shape row: never served (503). */
  | { status: "incomplete"; missing: number }
  | { status: "ok"; body: Lines };

type LineCoordinate = [number, number];

function lineFromGeoJson(raw: unknown): LatLng[] {
  const g = JSON.parse(String(raw)) as { type?: string; coordinates?: LineCoordinate[] };
  if (g.type !== "LineString" || !Array.isArray(g.coordinates)) throw new Error("v_published_shapes: geojson is not a LineString");
  return g.coordinates.map(([lng, lat]) => ({ lat, lng }));
}

const numberOr0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The approximate paths of the published revision (D18, J1), built from v_published_shapes, the
 * routes and variants views and the fleet colour key. Untraced variants are listed with their reason.
 */
export async function getLines(db: Db, revisionId: string): Promise<LinesRead> {
  const revision = await getPublishedRevision(db);
  if (!revision || revision.revisionId !== revisionId) return { status: "not_published" };

  const shapes = await rows(db, sql`
    select s.variant_id, s.route_id, s.trace_status, s.flag_reason, s.untraced_reason, s.geojson, s.length_m::float8 as length_m,
           s.off_list_segments, s.trace_quality, s.label, s.road_source_code
      from transit.v_published_shapes s where s.revision_id = ${revisionId}::uuid`);
  if (shapes.length === 0) return { status: "none" };
  const variants = await rows(db, sql`
    select v.variant_id, v.route_id, v.name, v.direction, v.kind, r.public_code, r.name as route_name, r.mode,
           r.service_status, r.planning
      from transit.v_published_variants v
      join transit.v_published_routes r on r.revision_id = v.revision_id and r.id = v.route_id
     where v.revision_id = ${revisionId}::uuid
     order by r.official_group_number nulls last, length(r.public_code), r.public_code, v.kind, v.direction, v.name nulls first, v.variant_id`);
  const shapeOf = new Map(shapes.map((s) => [str(s.variant_id), s]));
  const missing = variants.filter((v) => !shapeOf.has(str(v.variant_id))).length;
  if (missing > 0 || shapes.length !== variants.length) return { status: "incomplete", missing };
  const fleet = await fleetByRoute(db, revisionId);

  const lines: Lines["lines"] = [];
  const untraced: Lines["untraced"] = [];
  for (const v of variants) {
    const s = shapeOf.get(str(v.variant_id))!;
    const q = (s.trace_quality && typeof s.trace_quality === "object" ? s.trace_quality : {}) as Row;
    const base = {
      variantId: str(v.variant_id),
      routeId: str(v.route_id),
      routeCode: str(v.public_code),
      routeName: str(v.route_name),
      variantName: strOrNull(v.name),
      mode: v.mode as RouteMode,
      direction: v.direction as Line["direction"],
      kind: v.kind as Line["kind"],
    };
    if (s.trace_status === "untraced") {
      untraced.push({
        ...base,
        reason: s.untraced_reason as Lines["untraced"][number]["reason"],
        message: UNTRACED_MESSAGE,
        quality: {
          listedStreets: numberOr0(q.listedStreets),
          matchedStreets: numberOr0(q.matchedStreets),
          unmatchedStreets: strArray(q.unmatchedStreets),
          anchorsUnresolved: strArray(q.anchorsUnresolved),
        },
      });
      continue;
    }
    const summary = fleetSummary(fleet.get(str(v.route_id)) ?? [], v.mode as RouteMode);
    const segments = Array.isArray(s.off_list_segments) ? (s.off_list_segments as Row[]) : [];
    lines.push({
      ...base,
      serviceStatus: strOrNull(v.service_status) as Line["serviceStatus"],
      planning: v.planning as Line["planning"],
      fleet: summary,
      colourKey: summary.colourKey,
      status: s.trace_status as Line["status"],
      flagReason: strOrNull(s.flag_reason) as Line["flagReason"],
      encoded: encodePolyline(lineFromGeoJson(s.geojson)),
      lengthM: Number(s.length_m),
      label: PATH_LABEL,
      roadSource: str(s.road_source_code),
      attribution: LINES_ATTRIBUTION,
      segments: segments.map((g) => ({
        fromM: Number(g.fromM),
        toM: Number(g.toM),
        lengthM: Number(g.lengthM),
        reason: g.reason as Line["segments"][number]["reason"],
        streets: Array.isArray(g.streets) ? (g.streets as Row[]).map((x) => ({ name: str(x.name), m: Number(x.m) })) : [],
        against: Array.isArray(g.against) ? strArray(g.against) : null,
      })),
      quality: {
        listedStreets: numberOr0(q.listedStreets),
        matchedStreets: numberOr0(q.matchedStreets),
        unmatchedStreets: strArray(q.unmatchedStreets),
        offListShare: typeof q.offListShare === "number" ? q.offListShare : null,
        gateOffListShare: typeof q.gateOffListShare === "number" ? q.gateOffListShare : null,
        terminalAccessM: numberOr0(q.terminalAccessM),
      },
    });
  }
  return {
    status: "ok",
    body: {
      formatVersion: LINES_FORMAT_VERSION,
      revision,
      label: PATH_LABEL,
      attribution: LINES_ATTRIBUTION,
      attributionUrl: OSM_COPYRIGHT_URL,
      licence: "ODbL 1.0",
      roadSources: [...new Set(shapes.map((s) => str(s.road_source_code)))].sort(),
      lines,
      untraced,
    },
  };
}

// ---------------------------------------------------------------- walk graph

export type WalkGraphMeta =
  | { status: "not_published" }
  | { status: "none" }
  | { status: "ok"; versionId: string; sha256: string; bytes: number };

/** The published walk graph's stored sha256 and size (Task 6 format v1), without the payload. */
export async function getWalkGraphMeta(db: Db, revisionId: string): Promise<WalkGraphMeta> {
  const revision = await getPublishedRevision(db);
  if (!revision || revision.revisionId !== revisionId) return { status: "not_published" };
  const [g] = await rows(db, sql`
    select walk_graph_version_id, sha256, bytes from transit.v_published_walk_graph where revision_id = ${revisionId}::uuid`);
  if (!g) return { status: "none" };
  return { status: "ok", versionId: str(g.walk_graph_version_id), sha256: str(g.sha256), bytes: Number(g.bytes) };
}

/** That walk graph's payload, verbatim; null when it is no longer the published one. */
export async function getWalkGraphPayload(db: Db, revisionId: string, versionId: string): Promise<string | null> {
  const [g] = await rows(db, sql`
    select payload from transit.v_published_walk_graph
     where revision_id = ${revisionId}::uuid and walk_graph_version_id = ${versionId}::uuid`);
  return g ? str(g.payload) : null;
}

// ---------------------------------------------------------------- routes

const EVIDENCE_RANK = { documentary: 0, provisional: 1, verified: 2 } as const;
type Evidence = keyof typeof EVIDENCE_RANK;

const ROUTE_COLUMNS = sql`id, public_code, official_group_number, name, mode_code, legal_status, allocated_units,
  allocation_is_active_fleet_count, notes, source_codes::text[] as source_codes, properties, mode, service_status, planning`;

type VariantRow = {
  routeId: string;
  kind: string;
  evidenceLevel: Evidence;
  navigationApproved: boolean;
  stopCount: number;
};

function summarize(r: Row, variants: VariantRow[], aliases: Row[], extras: RouteExtras): RouteSummary {
  const props = (r.properties && typeof r.properties === "object" ? r.properties : {}) as Row;
  const mine = variants.filter((v) => v.routeId === r.id);
  const strongest = mine.reduce<Evidence | null>(
    (best, v) => (best === null || EVIDENCE_RANK[v.evidenceLevel] > EVIDENCE_RANK[best] ? v.evidenceLevel : best),
    null,
  );
  const verified = mine.length > 0 && mine.every((v) => variantVerification(v.evidenceLevel, v.navigationApproved) === "verified");
  return {
    code: str(r.public_code),
    name: str(r.name),
    groupNumber: numOrNull(r.official_group_number),
    modeCode: strOrNull(r.mode_code),
    legalStatus: strOrNull(r.legal_status),
    allocatedUnits: numOrNull(r.allocated_units),
    allocationIsActiveFleetCount: boolOrNull(r.allocation_is_active_fleet_count),
    groupAllocatedUnits: Number.isInteger(props.group_allocated_units) ? (props.group_allocated_units as number) : null,
    aliases: aliases.filter((a) => a.route_id === r.id).map(toAlias),
    evidenceLevel: strongest,
    verification: verified ? "verified" : "unverified",
    hasProvisionalStops: mine.some((v) => v.evidenceLevel === "provisional" && v.stopCount > 0),
    hasTrial: mine.some((v) => v.kind === "trial"),
    mode: r.mode as RouteMode,
    serviceStatus: strOrNull(r.service_status) as RouteSummary["serviceStatus"],
    planning: r.planning as RouteSummary["planning"],
    fleet: fleetSummary(extras.fleet.get(str(r.id)) ?? [], r.mode as RouteMode),
    operatingStatus: extras.operating.get(str(r.id)) ?? null,
  };
}

function toAlias(a: Row) {
  return { alias: str(a.alias), kind: str(a.kind), isHistorical: Boolean(a.is_historical), sourceCode: strOrNull(a.source_code) };
}

async function variantSummaries(db: Db, revisionId: string): Promise<VariantRow[]> {
  const found = await rows(db, sql`
    select v.route_id, v.kind, v.evidence_level, v.navigation_approved,
           (select count(*) from transit.v_published_route_stops rs
             where rs.revision_id = v.revision_id and rs.variant_version_id = v.variant_version_id)::int as stop_count
      from transit.v_published_variants v where v.revision_id = ${revisionId}::uuid`);
  return found.map((v) => ({
    routeId: str(v.route_id),
    kind: str(v.kind),
    evidenceLevel: v.evidence_level as Evidence,
    navigationApproved: Boolean(v.navigation_approved),
    stopCount: Number(v.stop_count),
  }));
}

const aliasRows = (db: Db, revisionId: string) =>
  rows(db, sql`select route_id, alias, kind, is_historical, source_code from transit.v_published_route_aliases
                where revision_id = ${revisionId}::uuid order by is_historical, kind, alias`);

export async function listRoutes(db: Db, revisionId: string): Promise<RouteList["groups"]> {
  const routes = await rows(db, sql`
    select ${ROUTE_COLUMNS} from transit.v_published_routes where revision_id = ${revisionId}::uuid
     order by official_group_number nulls last, length(public_code), public_code`);
  const variants = await variantSummaries(db, revisionId);
  const aliases = await aliasRows(db, revisionId);
  const extras = await routeExtras(db, revisionId);

  const groups: RouteList["groups"] = [];
  for (const r of routes) {
    const summary = summarize(r, variants, aliases, extras);
    const last = groups.at(-1);
    if (last && last.groupNumber === summary.groupNumber) last.routes.push(summary);
    else groups.push({ groupNumber: summary.groupNumber, routes: [summary] });
  }
  return groups;
}

function legalStreetsOf(v: unknown): LegalStreets {
  const o = (v && typeof v === "object" ? v : {}) as Row;
  return {
    inbound: strArrayOrNull(o.inbound),
    outbound: strArrayOrNull(o.outbound),
    circuit: strArrayOrNull(o.circuit),
    branch: strArrayOrNull(o.branch),
  };
}

export async function getRouteDetail(db: Db, revisionId: string, code: string): Promise<Omit<RouteDetail, "revision"> | null> {
  const [r] = await rows(db, sql`
    select ${ROUTE_COLUMNS} from transit.v_published_routes where revision_id = ${revisionId}::uuid and public_code = ${code}`);
  if (!r) return null;
  const routeId = str(r.id);

  const variantRows = await rows(db, sql`
    select variant_id, variant_version_id, name, direction, kind, evidence_level, navigation_approved, is_circular, headsign,
           vehicle_class, operating_status, trial_status, effective_from::text as effective_from, trial_duration_days,
           legal_streets, notes, source_codes::text[] as source_codes
      from transit.v_published_variants where revision_id = ${revisionId}::uuid and route_id = ${routeId}::uuid
     order by kind, direction, name nulls first, variant_id`);
  const stopRows = await rows(db, sql`
    select rs.variant_version_id, rs.seq, s.stop_point_id, s.name, s.lat, s.lon, s.status, s.navigation_approved,
           s.source_layer, s.source_code_raw, s.label_raw
      from transit.v_published_route_stops rs
      join transit.v_published_stops s on s.revision_id = rs.revision_id and s.stop_point_version_id = rs.stop_point_version_id
      join transit.v_published_variants v on v.revision_id = rs.revision_id and v.variant_version_id = rs.variant_version_id
     where rs.revision_id = ${revisionId}::uuid and v.route_id = ${routeId}::uuid
     order by rs.variant_version_id, rs.seq`);
  const aliases = (await aliasRows(db, revisionId)).filter((a) => a.route_id === routeId);
  const shapeRows = await rows(db, sql`
    select variant_id, trace_status, flag_reason, untraced_reason, trace_quality from transit.v_published_shapes
     where revision_id = ${revisionId}::uuid and route_id = ${routeId}::uuid`);
  const pathStatusOf = (variantId: string): PathStatus => {
    const s = shapeRows.find((x) => str(x.variant_id) === variantId);
    if (!s) return { ...NOT_TRACED };
    const q = (s.trace_quality && typeof s.trace_quality === "object" ? s.trace_quality : {}) as Row;
    const listed = typeof q.listedStreets === "number" ? q.listedStreets : null;
    const status = s.trace_status === "ok" ? "traced" : (s.trace_status as "flagged" | "untraced");
    return {
      status,
      reason: strOrNull(s.trace_status === "flagged" ? s.flag_reason : s.untraced_reason),
      listedStreets: listed !== null && listed > 0 ? listed : null,
      matchedStreets: listed !== null && listed > 0 && typeof q.matchedStreets === "number" ? q.matchedStreets : null,
      unmatchedStreets: strArray(q.unmatchedStreets),
    };
  };

  const variants = variantRows.map((v) => ({
    variantId: str(v.variant_id),
    name: strOrNull(v.name),
    direction: v.direction as RouteDetail["variants"][number]["direction"],
    kind: v.kind as RouteDetail["variants"][number]["kind"],
    evidenceLevel: v.evidence_level as Evidence,
    verification: variantVerification(str(v.evidence_level), Boolean(v.navigation_approved)),
    isCircular: Boolean(v.is_circular),
    headsign: strOrNull(v.headsign),
    vehicleClass: strOrNull(v.vehicle_class),
    operatingStatus: strOrNull(v.operating_status),
    trialStatus: strOrNull(v.trial_status),
    effectiveFrom: strOrNull(v.effective_from),
    trialDurationDays: numOrNull(v.trial_duration_days),
    legalStreets: legalStreetsOf(v.legal_streets),
    notes: strOrNull(v.notes),
    sourceCodes: strArray(v.source_codes),
    stops: stopRows
      .filter((s) => s.variant_version_id === v.variant_version_id)
      .map((s) => ({ ...toStop(s), seq: Number(s.seq) })),
    pathStatus: pathStatusOf(str(v.variant_id)),
  }));
  const permanent = variants.filter((v) => v.kind !== "trial");
  const trials = variants.filter((v) => v.kind === "trial");

  const legalStreets: LegalStreets = { inbound: null, outbound: null, circuit: null, branch: null };
  for (const v of permanent) {
    legalStreets.inbound ??= v.legalStreets.inbound;
    legalStreets.outbound ??= v.legalStreets.outbound;
    legalStreets.circuit ??= v.legalStreets.circuit;
    // Feeder branches: every branch's street text, in variant order.
    if (v.legalStreets.branch) legalStreets.branch = [...(legalStreets.branch ?? []), ...v.legalStreets.branch];
  }

  const props = (r.properties && typeof r.properties === "object" ? r.properties : {}) as Row;
  const extraStructure = props.additional_source_structure;

  // Fare evidence: rules for the route's mode, plus observations and conflicts on those rules.
  const modes = fareModesForRouteMode(strOrNull(r.mode_code));
  const rules = modes.length === 0 ? [] : await rows(db, sql`
    select ${FARE_COLUMNS} from transit.v_published_fare_rules
     where revision_id = ${revisionId}::uuid and mode_code in (${sql.join(modes.map((m) => sql`${m}`), sql`, `)})
     order by code`);
  const ruleIds = rules.map((x) => str(x.fare_rule_id));
  const ruleCode = new Map(rules.map((x) => [str(x.fare_rule_id), str(x.code)]));
  const conflicts = ruleIds.length === 0 ? [] : await rows(db, sql`
    select k.fare_rule_id, o.code as observation_code, k.status, k.note
      from transit.v_published_fare_conflicts k
      left join transit.v_published_fare_observations o on o.revision_id = k.revision_id and o.id = k.fare_observation_id
     where k.revision_id = ${revisionId}::uuid
       and k.fare_rule_id in (${sql.join(ruleIds.map((id) => sql`${id}::uuid`), sql`, `)})
     order by o.code`);
  const observations = modes.length === 0 ? [] : await rows(db, sql`
    select code, mode_code, amount_centavos, category, kind, observed_at::text as observed_at, evidence_status,
           source_codes::text[] as source_codes
      from transit.v_published_fare_observations
     where revision_id = ${revisionId}::uuid
       and (mode_code in (${sql.join(modes.map((m) => sql`${m}`), sql`, `)})
            ${ruleIds.length === 0 ? sql`` : sql`or fare_rule_id in (${sql.join(ruleIds.map((id) => sql`${id}::uuid`), sql`, `)})`})
     order by code, category`);

  const cooperatives = await rows(db, sql`
    select name, basis, reported_on, notes, source_codes::text[] as source_codes
      from transit.v_published_route_cooperatives
     where revision_id = ${revisionId}::uuid and route_id = ${routeId}::uuid
     order by basis, name`);
  const practice = await rows(db, sql`
    select code, vehicle_class, delta_qualifier, delta_centavos_low, delta_centavos_high, observed_on::text as observed_on,
           report_text, source_codes::text[] as source_codes
      from transit.v_published_route_fare_observations
     where revision_id = ${revisionId}::uuid and route_id = ${routeId}::uuid
     order by code`);
  const extras = await routeExtras(db, revisionId);
  const notes = (await notesByRoute(db, revisionId)).get(routeId) ?? [];
  const fleetRecords = extras.fleet.get(routeId) ?? [];
  const operating = extras.operating.get(routeId);

  const codes = [...new Set([...strArray(r.source_codes), ...variants.flatMap((v) => v.sourceCodes),
    ...aliases.map((a) => strOrNull(a.source_code)).filter((c): c is string => c !== null),
    ...fleetRecords.flatMap((f) => [...f.sourceCodes, ...f.airconSourceCodes]),
    ...(operating?.sourceCodes ?? []),
    ...cooperatives.flatMap((c) => strArray(c.source_codes)),
    ...notes.flatMap((n) => n.sourceCodes),
    ...practice.flatMap((o) => strArray(o.source_codes))])];
  const sources = codes.length === 0 ? [] : await rows(db, sql`
    select code, title, url, evidence_type, published_or_enacted, checked_on::text as checked_on
      from transit.v_published_sources
     where revision_id = ${revisionId}::uuid and code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
     order by code`);

  const variantSummary = variantRows.map((v) => ({
    routeId,
    kind: str(v.kind),
    evidenceLevel: v.evidence_level as Evidence,
    navigationApproved: Boolean(v.navigation_approved),
    stopCount: stopRows.filter((s) => s.variant_version_id === v.variant_version_id).length,
  }));
  const { aliases: _omit, ...summary } = summarize(r, variantSummary, aliases, extras);
  void _omit;

  return {
    route: {
      ...summary,
      notes: strOrNull(r.notes) || null,
      sourceCodes: strArray(r.source_codes),
      legalStreets,
      additionalSourceStructures: Array.isArray(extraStructure) ? [extraStructure.map(String)] : [],
      normalizationNote: typeof props.normalization_note === "string" ? props.normalization_note : null,
    },
    variants: permanent,
    trials,
    notes,
    aliases: aliases.map(toAlias),
    cooperatives: cooperatives.map((c) => ({
      name: str(c.name),
      basis: c.basis as CooperativeBasis,
      label: cooperativeLabel(c.basis as CooperativeBasis, strOrNull(c.reported_on)),
      reportedOn: strOrNull(c.reported_on),
      notes: strOrNull(c.notes),
      sourceCodes: strArray(c.source_codes),
    })),
    fareEvidence: {
      basis: "route_mode",
      rules: rules.map(toFareRule),
      observations: observations.map((o) => ({
        code: strOrNull(o.code),
        modeCode: str(o.mode_code),
        amountCentavos: Number(o.amount_centavos),
        category: str(o.category),
        kind: str(o.kind),
        observedAt: strOrNull(o.observed_at),
        evidenceStatus: strOrNull(o.evidence_status),
        sourceCodes: strArray(o.source_codes),
      })),
      conflicts: conflicts.map((k) => ({
        ruleCode: ruleCode.get(str(k.fare_rule_id)) ?? str(k.fare_rule_id),
        observationCode: strOrNull(k.observation_code),
        status: str(k.status),
        note: strOrNull(k.note),
      })),
      reportedPractice: practice.map((o) => ({
        code: str(o.code),
        vehicleClass: o.vehicle_class as RouteDetail["fareEvidence"]["reportedPractice"][number]["vehicleClass"],
        deltaQualifier: o.delta_qualifier as "range" | "at_least",
        deltaCentavosLow: Number(o.delta_centavos_low),
        deltaCentavosHigh: numOrNull(o.delta_centavos_high),
        observedOn: str(o.observed_on),
        reportText: str(o.report_text),
        sourceCodes: strArray(o.source_codes),
      })),
    },
    sources: sources.map((s) => ({
      code: str(s.code),
      title: str(s.title),
      url: strOrNull(s.url),
      evidenceType: strOrNull(s.evidence_type),
      publishedOrEnacted: strOrNull(s.published_or_enacted),
      checkedOn: strOrNull(s.checked_on),
    })),
  };
}
