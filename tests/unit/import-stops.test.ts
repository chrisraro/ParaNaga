import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/domain/geo/geometry";
import { detectConflicts } from "@/domain/import/conflicts";
import { parseSurveyTemplate } from "@/domain/import/survey-template";
import { provisionalLoopSequence } from "@/domain/import/provisional-loops";
import {
  EXPECTED_LAYER_COUNTS,
  buildSnapshot,
  crossCheck,
  normalizeLabel,
  parseCsvStops,
  parseGeojsonStops,
  parseKmlStops,
  sourceIdentity,
  withIdentities,
  type MappedStopRecord,
} from "@/domain/import/mapped-stops";

const read = (f: string) => readFileSync(`Data_Sets/${f}`, "utf8");
const kmlText = read("naga_mapped_stops_source.kml");
const geojsonText = read("naga_mapped_stops.geojson");
const csvText = read("naga_mapped_stops.csv");

const kml = parseKmlStops(kmlText);
const geojson = parseGeojsonStops(geojsonText);
const csv = parseCsvStops(csvText);

function countBy(rows: MappedStopRecord[]) {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.layer] = (out[r.layer] ?? 0) + 1;
  return out;
}

describe("mapped stop parsing", () => {
  it("reads 128 records from each of the three formats with layer counts A30 B31 C34 D33", () => {
    for (const rows of [kml, geojson.records, csv]) {
      expect(rows).toHaveLength(128);
      expect(countBy(rows)).toEqual({ A: 30, B: 31, C: 34, D: 33 });
    }
    expect(EXPECTED_LAYER_COUNTS).toEqual({ A: 30, B: 31, C: 34, D: 33 });
  });

  it("keeps raw labels, layer names and coordinate text verbatim", () => {
    expect(kml[0]).toMatchObject({
      sourceLayer: "Loop Service A",
      layer: "A",
      code: "A1",
      label: "Plaza Rizal",
      coordinatesRaw: "123.1846726,13.6233869,0",
    });
    expect(kml.some((r) => r.label === "Cor. Peñafrancia Ave & Magsaysay Ave.")).toBe(true);
    expect(kml.filter((r) => r.label === "")).toHaveLength(2);
  });

  it("geojson metadata carries the My Maps provenance", () => {
    expect(geojson.metadata).toMatchObject({
      mapId: "1f0HedvouLfPzGTte38TdqNM4pYBICG4",
      publicOwnerDisplayName: "Tan Gumba",
      ownerIdentityOrOfficialRoleVerified: false,
      recordCount: 128,
      exactUniqueCoordinateCount: 114,
      retrievedOn: "2026-10-15",
    });
  });
});

describe("crossCheck", () => {
  it("finds no disagreement between KML, GeoJSON and CSV on this snapshot", () => {
    expect(crossCheck(kml, geojson.records, csv)).toEqual([]);
  });

  it("reports a moved pin, a relabelled pin and a missing record", () => {
    const moved = geojson.records.map((r, i) => (i === 0 ? { ...r, lat: r.lat + 1e-5 } : r));
    const relabelled = csv.map((r, i) => (i === 1 ? { ...r, label: "Other" } : r));
    const missing = geojson.records.slice(1);
    expect(crossCheck(kml, moved, csv).join("\n")).toMatch(/coordinates differ/i);
    expect(crossCheck(kml, geojson.records, relabelled).join("\n")).toMatch(/A2/);
    expect(crossCheck(kml, missing, csv).join("\n")).toMatch(/count|missing/i);
  });

  it("tolerates differences below 1e-7 degrees", () => {
    const nudged = geojson.records.map((r, i) => (i === 0 ? { ...r, lng: r.lng + 5e-8 } : r));
    expect(crossCheck(kml, nudged, csv)).toEqual([]);
  });

  it("buildSnapshot merges KML authority with GeoJSON ids and has no errors", () => {
    const snap = buildSnapshot(kmlText, geojsonText, csvText);
    expect(snap.errors).toEqual([]);
    expect(snap.records).toHaveLength(128);
    expect(snap.records[0]).toMatchObject({ packageId: "MYM-A-001", routeId: "R8-A", direction: "clockwise", exportPosition: 1 });
    expect(snap.records.every((r) => r.packageId !== null)).toBe(true);
    expect(snap.metadata.mapId).toBe("1f0HedvouLfPzGTte38TdqNM4pYBICG4");
  });
});

