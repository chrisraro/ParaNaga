// Pure parser of a committed OpenStreetMap places snapshot (data/source/osm/naga-places-*.osm.json,
// written by scripts/fetch-osm-places.ts). Reads only what ParaNaga keeps from OSM: the name and
// four alias tags, the tags that decide the category, the coordinate and the element's
// type/id/version/timestamp. Every other tag (opening_hours, phone, website, image, entrances,
// addresses, …) is never read and never output.
//
// Contributor data: the fetch script removes `user`, `uid` and `changeset` (and the unused `nodes`,
// `members`, `bounds`, `geometry`) from every element before writing the file, and records that in
// the required `header.removedFields`. A file whose elements still carry user/uid/changeset is a
// problem here, so an unstripped snapshot can never import (stripOverpassResponse below).
//
// ODbL 1.0, © OpenStreetMap contributors (see data/source/osm/README.md).
import { z } from "zod";
import { pointInRing } from "../geo/geometry";
import type { LngLat } from "../geo/types";
import { OSM_ELEMENT_TYPES, OSM_PLACE_CATEGORIES, type OsmElementType, type OsmPlaceCategory } from "../places/osm-categories";
import { sha256Hex } from "./hash";
import { zodMessage } from "./zod-message";

export const OSM_BOUNDARY_RELATION = 3084673;
export const OSM_LICENCE = "ODbL-1.0";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/** Alias tags kept verbatim, in this order (after `name`). */
export const OSM_ALIAS_TAGS = ["name:en", "name:fil", "alt_name", "old_name"] as const;

type Rule = { category: OsmPlaceCategory; key: string; values: readonly string[]; also?: Record<string, string> };

/**
 * Fixed precedence: the first category with a matching rule wins (one category per place).
 * Values separated by ";" (OSM multi-values) match each part. The stored `tags` are the matching
 * rules' tags of the winning category, verbatim.
 */
export const CATEGORY_RULES: readonly Rule[] = [
  { category: "bus_terminal", key: "amenity", values: ["bus_station"] },
  { category: "bus_terminal", key: "public_transport", values: ["station"], also: { bus: "yes" } },
  { category: "hospital_clinic", key: "amenity", values: ["hospital", "clinic"] },
  { category: "college_university", key: "amenity", values: ["college", "university"] },
  { category: "school", key: "amenity", values: ["school"] },
  { category: "place_of_worship", key: "amenity", values: ["place_of_worship"] },
  { category: "government", key: "amenity", values: ["townhall", "police", "fire_station", "post_office"] },
  { category: "government", key: "office", values: ["government"] },
  { category: "market", key: "amenity", values: ["marketplace"] },
  { category: "mall", key: "shop", values: ["mall"] },
  { category: "park", key: "leisure", values: ["park"] },
  { category: "square", key: "place", values: ["square"] },
];

/** OSM contributor metadata: never stored in a committed snapshot, never imported. */
export const CONTRIBUTOR_FIELDS = ["user", "uid", "changeset"] as const;
/** Every element field the fetch script removes (when present). */
export const REMOVED_ELEMENT_FIELDS = ["bounds", "changeset", "geometry", "members", "nodes", "uid", "user"] as const;
/** Element fields a snapshot keeps, in this order. */
const KEPT_ELEMENT_FIELDS = ["type", "id", "lat", "lon", "center", "version", "timestamp", "tags"] as const;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// z.object strips unknown keys; contributor fields are refused separately (CONTRIBUTOR_FIELDS).
const elementSchema = z.object({
  type: z.enum(OSM_ELEMENT_TYPES),
  id: z.number().int().positive(),
  lat: latitude.optional(),
  lon: longitude.optional(),
  center: z.object({ lat: latitude, lon: longitude }).optional(),
  version: z.number().int().min(1),
  timestamp: z.iso.datetime({ offset: true }),
  tags: z.record(z.string(), z.string()).optional(),
});

