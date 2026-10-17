import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { showMapLayers } from "./fixtures/layers";

// The home map starts bare: no route lines and no stop pins until the Layers sheet switches them on.

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
});

const mapEl = (page: Page) => page.getByTestId("naga-map");
const routeLines = (page: Page) => page.locator("path.pn-line--route");

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
}

test("the bare map draws no route lines or stop pins, and does not fetch the lines", async ({ page }) => {
  const lineRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/network/lines/")) lineRequests.push(r.url());
  });
  await openApp(page);
  await expect(mapEl(page)).toHaveAttribute("data-stop-pins", "0");
  await expect(routeLines(page)).toHaveCount(0);
  await expect(page.getByTestId("map-legend-button")).toHaveCount(0);
  expect(lineRequests).toEqual([]);
});

test("the Routes and Stops switches draw and remove the layers, keep the legend honest and announce the change", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Layers" }).click();
  const sheet = page.getByTestId("layers-sheet");
  const routes = sheet.getByRole("switch", { name: "Routes" });
  const stops = sheet.getByRole("switch", { name: "Stops" });
  await expect(routes).toHaveAttribute("aria-checked", "false");
  await expect(stops).toHaveAttribute("aria-checked", "false");
  for (const toggle of [routes, stops]) {
    // The whole row (label + switch) is the 60 px tap target: the label toggles too.
    const row = (await toggle.locator("xpath=..").boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(44);
  }
  await routes.click();
  await stops.click();
  await sheet.getByRole("button", { name: "Close map layers" }).click();

  await expect(routeLines(page).first()).toBeAttached({ timeout: 15000 });
  await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  await expect(page.getByText("Stops shown on the map")).toBeAttached();
  await page.getByTestId("map-legend-button").click();
  await expect(page.getByTestId("map-legend-panel")).toContainText("Mapped stop, not verified");
  await page.keyboard.press("Escape");

  // Off again: the lines and pins go, and with them the legend (nothing is drawn).
  await page.getByRole("button", { name: "Layers" }).click();
  await sheet.getByRole("switch", { name: "Routes" }).click();
  await sheet.getByRole("switch", { name: "Stops" }).click();
  await sheet.getByRole("button", { name: "Close map layers" }).click();
  await expect(routeLines(page)).toHaveCount(0);
  await expect(mapEl(page)).toHaveAttribute("data-stop-pins", "0");
  await expect(page.getByTestId("map-legend-button")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the Layers sheet with the new switches has no serious axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByTestId("layers-sheet")).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="layers-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
    await page.keyboard.press("Escape");
    await showMapLayers(page, "Routes", "Stops");
  });
}
