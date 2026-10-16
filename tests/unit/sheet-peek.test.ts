import { describe, expect, it } from "vitest";
import { HALF_VISIBLE, PEEK_OPTIONS_VISIBLE, PEEK_VISIBLE, offsetFor } from "@/ui/home/endpoint-sheet";

describe("offsetFor with a taller peek (options listed)", () => {
  it("defaults to the 214 px peek and keeps half and full", () => {
    expect(offsetFor(0, 800)).toBe(800 - PEEK_VISIBLE);
    expect(offsetFor(1, 800)).toBe(800 - HALF_VISIBLE);
    expect(offsetFor(2, 800)).toBe(0);
  });
  it("shows the options peek height (plus the tab bar) at snap 0 only", () => {
    expect(offsetFor(0, 800, 90, PEEK_OPTIONS_VISIBLE)).toBe(800 - PEEK_OPTIONS_VISIBLE - 90);
    expect(offsetFor(1, 800, 90, PEEK_OPTIONS_VISIBLE)).toBe(800 - HALF_VISIBLE);
    expect(offsetFor(2, 800, 90, PEEK_OPTIONS_VISIBLE)).toBe(0);
  });
  it("peek leaves room for the rows, the summary and a 44 px toggle", () => {
    expect(PEEK_OPTIONS_VISIBLE).toBeGreaterThanOrEqual(PEEK_VISIBLE + 44);
    expect(PEEK_OPTIONS_VISIBLE).toBeLessThan(HALF_VISIBLE);
  });
});
