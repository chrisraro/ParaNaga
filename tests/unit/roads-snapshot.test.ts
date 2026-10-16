import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importableRecords, parseModesSeed } from "@/domain/import/modes-seed";
import { verifyStreetAliases } from "@/domain/import/osm-roads";
import { checkRoadsSnapshot, readPinnedRoadsSnapshot, ROADS_SNAPSHOT_PINS } from "../../scripts/lib/roads-snapshot";

const synthetic = readFileSync("tests/fixtures/osm/roads-synthetic.osm.json");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("checkRoadsSnapshot (importer gate)", () => {
  it("refuses a file without a pin", () => {
    const r = checkRoadsSnapshot("naga-roads-2099-01-01.osm.json", synthetic, {});
    expect(r.roads).toBeNull();
    expect(r.problems.join()).toMatch(/no sha256 pin/);
  });

  it("refuses a file whose bytes do not match the pin", () => {
    const r = checkRoadsSnapshot("naga-roads-2099-01-01.osm.json", synthetic, { "naga-roads-2099-01-01.osm.json": "0".repeat(64) });
    expect(r.problems.join()).toMatch(/does not match its pin/);
    expect(r.roads).toBeNull();
  });

  it("refuses parse problems even when the pin matches", () => {
    const f = JSON.parse(synthetic.toString("utf8"));
    f.response.elements[0].user = "someone";
    const bytes = Buffer.from(JSON.stringify(f));
    const r = checkRoadsSnapshot("naga-roads-2099-01-01.osm.json", bytes, { "naga-roads-2099-01-01.osm.json": sha(bytes) });
    expect(r.roads).toBeNull();
    expect(r.problems.join()).toMatch(/contributor data/);
  });

  it("refuses a synthetic snapshot", () => {
    const r = checkRoadsSnapshot("naga-roads-2099-01-01.osm.json", synthetic, { "naga-roads-2099-01-01.osm.json": sha(synthetic) });
    expect(r.problems.join()).toMatch(/synthetic/);
  });

  it("the committed snapshot matches its pin and parses", () => {
    const r = readPinnedRoadsSnapshot()!;
    expect(r.problems).toEqual([]);
    expect(r.sha256).toBe(ROADS_SNAPSHOT_PINS[r.fileName]);
    expect(r.roads!.ways.length).toBeGreaterThan(1000);
  });

  it("every reviewed street alias of the real modes seed is evidenced in the pinned snapshot", () => {
    const r = readPinnedRoadsSnapshot()!;
    const seed = importableRecords(parseModesSeed(JSON.parse(readFileSync("data/source/research/naga-modes-seed-2026-10-16.json", "utf8"))));
    expect(seed.streetAliases.length).toBeGreaterThan(0);
    for (const a of seed.streetAliases) expect(a.evidence_snapshot).toBe(r.fileName);
    expect(verifyStreetAliases(seed.streetAliases, r.roads!)).toEqual([]);
  });
});
