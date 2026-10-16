// Pure parser of a committed OpenStreetMap road snapshot (data/source/osm/naga-roads-*.osm.json,
// written by scripts/fetch-osm-roads.ts). The road network is the basis of the approximate ride
// paths (J1) and the on-device walk graph (J2); place nodes resolve the feeder `place_name`
// anchors; `header.regionalRelations` carries the regional route lengths (D5).
//
// What a snapshot keeps:
//   ways   — type, id, version, timestamp, nodes and the tags in ROAD_TAGS;
//   nodes  — type, id, lat, lon; place nodes also `tags: {name, place}`;
//   header — the queries, endpoint, fetch time, OSM base, licence, attribution, both response
//            sha256s (as received, before stripping), removedFields and the regional relation
//            summaries (no geometry).
// Contributor data (user, uid, changeset) is removed by the fetch script before anything is
// written; a file that still carries it is a problem here and cannot import. Every other tag is
// dropped ("otherTags") and is never read: the Zod schemas below strip unknown tags.
//
// ODbL 1.0, © OpenStreetMap contributors (see data/source/osm/README.md).
import { z } from "zod";
import { haversineMeters } from "../geo/geometry";
import { normalizeStreetName, wayStreetNames } from "../geo/street-names";
import type { LatLng } from "../geo/types";
import { CONTRIBUTOR_FIELDS, OSM_ATTRIBUTION, OSM_BOUNDARY_RELATION, OSM_LICENCE } from "./osm-places";
import { zodMessage } from "./zod-message";

/** Way tags a road snapshot keeps (everything the path tracer and the walk graph read). */
export const ROAD_TAGS = [
  "highway", "name", "alt_name", "old_name", "official_name", "ref", "oneway", "junction", "access", "foot", "area",
  // Jeepney access (vehicle profile): psv/bus=yes lifts access=no; motor_vehicle/vehicle=no blocks;
  // service=parking_aisle|drive-through is not a through road; oneway:psv overrides oneway.
  "motor_vehicle", "vehicle", "psv", "bus", "oneway:psv", "service",
] as const;
/** Place-node tags a road snapshot keeps. */
export const PLACE_TAGS = ["name", "place"] as const;
/** Place classes queried as feeder anchors. */
export const ANCHOR_PLACE_CLASSES = ["village", "hamlet", "neighbourhood", "locality", "quarter"] as const;
/** Relation member roles that are part of a regional route's length. */
export const REGIONAL_RELATION_ROLES = ["", "forward", "backward"] as const;
/** Fields the fetch script removes (when present), recorded in header.removedFields. */
export const ROAD_REMOVED_FIELDS = ["changeset", "otherTags", "uid", "user"] as const;
/** The buffer around the city boundary, in metres. */
export const ROAD_BUFFER_M = 300;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const osmId = z.number().int().positive();
const isoDateTime = z.iso.datetime({ offset: true });

const roadTagsSchema = z.object(Object.fromEntries(ROAD_TAGS.map((k) => [k, z.string().optional()])) as Record<(typeof ROAD_TAGS)[number], z.ZodOptional<z.ZodString>>);
export type RoadTags = z.infer<typeof roadTagsSchema>;

const wayElementSchema = z.object({
  type: z.literal("way"),
  id: osmId,
  version: z.number().int().min(1),
  timestamp: isoDateTime,
  nodes: z.array(osmId).min(2),
  tags: roadTagsSchema.extend({ highway: z.string().min(1) }),
});

const nodeElementSchema = z.object({
  type: z.literal("node"),
  id: osmId,
  lat: latitude,
  lon: longitude,
  tags: z.object({ name: z.string().optional(), place: z.string().optional() }).optional(),
});

const elementSchema = z.discriminatedUnion("type", [wayElementSchema, nodeElementSchema]);

export const regionalRelationSummarySchema = z.object({
  relationId: osmId,
  version: z.number().int().min(1),
  timestamp: isoDateTime,
  name: z.string().nullable(),
  ref: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  lengthKm: z.number().min(0),
});
export type RegionalRelationSummary = z.infer<typeof regionalRelationSummarySchema>;

export const osmRoadsHeaderSchema = z
  .object({
    query: z.string().min(1),
    regionalQuery: z.string().min(1),
    endpoint: z.string().min(1),
    fetchedAt: isoDateTime,
    osmBaseTimestamp: z.string().nullable(),
    boundaryRelation: z.literal(OSM_BOUNDARY_RELATION),
    bufferM: z.number().int().positive(),
    licence: z.literal(OSM_LICENCE),
    attribution: z.literal(OSM_ATTRIBUTION),
    /** Hand-made test data (tests/fixtures/osm). Never imported or published. */
    synthetic: z.boolean().optional(),
    note: z.string().optional(),
    /** sha256 of the roads response body as received, BEFORE stripping. */
    responseSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    /** sha256 of the regional relations response body as received (its geometry is discarded). */
    regionalResponseSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    removedFields: z.array(z.string()).optional(),
    regionalRelations: z.array(regionalRelationSummarySchema),
  })
  .superRefine((h, ctx) => {
    if (h.synthetic === true) return;
    const removed = new Set(h.removedFields ?? []);
    if (!CONTRIBUTOR_FIELDS.every((f) => removed.has(f))) {
      ctx.addIssue({ code: "custom", path: ["removedFields"], message: `must list ${CONTRIBUTOR_FIELDS.join(", ")}` });
    }
    if (h.responseSha256 === undefined || h.regionalResponseSha256 === undefined) {
      ctx.addIssue({ code: "custom", path: ["responseSha256"], message: "a real snapshot records both response sha256s" });
    }
  });
