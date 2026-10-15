import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodMessage } from "@/domain/import/zod-message";

describe("zodMessage", () => {
  it("names the place, the path of the first issue and its message", () => {
    const r = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: "x" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(zodMessage("Seed", r.error)).toMatch(/^Seed: invalid at a\.b: /);
  });

  it("says root when the issue has no path", () => {
    const r = z.number().safeParse("x");
    if (!r.success) expect(zodMessage("GeoJSON", r.error)).toMatch(/^GeoJSON: invalid at root: /);
  });
});
