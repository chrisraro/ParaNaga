import "server-only";
import { sql } from "drizzle-orm";
import { OSM_ELEMENT_TYPES, OSM_PLACE_CATEGORIES } from "@/domain/places/osm-categories";
import type { OsmPlace } from "@/domain/api/schemas";
import type { Db } from "@/server/db/context";

// OpenStreetMap places of a published revision, read ONLY through transit.v_published_places
// (security_invoker, pointer → revision_member → place_version, synthetic rows hidden). No
// separate endpoint: the search index (Task 4) includes them. ODbL, © OpenStreetMap contributors.

type Row = Record<string, unknown>;

const TYPES = new Set<string>(OSM_ELEMENT_TYPES);
const CATEGORIES = new Set<string>(OSM_PLACE_CATEGORIES);

function toPlace(r: Row): OsmPlace {
  const osmType = String(r.osm_type);
  const category = String(r.category);
  if (!TYPES.has(osmType) || !CATEGORIES.has(category)) {
    throw new Error(`v_published_places: unexpected osm_type/category ${osmType}/${category}`);
  }
  const osmId = Number(r.osm_id);
  return {
    key: `osm:${osmType}/${osmId}`,
    name: String(r.name),
    aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [],
    category: category as OsmPlace["category"],
    lat: Number(r.lat),
    lng: Number(r.lon),
    osmType: osmType as OsmPlace["osmType"],
    osmId,
    osmVersion: Number(r.osm_version),
    sourceCode: String(r.source_code),
  };
}

/** Every published OSM place of `revisionId`, ordered by name then key (duplicate names stay separate). */
export async function listPlaces(db: Db, revisionId: string): Promise<OsmPlace[]> {
  const result = await db.execute(sql`
    select osm_type, osm_id::text as osm_id, name, aliases, category, lat, lon, osm_version, source_code
      from transit.v_published_places
     where revision_id = ${revisionId}::uuid
     order by name, osm_type, osm_id`);
  return (result.rows as Row[]).map(toPlace);
}