export type OsmRoadsHeader = z.infer<typeof osmRoadsHeaderSchema>;

const snapshotSchema = z.object({
  header: osmRoadsHeaderSchema,
  response: z.object({ elements: z.array(z.unknown()) }),
});

export type RoadWay = { id: number; version: number; timestamp: string; nodeIds: number[]; tags: RoadTags & { highway: string } };
export type PlaceNode = { id: number; name: string; place: string; lat: number; lng: number };

export type OsmRoads = {
  header: OsmRoadsHeader;
  synthetic: boolean;
  /** UTC date of fetchedAt (YYYY-MM-DD). */
  fetchDate: string;
  /** Node coordinates by OSM node id (every node a kept way uses). */
  nodes: ReadonlyMap<number, LatLng>;
  /** Ways sorted by id; a way with a node missing from the file is left out (and reported). */
  ways: RoadWay[];
  /** Named place nodes of the anchor classes, sorted by id. */
  places: PlaceNode[];
  regionalRelations: RegionalRelationSummary[];
  problems: string[];
};

function emptyResult(header: OsmRoadsHeader, problems: string[]): OsmRoads {
  return { header, synthetic: false, fetchDate: "", nodes: new Map(), ways: [], places: [], regionalRelations: [], problems };
}

/** Parses a snapshot (already JSON-decoded). Never throws: problems are reported in `problems`. */
export function parseOsmRoads(snapshot: unknown): OsmRoads {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) return emptyResult({} as OsmRoadsHeader, [zodMessage("OSM road snapshot", parsed.error)]);
  const { header, response } = parsed.data;
  const problems: string[] = [];

  const withContributorData = response.elements.filter(
    (e) => e !== null && typeof e === "object" && CONTRIBUTOR_FIELDS.some((f) => f in (e as object)),
  ).length;
  if (withContributorData > 0) {
    problems.push(
      `OSM road snapshot: ${withContributorData} element(s) carry contributor data (${CONTRIBUTOR_FIELDS.join(", ")}); ` +
        "write snapshots only with scripts/fetch-osm-roads.ts, which removes it",
    );
  }

  const nodes = new Map<number, LatLng>();
  const placeById = new Map<number, PlaceNode>();
  const wayById = new Map<number, RoadWay>();
  response.elements.forEach((raw, i) => {
    const el = elementSchema.safeParse(raw);
    if (!el.success) {
      problems.push(zodMessage(`OSM road snapshot element ${i}`, el.error));
      return;
    }
    const e = el.data;
    if (e.type === "node") {
      // A place node can also be a way node (listed twice by `out meta; >; out skel`): same position.
      nodes.set(e.id, { lat: e.lat, lng: e.lon });
      const name = e.tags?.name?.trim();
      const place = e.tags?.place;
      if (name && place && (ANCHOR_PLACE_CLASSES as readonly string[]).includes(place)) {
        placeById.set(e.id, { id: e.id, name: e.tags!.name!, place, lat: e.lat, lng: e.lon });
      }
      return;
    }
    if (wayById.has(e.id)) {
      problems.push(`OSM road snapshot: way/${e.id} appears more than once`);
      return;
    }
    wayById.set(e.id, { id: e.id, version: e.version, timestamp: e.timestamp, nodeIds: e.nodes, tags: e.tags });
  });

  const ways: RoadWay[] = [];
  for (const way of [...wayById.values()].sort((a, b) => a.id - b.id)) {
    const missing = way.nodeIds.find((n) => !nodes.has(n));
    if (missing !== undefined) {
      problems.push(`OSM road snapshot: way/${way.id} uses node ${missing}, which has no coordinate in the file`);
      continue;
    }
    ways.push(way);
  }

  return {
    header,
    synthetic: header.synthetic === true,
    fetchDate: new Date(header.fetchedAt).toISOString().slice(0, 10),
    nodes,
    ways,
    places: [...placeById.values()].sort((a, b) => a.id - b.id),
    regionalRelations: header.regionalRelations,
    problems,
  };
}

/**
 * Removes contributor data and unused tags from a decoded Overpass roads response: ways keep
 * type, id, version, timestamp, nodes and ROAD_TAGS; nodes keep type, id, lat, lon and (place
 * nodes) the PLACE_TAGS; the response keeps version, generator, osm3s and elements. Tags keep
 * their received order. Deterministic. Used by scripts/fetch-osm-roads.ts before anything is written.
 */
