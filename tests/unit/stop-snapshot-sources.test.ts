// Why the register adds S39/S40 by an explicit list (src/domain/sources/stop-snapshot-sources.ts):
// every mapped stop record in the research package cites exactly those two sources, the import
// files the KML export under S40, and S41/S42 are cited by no stop record.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STOP_SNAPSHOT_SOURCE_CODES } from "@/domain/sources/stop-snapshot-sources";

const geojson = JSON.parse(readFileSync("Data_Sets/naga_mapped_stops.geojson", "utf8")) as { features: { properties: { source_ids?: string[] } }[] };
const seed = JSON.parse(readFileSync("Data_Sets/naga_transport_seed.json", "utf8")) as {
  sources: { id: string }[];
  mapped_stop_records: { source_ids?: string[] }[];
};

describe("stop snapshot sources", () => {
  it("are exactly the sources every mapped stop record cites", () => {
    const cited = new Set([...geojson.features.map((f) => f.properties.source_ids ?? []), ...seed.mapped_stop_records.map((r) => r.source_ids ?? [])].map((ids) => [...ids].sort().join(",")));
    expect([...cited]).toEqual([[...STOP_SNAPSHOT_SOURCE_CODES].sort().join(",")]);
    expect(geojson.features).toHaveLength(128);
  });

  it("exist in the source catalogue; the import files the KML export under S40", () => {
    const ids = seed.sources.map((s) => s.id);
    for (const code of STOP_SNAPSHOT_SOURCE_CODES) expect(ids).toContain(code);
    expect(readFileSync("scripts/lib/import-plan.ts", "utf8")).toMatch(/isExport \? "S40" : null/);
  });

  it("leave out S41/S42, which no stop record cites", () => {
    expect(STOP_SNAPSHOT_SOURCE_CODES).not.toContain("S41");
    expect(STOP_SNAPSHOT_SOURCE_CODES).not.toContain("S42");
  });
});
