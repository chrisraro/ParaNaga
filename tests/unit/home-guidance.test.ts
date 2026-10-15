// @vitest-environment jsdom
// Facts: new test file for src/ui/home/use-home-guidance.ts (Task 10 fix round 1, review Minor 2):
// a replan after a missed stop starts from the last guidance fix only when it is ≤ 10 s old and
// usable as a start inside Naga; otherwise the start is chosen on the map.
import { describe, expect, it } from "vitest";
import { REPLAN_FIX_MAX_AGE_MS, replanFix } from "@/ui/home/use-home-guidance";

const T = 1_000_000;
const inNaga = { lat: 13.6249, lng: 123.1871, accuracy: 10, timestamp: T };

describe("replanFix", () => {
  it("accepts a fix up to 10 s old, inside Naga and not coarse", () => {
    expect(REPLAN_FIX_MAX_AGE_MS).toBe(10_000);
    expect(replanFix(inNaga, T + 10_000)).toBe(inNaga);
  });
  it("refuses an older, missing, coarse or outside-Naga fix", () => {
    expect(replanFix(inNaga, T + 10_001)).toBeNull();
    expect(replanFix(null, T)).toBeNull();
    expect(replanFix({ ...inNaga, accuracy: 150 }, T)).toBeNull();
    expect(replanFix({ ...inNaga, lat: 14.6, lng: 121.0 }, T)).toBeNull();
  });
});