export function stripRoadsResponse(body: {
  version?: unknown;
  generator?: unknown;
  osm3s?: unknown;
  elements: readonly Record<string, unknown>[];
}): { response: Record<string, unknown>; removedFields: string[] } {
  const pickTags = (tags: unknown, keep: readonly string[]) =>
    Object.fromEntries(Object.entries((tags ?? {}) as Record<string, unknown>).filter(([k]) => keep.includes(k)));
  const elements = body.elements.map((e) => {
    const fields = e.type === "way" ? (["type", "id", "version", "timestamp", "nodes"] as const) : (["type", "id", "lat", "lon"] as const);
    const kept: Record<string, unknown> = {};
    for (const k of fields) if (e[k] !== undefined) kept[k] = e[k];
    const tags = pickTags(e.tags, e.type === "way" ? ROAD_TAGS : PLACE_TAGS);
    if (Object.keys(tags).length > 0) kept.tags = tags;
    return kept;
  });
  const response: Record<string, unknown> = {};
  if (body.version !== undefined) response.version = body.version;
  if (body.generator !== undefined) response.generator = body.generator;
  if (body.osm3s !== undefined) response.osm3s = body.osm3s;
  response.elements = elements;
  return { response, removedFields: [...ROAD_REMOVED_FIELDS] };
}

type RelationMember = { type?: unknown; ref?: unknown; role?: unknown; geometry?: unknown };
type RelationInput = { type?: unknown; id?: unknown; version?: unknown; timestamp?: unknown; tags?: unknown; members?: unknown };

/**
 * Length of a route relation from `out geom`: the sum of its member ways with role "", "forward"
 * or "backward", each way id counted once (a gap in a way's geometry skips that gap only). In km.
 */
export function relationLengthKm(relation: RelationInput): number {
  const seen = new Set<number>();
  let metres = 0;
  for (const m of (Array.isArray(relation.members) ? relation.members : []) as RelationMember[]) {
    if (m.type !== "way" || typeof m.ref !== "number") continue;
    if (!(REGIONAL_RELATION_ROLES as readonly unknown[]).includes(m.role ?? "")) continue;
    if (seen.has(m.ref)) continue;
    seen.add(m.ref);
    const geometry = (Array.isArray(m.geometry) ? m.geometry : []) as ({ lat?: unknown; lon?: unknown } | null)[];
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1];
      const b = geometry[i];
      if (!a || !b || typeof a.lat !== "number" || typeof a.lon !== "number" || typeof b.lat !== "number" || typeof b.lon !== "number") continue;
      metres += haversineMeters({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon });
    }
  }
  return metres / 1000;
}

/** The only thing kept of a regional relation (D5): no geometry, no contributor data. lengthKm to 1 m. */
export function regionalRelationSummary(relation: RelationInput): RegionalRelationSummary {
  const tags = (relation.tags ?? {}) as Record<string, unknown>;
  const tag = (k: string) => (typeof tags[k] === "string" && (tags[k] as string).trim() !== "" ? (tags[k] as string) : null);
  return regionalRelationSummarySchema.parse({
    relationId: relation.id,
    version: relation.version,
    timestamp: relation.timestamp,
    name: tag("name"),
    ref: tag("ref"),
    from: tag("from"),
    to: tag("to"),
    lengthKm: Number(relationLengthKm(relation).toFixed(3)),
  });
}

export type PlaceResolution =
  | { status: "resolved"; place: PlaceNode }
  | { status: "unresolved"; reason: "ambiguous" | "not_found"; candidates: number[] };

/**
 * Resolves a feeder `place_name` anchor (Langon, Vistansa, …) against the snapshot's place nodes
 * by normalized name. More than one match is ambiguous and stays unresolved (never guessed).
 */
export function resolvePlaceName(places: readonly PlaceNode[], name: string): PlaceResolution {
  const wanted = normalizeStreetName(name);
  const matches = wanted === "" ? [] : places.filter((p) => normalizeStreetName(p.name) === wanted);
  if (matches.length === 1) return { status: "resolved", place: matches[0]! };
  return { status: "unresolved", reason: matches.length === 0 ? "not_found" : "ambiguous", candidates: matches.map((p) => p.id).sort((a, b) => a - b) };
}

/**
 * Checks reviewed street aliases against a road snapshot: every listed way exists and carries the
 * alias's OSM name (name, alt_name, old_name or official_name). Returns the problems (empty = ok).
 */
export function verifyStreetAliases(
  aliases: readonly { legal_name: string; osm_name: string; osm_way_ids: readonly number[] }[],
  roads: Pick<OsmRoads, "ways">,
): string[] {
  const byId = new Map(roads.ways.map((w) => [w.id, w]));
  const problems: string[] = [];
  for (const a of aliases) {
    const wanted = normalizeStreetName(a.osm_name);
    for (const id of a.osm_way_ids) {
      const way = byId.get(id);
      if (!way) problems.push(`alias "${a.legal_name}" → "${a.osm_name}": way/${id} is not in the snapshot`);
      else if (!wayStreetNames(way.tags).includes(wanted)) problems.push(`alias "${a.legal_name}" → "${a.osm_name}": way/${id} does not carry that name`);
    }
  }
  return problems;
}
