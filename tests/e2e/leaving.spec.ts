import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";

// S24 Leaving Naga (IC1) over the synthetic intercity guide (fixtures/network/intercity.json, built
// from the draft seed) and the captured network responses. Tiles are aborted; every test checks
// for CSP (report-only) violations. The offline test allows the service worker and answers the API
// with context routes and production Cache-Control headers, as tests/e2e/offline.spec.ts does.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const PREFS_KEY = "paranaga.prefs";
const screen = (page: Page) => page.getByTestId("leaving-screen");
const card = (page: Page, code: string) => screen(page).locator(`[data-testid="leaving-card"][data-code="${code}"]`);

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP (report-only) violations").toEqual([]);
});

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="leaving-screen"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test.describe("online", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
    await page.route("**/api/v1/plan", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }));
    await routeNetwork(page);
    await watchCsp(page);
  });

  test("Explore → Leaving Naga → Legazpi → Get to Bicol Central Station opens the planner with To set", async ({ page }) => {
    await page.goto("/app/explore");
    await page.getByTestId("explore-leaving-link").click();
    await expect(page).toHaveURL(/\/app\/leaving$/);
    await expect(screen(page).getByRole("heading", { level: 1, name: "Leaving Naga" })).toBeFocused();
    await expect(screen(page).getByTestId("leaving-south-long-haul")).toHaveText("South Long Haul (Bicol Express): Planned project · not funded · no trains run");
    await expect(screen(page).getByTestId("leaving-airport-row")).toContainText("Flights to Clark");

    // The filter runs on the phone: no request (a link prefetch either) carries what was typed.
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await screen(page).getByTestId("leaving-search").fill("leg");
    await expect(screen(page).getByTestId("leaving-destination")).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => /leg/i.test(u.replace(/leaving/g, "")))).toEqual([]);
    await screen(page).getByRole("link", { name: /^Legazpi/ }).click();
    await expect(page).toHaveURL(/\/app\/leaving\?to=D-LEGAZPI$/);
    await expect(screen(page).getByRole("heading", { level: 1, name: "Legazpi" })).toBeFocused();

    // AC-IC2: PNR under Not running, suspended, with no fare and no departures.
    const pnr = screen(page).getByTestId("leaving-not-running").locator('[data-code="RS09"]');
    await expect(pnr.getByTestId("leaving-status")).toContainText("Suspended since 10 Nov 2025");
    await expect(pnr.getByTestId("leaving-fares")).toHaveCount(0);
    await expect(pnr.getByTestId("leaving-departures")).toHaveCount(0);
    // AC-IC1: no Get to from the Eastbound Terminal (address only).
    await expect(card(page, "RS21").getByTestId("leaving-get-to")).toHaveCount(0);
    await expect(card(page, "RS21")).toContainText("Location being confirmed");

    await card(page, "RS10").getByRole("button", { name: "Get to Bicol Central Station" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("endpoint-destination").locator(".pn-endpoint__main")).toContainText(
      "Bicol Central Station (map point, entrance not mapped)",
    );
  });

  test("Search with regional connections finds a destination and opens it; a card's Sources link filters the register", async ({ page }) => {
    await page.goto("/app/search");
    await page.getByTestId("search-regional").click();
    await page.getByRole("searchbox").fill("Clark");
    await page.getByTestId("search-result-intercity").first().click();
    await expect(page).toHaveURL(/\/app\/leaving\?to=D-CLARK$/);
    const flight = card(page, "RS24");
    await expect(flight.getByTestId("leaving-get-to")).toHaveCount(0);
    await expect(flight.getByTestId("leaving-fare-not-found")).toHaveText("Fare not found. Ask at the terminal before you board.");

    await flight.getByRole("link", { name: "Sources for Cebgo Naga–Clark (DG6129/6130)" }).click();
    await expect(page).toHaveURL(/\/app\/help\/sources\?service=RS24$/);
    const filtered = page.getByTestId("sources-service");
    await expect(filtered.getByRole("heading", { level: 2 })).toHaveText("Showing sources for Cebgo Naga–Clark (DG6129/6130)");
    // The captured register predates IC1: none of RS24's sources is in it yet.
    await expect(filtered.getByTestId("sources-service-none")).toBeVisible();
    await filtered.getByRole("link", { name: "Show all sources" }).click();
    await expect(page).toHaveURL(/\/app\/help\/sources$/);
    await expect(page.getByTestId("sources-service")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`list and detail pass axe: ${scheme}`, async ({ page }) => {
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [PREFS_KEY, JSON.stringify({ theme: scheme })] as const);
      await page.goto("/app/leaving");
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await expect(screen(page).getByTestId("leaving-list")).toBeVisible();
      await expectAxeClean(page);

      await page.goto("/app/leaving?to=D-LEGAZPI");
      await expect(screen(page).getByTestId("leaving-not-running")).toBeVisible();
      await card(page, "RS10").getByTestId("leaving-estimate").locator("summary").click();
      await expectAxeClean(page);

      await page.goto("/app/leaving?to=D-CUBAO");
      await expect(card(page, "RS16").getByTestId("leaving-fare").first()).toBeVisible();
      await expectAxeClean(page);
    });
  }
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });

  /** Offline for the page and the worker; records API requests that still tried the network. */
  let attempted: string[] = [];
  async function goOffline(context: BrowserContext) {
    await context.setOffline(true);
    await context.route(/\/api\//, (route: Route) => {
      attempted.push(new URL(route.request().url()).pathname);
      return route.abort("internetdisconnected");
    });
  }

  test.beforeEach(async ({ context, page }) => {
    test.slow(); // installs a worker
    attempted = [];
    await context.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
    await context.route("**/api/v1/plan", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(PROVISIONAL_PLAN) }));
    await routeNetwork(context, { realCacheHeaders: true });
    await watchCsp(page);
  });

  test("after one visit, the list and a destination open offline from the worker's copies (AC-IC8)", async ({ page, context }) => {
    // First visit: the worker installs (the /app/leaving shell among them) and takes control.
    await page.goto("/app");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    // One visit to Leaving Naga stores the guide (CacheFirst) and the head (NetworkFirst).
    await page.goto("/app/leaving");
    await expect(screen(page).getByTestId("leaving-list")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          for (const name of await caches.keys()) {
            const keys = await (await caches.open(name)).keys();
            if (keys.some((r) => r.url.includes("/api/v1/network/intercity/"))) return true;
          }
          return false;
        }),
      )
      .toBe(true);

    await goOffline(context);
    await page.goto("/app/leaving?to=D-LEGAZPI");
    await expect(screen(page).getByRole("heading", { level: 1, name: "Legazpi" })).toBeVisible();
    await expect(screen(page).getByTestId("leaving-not-running")).toContainText("Suspended since 10 Nov 2025");
    await expect(card(page, "RS10").getByTestId("leaving-departure")).toHaveText("Dispatch every 15 min · terminal rule, Apr 2024");
    // The guide never went to the network once offline (the head may try, then falls back to its copy).
    expect(attempted.filter((p) => p.includes("/network/intercity/"))).toEqual([]);

    await page.goto("/app/leaving");
    await expect(screen(page).getByTestId("leaving-list")).toBeVisible();
    await expect(screen(page).getByTestId("leaving-south-long-haul")).toBeVisible();
  });
});
