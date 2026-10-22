// Spec 7.3: synthetic fixtures can never be published.
import { describe, expect, it } from "vitest";
import { canPublish, publicationBlockers } from "@/domain/network/publication";
import { FIXTURE_LOOP_X, REAL_ROW, synthetic, TEST_BBOX } from "../fixtures/synthetic/fixture-loop-x";

describe("publication guard", () => {
  it("the fixture is obviously fake: named Fixture Loop X, flagged synthetic, inside the offset test bbox", () => {
    expect(synthetic).toBe(true);
    expect(FIXTURE_LOOP_X).toMatchObject({ name: "Fixture Loop X", isSynthetic: true });
    for (const s of FIXTURE_LOOP_X.stops) {
      expect(s.isSynthetic).toBe(true);
      expect(s.lat).toBeGreaterThanOrEqual(TEST_BBOX.south);
      expect(s.lat).toBeLessThanOrEqual(TEST_BBOX.north);
      expect(s.lng).toBeGreaterThanOrEqual(TEST_BBOX.west);
      expect(s.lng).toBeLessThanOrEqual(TEST_BBOX.east);
    }
    expect(TEST_BBOX.south).toBeLessThan(13); // nowhere near Naga City (13.6 N)
  });

  it("refuses a revision that holds any synthetic row, and names each one", () => {
    const rows = [REAL_ROW, FIXTURE_LOOP_X, ...FIXTURE_LOOP_X.stops];
    expect(canPublish(rows)).toBe(false);
    expect(publicationBlockers(rows)).toEqual([
      { kind: "route", code: "FIXTURE-X", reason: "synthetic" },
      { kind: "stop", code: "FX-1", reason: "synthetic" },
      { kind: "stop", code: "FX-2", reason: "synthetic" },
    ]);
  });

  it("a single synthetic row among real ones is enough to block", () => {
    expect(canPublish([REAL_ROW, FIXTURE_LOOP_X.stops[0]])).toBe(false);
  });

  it("allows real rows only", () => {
    expect(canPublish([REAL_ROW])).toBe(true);
    expect(publicationBlockers([])).toEqual([]);
  });
});
