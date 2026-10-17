// The e2e plan fixtures (tests/e2e/fixtures/plan-responses.ts) must be real plan responses of the
// Increment E schema and follow the planner's recommendation rules, so the specs exercise the real shape.
import { describe, expect, it } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import * as fixtures from "../e2e/fixtures/plan-responses";

const PLANS = Object.entries(fixtures).filter(([, v]) => typeof v === "object" && v !== null && "plan" in v) as [string, unknown][];

describe("e2e plan fixtures", () => {
  it("has the plans the specs use", () => {
    expect(PLANS.map(([name]) => name)).toEqual(expect.arrayContaining(["PROVISIONAL_PLAN", "ANYWHERE_DROP_OFF_PLAN", "NO_JEEPNEY_PLAN", "PADYAK_PLAN", "ROUTE_NOTES_PLAN"]));
  });

  for (const [name, plan] of PLANS) {
    it(`${name} parses as a plan response with exactly one Recommended option (or none without options)`, () => {
      const parsed = planResponseSchema.parse(plan);
      const recommended = parsed.plan.options.filter((o) => o.labels.includes("Recommended"));
      // A far plan (Increment F, ruling e) may have no Recommended option and carries a special-trip tricycle only at an end.
      expect(recommended).toHaveLength(parsed.plan.farNote ? Math.min(1, recommended.length) : parsed.plan.options.length > 0 ? 1 : 0);
      // Options come walk, jeepneys, tricycle, padyak.
      const order = parsed.plan.options.map((o) => ["walk", "jeepney", "tricycle", "padyak"].indexOf(o.mode));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      if (parsed.plan.options.length > 0 && !parsed.plan.farNote) expect(parsed.plan.options.some((o) => o.mode === "tricycle")).toBe(true);
    });
  }

  it("keeps the 500 m rule: no walk card at 500 m and above; the cheapest jeepney Recommended, the tricycle only without one", () => {
    for (const [, plan] of PLANS) {
      const parsed = planResponseSchema.parse(plan);
      const d = parsed.plan.directWalkEstimateMeters;
      if (parsed.plan.options.length === 0 || d === null || d < 500 || parsed.plan.farNote) continue;
      expect(parsed.plan.options.some((o) => o.mode === "walk")).toBe(false);
      const jeeps = parsed.plan.options.filter((o) => o.mode === "jeepney");
      if (jeeps.length > 0) {
        expect(jeeps[0]!.labels).toContain("Recommended");
        const fare = (o: (typeof jeeps)[number]) => o.fare.minCentavos ?? Infinity;
        expect(jeeps.every((o) => fare(o) >= fare(jeeps[0]!))).toBe(true);
        expect(parsed.plan.options.find((o) => o.mode === "tricycle")!.labels).not.toContain("Recommended");
      } else {
        expect(parsed.plan.options.find((o) => o.mode === "tricycle")!.labels).toContain("Recommended");
      }
    }
  });
});
