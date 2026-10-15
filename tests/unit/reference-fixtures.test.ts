// The captured reference responses (tests/e2e/fixtures/network, REAL data from a throwaway Neon
// branch: CAPTURE_E2E_FIXTURES=1 with tests/integration/reference-api.test.ts) still match the
// shared schemas, so a schema change cannot silently break the e2e fixtures.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { revisionMetaSchema, searchIndexSchema, sourceListSchema, terminalDetailSchema } from "@/domain/api/schemas";
import { REVISION as PLAN_REVISION } from "../e2e/fixtures/plan-responses";

const read = (name: string) => JSON.parse(readFileSync(path.resolve("tests/e2e/fixtures/network", name), "utf8"));

describe("reference fixtures", () => {
  const index = searchIndexSchema.parse(read("search-index.json"));
  const t01 = terminalDetailSchema.parse(read("terminal-t01.json"));
  const sources = sourceListSchema.parse(read("sources.json"));

  it("name one revision (the published modes revision)", () => {
    expect(index.revision.label).toBe("modes-2026-10-16");
    expect(t01.revision).toEqual(index.revision);
    expect(sources.revision).toEqual(index.revision);
  });

  it("every captured network fixture and the plan fixture name that same revision (network/head answers with it)", () => {
    const files = readdirSync(path.resolve("tests/e2e/fixtures/network")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(19);
    for (const f of files) expect(revisionMetaSchema.parse(read(f).revision), f).toEqual(index.revision);
    expect(PLAN_REVISION).toEqual(index.revision);
  });

  it("carry the real counts", () => {
    expect(index.osmPlaces).toHaveLength(233);
    expect([index.routes.length, index.terminals.length, index.barangays.length, index.studyLabels.length]).toEqual([13, 16, 27, 32]);
    expect(t01.routes.map((r) => r.basis)).toEqual(["legal_plan", "trial", "legal_plan", "trial"]);
    expect(t01.regionalServices.map((r) => r.code)).toEqual(["RS02", "RS03", "RS05", "RS06", "RS07"]);
    expect(sources.sources.map((s) => s.code)).toEqual(expect.arrayContaining(["S22", "S33", "OSM-2026-10-15", "N01", "N17", "U01"]));
  });

  it("terminal-t06.json agrees with the index (same OpenStreetMap coordinate) and lists no routes", () => {
    const t06 = terminalDetailSchema.parse(read("terminal-t06.json"));
    const entry = index.terminals.find((t) => t.code === "T06")!;
    expect(t06.terminal).toMatchObject({ code: "T06", name: entry.name, locationText: entry.locationText, modes: entry.modes });
    expect(entry.location).toEqual({ lat: t06.terminal.lat, lng: t06.terminal.lng, source: "osm" });
    expect(t06.routes).toEqual([]);
    expect(t06.destinationCategories).toEqual([]);
    for (const s of t06.sources) expect(sources.sources).toContainEqual(s);
  });
});
