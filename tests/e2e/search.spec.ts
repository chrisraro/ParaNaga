import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { SEARCH_INDEX, STOP_A1, routeNetwork } from "./fixtures/network";

// Search (Increment A, Task 5): the search screen over the captured search index, setting trip
// ends from it through the endpoint channel, and the HomeScreen side of that channel (row label,
// the announcement released once the map shows again, the recentre). Tiles are aborted, the
// network API is answered from captured fixtures, POST /api/v1/plan from a fixture. Every test
// checks for CSP (report-only) violations, and that no request ever carries the query.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("naga-map");
const rowMain = (page: Page, which: "start" | "destination") => page.getByTestId(`endpoint-${which}`).locator(".pn-endpoint__main");
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search places, stops and routes" });
const SM = SEARCH_INDEX.osmPlaces.find((p) => p.name === "SM City Naga")!;

type Seen = { urls: string[]; plans: unknown[] };

test.beforeEach(async ({ page }, testInfo) => {
  const seen: Seen = { urls: [], plans: [] };
  (testInfo as unknown as { seen: Seen }).seen = seen;
  page.on("request", (r) => seen.urls.push(r.url()));
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) => {
    seen.plans.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) });
  });
  await routeNetwork(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP (report-only) violations").toEqual([]);
  // Search runs in the browser: no request URL (or query string) ever carries what was typed.
  const seen = (testInfo as unknown as { seen?: Seen }).seen;
  if (!seen) return; // skipped (desktop): beforeEach did not run
  const { urls } = seen;
  for (const typed of ["plaza", "rizal", "diversion", "sm%20city", "sm+city", "r8a", "iriga"]) {
    expect(urls.filter((u) => u.toLowerCase().includes(typed)), `a request carried "${typed}"`).toEqual([]);
  }
});

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

async function readCenter(page: Page) {
  return {
    lat: Number(await mapEl(page).getAttribute("data-center-lat")),
    lng: Number(await mapEl(page).getAttribute("data-center-lng")),
  };
}

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="search-screen"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test("search sets the start and the destination; the map announces, recentres and plans", async ({ page }, testInfo) => {
  const { plans } = (testInfo as unknown as { seen: Seen }).seen;
  await openApp(page);

  // Start: the endpoint sheet's new option opens Search for the start.
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await expect(page).toHaveURL(/\/app\/search\?for=start$/);
  await expect(searchBox(page)).toBeFocused();
  await searchBox(page).fill("plaza rizal");
  const places = page.getByTestId("search-group-places");
  await places.getByRole("button", { name: /^Plaza Rizal Mapped stop/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "start")).toContainText("Plaza Rizal (mapped pin)");
  await expect(page.getByTestId("home-announcer")).toHaveText("Start set: Plaza Rizal (mapped pin)");
  expect(plans).toHaveLength(0);

  // Destination: the sheet now offers the destination row's options.
  const before = await readCenter(page);
  expect(Math.abs(before.lng - SM.lng)).toBeGreaterThan(0.004);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await expect(page).toHaveURL(/\/app\/search\?for=destination$/);
  // Each opening starts fresh (the start's query is gone).
  await expect(searchBox(page)).toHaveValue("");
  await expect(searchBox(page)).toBeFocused();
  await searchBox(page).fill("SM City");
  await expect(page.getByTestId("search-announcer")).toHaveText(/^\d+ results?$/);
  await page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Focus returns to the row that was set, and the home screen did not scroll.
  await expect(rowMain(page, "destination")).toBeFocused();
  expect(await page.evaluate(() => document.querySelector(".pn-home")?.scrollTop ?? 0)).toBe(0);
  // The HomeScreen consumer of requestEndpoint: row label. With both ends set the map no longer
  // flies to (zooms in on) the destination; it fits the route instead.
  await expect(rowMain(page, "destination")).toContainText("SM City Naga");
  await expect(page.getByText(/Map centered on SM City/)).toHaveCount(0);
  await expect.poll(() => plans.length).toBe(1);
  await expect.poll(() => plans.length).toBe(1);
  expect(plans[0]).toMatchObject({
    origin: { lat: STOP_A1.stop.lat, lng: STOP_A1.stop.lng },
    destination: { lat: SM.lat, lng: SM.lng },
  });
});

