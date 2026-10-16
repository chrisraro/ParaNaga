import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
});

const mapEl = (page: Page) => page.getByTestId("naga-map");

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

async function drag(page: Page, dx: number, dy: number) {
  const box = await mapEl(page).boundingBox();
  if (!box) throw new Error("map has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function pinBoth(page: Page) {
  const chooseOnMap = page.getByRole("button", { name: "Choose on map", exact: true });
  await chooseOnMap.click();
  await page.getByRole("button", { name: "Set start here" }).click();
  await chooseOnMap.click();
  await drag(page, -120, 80);
  await page.getByRole("button", { name: "Set destination here" }).click();
}

test("trip lines draw walk (dotted) and ride (solid) layers with chevrons and legend", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );

  await openApp(page);
  await pinBoth(page);

  await page.getByTestId("trip-option").first().click();

  // Verify trip lines rendered on the map
  const walkLines = page.locator("path.pn-line--walk");
  await expect(walkLines.first()).toBeAttached();
  await expect(walkLines.first()).toHaveAttribute("stroke-dasharray", /.+/);

  const rideLines = page.locator("path.pn-line--ride");
  await expect(rideLines.first()).toBeAttached();

  // Direction chevrons
  const chevrons = page.locator(".pn-chevron-icon");
  await expect(chevrons.first()).toBeAttached();

  // Map legend lists Walk and vehicle class
  await page.getByRole("button", { name: "Collapse sheet" }).click();
  const legend = page.getByTestId("map-legend");
  await expect(legend).toBeVisible();
  await page.getByTestId("map-legend-button").click();
  await expect(legend).toContainText("Walk");
  await expect(legend).toContainText("Traditional jeepney");

  // Trip detail shows approximate path label
  const detail = page.getByTestId("trip-detail");
  await expect(detail).toContainText("Approximate path, not a verified route shape");

  // Accessibility check on trip map with lines
  const a11y = await new AxeBuilder({ page })
    .include('[data-testid="trip-sheet"]')
    .include('[data-testid="map-legend"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
});

test("route overview lines draw on home map, filter by mode and historical toggle in Layers sheet", async ({ page }) => {
  await openApp(page);

  // Overview lines are drawn when no trip is active
  const overviewLines = page.locator("path.pn-line--route");
  await expect(overviewLines.first()).toBeAttached({ timeout: 15000 });

  // Open the Layers sheet from the map controls button
  const layersBtn = page.getByRole("button", { name: "Layers" });
  await expect(layersBtn).toBeVisible();
  await layersBtn.click();

  const sheet = page.getByTestId("layers-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Map layers" })).toBeVisible();

  // Routes list visible in the sheet
  const routesList = page.getByTestId("layers-routes-list");
  await expect(routesList).toBeVisible();
  await expect(routesList).toContainText("Centro–San Isidro");

  // Multi-select mode filter: filter to Jeepney
  const jeepneyFilter = page.getByTestId("mode-filter-jeepney");
  await jeepneyFilter.click();
  await expect(routesList).toContainText("Centro–San Isidro");

  // Filter to Tricycle - shows terminals for tricycle
  const trikeFilter = page.getByTestId("mode-filter-tricycle");
  await trikeFilter.click();
  const terminalsList = page.getByTestId("layers-terminals-list");
  await expect(terminalsList).toContainText("Balatas Tricycle Terminal");

  // Toggle "Show historical routes"
  const histSwitch = page.getByTestId("layer-switch-historical");
  await expect(histSwitch).toHaveAttribute("aria-checked", "false");
  await histSwitch.click();
  await expect(histSwitch).toHaveAttribute("aria-checked", "true");

  // Axe check on the layers sheet
  const a11y = await new AxeBuilder({ page })
    .include('[data-testid="layers-sheet"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);

  // Close sheet
  await page.getByRole("button", { name: "Close map layers" }).click();
  await expect(sheet).toHaveCount(0);
});

test("tapping an overview line opens SelectedRouteCard with route details link", async ({ page }) => {
  await openApp(page);

  // Tap an overview line to select it
  const overviewLine = page.locator("path.pn-line--route").first();
  await expect(overviewLine).toBeAttached({ timeout: 15000 });
  await overviewLine.click({ force: true });

  const card = page.getByTestId("selected-route-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Approximate path, not a verified route shape");

  const routeDetailsLink = card.getByRole("link", { name: "Route details" });
  await expect(routeDetailsLink).toBeVisible();
  await routeDetailsLink.click();
  await expect(page).toHaveURL(/\/app\/routes\/.+$/);
});
