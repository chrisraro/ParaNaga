import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  DATA_FILES,
  PUBLIC_STOP_MAP_KEYS,
  planRawFeatures,
  readDataFiles,
  type DataFiles,
} from "../../scripts/lib/import-plan";

const files = readDataFiles("Data_Sets");
const plan = buildImportPlan(files);

const tamper = (name: (typeof DATA_FILES)[number], edit: (text: string) => string): DataFiles => ({
  ...files,
  [name]: Buffer.from(edit(files[name].toString("utf8")), "utf8"),
});

describe("buildImportPlan on the research package", () => {
  it("has no problems", () => {
    expect(plan.problems).toEqual([]);
  });

  it("hashes all seven files", () => {
    expect(plan.documents.map((d) => d.fileName).sort()).toEqual([...DATA_FILES].sort());
    for (const d of plan.documents) expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.documents.find((d) => d.fileName === "naga_mapped_stops_source.kml")).toMatchObject({
      sourceCode: "S40",
      retrievedOn: "2026-10-15",
    });
    expect(plan.documentsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the snapshot and the revision", () => {
    expect(plan.snapshotVersion).toBe("mymaps:1f0HedvouLfPzGTte38TdqNM4pYBICG4:2026-10-15");
    expect(plan.revisionLabel).toBe("provisional-loops-2026-10-15");
  });

  it("plans 128 raw features with verbatim coordinate text and one candidate stop each", () => {
    expect(plan.rawFeatures).toHaveLength(128);
    const byLayer: Record<string, number> = {};
    for (const r of plan.rawFeatures) byLayer[r.sourceLayer] = (byLayer[r.sourceLayer] ?? 0) + 1;
    expect(byLayer).toEqual({ "Loop Service A": 30, "Loop Service B": 31, "Loop Service C": 34, "Loop Service D": 33 });
    const a1 = plan.rawFeatures.find((r) => r.sourceLayer === "Loop Service A" && r.sourceCodeRaw === "A1")!;
    expect(a1.coordinatesRaw).toBe("123.1846726,13.6233869,0");
    expect(a1.lonText).toBe("123.1846726");
    expect(a1.stopName).toBe("Plaza Rizal");
  });

  it("names the two empty-label Loop B pins by their source code, keeping the empty label", () => {
    const empty = plan.rawFeatures.filter((r) => r.labelRaw === "");
    expect(empty.map((r) => [r.sourceCodeRaw, r.stopName]).sort()).toEqual([["B18", "B18"], ["B19", "B19"]]);
  });

  it("records 113 conflicts: 53 prefix mismatches, 14 shared coordinates, 46 near duplicates", () => {
    const byKind: Record<string, number> = {};
    for (const c of plan.conflicts) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    expect(byKind).toEqual({ code_prefix_mismatch: 53, exact_coordinate_shared: 14, near_duplicate: 46 });
  });

  it("plans 18 variants: documentary for every route, provisional loops A and B, two trials", () => {
    expect(plan.variants).toHaveLength(18);
    const key = (v: (typeof plan.variants)[number]) => `${v.routeCode}/${v.direction}/${v.kind}`;
    expect(plan.variants.map(key)).toEqual(expect.arrayContaining([
      "R1/inbound/permanent", "R1/outbound/permanent", "R3/circuit/permanent",
      "R8-A/clockwise/permanent", "R8-B/counterclockwise/permanent", "R8-C/clockwise/permanent",
      "R8-A/clockwise/trial", "R8-B/counterclockwise/trial",
    ]));
    const versions = plan.variants.flatMap((v) => v.versions);
    expect(versions).toHaveLength(20);
    expect(versions.filter((v) => v.evidenceLevel === "provisional")).toHaveLength(2);
    expect(versions.filter((v) => v.evidenceLevel === "documentary")).toHaveLength(18);
    expect(new Set(versions.map((v) => v.contentHash)).size).toBe(20);
    for (const v of plan.variants) expect(v.versions.filter((x) => x.isMember)).toHaveLength(1);
  });

  it("orders Loop A and Loop B by code (61 provisional route stops); C and D get none", () => {
    const stops = plan.variants.flatMap((v) => v.versions.map((x) => ({ route: v.routeCode, kind: v.kind, x })));
    const loopA = stops.find((s) => s.route === "R8-A" && s.kind === "permanent" && s.x.evidenceLevel === "provisional")!;
    const loopB = stops.find((s) => s.route === "R8-B" && s.kind === "permanent" && s.x.evidenceLevel === "provisional")!;
    expect(loopA.x).toMatchObject({ isCircular: true, isMember: true });
    expect(loopA.x.routeStops).toHaveLength(30);
    expect(loopB.x.routeStops).toHaveLength(31);
    const codeOf = (identity: string) => plan.rawFeatures.find((r) => r.sourceIdentity === identity)!.sourceCodeRaw;
    expect(loopA.x.routeStops.map((s) => codeOf(s.recordIdentity))).toEqual(Array.from({ length: 30 }, (_, i) => `A${i + 1}`));
    const others = stops.filter((s) => s !== loopA && s !== loopB);
    for (const s of others) expect(s.x.routeStops).toEqual([]);
    expect(plan.counts.route_stops).toBe(61);
  });

  it("trial variants keep permanence unconfirmed and their adoption date", () => {
    const trial = plan.variants.find((v) => v.routeCode === "R8-A" && v.kind === "trial")!;
    expect(trial.versions[0]).toMatchObject({
      trialStatus: "permanence_unconfirmed",
      effectiveFrom: "2025-11-11",
      trialDurationDays: 30,
      operatingStatus: null,
      sourceCodes: ["S03"],
    });
  });

  it("adds the survey template columns to the seed's dataset notes", () => {
    expect(plan.datasetNotes.map((n) => n.key)).toContain("survey_template_columns");
    expect(plan.datasetNotes).toHaveLength(10);
  });

  it("hashes fare rule versions from content only, so two plans agree", () => {
    const again = buildImportPlan(files);
    expect(plan.fareRules.map((f) => f.contentHash)).toEqual(again.fareRules.map((f) => f.contentHash));
    expect(new Set(plan.fareRules.map((f) => f.contentHash)).size).toBe(4);
    for (const f of plan.fareRules) expect(f.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("publishes only the allowed attribution fields of public_stop_map and records the omission", () => {
    const note = plan.datasetNotes.find((n) => n.key === "public_stop_map")!;
    const value = note.value as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual([...PUBLIC_STOP_MAP_KEYS].sort());
    expect(value).toMatchObject({
      public_owner_display_name: "Tan Gumba",
      owner_identity_or_official_role_verified: false,
      omitted_keys_count: 12,
    });
    expect(value.omitted_keys_note).toMatch(/provenance/);
  });

  it("says in R3/R4 notes that is_circular=false is unverified, not verified non-circular", () => {
    for (const code of ["R3", "R4"]) {
      const v = plan.variants.find((x) => x.routeCode === code)!;
      expect(v.versions[0]).toMatchObject({ isCircular: false });
      expect(v.versions[0]!.notes).toMatch(/not verified/);
    }
  });

  it("reports aliases as deferred", () => {
    expect(plan.deferred).toEqual({ route_aliases: "deferred (no structured source)" });
    expect(plan.counts).not.toHaveProperty("route_aliases");
  });

  it("counts every collection", () => {
    expect(plan.counts).toMatchObject({
      documents: 7, sources: 42, raw_features: 128, stop_points: 128, routes: 11,
      variants: 18, variant_versions: 20, route_stops: 61, fare_rules: 4, fare_observations: 1,
      fare_conflicts: 1, terminals: 6, feeder_leads: 5, providers: 3, rail_status: 4, barangays: 27,
      coverage_audits: 27, designated_stop_candidates: 32, external_destination_categories: 5, dataset_notes: 10,
    });
  });
});

describe("buildImportPlan refuses bad input", () => {
  it("reports a record without verbatim coordinate text as a problem", () => {
    const problems: string[] = [];
    const rows = planRawFeatures([{ ...plan.identified[0]!, coordinatesRaw: null }, plan.identified[1]!], problems);
    expect(rows).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no verbatim coordinate text/);
  });

  it("reports a seed integrity issue", () => {
    const bad = buildImportPlan(tamper("naga_transport_seed.json", (t) => t.replace('"timezone"', '"surprise": 1, "timezone"')));
    expect(bad.problems.join("\n")).toMatch(/surprise/);
  });

  it("reports a designated-candidate CSV disagreement", () => {
    const bad = buildImportPlan(tamper("designated_stop_candidates.csv", (t) => t.trimEnd().split(/\r?\n/).slice(0, -1).join("\n")));
    expect(bad.problems.join("\n")).toMatch(/designated candidates count/);
  });

  it("reports a format disagreement between KML and CSV", () => {
    const bad = buildImportPlan(tamper("naga_mapped_stops.csv", (t) => t.replace("Plaza Rizal", "Plaza Rizal X")));
    expect(bad.problems).toContain('CSV is missing Loop Service A/A1 "Plaza Rizal" present in KML');
  });

  it("reports seed data the schema has no place for instead of dropping it", () => {
    const bad = buildImportPlan(tamper("naga_transport_seed.json", (t) => {
      const seed = JSON.parse(t) as { feeder_candidates: { geometry: unknown }[] };
      seed.feeder_candidates[0]!.geometry = { type: "LineString", coordinates: [] };
      return JSON.stringify(seed);
    }));
    expect(bad.problems.join("\n")).toMatch(/SF01.*geometry/);
  });
});