describe("sourceIdentity", () => {
  const mapId = "MAP";
  const base: MappedStopRecord = { ...kml[0]! };

  it("is sha256 hex of map_id|source_layer|code|normalized label", () => {
    const id = sourceIdentity(base, mapId);
    expect(id.identityMethod).toBe("layer_code_label");
    expect(id.sourceIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(id.key).toBe("MAP|Loop Service A|A1|plaza rizal");
  });

  it("normalizes labels (NFC, trim, collapse whitespace, lower-case) and is stable", () => {
    expect(normalizeLabel("  Cor.   Peñafrancia\tAve ")).toBe(normalizeLabel("cor. peñafrancia ave"));
    expect(sourceIdentity(base, mapId)).toEqual(sourceIdentity({ ...base, label: "  PLAZA  rizal " }, mapId));
    expect(sourceIdentity(base, mapId).sourceIdentity).not.toBe(sourceIdentity(base, "OTHER").sourceIdentity);
    expect(sourceIdentity(base, mapId).sourceIdentity).not.toBe(sourceIdentity({ ...base, code: "A2" }, mapId).sourceIdentity);
  });

  it("does not depend on coordinates", () => {
    expect(sourceIdentity({ ...base, lat: 1 }, mapId)).toEqual(sourceIdentity(base, mapId));
  });

  it("is unique and stable across all 128 records", () => {
    const a = withIdentities(kml, geojson.metadata.mapId);
    const b = withIdentities(parseKmlStops(kmlText), geojson.metadata.mapId);
    expect(new Set(a.map((r) => r.sourceIdentity)).size).toBe(128);
    expect(a.map((r) => r.sourceIdentity)).toEqual(b.map((r) => r.sourceIdentity));
  });

  it("withIdentities throws on a duplicate identity", () => {
    expect(() => withIdentities([base, { ...base }], mapId)).toThrow(/duplicate/i);
  });
});

describe("detectConflicts", () => {
  const records = withIdentities(buildSnapshot(kmlText, geojsonText, csvText).records, geojson.metadata.mapId);
  const conflicts = detectConflicts(records);
  const ofKind = (k: string) => conflicts.filter((c) => c.kind === k);

  it("flags 26 Loop C records with A codes and 27 Loop D records with B codes", () => {
    const mm = ofKind("code_prefix_mismatch");
    expect(mm).toHaveLength(53);
    const byLayer = (layer: string) => mm.filter((c) => (c.detail as { layer: string }).layer === layer).length;
    expect(byLayer("C")).toBe(26);
    expect(byLayer("D")).toBe(27);
    expect(mm.every((c) => c.refs.length === 1)).toBe(true);
  });

  it("puts 128 records on 114 distinct coordinate pairs; 14 pairs are shared by 2 records", () => {
    const coords = new Set(records.map((r) => `${r.lat},${r.lng}`));
    expect(coords.size).toBe(114);
    const shared = ofKind("exact_coordinate_shared");
    expect(shared).toHaveLength(14);
    expect(shared.every((c) => c.refs.length === 2)).toBe(true);
    expect(shared.reduce((n, c) => n + c.refs.length, 0)).toBe(28);
  });

  it("finds near-duplicate cross-layer pairs within 15 m with similar labels, never same-layer or exact", () => {
    const near = ofKind("near_duplicate");
    expect(near).toHaveLength(46); // 62 cross-layer pairs within 15 m, minus 14 exact-coordinate pairs, minus 2 with an empty label
    const byIdentity = new Map(records.map((r) => [r.sourceIdentity, r]));
    for (const c of near) {
      const [a, b] = c.refs.map((x) => byIdentity.get(x)!);
      expect(a!.layer).not.toBe(b!.layer);
      const d = haversineMeters(a!, b!);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(15);
      expect(a!.label).not.toBe("");
      expect(b!.label).not.toBe("");
    }
    const labels = near.map((c) => c.refs.map((x) => byIdentity.get(x)!.label));
    expect(labels.some(([a, b]) => a === "Villla Caceres" && b === "Villla Caceres")).toBe(true);
  });

  it("emits sorted, distinct refs and a unique (kind, refs) key", () => {
    const keys = new Set<string>();
    for (const c of conflicts) {
      const sorted = [...c.refs].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
      expect(c.refs).toEqual(sorted);
      expect(new Set(c.refs).size).toBe(c.refs.length);
      keys.add(`${c.kind}|${c.refs.join(",")}`);
    }
    expect(keys.size).toBe(conflicts.length);
  });

  it("is deterministic", () => {
    expect(detectConflicts(records)).toEqual(conflicts);
  });
});

describe("provisionalLoopSequence", () => {
  const records = withIdentities(buildSnapshot(kmlText, geojsonText, csvText).records, geojson.metadata.mapId);

  function loop(routeId: "R8-A" | "R8-B") {
    const seq = provisionalLoopSequence(records, routeId)!;
    const byId = new Map(records.map((r) => [r.sourceIdentity, r]));
    const pts = seq.map((s) => byId.get(s.recordIdentity)!);
    const gaps = pts.map((p, i) => haversineMeters(p, pts[(i + 1) % pts.length]!));
    return { seq, pts, gaps };
  }

  it("orders Loop A A1…A30 and Loop B B1…B31", () => {
    const a = loop("R8-A");
    expect(a.seq).toHaveLength(30);
    expect(a.seq.map((s) => s.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(a.pts.map((p) => p.code)).toEqual(Array.from({ length: 30 }, (_, i) => `A${i + 1}`));
    expect(a.pts.every((p) => p.layer === "A")).toBe(true);
    const b = loop("R8-B");
    expect(b.seq).toHaveLength(31);
    expect(b.pts.map((p) => p.code)).toEqual(Array.from({ length: 31 }, (_, i) => `B${i + 1}`));
    expect(b.pts.every((p) => p.layer === "B")).toBe(true);
  });

  it("forms a plausible closed loop: at most 8 km round trip, largest gap at most 600 m", () => {
    for (const r of ["R8-A", "R8-B"] as const) {
      const { gaps } = loop(r);
      expect(gaps.reduce((s, g) => s + g, 0)).toBeLessThanOrEqual(8000);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(600);
    }
  });

  it("does not sequence C or D", () => {
    expect(provisionalLoopSequence(records, "R8-C")).toBeNull();
    expect(provisionalLoopSequence(records, "R8-D")).toBeNull();
  });

  it("rejects incomplete or foreign-prefixed layers and unknown routes", () => {
    const withoutA3 = records.filter((r) => !(r.layer === "A" && r.code === "A3"));
    expect(() => provisionalLoopSequence(withoutA3, "R8-A")).toThrow(/contiguous|missing/i);
    const foreign = records.map((r) => (r.layer === "B" && r.code === "B2" ? { ...r, code: "A2" } : r));
    expect(() => provisionalLoopSequence(foreign, "R8-B")).toThrow(/prefix/i);
    expect(() => provisionalLoopSequence(records, "R1")).toThrow(/route/i);
  });
});

describe("field_survey_template.csv", () => {
  it("has 45 unique header columns", () => {
    const cols = parseSurveyTemplate(read("field_survey_template.csv"));
    expect(cols).toHaveLength(45);
    expect(cols[0]).toBe("record_id");
    expect(cols.at(-1)).toBe("source_program");
  });
});
