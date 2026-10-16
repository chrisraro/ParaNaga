// Road outputs plan (Task 7) on the committed data: the pinned road snapshot, the reviewed modes
// seed, the Data_Sets variants and the OSM places snapshot. Pure (no database).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ETA_PARAM_KEYS as API_ETA_KEYS } from "@/domain/api/schemas";
import { ETA_PARAM_KEYS } from "@/domain/import/modes-seed";
import { walkGraphPayloadSchema } from "@/domain/walk/format";
import {
  buildImportPlan,
  readDataFiles,
  readNewestModesSeed,
  readNewestOsmSnapshot,
  readPinnedRoadsSnapshot,
  type ImportPlan,
} from "../../scripts/lib/import-plan";
import { buildLinesPlan, PATH_LABEL, type LinesPlanInput } from "../../scripts/lib/lines-plan";
import { checkRoadsSnapshot } from "../../scripts/lib/roads-snapshot";

const files = readDataFiles("Data_Sets");
const roads = readPinnedRoadsSnapshot()!;
const plan = buildImportPlan(files, readNewestOsmSnapshot(), readNewestModesSeed(), roads);
const lines = plan.lines!;
const inputOf = (p: ImportPlan): LinesPlanInput => ({
  roads, modes: p.modes!, variants: p.variants, identified: p.identified, documentsHash: p.documentsHash,
  osmPlaces: (p.osm?.places ?? []).map((x) => ({ key: x.key, lat: x.lat, lng: x.lng })), osmPlacesSha256: p.osm?.sha256 ?? null,
});

describe("buildLinesPlan on the committed snapshot", () => {
  it("has no problems and names the revision after the road snapshot", () => {
    expect(plan.problems).toEqual([]);
    expect(lines).toMatchObject({
      roadsFileName: "naga-roads-2026-10-16.osm.json", sourceCode: "OSMR-2026-10-16",
      revisionLabel: "modes-lines-2026-10-16",
    });
    // Keyed by every input: another places snapshot, Data_Sets or seed is a new batch, not a refusal.
    expect(lines.snapshotVersion).toBe(`modes-lines:2026-10-16:2026-10-16:${lines.inputsHash.slice(0, 12)}`);
    const otherPlaces = buildLinesPlan({ ...inputOf(plan), osmPlacesSha256: "0".repeat(64) });
    expect(otherPlaces.snapshotVersion).not.toBe(lines.snapshotVersion);
    expect(otherPlaces.revisionLabel).toBe(lines.revisionLabel);
  });

  it("traces every member variant: 18 drawn (R1–R8 and both trials), 3 feeders untraced (reported, not an abort)", () => {
    const drawn = lines.traces.filter((t) => t.status !== "untraced");
    expect(drawn).toHaveLength(18);
    expect(drawn.every((t) => t.status === "ok" && t.coords.length >= 2 && (t.lengthM ?? 0) > 0)).toBe(true);
    const untraced = lines.traces.filter((t) => t.status === "untraced");
    expect(untraced.map((t) => [t.routeCode, t.untracedReason])).toEqual([
      ["TRI-VISTODA", "anchor_unresolved"], ["TRI-VISTODA", "anchor_unresolved"], ["TRI-DECALANGON", "anchor_unresolved"],
    ]);
    expect(untraced.every((t) => t.coords.length === 0 && t.lengthM === null && t.stopMeasures === null)).toBe(true);
    // One trace per member variant version (content hash), the same set the writer publishes.
    const members = plan.variants.map((v) => v.versions.find((x) => x.isMember)!.contentHash);
    expect(lines.traces.slice(0, members.length).map((t) => t.variantVersionHash)).toEqual(members);
  });

  it("measures every provisional Loop A/B pin along its path, snapped within 60 m (D6)", () => {
    for (const [code, n] of [["R8-A", 30], ["R8-B", 31]] as const) {
      const t = lines.traces.find((x) => x.routeCode === code && x.kind === "permanent")!;
      expect(t.mode).toBe("pins");
      expect(t.stopMeasures).toHaveLength(n);
      expect(t.stopMeasures!.map((m) => m.seq)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const m of t.stopMeasures!) {
        expect(m.measureM).toBeGreaterThanOrEqual(0);
        expect(m.measureM).toBeLessThanOrEqual(t.lengthM!);
        expect(m.snapM).toBeLessThanOrEqual(60);
      }
    }
    expect(lines.traces.filter((t) => t.stopMeasures !== null)).toHaveLength(2);
  });

  it("keeps every off-list segment with its reason and length (rendering rules, Task 12)", () => {
    const r4 = lines.traces.find((t) => t.routeCode === "R4")!;
    const conflict = r4.offListSegments.find((s) => s.reason === "oneway_conflict")!;
    expect(conflict.lengthM).toBeGreaterThanOrEqual(100);
    expect(conflict.against).toEqual(["caceres street"]);
    const loopA = lines.traces.find((t) => t.routeCode === "R8-A" && t.kind === "permanent")!;
    expect(loopA.offListSegments.some((s) => s.reason === "terminal_access")).toBe(true);
  });

  it("builds the walk graph within the D7 budget, valid format v1, named after the road source", () => {
    const wg = lines.walkGraph!;
    expect(wg.bytes).toBeLessThanOrEqual(600 * 1024);
    expect(wg.gzipBytes).toBeLessThanOrEqual(220 * 1024);
    expect(wg.sha256).toBe(createHash("sha256").update(wg.payload, "utf8").digest("hex"));
    const parsed = walkGraphPayloadSchema.parse(JSON.parse(wg.payload));
    expect(parsed.roadSource).toBe("OSMR-2026-10-16");
  });

  it("carries the five time-estimate parameters with sources or assumption notes (A1–A3)", () => {
    expect(lines.etaParams.map((p) => p.key).sort()).toEqual([...ETA_PARAM_KEYS].sort());
    expect([...API_ETA_KEYS]).toEqual([...ETA_PARAM_KEYS]);
    for (const p of lines.etaParams) expect(p.isAssumption ? p.assumptionNote : p.sourceCodes.length).toBeTruthy();
    expect(lines.etaParams.find((p) => p.key === "walk_slowdown_factor")).toMatchObject({ valueLow: 1, valueHigh: 1.25, isAssumption: true });
  });

  it("measures each regional service on its OSM relations, keeping the shorter direction (D5)", () => {
    expect(lines.regionalWithoutDistance).toEqual([]);
    const rs05 = lines.regionalDistances.find((d) => d.service.code === "RS05")!;
    expect(rs05).toMatchObject({ distanceKm: 94.278, relationVersions: [13, 14] });
    expect(rs05.distanceBasis).toMatch(/shorter of 2 directions/);
    expect(lines.regionalDistances.find((d) => d.service.code === "RS07")!.distanceBasis).toMatch(/one direction/);
  });

  it("records the landmark and terminus review decisions with how they resolved", () => {
    expect(lines.traceRules.landmarks.find((l) => l.item === "Bicol Central Station")).toMatchObject({ rule: "terminal", resolved: true });
    expect(lines.traceRules.termini.map((t) => [t.routeCode, t.resolved])).toEqual([
      ["R1", true], ["R2", true], ["R5", true], ["R6", true], ["R7", true],
    ]);
  });

  it("is deterministic: the same inputs give the same hashes", () => {
    const again = buildLinesPlan(inputOf(plan));
    expect(again.inputsHash).toBe(lines.inputsHash);
    expect(again.traces.map((t) => t.contentHash)).toEqual(lines.traces.map((t) => t.contentHash));
    expect(again.walkGraph!.contentHash).toBe(lines.walkGraph!.contentHash);
    expect(PATH_LABEL).toBe("Approximate path, not a verified route shape");
  });
});

