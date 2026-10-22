import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page loads with security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  // Enforced since N8 (CSP_REPORT_ONLY=1 at build is the kill switch, docs/setup.md).
  const csp = headers["content-security-policy"] ?? "";
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "report-uri /api/csp-report", "report-to csp"]) {
    expect(csp).toContain(directive);
  }
  expect(csp).not.toContain("unsafe-eval");
  expect(headers["reporting-endpoints"]).toBe('csp="/api/csp-report"');
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("home page has no serious accessibility violations", async ({ page }) => {
  // Axe reads computed colors: measure the settled page (reduced motion: nothing mid-fade).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
});

test("public health endpoint discloses nothing but liveness", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers()["cache-control"]).toContain("no-store");

  const wrongToken = await request.get("/api/health", { headers: { authorization: "Bearer nope" } });
  expect(await wrongToken.json()).toEqual({ ok: true });
});

test("account and admin routes are not reachable signed out", async ({ page }) => {
  await page.goto("/account");
  expect(new URL(page.url()).pathname).toBe("/");
  // /admin answers a plain 404 to a signed-out visitor, never a redirect that confirms it exists (N5a, src/proxy.ts).
  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(404);
  expect(new URL(page.url()).pathname).toBe("/admin");
});