test("the destination announcement waits for the map and then says what was set", async ({ page }) => {
  await openApp(page);
  await rowMain(page, "destination").click();
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await searchBox(page).fill("SM City");
  await page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "destination")).toContainText("SM City Naga");
  // Only the destination is set: no plan, so the announcement is the endpoint's own.
  await expect(page.getByTestId("home-announcer")).toHaveText("Destination set: SM City Naga");
});

test('"Diversion": the corner first, old names footnoted, OSM attributed; a route opens route detail', async ({ page }) => {
  await page.goto("/app/search");
  await expect(searchBox(page)).toBeFocused();
  await searchBox(page).fill("Diversion");
  const places = page.getByTestId("search-group-places");
  await expect(places.locator("li").first()).toContainText("Cor. Diversion Rd. & Fraternidad St.");
  await expect(page.getByTestId("search-legacy-note")).toHaveText("Old route names are historical hints, not current routes.");
  await expect(page.getByTestId("search-group-legacy")).toContainText("Historical name (1993) · not matched to a current route · S28");
  await expect(page.getByTestId("search-osm-attribution")).toHaveCount(0); // the credit is on Sources and credits
  await expect(page.getByTestId("search-group-routes")).toHaveCount(0);

  await searchBox(page).fill("r8a");
  await page.getByTestId("search-result-route").first().click();
  await expect(page).toHaveURL(/\/app\/routes\/R8-A$/);
  await expect(page.getByRole("heading", { level: 1, name: "Centro–Magsaysay Loop A" })).toBeVisible();
});

test("no match, regional connections, and a barangay opens its place detail", async ({ page }) => {
  await page.goto("/app/search?for=start");
  await searchBox(page).fill("xyz");
  await expect(page.getByTestId("search-empty")).toHaveText("No match. Try a place, stop, street or route.");
  await searchBox(page).fill("Iriga");
  await expect(page.getByTestId("search-empty")).toBeVisible();
  await page.getByRole("switch", { name: "Include regional connections" }).click();
  await expect(page.getByTestId("search-group-regional")).toContainText("Eastbound destinations from Eastbound Terminal · services not verified");

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(searchBox(page)).toHaveValue("");
  await expect(searchBox(page)).toBeFocused();
  await searchBox(page).fill("Abella");
  await page.getByTestId("search-result-barangay").click();
  await expect(page).toHaveURL(/\/app\/places\/barangay\/abella$/);
  await expect(page.getByTestId("place-detail").getByRole("heading", { level: 1, name: "Abella" })).toBeFocused();
});