export const osmSnapshotHeaderSchema = z.object({
  query: z.string().min(1),
  endpoint: z.string().min(1),
  fetchedAt: z.iso.datetime({ offset: true }),
  osmBaseTimestamp: z.string().nullable(),
  boundaryRelation: z.literal(OSM_BOUNDARY_RELATION),
  licence: z.literal(OSM_LICENCE),
  attribution: z.literal(OSM_ATTRIBUTION),
  /** Hand-made test data (tests/fixtures/osm). Never published: publish_revision refuses it. */
  synthetic: z.boolean().optional(),
  /**
   * sha256 of the Overpass response body exactly as received, BEFORE the contributor fields were
   * removed (so it does not match the stored `response`; it records what was fetched).
   */
  responseSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Element fields removed by the fetch script; required (with user, uid, changeset) unless synthetic. */
  removedFields: z.array(z.string()).optional(),
}).superRefine((h, ctx) => {
  if (h.synthetic === true) return;
  const removed = new Set(h.removedFields ?? []);
  if (!CONTRIBUTOR_FIELDS.every((f) => removed.has(f))) {
    ctx.addIssue({
      code: "custom",
      path: ["removedFields"],
      message: `must list ${CONTRIBUTOR_FIELDS.join(", ")} (contributor data is removed before a snapshot is written)`,
    });
  }
});
export type OsmSnapshotHeader = z.infer<typeof osmSnapshotHeaderSchema>;

const snapshotSchema = z.object({
  header: osmSnapshotHeaderSchema,
  response: z.object({ elements: z.array(elementSchema) }),
});

export type OsmPlace = {
  /** "osm:{type}/{id}" — the stable identity. */
  key: string;
  /** sha256 of `key` (ingest.raw_feature.source_identity). */
  sourceIdentity: string;
  osmType: OsmElementType;
  osmId: number;
  name: string;
  aliases: string[];
  category: OsmPlaceCategory;
  lat: number;
  lng: number;
  osmVersion: number;
  osmTimestamp: string;
  /** Only the tags that decided the category, verbatim. */
  tags: Record<string, string>;
  /** sha256 over name, aliases, category, coordinate and OSM version. */
  contentHash: string;
};

export type OsmDropReason = "unnamed" | "outside_boundary" | "other_tags" | "no_coordinate";

export type OsmPlacesResult = {
  header: OsmSnapshotHeader;
  synthetic: boolean;
  /** UTC date of fetchedAt (YYYY-MM-DD). */
  fetchDate: string;
  places: OsmPlace[];
  dropped: Record<OsmDropReason, number>;
  counts: Record<OsmPlaceCategory, number>;
  problems: string[];
};

const TYPE_ORDER: Record<OsmElementType, number> = { node: 0, way: 1, relation: 2 };

const emptyCounts = () =>
  Object.fromEntries(OSM_PLACE_CATEGORIES.map((c) => [c, 0])) as Record<OsmPlaceCategory, number>;

function matches(tags: Record<string, string>, rule: Rule): boolean {
  const value = tags[rule.key];
  if (value === undefined) return false;
  const parts = value.split(";").map((p) => p.trim());
  if (!rule.values.some((v) => parts.includes(v))) return false;
  return Object.entries(rule.also ?? {}).every(([k, v]) => tags[k] === v);
}

export function categorize(tags: Record<string, string>): { category: OsmPlaceCategory; tags: Record<string, string> } | null {
  const first = CATEGORY_RULES.find((r) => matches(tags, r));
  if (!first) return null;
  const used: Record<string, string> = {};
  for (const rule of CATEGORY_RULES) {
    if (rule.category !== first.category || !matches(tags, rule)) continue;
    for (const k of [rule.key, ...Object.keys(rule.also ?? {})]) used[k] = tags[k]!;
  }
  return { category: first.category, tags: used };
}

