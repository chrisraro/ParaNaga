import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LINES, routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP (report-only) violations").toEqual([]);
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
  // No sheet change needed: trip detail opens at half, so the map and legend are in view.
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

// Lines and legend never vanish: guidance, picking a point, and lines that fail to load.

/** Lowers the trip sheet to its peek, whichever snap it opened at, so the map and its legend show. */
async function peekSheet(page: Page) {
  const toHalf = page.getByRole("button", { name: "Expand sheet to half" });
  const lower = page.getByRole("button", { name: /^(Expand sheet to full|Collapse sheet)$/ });
  for (let i = 0; i < 3 && !(await toHalf.isVisible()); i++) await lower.click();
  await expect(toHalf).toBeVisible();
}

/** The legend button and part of a ride line are inside the viewport and above the sheet's top edge. */
async function expectLegendAndLineAboveSheet(page: Page) {
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached({ timeout: 15000 });
  const sheetTop = (await page.getByTestId("trip-sheet").boundingBox())!.y;
  // Once the map has fitted the trip, part of a ride line is on the map above the sheet.
  await expect
    .poll(async () => {
      const line = await page.locator("path.pn-line--ride").first().boundingBox();
      return line !== null && line.y < sheetTop && line.y + line.height > 0;
    })
    .toBe(true);
  const legend = (await page.getByTestId("map-legend-button").boundingBox())!;
  expect(legend.y).toBeGreaterThanOrEqual(0);
  expect(legend.y + legend.height).toBeLessThanOrEqual(sheetTop + 1);
}

async function expectLegendListsWalkAndStops(page: Page, notice?: string) {
  const button = page.getByTestId("map-legend-button");
  await expect(button).toBeVisible();
  await button.click();
  const panel = page.getByTestId("map-legend-panel");
  await expect(panel).toContainText("Walk");
  await expect(panel).toContainText("Dotted: approximate walking path");
  await expect(panel).toContainText("Mapped stop, not verified");
  await expect(panel).toContainText("Lines are approximate paths, not verified route shapes.");
  if (notice) await expect(page.getByTestId("map-legend-notice")).toHaveText(notice);
  else await expect(page.getByTestId("map-legend-notice")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

test("guidance keeps the trip lines (walk dotted, ride solid), the ride's stop pins and the legend", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await expectLegendAndLineAboveSheet(page); // trip detail too, sheet untouched
  await page.getByTestId("trip-start").click();
  const guide = page.getByTestId("guidance");
  await expect(guide).toBeVisible();
  // Without touching the sheet: the legend and a trip line are on the map above the sheet's top edge.
  await expectLegendAndLineAboveSheet(page);

  const walk = page.locator("path.pn-line--walk");
  await expect(walk.first()).toBeAttached({ timeout: 15000 });
  await expect(walk.first()).toHaveAttribute("stroke-dasharray", /.+/);
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
  await expect(page.getByTestId("home-screen").getByTestId("naga-map")).not.toHaveAttribute("data-stop-pins", "0");
  await expectLegendListsWalkAndStops(page);
  await page.getByTestId("map-legend-button").click();
  const a11y = await new AxeBuilder({ page })
    .include('[data-testid="naga-map"]')
    .include('[data-testid="map-legend"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
  await page.keyboard.press("Escape");

  // Still there on the next steps (the ride).
  await page.getByRole("button", { name: /^Expand sheet/ }).first().click();
  await guide.getByRole("button", { name: "I'm at the stop", exact: true }).click();
  await guide.getByRole("button", { name: /^I boarded/ }).click();
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
  await expect(page.locator("path.pn-line--walk").first()).toBeAttached();
  await expect(page.getByTestId("map-legend-button")).toBeVisible();
});

test("scrolling a sheet element into view never shifts the map, so the legend stays on screen", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();

  const expectMapStill = async () => {
    await page.evaluate(() => {
      document.querySelector(".pn-sheet__content")?.lastElementChild?.scrollIntoView({ block: "center" });
    });
    expect(await page.locator(".pn-home").evaluate((el) => el.scrollTop)).toBe(0);
    const legend = (await page.getByTestId("map-legend-button").boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(legend.y).toBeGreaterThanOrEqual(0);
    expect(legend.y + legend.height).toBeLessThanOrEqual(vh);
  };
  await expectMapStill();

  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await expectMapStill();
});

test("the overview lines and the legend stay while a point is being chosen on the map", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  await expect(page.getByRole("button", { name: "Set start here" })).toBeVisible();
  await expect(page.locator("path.pn-line--route").first()).toBeAttached();
  await expectLegendListsWalkAndStops(page);
});

test("the legend and the walking line still show when the route lines are not loaded (404)", async ({ page }) => {
  await page.route(/\/api\/v1\/network\/lines\/[^/?]+$/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await expectLegendListsWalkAndStops(page);

  await pinBoth(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await peekSheet(page);
  await expect(page.locator("path.pn-line--walk").first()).toBeAttached({ timeout: 15000 });
  await expect(page.locator("path.pn-line--ride")).toHaveCount(0); // never an invented path
  await expectLegendListsWalkAndStops(page, "Route lines for this trip didn't load.");
});

// Keyboard focus is never left below the screen edge: the half sheet cannot scroll it into view, so
// a keyboard Tab to a cut-off control lifts the sheet (a tap does not).

async function expectTabbedControlsOnScreen(page: Page, scope: string, wanted: RegExp[]) {
  const seen = new Set<RegExp>();
  const viewportHeight = page.viewportSize()!.height;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate((testId) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest(`[data-testid="${testId}"]`)) return null;
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, top: r.top, name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60) };
    }, scope);
    if (!state) continue;
    expect(state.top, state.name).toBeGreaterThanOrEqual(0);
    expect(state.bottom, state.name).toBeLessThanOrEqual(viewportHeight);
    for (const w of wanted) if (w.test(state.name)) seen.add(w);
    if (seen.size === wanted.length) return;
  }
  throw new Error(`never reached every control: ${wanted.join(", ")}`);
}

test("tabbing through trip detail and guidance at half keeps the focused control on screen", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "1"); // a tap left it at half
  await expectTabbedControlsOnScreen(page, "trip-detail", [/Start trip/]);

  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "1");
  await expectTabbedControlsOnScreen(page, "guidance", [/I'm at the stop/, /End guidance/]);
});
