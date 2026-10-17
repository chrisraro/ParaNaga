import { expect, test, type Page, type Route } from "@playwright/test";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";
import { chooseOption, pinTrip, sheetSettled } from "./fixtures/options";

// Home redesign T2: the tab bar belongs to the map alone; Escape and the browser Back button step
// out of guidance, detail and directions one state at a time (the on-screen Back / End / Clear trip
// buttons are the fallback and stay covered by trip.spec and guidance.spec).

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const sheet = (page: Page) => page.getByTestId("trip-sheet");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/plan", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
});

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
}

async function pinBoth(page: Page) {
  await pinTrip(page);
  await expect(page.getByTestId("options-best")).toBeVisible();
}

test("tab bar: shown on the map, hidden while planning and in detail, back with the map; results open at peek", async ({ page }) => {
  await openApp(page);
  await expect(tabBar(page)).toBeVisible();
  await pinBoth(page);
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  await expect(tabBar(page)).toBeHidden();
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await expect(tabBar(page)).toBeHidden();
  await page.getByTestId("trip-detail").getByRole("button", { name: /back/i }).first().click();
  await expect(page.getByTestId("trip-detail")).toHaveCount(0);
  await expect(tabBar(page)).toBeHidden();
  await page.getByRole("button", { name: "Clear trip" }).click();
  await expect(tabBar(page)).toBeVisible();
});

test("Escape steps out: detail, then directions (clears the trip and brings the tab bar back)", async ({ page }) => {
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("trip-detail")).toHaveCount(0);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  await expect(tabBar(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("trip-sheet")).toHaveCount(0);
  await expect(page.getByTestId("options-best")).toHaveCount(0);
  await expect(tabBar(page)).toBeVisible();
  await expect(page.getByTestId("home-search")).toBeFocused();
});

test("browser Back steps out one state at a time and stays on /app", async ({ page }) => {
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("trip-detail")).toHaveCount(0);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app");

  await page.goBack();
  await expect(page.getByTestId("options-best")).toHaveCount(0);
  await expect(tabBar(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app");
});

test("the on-screen Back keeps history in step: one browser Back then leaves nothing stale", async ({ page }) => {
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
  await page.getByTestId("trip-detail").getByRole("button", { name: /back/i }).first().click();
  await expect(page.getByTestId("trip-detail")).toHaveCount(0);
  await sheetSettled(page);
  // Detail was closed on screen: the next browser Back clears the trip (not a no-op step).
  await page.goBack();
  await expect(page.getByTestId("options-best")).toHaveCount(0);
  await expect(tabBar(page)).toBeVisible();
});
