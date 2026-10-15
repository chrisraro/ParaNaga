import { z } from "zod";
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
  recordCount: number | null;
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

const GeoMetadataSchema = z.looseObject({
  map_id: z.string().min(1),
  title: z.string().nullish(),
  viewer_url: z.string().nullish(),
  shared_short_url: z.string().nullish(),
  public_owner_display_name: z.string().nullish(),
  owner_identity_or_official_role_verified: z.boolean().nullish(),
  record_count: z.number().finite().nonnegative().nullish(),
  exact_unique_coordinate_count: z.number().finite().nonnegative().nullish(),
  layer_counts: z.record(z.string(), z.number().finite().nonnegative()).nullish(),
  retrieved_on: z.string().nullish(),
  notes: z.string().nullish(),
});

const GeoFeatureSchema = z.object({
  id: z.string().nullish(),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)], z.number()),
  }),
  properties: z.looseObject({
    id: z.string().nullish(),
    source_layer: z.string(),
    source_stop_code: z.string(),
    label_raw: z.string(),
    route_id: z.string().nullish(),
    direction: z.string().nullish(),
    export_position: z.number().finite().nullish(),
    operating_status: z.string().nullish(),
  }),
});

const GeoCollectionSchema = z.looseObject({
  name: z.string().nullish(),
  metadata: GeoMetadataSchema,
  features: z.array(GeoFeatureSchema),
});

const coordText = z.string().regex(/^-?\d+(\.\d+)?$/, "coordinate must be a decimal number");

const CsvRowSchema = z.looseObject({
  id: z.string(),
  source_layer: z.string(),
  source_stop_code: z.string(),
  label_raw: z.string(),
  latitude: coordText,
  longitude: coordText,
  route_id: z.string().optional(),
  direction: z.string().optional(),
  operating_status: z.string().optional(),
});

function zodMessage(where: string, error: z.ZodError): string {
  const first = error.issues[0];
  return `${where}: invalid at ${first && first.path.length > 0 ? first.path.join(".") : "root"}: ${first?.message ?? "unknown error"}`;
}

export function parseGeojsonStops(text: string): { metadata: MapMetadata; records: MappedStopRecord[] } {
  const parsed = GeoCollectionSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(zodMessage("GeoJSON", parsed.error));
  const { metadata: m, features } = parsed.data;
  const metadata: MapMetadata = {
    mapId: m.map_id,
    title: m.title ?? parsed.data.name ?? "",
    viewerUrl: m.viewer_url ?? null,
    sharedShortUrl: m.shared_short_url ?? null,
    publicOwnerDisplayName: m.public_owner_display_name ?? null,
    ownerIdentityOrOfficialRoleVerified: m.owner_identity_or_official_role_verified ?? null,
    recordCount: m.record_count ?? null,
    exactUniqueCoordinateCount: m.exact_unique_coordinate_count ?? null,
    layerCounts: m.layer_counts ?? {},
    retrievedOn: m.retrieved_on ?? null,
    notes: m.notes ?? null,
    raw: m,
  };
  const records = features.map((f): MappedStopRecord => {
    const p = f.properties;
    return {
      packageId: p.id ?? f.id ?? null,
      sourceLayer: p.source_layer,
      layer: layerFromName(p.source_layer),
      code: p.source_stop_code,
      label: p.label_raw,
      descriptionRaw: null,
      coordinatesRaw: null,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      routeId: p.route_id ?? null,
      direction: p.direction ?? null,
      exportPosition: p.export_position ?? null,
      operatingStatus: p.operating_status ?? null,
      properties: p,
    };
  });
  return { metadata, records };
}

/**
 * The CSV has separate latitude and longitude columns, so `coordinatesRaw` is assembled as
 * "lng,lat" from the two verbatim cell strings (not a source-authored coordinate string).
 */
export function parseCsvStops(text: string): MappedStopRecord[] {
  const { rows } = parseCsvObjects(text);
  return rows.map((raw, i) => {
    const parsed = CsvRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error(zodMessage(`Mapped stops CSV row ${i + 2}`, parsed.error));
    const r = parsed.data;
    return {
      packageId: r.id || null,
      sourceLayer: r.source_layer,
      layer: layerFromName(r.source_layer),
      code: r.source_stop_code,
      label: r.label_raw,
      descriptionRaw: null,
      coordinatesRaw: `${r.longitude},${r.latitude}`,
      lat: Number(r.latitude),
      lng: Number(r.longitude),
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

  if (geo.metadata.recordCount !== null && geo.metadata.recordCount !== geo.records.length) {
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
  if (raw === null) throw new Error(`toRawFeatureRow: ${record.sourceLayer}/${record.code} has no verbatim coordinate text`);
  const [lonText, latText] = raw.split(",");
  if (lonText === undefined || latText === undefined) throw new Error(`toRawFeatureRow: unusable coordinate text "${raw}"`);
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
