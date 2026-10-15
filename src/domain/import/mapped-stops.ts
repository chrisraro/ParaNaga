import { parseCsvObjects } from "./csv";
import { sha256Hex } from "./hash";
import { parseKml } from "./kml";

export type LayerLetter = "A" | "B" | "C" | "D";

/** Layer counts the My Maps snapshot of 2026-10-15 must have. */
export const EXPECTED_LAYER_COUNTS: Readonly<Record<LayerLetter, number>> = { A: 30, B: 31, C: 34, D: 33 };
export const EXPECTED_RECORD_COUNT = 128;
export const COORDINATE_TOLERANCE_DEG = 1e-7;

export type MappedStopRecord = {
  /** Package id such as MYM-A-001 (GeoJSON/CSV only). Cross-reference, never identity. */
  packageId: string | null;
  /** Layer name verbatim, e.g. "Loop Service A". */
  sourceLayer: string;
  layer: LayerLetter;
  /** Source stop code verbatim (placemark name). Not unique across layers; may carry another layer's prefix. */
  code: string;
  /** Label verbatim (placemark description). May be an empty string. */
  label: string;
  /** Verbatim KML description text; null for formats that do not carry it. */
  descriptionRaw: string | null;
  /** Verbatim coordinate text "lng,lat[,alt]"; null when the format lost the source text (GeoJSON). */
  coordinatesRaw: string | null;
  lat: number;
  lng: number;
  routeId: string | null;
  direction: string | null;
  exportPosition: number | null;
  operatingStatus: string | null;
  /** Remaining source properties verbatim (GeoJSON feature properties). */
  properties: Record<string, unknown>;
};

export type MapMetadata = {
  mapId: string;
  title: string;
  viewerUrl: string | null;
  sharedShortUrl: string | null;
  publicOwnerDisplayName: string | null;
  ownerIdentityOrOfficialRoleVerified: boolean | null;
  recordCount: number;
  exactUniqueCoordinateCount: number | null;
  layerCounts: Record<string, number>;
  retrievedOn: string | null;
  notes: string | null;
  /** The whole metadata object as found, for storage in a dataset note. */
  raw: Record<string, unknown>;
};

export function layerFromName(sourceLayer: string): LayerLetter {
  const m = /^Loop Service ([ABCD])$/.exec(sourceLayer.trim());
  if (!m) throw new Error(`Unknown source layer "${sourceLayer}"`);
  return m[1] as LayerLetter;
}

/** NFC, trim, collapse whitespace runs, lower-case. */
export function normalizeLabel(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------- parsers

export function parseKmlStops(xml: string): MappedStopRecord[] {
  const { placemarks, skipped } = parseKml(xml);
  if (skipped.length > 0) {
    throw new Error(`KML has ${skipped.length} non-point placemark(s): ${skipped.map((s) => `${s.layer}/${s.name}`).join(", ")}`);
  }
  return placemarks.map((p) => ({
    packageId: null,
    sourceLayer: p.layer,
    layer: layerFromName(p.layer),
    code: p.name,
    label: p.description,
    descriptionRaw: p.description,
    coordinatesRaw: p.coordinatesRaw,
    lat: p.lat,
    lng: p.lng,
    routeId: null,
    direction: null,
    exportPosition: null,
    operatingStatus: null,
    properties: {},
  }));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseGeojsonStops(text: string): { metadata: MapMetadata; records: MappedStopRecord[] } {
  const root: unknown = JSON.parse(text);
  if (!isObj(root) || !Array.isArray(root.features) || !isObj(root.metadata)) {
    throw new Error("GeoJSON: expected a FeatureCollection with metadata and features");
  }
  const m = root.metadata;
  const mapId = str(m.map_id);
  if (!mapId) throw new Error("GeoJSON: metadata.map_id is missing");
  const metadata: MapMetadata = {
    mapId,
    title: str(m.title) ?? str(root.name) ?? "",
    viewerUrl: str(m.viewer_url),
    sharedShortUrl: str(m.shared_short_url),
    publicOwnerDisplayName: str(m.public_owner_display_name),
    ownerIdentityOrOfficialRoleVerified:
      typeof m.owner_identity_or_official_role_verified === "boolean" ? m.owner_identity_or_official_role_verified : null,
    recordCount: num(m.record_count) ?? -1,
    exactUniqueCoordinateCount: num(m.exact_unique_coordinate_count),
    layerCounts: isObj(m.layer_counts) ? (Object.fromEntries(Object.entries(m.layer_counts).filter(([, v]) => typeof v === "number")) as Record<string, number>) : {},
    retrievedOn: str(m.retrieved_on),
    notes: str(m.notes),
    raw: m,
  };

  const records = root.features.map((f: unknown, i: number): MappedStopRecord => {
    if (!isObj(f) || !isObj(f.properties) || !isObj(f.geometry)) throw new Error(`GeoJSON: feature ${i} is malformed`);
    const p = f.properties;
    const coords = f.geometry.coordinates;
    if (f.geometry.type !== "Point" || !Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") {
      throw new Error(`GeoJSON: feature ${i} is not a Point`);
    }
    const sourceLayer = str(p.source_layer);
    const code = str(p.source_stop_code);
    const label = str(p.label_raw);
    if (sourceLayer === null || code === null || label === null) throw new Error(`GeoJSON: feature ${i} lacks layer, code or label`);
    return {
      packageId: str(p.id) ?? str(f.id),
      sourceLayer,
      layer: layerFromName(sourceLayer),
      code,
      label,
      descriptionRaw: null,
      coordinatesRaw: null,
      lat: coords[1],
      lng: coords[0],
      routeId: str(p.route_id),
      direction: str(p.direction),
      exportPosition: num(p.export_position),
      operatingStatus: str(p.operating_status),
      properties: p,
    };
  });
  return { metadata, records };
}

export function parseCsvStops(text: string): MappedStopRecord[] {
  const { header, rows } = parseCsvObjects(text);
  for (const col of ["id", "source_layer", "source_stop_code", "label_raw", "latitude", "longitude"]) {
    if (!header.includes(col)) throw new Error(`Mapped stops CSV lacks column ${col}`);
  }
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || r.latitude === "" || r.longitude === "") {
      throw new Error(`Mapped stops CSV row ${i + 2}: unusable coordinates`);
    }
    const sourceLayer = r.source_layer!;
    return {
      packageId: r.id || null,
      sourceLayer,
      layer: layerFromName(sourceLayer),
      code: r.source_stop_code!,
      label: r.label_raw!,
      descriptionRaw: null,
      coordinatesRaw: `${r.longitude},${r.latitude}`,
      lat,
      lng,
      routeId: r.route_id || null,
      direction: r.direction || null,
      exportPosition: null,
      operatingStatus: r.operating_status || null,
      properties: { ...r },
    };
  });
}