describe("buildLinesPlan refuses", () => {
  it("a synthetic road snapshot", () => {
    const bytes = readFileSync("tests/fixtures/osm/roads-synthetic.osm.json");
    const name = "naga-roads-2026-10-16.osm.json";
    const fake = checkRoadsSnapshot(name, bytes, { [name]: createHash("sha256").update(bytes).digest("hex") });
    const refused = buildImportPlan(files, readNewestOsmSnapshot(), readNewestModesSeed(), fake);
    expect(refused.problems.join("\n")).toMatch(/synthetic snapshot is never imported/);
    expect(refused.lines!.traces).toEqual([]);
  });

  it("road outputs without the reviewed modes seed", () => {
    expect(buildImportPlan(files, null, null, roads).problems.join()).toMatch(/need the reviewed modes seed/);
  });

  it("a street alias the snapshot does not confirm", () => {
    const modes = { ...plan.modes!, streetAliases: [{ ...plan.modes!.streetAliases[0]!, osmWayIds: [1] }] };
    expect(buildLinesPlan({ ...inputOf(plan), modes }).problems.join()).toMatch(/street alias: .*way\/1 is not in the snapshot/);
  });

  it("a missing time-estimate parameter (abort)", () => {
    const modes = { ...plan.modes!, etaParams: plan.modes!.etaParams.filter((p) => p.key !== "peak_windows") };
    expect(buildLinesPlan({ ...inputOf(plan), modes }).problems).toEqual([
      "time-estimate parameter peak_windows is missing from naga-modes-seed-2026-10-16.json",
    ]);
  });

  it("a walk graph over budget (abort)", () => {
    const over = buildLinesPlan({ ...inputOf(plan), walkGraphBudget: { bytes: 1000, gzipBytes: 100 } });
    expect(over.problems.join("\n")).toMatch(/over the 1000 B budget[\s\S]*over the 100 B budget/);
  });

  it("a synthetic modes seed", () => {
    const modes = { ...plan.modes!, synthetic: true };
    expect(buildLinesPlan({ ...inputOf(plan), modes }).problems.join()).toMatch(/non-synthetic/);
  });
});
