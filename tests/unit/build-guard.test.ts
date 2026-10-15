// The e2e-only worker switch can never reach a deployment build (Task 12 review R2).
import { describe, expect, it } from "vitest";
import { testOnlyEnvProblem } from "@/domain/pwa/build-guard";

describe("testOnlyEnvProblem", () => {
  it("refuses PARANAGA_E2E_SW_VARIANT in a Vercel (or other deployment) build", () => {
    for (const marker of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "NETLIFY", "CF_PAGES"]) {
      expect(testOnlyEnvProblem({ PARANAGA_E2E_SW_VARIANT: "1", [marker]: "1" }), marker).toMatch(/test-only/);
    }
    expect(testOnlyEnvProblem({ PARANAGA_E2E_SW_VARIANT: "1", VERCEL_ENV: "production" })).toContain("VERCEL_ENV");
  });

  it("allows it locally and in the e2e suite, and allows deployments without it", () => {
    expect(testOnlyEnvProblem({ PARANAGA_E2E_SW_VARIANT: "1", NEXT_DIST_DIR: ".next-e2e" })).toBeNull();
    expect(testOnlyEnvProblem({ VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
    expect(testOnlyEnvProblem({})).toBeNull();
  });
});