// ---------------------------------------------------------------- cross-check

type NamedSet = { name: string; records: MappedStopRecord[] };

const recordKey = (r: MappedStopRecord) => `${r.sourceLayer}|${r.code}|${r.label}`;
const show = (r: MappedStopRecord) => `${r.sourceLayer}/${r.code} "${r.label}"`;

function countErrors(set: NamedSet): string[] {
  const errors: string[] = [];
  if (set.records.length !== EXPECTED_RECORD_COUNT) {
    errors.push(`${set.name}: record count ${set.records.length}, expected ${EXPECTED_RECORD_COUNT}`);
  }
  const counts: Record<string, number> = {};
  for (const r of set.records) counts[r.layer] = (counts[r.layer] ?? 0) + 1;
  for (const [layer, expected] of Object.entries(EXPECTED_LAYER_COUNTS)) {
    if ((counts[layer] ?? 0) !== expected) {
      errors.push(`${set.name}: layer ${layer} has ${counts[layer] ?? 0} records, expected ${expected}`);
    }
  }
  return errors;
}

function compareSets(base: NamedSet, other: NamedSet): string[] {
  const errors: string[] = [];
  const index = (set: NamedSet) => {
    const map = new Map<string, MappedStopRecord>();
    for (const r of set.records) {
      const k = recordKey(r);
      if (map.has(k)) errors.push(`${set.name}: duplicate (layer, code, label) ${show(r)}`);
      else map.set(k, r);
    }
    return map;
  };
  const a = index(base);
  const b = index(other);
  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (!rb) {
      errors.push(`${other.name} is missing ${show(ra)} present in ${base.name}`);
      continue;
    }
    if (Math.abs(ra.lat - rb.lat) > COORDINATE_TOLERANCE_DEG || Math.abs(ra.lng - rb.lng) > COORDINATE_TOLERANCE_DEG) {
      errors.push(`${show(ra)}: coordinates differ between ${base.name} (${ra.lng},${ra.lat}) and ${other.name} (${rb.lng},${rb.lat})`);
    }
  }
  for (const [k, rb] of b) {
    if (!a.has(k)) errors.push(`${other.name} has extra ${show(rb)} not in ${base.name}`);
  }
  return errors;
}

/** Record-for-record agreement of the three formats; KML is the authority. Empty array means agreement. */
export function crossCheck(kml: MappedStopRecord[], geojson: MappedStopRecord[], csv: MappedStopRecord[]): string[] {
  const k: NamedSet = { name: "KML", records: kml };
  const g: NamedSet = { name: "GeoJSON", records: geojson };
  const c: NamedSet = { name: "CSV", records: csv };
  return [...countErrors(k), ...countErrors(g), ...countErrors(c), ...compareSets(k, g), ...compareSets(k, c)];
}

