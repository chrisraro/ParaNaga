// The admin import planner (N5b, C2): the research package's own KML and CSV planned against a
// baseline, as the dry run and the commit do. AC-1 on this path: the same file again is 128
// unchanged and nothing to write; the counts check, problems and diff rows; the commit payload.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitPayload, planAdminImport, type ImportBaseline } from "@/domain/admin/imports";
import { importDryRunSchema, type ImportUpload } from "@/domain/admin/stops";

const MAP = "1f0HedvouLfPzGTte38TdqNM4pYBICG4";
const BATCH = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8b01";
const KML = readFileSync("Data_Sets/naga_mapped_stops_source.kml", "utf8");
const CSV = readFileSync("Data_Sets/naga_mapped_stops.csv", "utf8");

const kml = (text = KML): ImportUpload => ({ format: "kml", fileName: "naga_mapped_stops_source.kml", text, retrievedOn: "2026-10-20" });

/** A baseline equal to what the CLI committed from the same KML. */
function baselineOf(upload: ImportUpload): ImportBaseline {
  const plan = planAdminImport(upload, { batchId: BATCH, snapshotVersion: `mymaps:${MAP}:2026-10-15`, mapId: MAP, features: [] });
  return {
    batchId: BATCH,
    snapshotVersion: `mymaps:${MAP}:2026-10-15`,
    mapId: MAP,
    features: plan.features.map((f) => ({ sourceIdentity: f.sourceIdentity, contentHash: f.contentHash, layer: f.sourceLayer, code: f.sourceCodeRaw, label: f.labelRaw, lat: f.lat, lng: f.lon })),
  };
}

const BASE = baselineOf(kml());

describe("planAdminImport", () => {
  it("AC-1: the committed file again is 128 unchanged, nothing added, changed or missing", () => {
    const plan = planAdminImport(kml(), BASE);
    expect(plan.dryRun.problems).toEqual([]);
    expect(plan.dryRun.changes).toEqual({ added: 0, changed: 0, unchanged: 128, missing: 0 });
    expect(plan.dryRun.rows).toEqual([]);
    expect(plan.dryRun.counts).toMatchObject({ total: 128, byLayer: { A: 30, B: 31, C: 34, D: 33 }, expectedTotal: 128 });
    expect(plan.dryRun.canCommit).toBe(true);
    expect(plan.dryRun.snapshotVersion).toBe(`mymaps:${MAP}:2026-10-20`);
    expect(plan.dryRun.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(importDryRunSchema.parse(plan.dryRun)).toBeTruthy();
  });

  it("records the same conflicts as the CLI importer (never resolved here)", () => {
    const kinds = planAdminImport(kml(), BASE).dryRun.conflicts.map((c) => c.kind);
    expect(kinds.filter((k) => k === "code_prefix_mismatch")).toHaveLength(53);
    expect(kinds).toContain("exact_coordinate_shared");
  });

  it("the package CSV has the same identities as the KML (no pin added or missing)", () => {
    const plan = planAdminImport({ ...kml(CSV), format: "csv", fileName: "naga_mapped_stops.csv" }, BASE);
    expect(plan.dryRun.changes.added).toBe(0);
    expect(plan.dryRun.changes.missing).toBe(0);
    expect(plan.dryRun.changes.unchanged + plan.dryRun.changes.changed).toBe(128);
  });

  it("a moved pin is changed with the distance; a relabelled pin is a new identity plus a missing one", () => {
    // A1 Plaza Rizal: 123.1846726,13.6233869 → about 111 m north.
    const moved = KML.replace("123.1846726,13.6233869", "123.1846726,13.6243869");
    expect(moved).not.toBe(KML);
    const m = planAdminImport(kml(moved), BASE).dryRun;
    expect(m.changes).toMatchObject({ added: 0, missing: 0, changed: m.changes.changed });
    expect(m.changes.changed).toBeGreaterThanOrEqual(1);
    const row = m.rows.find((r) => r.kind === "changed" && r.code === "A1")!;
    expect(row.movedM).toBeGreaterThan(100);
    expect(row.movedM).toBeLessThan(120);

    const relabelled = KML.replace("<description>Plaza Rizal</description>", "<description>Plaza Rizal North</description>");
    expect(relabelled).not.toBe(KML);
    const r = planAdminImport(kml(relabelled), BASE).dryRun;
    expect(r.changes).toMatchObject({ added: 1, missing: 1, unchanged: 127 });
    expect(r.rows.map((x) => x.kind).sort()).toEqual(["added", "missing"]);
  });

  it("disables commit on a count mismatch, a missing baseline, an unreadable file or a pin outside the area", () => {
    const fewer = planAdminImport({ ...kml(CSV.split("\n").slice(0, 100).join("\n")), format: "csv" }, BASE).dryRun;
    expect(fewer.canCommit).toBe(false);
    expect(fewer.problems.join(" ")).toMatch(/99 pins; 128 are expected/);

    const none = planAdminImport(kml(), null).dryRun;
    expect(none.canCommit).toBe(false);
    expect(none.problems[0]).toMatch(/first import runs from the command line/);

    const broken = planAdminImport(kml("<kml><Document><Placemark>"), BASE).dryRun;
    expect(broken.canCommit).toBe(false);
    expect(broken.problems[0]).toMatch(/could not be read/);

    const far = planAdminImport(kml(KML.replace("123.1846726,13.6233869", "121.0000000,14.6000000")), BASE).dryRun;
    expect(far.canCommit).toBe(false);
    expect(far.problems.join(" ")).toMatch(/outside the service area/);
  });

  it("caps the listed rows but keeps the counts complete", () => {
    const r = planAdminImport(kml(), { ...BASE, features: [] }).dryRun;
    expect(r.changes.added).toBe(128);
    expect(r.rows.length).toBe(128);
  });
});

describe("commitPayload", () => {
  it("carries every raw feature verbatim (snake_case, coordinate text) and the conflicts", () => {
    const upload = kml();
    const plan = planAdminImport(upload, BASE);
    const p = commitPayload(upload, plan, BATCH) as { features: Record<string, unknown>[]; conflicts: unknown[] } & Record<string, unknown>;
    expect(p).toMatchObject({ mapId: MAP, snapshotVersion: `mymaps:${MAP}:2026-10-20`, retrievedOn: "2026-10-20", expectedBaselineBatchId: BATCH, fileName: upload.fileName });
    expect(p.features).toHaveLength(128);
    expect(p.features[0]).toMatchObject({ identity_method: "layer_code_label", source_layer: expect.stringMatching(/^Loop Service [ABCD]$/) });
    expect(String(p.features[0]!.lon)).toMatch(/^\d+\.\d+$/);
    expect(String(p.features[0]!.coordinates_raw)).toContain(String(p.features[0]!.lon));
    expect(p.conflicts.length).toBe(plan.conflicts.length);
  });

  it("refuses a plan with problems", () => {
    const upload = kml("<kml/>");
    expect(() => commitPayload(upload, planAdminImport(upload, BASE), BATCH)).toThrow(/problems/);
  });
});
