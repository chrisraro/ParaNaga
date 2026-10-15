// The captured reference responses (tests/e2e/fixtures/network, REAL data from a throwaway Neon
// branch: CAPTURE_E2E_FIXTURES=1 with tests/integration/reference-api.test.ts) still match the
// shared schemas, so a schema change cannot silently break the e2e fixtures.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchIndexSchema, sourceListSchema, terminalDetailSchema } from "@/domain/api/schemas";

const read = (name: string) => JSON.parse(readFileSync(path.resolve("tests/e2e/fixtures/network", name), "utf8"));

describe("reference fixtures", () => {
  const index = searchIndexSchema.parse(read("search-index.json"));
  const t01 = terminalDetailSchema.parse(read("terminal-t01.json"));
  const sources = sourceListSchema.parse(read("sources.json"));

  it("name one revision (the published OSM places revision)", () => {
    expect(index.revision.label).toBe("osm-places-2026-10-15");
    expect(t01.revision).toEqual(index.revision);
    expect(sources.revision).toEqual(index.revision);
  });

  it("carry the real counts", () => {
    expect(index.osmPlaces).toHaveLength(233);
    expect([index.routes.length, index.terminals.length, index.barangays.length, index.studyLabels.length]).toEqual([11, 6, 27, 32]);
    expect(t01.routes.map((r) => r.basis)).toEqual(["legal_plan", "trial", "legal_plan", "trial"]);
    expect(sources.sources.map((s) => s.code)).toEqual(expect.arrayContaining(["S22", "S33", "OSM-2026-10-15"]));
  });
});