export type Snapshot = { records: MappedStopRecord[]; metadata: MapMetadata; errors: string[] };

/**
 * Parses the three formats, cross-checks them, and returns the KML records (raw authority)
 * enriched with the GeoJSON package id, route, direction, export position and properties.
 */
export function buildSnapshot(kmlXml: string, geojsonText: string, csvText: string): Snapshot {
  const kml = parseKmlStops(kmlXml);
  const geo = parseGeojsonStops(geojsonText);
  const csv = parseCsvStops(csvText);
  const errors = crossCheck(kml, geo.records, csv);

  if (geo.metadata.recordCount !== geo.records.length) {
    errors.push(`GeoJSON metadata record_count ${geo.metadata.recordCount} != ${geo.records.length} features`);
  }
  const distinct = new Set(kml.map((r) => `${r.lat},${r.lng}`)).size;
  if (geo.metadata.exactUniqueCoordinateCount !== null && geo.metadata.exactUniqueCoordinateCount !== distinct) {
    errors.push(`GeoJSON metadata exact_unique_coordinate_count ${geo.metadata.exactUniqueCoordinateCount} != ${distinct} distinct KML coordinate pairs`);
  }

  const byKey = new Map(geo.records.map((r) => [recordKey(r), r]));
  const records = kml.map((r): MappedStopRecord => {
    const g = byKey.get(recordKey(r));
    if (!g) return r;
    return {
      ...r,
      packageId: g.packageId,
      routeId: g.routeId,
      direction: g.direction,
      exportPosition: g.exportPosition,
      operatingStatus: g.operatingStatus,
      properties: g.properties,
    };
  });
  return { records, metadata: geo.metadata, errors };
}

// ---------------------------------------------------------------- identity

export type SourceIdentity = {
  sourceIdentity: string;
  identityMethod: "layer_code_label";
  /** The pre-hash key, kept for debugging and tests. */
  key: string;
};

/** Identity method 2 (spec 4.7): sha256 of map_id|source_layer|code|normalized label. Coordinates excluded. */
export function sourceIdentity(record: MappedStopRecord, mapId: string): SourceIdentity {
  const key = `${mapId}|${record.sourceLayer}|${record.code}|${normalizeLabel(record.label)}`;
  return { sourceIdentity: sha256Hex(key), identityMethod: "layer_code_label", key };
}

export type IdentifiedStop = MappedStopRecord & {
  sourceIdentity: string;
  identityMethod: "layer_code_label";
  identityKey: string;
};

/** Attaches identities and asserts uniqueness within the snapshot. */
export function withIdentities(records: MappedStopRecord[], mapId: string): IdentifiedStop[] {
  const seen = new Map<string, string>();
  return records.map((r) => {
    const id = sourceIdentity(r, mapId);
    const prior = seen.get(id.sourceIdentity);
    if (prior !== undefined) throw new Error(`Duplicate source identity for ${show(r)} (same as ${prior})`);
    seen.set(id.sourceIdentity, show(r));
    return { ...r, sourceIdentity: id.sourceIdentity, identityMethod: id.identityMethod, identityKey: id.key };
  });
}

// ---------------------------------------------------------------- raw_feature rows

/** Shape for ingest.raw_feature (batch_id added by the importer). */
export type RawFeatureRow = {
  sourceIdentity: string;
  identityMethod: "layer_code_label";
  sourceLayer: string;
  sourceCodeRaw: string;
  labelRaw: string;
  descriptionRaw: string | null;
  /** Verbatim coordinate text, as it appears in the KML. */
  lonText: string;
  latText: string;
  lon: number;
  lat: number;
  properties: Record<string, unknown>;
  contentHash: string;
};

export function toRawFeatureRow(record: IdentifiedStop): RawFeatureRow {
  const raw = record.coordinatesRaw;
  const parts = raw === null ? [] : raw.split(",");
  const lonText = parts[0] ?? String(record.lng);
  const latText = parts[1] ?? String(record.lat);
  const contentHash = sha256Hex(JSON.stringify([record.sourceLayer, record.code, record.label, lonText, latText]));
  return {
    sourceIdentity: record.sourceIdentity,
    identityMethod: record.identityMethod,
    sourceLayer: record.sourceLayer,
    sourceCodeRaw: record.code,
    labelRaw: record.label,
    descriptionRaw: record.descriptionRaw,
    lonText,
    latText,
    lon: record.lng,
    lat: record.lat,
    properties: { ...record.properties, package_id: record.packageId },
    contentHash,
  };
}
