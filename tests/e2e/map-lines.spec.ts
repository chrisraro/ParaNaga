import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LINES, routeNetwork } from "./fixtures/network";
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
  // Tapping an option scrolls it into reach: the sheet goes to full only when the card was cut off,
  // which depends on its height at that moment. Whatever the snap, tap the grabber until it peeks.
  const grabber = page.getByRole("button", { name: /^(Expand sheet to (half|full)|Collapse sheet)$/ });
  const sheetSnap = () => page.locator("[data-snap]").first().getAttribute("data-snap");
  for (let taps = 0; taps < 3 && (await sheetSnap()) !== "0"; taps++) await grabber.click();
  expect(await sheetSnap()).toBe("0");
  const legend = page.getByTestId("map-legend");
  await expect(legend).toBeVisible();
  await page.getByTestId("map-legend-button").click();
  await expect(legend).toContainText("Walk");
  await expect(legend).toContainText("Traditional jeepney");

  // Trip detail shows approximate path label
  const detail = page.getByTestId("trip-detail");
  await expect(detail).toContainText("Approximate path, not a verified route shape");
  // The recommended Loop A ride (0 -> 1240 m) uses no terminal access road or one-way conflict.
  await expect(page.getByTestId("ride-terminal-access")).toHaveCount(0);
  await expect(page.getByTestId("ride-oneway-caution")).toHaveCount(0);

  // Accessibility check on trip map with lines
  const a11y = await new AxeBuilder({ page })
    .include('[data-testid="trip-sheet"]')
    .include('[data-testid="map-legend"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
});

// The published lines have no traced tricycle route (both feeders are untraced): this variation
// adds one, drawn on R5's inbound path, so the Tricycle filter has a TRI-* line to keep.
const TRACED_TRICYCLE = (() => {
  const base = LINES.lines.find((l) => l.routeCode === "R5" && l.direction === "inbound")!;
  return {
    ...base,
    variantId: "33333333-3333-4333-8333-333333333333",
    routeId: "44444444-4444-4444-8444-444444444444",
    routeCode: "TRI-TEST",
    routeName: "Test tricycle feeder",
    variantName: "Test branch",
    mode: "tricycle",
    direction: "branch",
    colourKey: "tricycle",
    fleet: { label: "Tricycles", chip: "Tricycle", colourKey: "tricycle", classes: [] },
    segments: [],
  };
})();

