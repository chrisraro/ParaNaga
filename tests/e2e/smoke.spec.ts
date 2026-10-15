import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page loads with security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("home page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  // Axe reads computed colors; let entrance fades finish so it measures the settled page,
  // not text halfway through an opacity transition. Looping animations are transform-only.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
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
  for (const path of ["/account", "/admin"]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname).toBe("/");
  }
});