test("for=save: a place opens the name dialog, whose Cancel returns focus to its row", async ({ page }) => {
  await page.goto("/app/search?for=save");
  await searchBox(page).fill("SM City");
  await page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" }).click();
  const dialog = page.getByTestId("search-save-dialog");
  await expect(dialog.getByRole("heading", { name: "Save place" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("SM City Naga");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" })).toBeFocused();
});

test("a search pick within 25 m of the other trip end is refused with the same-place notice", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await searchBox(page).fill("plaza rizal");
  await page.getByTestId("search-group-places").getByRole("button", { name: /^Plaza Rizal Mapped stop/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "start")).toContainText("Plaza Rizal (mapped pin)");
  // The destination search picks the same pin: refused, with the notice, and nothing is set.
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await expect(page).toHaveURL(/\/app\/search\?for=destination$/);
  await searchBox(page).fill("plaza rizal");
  await page.getByTestId("search-group-places").getByRole("button", { name: /^Plaza Rizal Mapped stop/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("same-place-notice")).toContainText("Start and destination are the same place");
  await expect(rowMain(page, "destination")).not.toContainText("Plaza Rizal");
});

test('"Show all" moves focus to the first row it revealed', async ({ page }) => {
  await page.goto("/app/search");
  await searchBox(page).fill("Centro");
  const routes = page.getByTestId("search-group-routes");
  await expect(routes.locator("li")).toHaveCount(5);
  await routes.getByRole("button", { name: "Show all 12" }).click();
  await expect(routes.locator("li")).toHaveCount(12);
  await expect(routes.locator("li").nth(5).locator("a")).toBeFocused();
});

test("reopening Search starts fresh: query and regional switch reset", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await searchBox(page).fill("Iriga");
  await page.getByRole("switch", { name: "Include regional connections" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await expect(searchBox(page)).toHaveValue("");
  await expect(searchBox(page)).toBeFocused();
  await expect(page.getByRole("switch", { name: "Include regional connections" })).toHaveAttribute("aria-checked", "false");
});

test("Cancel and Escape go back to the map", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await expect(page).toHaveURL(/\/app\/search/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app$/);
});

test("Choose on map from search opens the crosshair for that end", async ({ page }) => {
  await openApp(page);
  await rowMain(page, "destination").click();
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await page.getByTestId("search-screen").getByRole("button", { name: "Choose on map" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: "Set destination here" })).toBeFocused();
});

test.describe("with location permission", () => {
  test.use({ permissions: ["geolocation"], geolocation: { latitude: 13.6314651, longitude: 123.1927517, accuracy: 15 } });

  test("Use current location from search sets the start by GPS", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Search places and stops" }).click();
    await page.getByTestId("search-screen").getByRole("button", { name: "Use current location" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(rowMain(page, "start")).toContainText("Your location");
  });
});

test("from Explore (browsing): a place opens place detail, whose Plan trip from sets the start", async ({ page }) => {
  await openApp(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore", exact: true }).click();
  await page.getByTestId("explore-search").click();
  await expect(page).toHaveURL(/\/app\/search$/);
  await expect(page.getByTestId("search-screen").getByRole("button", { name: "Choose on map" })).toHaveCount(0);
  await searchBox(page).fill("SM City");
  await page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app\/places\/osm\/(node|way|relation)\/\d+$/);
  const detail = page.getByTestId("place-detail");
  await expect(detail.getByTestId("place-entrance")).toContainText("Not mapped. Trips end at the map point.");
  await detail.getByRole("radio", { name: "Directions from here" }).click();
  await detail.getByRole("button", { name: "Plan trip from SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "start")).toContainText("SM City Naga");
});

test("stop detail: Set as destination uses the pin and returns to the map", async ({ page }) => {
  await openApp(page);
  await page.goto(`/app/stops/${STOP_A1.stop.id}`);
  await expect(page.getByText("Trips from mapped pins are unverified.")).toBeVisible();
  await page.getByRole("button", { name: "Set as destination" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "destination")).toContainText("Plaza Rizal (A1)");
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`Search has no serious or critical violations (${colorScheme})`, async ({ page }) => {
      await page.goto("/app/search?for=destination");
      await expectAxeClean(page);
      await searchBox(page).fill("Diversion");
      await expect(page.getByTestId("search-group-places")).toBeVisible();
      await page.getByRole("switch", { name: "Include regional connections" }).click();
      await expectAxeClean(page);
      await searchBox(page).fill("Centro");
      await page.getByRole("button", { name: /^Show all/ }).first().click();
      await expectAxeClean(page);
      await page.goto("/app/search?for=save");
      await searchBox(page).fill("SM City");
      await page.getByTestId("search-result-osm").first().click();
      await expect(page.getByTestId("search-save-dialog")).toBeVisible();
      await expectAxeClean(page);
    });
  });
}
