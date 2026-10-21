import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { chooseOnMapVia, chooseOption, panMap } from "./fixtures/options";

// The owner's field test (2026-10-22): the installed app, used online once, then opened in
// airplane mode. The whole core flow must work by taps alone, with no page.goto after going
// offline: Search → a destination by text → the start from a map pin → trip options → trip detail
// → Start trip → Saved. Production build, service worker ALLOWED (the suite blocks it), API
// answered by context routes with the production Cache-Control headers (see offline.spec.ts).

test.use({ serviceWorkers: "allow" });
test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search places, stops and routes" });

test.beforeEach(async ({ context }) => {
  test.slow();
  await context.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await context.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await routeNetwork(context, { realCacheHeaders: true });
});

/** The first online visit: the worker installs, takes control and stores the data the planner needs. */
async function firstVisit(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).some((n) => n.startsWith("pn-search-index-"))), { timeout: 20_000 })
    .toBe(true);
  // The router's prefetches of this first visit ran before the worker controlled the page: the
  // worker stored the core shells' segment prefetches itself, at install.
  await expect(rscKeys(page)).resolves.toEqual(
    expect.arrayContaining(["/app?segment=%2F_tree", "/app?segment=%2Fapp%2F__PAGE__", "/app/search?segment=%2Fapp%2Fsearch%2F__PAGE__", "/app/saved?segment=%2F_tree"]),
  );
}

/** The shells' segment prefetches the worker stored (path + query of each key). */
async function rscKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const name = (await caches.keys()).find((n) => n.startsWith("pn-rsc-"));
    if (!name) return [];
    return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  });
}

/** Airplane mode for the page and the worker: every API request fails like a dropped connection. */
async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
  await context.route(/\/api\//, (route) => route.abort("internetdisconnected"));
}

/** Search → destination by text → start by map pin → options → detail → Start → End → Saved. */
async function coreFlow(page: Page) {
  await page.getByTestId("home-search").click();
  await expect(page).toHaveURL(/\/app\/search/);
  await searchBox(page).fill("Notice Board");
  await page.getByTestId("search-result-osm").filter({ hasText: "Synthetic Notice Board" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("endpoint-destination")).toContainText("Synthetic Notice Board");

  await chooseOnMapVia(page, "start");
  const setStart = page.getByRole("button", { name: "Set start here" });
  await expect(setStart).toBeVisible();
  // The map may still be flying to the destination: pan once it rests, until the pin is clear of it.
  await expect(async () => {
    await panMap(page, 160, -120);
    await expect(setStart).not.toHaveAttribute("aria-disabled", "true", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await setStart.click();
  await expect(page.getByTestId("trip-option").first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("options-peek-note")).toContainText("Offline plan");

  await chooseOption(page);
  const detail = page.getByTestId("trip-detail");
  await expect(detail).toBeVisible();
  await detail.getByTestId("trip-save").click();
  await expect(detail.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");

  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await page.getByRole("button", { name: "End guidance" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End guidance" }).click();
  await expect(page.getByTestId("guidance")).toHaveCount(0);

  // Back to the bare map, then the Saved tab lists the trip saved offline.
  for (let i = 0; i < 3 && !(await page.getByTestId("tab-saved").isVisible()); i++) await page.keyboard.press("Escape");
  await page.getByTestId("tab-saved").click();
  await expect(page).toHaveURL(/\/app\/saved/);
  await expect(page.getByTestId("saved-trip").first()).toBeVisible();
  // And reopens it on the map.
  await page.getByTestId("saved-trip").first().getByRole("button", { name: "Open trip" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
}

test("airplane mode, cold start: the whole core flow works by taps", async ({ page, context }) => {
  await firstVisit(page);
  await goOffline(context);
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await coreFlow(page);
});

test("connection drops while the app is open: the whole core flow still works by taps", async ({ page, context }) => {
  await firstVisit(page);
  await goOffline(context);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await coreFlow(page);
});