async function routeLinesWithTricycle(page: Page) {
  const body = JSON.stringify({ ...LINES, lines: [...LINES.lines, TRACED_TRICYCLE] });
  await page.route(/\/api\/v1\/network\/lines\/[^/?]+$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

async function openLayers(page: Page) {
  await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
  const layersBtn = page.getByRole("button", { name: "Layers" });
  await expect(layersBtn).toBeVisible();
  await layersBtn.click();
  const sheet = page.getByTestId("layers-sheet");
  await expect(sheet).toBeVisible();
  return { layersBtn, sheet };
}

test("the Layers button still opens the sheet, with an honest line, when route lines are not loaded (404)", async ({ page }) => {
  await page.route(/\/api\/v1\/network\/lines\/[^/?]+$/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await openApp(page);
  const layersBtn = page.getByRole("button", { name: "Layers" });
  await expect(layersBtn).toBeVisible();
  await layersBtn.click();
  await expect(page.getByTestId("layers-sheet")).toBeVisible();
  await expect(page.getByTestId("layers-lines-not-loaded")).toHaveText("Route lines aren't loaded on this device.");
});

test("route overview lines draw on the home map and the Tricycle filter leaves only TRI-* lines", async ({ page }) => {
  await routeLinesWithTricycle(page);
  await openApp(page);
  const { sheet } = await openLayers(page);
  await expect(sheet.getByRole("heading", { name: "Map layers" })).toBeVisible();
  // D16's historical switch is gone (no historical route is published).
  await expect(sheet.getByRole("switch")).toHaveCount(2);
  await expect(sheet.getByText(/historical/i)).toHaveCount(0);

  const routesList = page.getByTestId("layers-routes-list");
  await expect(routesList).toContainText("Centro–San Isidro");

  await page.getByTestId("mode-filter-tricycle").click();
  await expect(routesList.getByRole("link")).toHaveCount(1);
  await expect(routesList).toContainText("Test tricycle feeder");
  await expect(page.getByTestId("layers-terminals-list")).toContainText("Balatas Tricycle Terminal");

  const drawn = page.locator("path.pn-line--route");
  await expect(drawn.first()).toBeAttached();
  const classes = await drawn.evaluateAll((els) => els.map((el) => el.getAttribute("class") ?? ""));
  expect(classes.length).toBeGreaterThan(0);
  for (const c of classes) expect(c).toMatch(/\bpn-route--TRI-/);

  // "All" resets the filter: the jeepney lines come back.
  await page.getByTestId("mode-filter-all").click();
  await expect(page.locator("path.pn-line--route.pn-route--R1").first()).toBeAttached();

  await page.getByRole("button", { name: "Close map layers" }).click();
  await expect(sheet).toHaveCount(0);
});

test("the Layers sheet traps focus and returns it to the Layers button", async ({ page }) => {
  await openApp(page);
  const { layersBtn, sheet } = await openLayers(page);
  await expect(page.getByRole("button", { name: "Close map layers" })).toBeFocused();

  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(layersBtn).toBeFocused();

  await layersBtn.click();
  await page.getByRole("button", { name: "Close map layers" }).click();
  await expect(layersBtn).toBeFocused();
});

test("the legend draws its swatches on the same surface as the lines, and explains dashed sections", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
  const legend = page.getByTestId("map-legend");
  await expect(legend).toBeAttached();
  const mapSurface = await mapEl(page).getAttribute("data-map-surface");
  expect(mapSurface).toBeTruthy();
  await expect(legend).toHaveAttribute("data-surface", mapSurface!);
  // R4 (and Loops B, C) have >= 100 m one-way conflicts: dashed, and the legend says why.
  await expect(page.locator("path.pn-line--route.pn-line--caution").first()).toBeAttached();
  await page.getByTestId("map-legend-button").click();
  await expect(page.getByTestId("map-legend-caution")).toContainText(
    "street order conflicts with one-way mapping — confirm on the ground",
  );
});

for (const mode of ["light", "dark", "high contrast"] as const) {
  test(`home map with lines and legend, and the Layers sheet, have no serious axe violations (${mode})`, async ({ page }) => {
    if (mode === "dark") await page.emulateMedia({ colorScheme: "dark" });
    if (mode === "high contrast") {
      await page.addInitScript(() => {
        localStorage.setItem("paranaga.prefs", JSON.stringify({ theme: "system", highContrast: true, lowData: false, historyEnabled: false }));
      });
    }
    await openApp(page);
    if (mode === "high contrast") await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
    await page.getByTestId("map-legend-button").click();
    await expect(page.getByTestId("map-legend-panel")).toBeVisible();

    const describe = (vs: { id: string; nodes: { target: unknown[] }[] }[]) =>
      vs.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join(", ");
    const home = await new AxeBuilder({ page })
      .include('[data-testid="naga-map"]')
      .include('[data-testid="map-legend"]')
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const homeSerious = home.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(homeSerious, describe(homeSerious)).toEqual([]);

    await page.getByTestId("map-legend-button").click();
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByTestId("layers-sheet")).toBeVisible();
    const sheet = await new AxeBuilder({ page })
      .include('[data-testid="layers-sheet"]')
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const sheetSerious = sheet.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(sheetSerious, describe(sheetSerious)).toEqual([]);
  });
}

test("tapping an overview line opens SelectedRouteCard with route details link", async ({ page }) => {
  await openApp(page);

  // Tap an overview line where nothing (a terminal marker, a pin, the sheet) is drawn over it: a
  // point along the path whose topmost element is a route line.
  const overviewLine = page.locator("path.pn-line--route").first();
  await expect(overviewLine).toBeAttached({ timeout: 15000 });
  const tap = await page.evaluate(() => {
    for (const path of document.querySelectorAll<SVGPathElement>("path.pn-line--route")) {
      const ctm = path.getScreenCTM();
      if (!ctm) continue;
      const total = path.getTotalLength();
      for (let i = 1; i < 40; i++) {
        const p = path.getPointAtLength((total * i) / 40).matrixTransform(ctm);
        const top = document.elementFromPoint(p.x, p.y);
        if (top instanceof SVGPathElement && top.classList.contains("pn-line--route")) return { x: p.x, y: p.y };
      }
    }
    return null;
  });
  expect(tap, "a visible point on an overview line").not.toBeNull();
  await page.mouse.click(tap!.x, tap!.y);

  const card = page.getByTestId("selected-route-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Approximate path, not a verified route shape");

  const routeDetailsLink = card.getByRole("link", { name: "Route details" });
  await expect(routeDetailsLink).toBeVisible();
  await routeDetailsLink.click();
  await expect(page).toHaveURL(/\/app\/routes\/.+$/);
});

test("a trip ride that uses a terminal access road says so in trip detail", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  // "Least walking": Loop A 265.6 -> 5751.6 m passes the terminal access road at 5663.6 m.
  await page.getByTestId("trip-option").nth(1).click();
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
  await expect(page.getByTestId("ride-terminal-access")).toHaveText("terminal access road");
  await expect(page.locator("path.pn-line--ride.pn-line--caution")).toHaveCount(0);
});