function aliasesOf(tags: Record<string, string>, name: string): string[] {
  const out: string[] = [];
  for (const k of OSM_ALIAS_TAGS) {
    const v = tags[k];
    if (v === undefined || v.trim() === "" || v === name || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

export function osmPlaceKey(type: OsmElementType, id: number): string {
  return `osm:${type}/${id}`;
}

/**
 * Parses a snapshot file (already JSON-decoded) and keeps the named, categorised features whose
 * coordinate lies inside `boundary` (outer ring, GeoJSON [lng, lat] order). Never throws on bad
 * input: a malformed file is reported in `problems` with no places.
 */
export function parseOsmPlaces(snapshot: unknown, boundary: readonly LngLat[]): OsmPlacesResult {
  const dropped: Record<OsmDropReason, number> = { unnamed: 0, outside_boundary: 0, other_tags: 0, no_coordinate: 0 };
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return {
      header: (snapshot as { header?: OsmSnapshotHeader } | null)?.header ?? ({} as OsmSnapshotHeader),
      synthetic: false,
      fetchDate: "",
      places: [],
      dropped,
      counts: emptyCounts(),
      problems: [zodMessage("OSM snapshot", parsed.error)],
    };
  }
  const { header, response } = parsed.data;
  const problems: string[] = [];
  const rawElements = (snapshot as { response: { elements: Record<string, unknown>[] } }).response.elements;
  const withContributorData = rawElements.filter((e) => CONTRIBUTOR_FIELDS.some((f) => f in e)).length;
  if (withContributorData > 0) {
    problems.push(
      `OSM snapshot: ${withContributorData} element(s) carry contributor data (${CONTRIBUTOR_FIELDS.join(", ")}); ` +
        "write snapshots only with scripts/fetch-osm-places.ts, which removes it",
    );
  }
  const seen = new Set<string>();
  const places: OsmPlace[] = [];

  for (const el of response.elements) {
    const key = osmPlaceKey(el.type, el.id);
    if (seen.has(key)) {
      problems.push(`OSM snapshot: element ${key} appears more than once`);
      continue;
    }
    seen.add(key);
    const tags = el.tags ?? {};
    const category = categorize(tags);
    if (!category) {
      dropped.other_tags++;
      continue;
    }
    const name = tags.name;
    if (name === undefined || name.trim() === "") {
      dropped.unnamed++;
      continue;
    }
    const coord = el.type === "node" ? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null) : el.center ?? null;
    if (!coord) {
      dropped.no_coordinate++;
      continue;
    }
    if (!pointInRing({ lat: coord.lat, lng: coord.lon }, boundary)) {
      dropped.outside_boundary++;
      continue;
    }
    const aliases = aliasesOf(tags, name);
    places.push({
      key,
      sourceIdentity: sha256Hex(key),
      osmType: el.type,
      osmId: el.id,
      name,
      aliases,
      category: category.category,
      lat: coord.lat,
      lng: coord.lon,
      osmVersion: el.version,
      osmTimestamp: el.timestamp,
      tags: category.tags,
      contentHash: sha256Hex(JSON.stringify(["osm_place", name, aliases, category.category, coord.lat, coord.lon, el.version])),
    });
  }

  places.sort((a, b) => TYPE_ORDER[a.osmType] - TYPE_ORDER[b.osmType] || a.osmId - b.osmId);
  const counts = emptyCounts();
  for (const p of places) counts[p.category]++;

  return {
    header,
    synthetic: header.synthetic === true,
    fetchDate: new Date(header.fetchedAt).toISOString().slice(0, 10),
    places,
    dropped,
    counts,
    problems,
  };
}

/**
 * Removes contributor data and unused geometry from a decoded Overpass response: each element keeps
 * only type, id, lat, lon, center, version, timestamp and tags (in that order); the response keeps
 * version, generator, osm3s and elements. Deterministic (same input → same JSON.stringify output).
 * Pure; used by scripts/fetch-osm-places.ts before anything is written.
 */
export function stripOverpassResponse(body: {
  version?: unknown;
  generator?: unknown;
  osm3s?: unknown;
  elements: readonly Record<string, unknown>[];
}): { response: Record<string, unknown>; removedFields: string[] } {
  const elements = body.elements.map((e) => {
    const kept: Record<string, unknown> = {};
    for (const k of KEPT_ELEMENT_FIELDS) if (e[k] !== undefined) kept[k] = e[k];
    return kept;
  });
  const response: Record<string, unknown> = {};
  if (body.version !== undefined) response.version = body.version;
  if (body.generator !== undefined) response.generator = body.generator;
  if (body.osm3s !== undefined) response.osm3s = body.osm3s;
  response.elements = elements;
  return { response, removedFields: [...REMOVED_ELEMENT_FIELDS] };
}
