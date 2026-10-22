import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LINES, routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { chooseOnMapVia, chooseOption, pinTrip } from "./fixtures/options";
import { showMapLayers } from "./fixtures/layers";

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

/** No pan or zoom (drag, its inertia, an animated fit) is under way: the map's data-moving flag. */
const mapSettled = (page: Page) => expect(mapEl(page)).toHaveAttribute("data-moving", "false");
/** The legend panel's open state is an attribute, so a test waits on it instead of on timing. */
const legendOpen = (page: Page, open: boolean) =>
  expect(page.getByTestId("map-legend-panel")).toHaveAttribute("data-open", String(open));

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
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
  await pinTrip(page);
}

test("trip lines draw walk (dotted) and ride (solid) layers with chevrons and legend", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );

  await openApp(page);
  await pinBoth(page);

  await chooseOption(page);

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
  await showMapLayers(page, "Routes");
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
  await showMapLayers(page, "Routes");
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
  await expect(sheet.getByRole("switch")).toHaveCount(3);
  await expect(sheet.getByText(/historical/i)).toHaveCount(0);

  const routesList = page.getByTestId("layers-routes-list");
  await expect(routesList).toContainText("Centro-Cararayan-San Isidro");

  await page.getByTestId("mode-filter-tricycle").click();
  // The Routes list names only the 11 active jeepney services: a tricycle feeder line is drawn but not listed.
  await expect(routesList.getByRole("link")).toHaveCount(0);
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
  await showMapLayers(page, "Routes");
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
    await showMapLayers(page, "Routes");
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
  await showMapLayers(page, "Routes");

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
  await chooseOption(page, 1);
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

async function expectLegendListsWalkWithoutStops(page: Page, notice?: string, bareMap = false) {
  const button = page.getByTestId("map-legend-button");
  await expect(button).toBeVisible();
  await button.click();
  await legendOpen(page, true);
  const panel = page.getByTestId("map-legend-panel");
  await expect(panel).toContainText("Walk");
  await expect(panel).toContainText("Dotted: approximate walking path");
  // Route screens draw no stop pins, so the legend has no stop entry; the bare map still shows them.
  if (bareMap) await expect(panel).toContainText("Mapped stop, not verified");
  else await expect(panel).not.toContainText("Mapped stop, not verified");
  await expect(panel).toContainText("Lines are approximate paths, not verified route shapes.");
  if (notice) await expect(page.getByTestId("map-legend-notice")).toHaveText(notice);
  else await expect(page.getByTestId("map-legend-notice")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await legendOpen(page, false);
  await expect(panel).toBeHidden();
}

test("guidance keeps the trip lines (walk dotted, ride solid) and the legend, without stop pins", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
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
  // Route screens show only the route: no stop pins (owner ruling 2026-10-17).
  await expect(page.getByTestId("home-screen").getByTestId("naga-map")).toHaveAttribute("data-stop-pins", "0");
  await expectLegendListsWalkWithoutStops(page);
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
  await page.getByTestId("trip-sheet").getByRole("button", { name: "I'm at the stop", exact: true }).click();
  await page.getByTestId("trip-sheet").getByRole("button", { name: /^I boarded/ }).click();
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
  await expect(page.locator("path.pn-line--walk").first()).toBeAttached();
  await expect(page.getByTestId("map-legend-button")).toBeVisible();
});

test("after choosing From and To the recommended option's lines are previewed above the sheet", async ({ page }) => {
  // The recommended option here is a jeepney ride (walk dotted, ride solid): the fixture's tricycle is not Recommended.
  const jeepneyRecommended = {
    ...PROVISIONAL_PLAN,
    plan: {
      ...PROVISIONAL_PLAN.plan,
      options: PROVISIONAL_PLAN.plan.options.map((o, i) => ({ ...o, labels: (o.labels as string[]).filter((l) => l !== "Recommended").concat(i === 0 ? ["Recommended"] : []) })),
    },
  };
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jeepneyRecommended) }),
  );
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  await expect(page.getByTestId("trip-detail")).toHaveCount(0);
  // Walk dotted, ride solid; overview routes are hidden under the preview.
  const walk = page.locator("path.pn-line--walk");
  await expect(walk.first()).toBeAttached({ timeout: 15000 });
  await expect(walk.first()).toHaveAttribute("stroke-dasharray", /.+/);
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
  await expect(page.locator("path.pn-line--route")).toHaveCount(0);
  await expectLegendListsWalkWithoutStops(page);
  await page.getByTestId("map-legend-button").click();
  await legendOpen(page, true);
  await expect(page.getByTestId("map-legend-panel")).toContainText(/jeepney/i);
  await page.keyboard.press("Escape");
  await legendOpen(page, false);
  // The sheet rests at peek and the map has stopped moving; then the whole path is inside the
  // map, at least 24 px above the sheet.
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "0");
  await mapSettled(page);
  const mapBox = (await page.getByTestId("naga-map").boundingBox())!;
  await expect
    .poll(async () => {
      const sheetTop = (await page.getByTestId("trip-sheet").boundingBox())!.y;
      for (const sel of ["path.pn-line--ride", "path.pn-line--walk"]) {
        for (const el of await page.locator(sel).all()) {
          const b = await el.boundingBox();
          if (!b) continue;
          if (b.x < mapBox.x || b.x + b.width > mapBox.x + mapBox.width || b.y < mapBox.y || b.y + b.height > sheetTop - 24) return false;
        }
      }
      return true;
    }, { timeout: 10_000 })
    .toBe(true);
  // Opening an option swaps to its lines; Back returns to the preview.
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await page.getByTestId("trip-detail").getByRole("button", { name: /back/i }).first().click();
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
});

/** Both pins are inside the map and at least 24 px above the sheet's top edge. */
async function pinsClearOfSheet(page: Page): Promise<boolean> {
  const mapBox = (await mapEl(page).boundingBox())!;
  const sheetTop = (await page.getByTestId("trip-sheet").boundingBox())!.y;
  const pins = await page.locator(".pn-marker").all();
  if (pins.length !== 2) return false;
  for (const pin of pins) {
    const b = await pin.boundingBox();
    if (!b || b.x < mapBox.x || b.x + b.width > mapBox.x + mapBox.width || b.y < mapBox.y || b.y + b.height > sheetTop - 24) return false;
  }
  return true;
}
const centreOf = async (page: Page) => `${await mapEl(page).getAttribute("data-center-lat")},${await mapEl(page).getAttribute("data-center-lng")}`;

test("the route re-fits on a snap change and a new route, but a user pan stays put", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  await expect.poll(() => pinsClearOfSheet(page), { timeout: 10_000 }).toBe(true);

  // Peek: the sheet is lower, the route re-fits with the same clearance.
  await peekSheet(page);
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "0");
  await mapSettled(page);
  await expect.poll(() => pinsClearOfSheet(page), { timeout: 10_000 }).toBe(true);

  // A user pan wins: a re-render (legend open and closed) does not take the view back.
  await drag(page, -60, 40);
  // The drag's inertia ends with a moveend.
  await mapSettled(page);
  const panned = await centreOf(page);
  await page.getByTestId("map-legend-button").click();
  await legendOpen(page, true);
  await page.keyboard.press("Escape");
  await legendOpen(page, false);
  await expect(page.getByTestId("map-legend-panel")).toBeHidden();
  await mapSettled(page);
  expect(await centreOf(page)).toBe(panned);

  // A new route (the destination moved) re-fits.
  await page.getByTestId("endpoint-destination").locator("button.pn-endpoint__main").click();
  await page.getByTestId("search-screen").getByRole("button", { name: "Choose on map", exact: true }).click();
  await drag(page, 100, -60);
  await page.getByRole("button", { name: "Set destination here" }).click();
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  await expect.poll(() => pinsClearOfSheet(page), { timeout: 10_000 }).toBe(true);
});

test("both pins are framed while the plan has not arrived or failed", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await openApp(page);
  await pinBoth(page);
  await expect.poll(() => pinsClearOfSheet(page), { timeout: 10_000 }).toBe(true);
  expect(Number(await mapEl(page).getAttribute("data-zoom"))).toBeLessThanOrEqual(17);
});

test("scrolling a sheet element into view never shifts the map, so the legend stays on screen", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
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
  await showMapLayers(page, "Routes", "Stops");
  await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
  await chooseOnMapVia(page);
  await expect(page.getByRole("button", { name: "Set destination here" })).toBeVisible();
  await expect(page.locator("path.pn-line--route").first()).toBeAttached();
  await expectLegendListsWalkWithoutStops(page, undefined, true);
});

test("the legend and the walking line still show when the route lines are not loaded (404)", async ({ page }) => {
  await page.route(/\/api\/v1\/network\/lines\/[^/?]+$/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await showMapLayers(page, "Routes", "Stops");
  await expectLegendListsWalkWithoutStops(page, undefined, true);

  await pinBoth(page);
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await peekSheet(page);
  await expect(page.locator("path.pn-line--walk").first()).toBeAttached({ timeout: 15000 });
  await expect(page.locator("path.pn-line--ride")).toHaveCount(0); // never an invented path
  await expectLegendListsWalkWithoutStops(page, "Route lines for this trip didn't load.");
});

// Keyboard focus is never left below the screen edge (the content scrolls inside the visible sheet;
// the primary action lives in the sheet's footer, outside the guidance/detail element).

async function expectTabbedControlsOnScreen(page: Page, scope: string, wanted: RegExp[]) {
  const seen = new Set<RegExp>();
  const viewportHeight = page.viewportSize()!.height;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => ((window as unknown as { __tabFrom: Element | null }).__tabFrom = document.activeElement));
    await page.keyboard.press("Tab");
    // Past the last control a browser moves focus to its own toolbar and comes back at the top of the
    // page. Firefox under Playwright has no toolbar and leaves focus on the last control: do the wrap.
    const stuck = await page.evaluate(() => document.activeElement === (window as unknown as { __tabFrom: Element | null }).__tabFrom);
    if (stuck) {
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await page.keyboard.press("Tab");
    }
    const state = await page.evaluate((testId) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !(el.closest(`[data-testid="${testId}"]`) || el.closest(".pn-sheet-footer"))) return null;
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, top: r.top, name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60) };
    }, scope);
    if (!state) continue;
    expect(state.top, state.name).toBeGreaterThanOrEqual(0);
    // The sheet lifts with a short animation after the Tab: wait for it to settle on screen.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getBoundingClientRect().bottom ?? 0), { message: state.name })
      .toBeLessThanOrEqual(viewportHeight + 1); // 1 px: sub-pixel rounding
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
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "1"); // a tap left it at half
  await expectTabbedControlsOnScreen(page, "trip-detail", [/Start trip/]);

  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "1");
  await expectTabbedControlsOnScreen(page, "guidance", [/I'm at the stop/, /End guidance/]);
});

/** Computed transition (property -> duration in ms) of an element, split into its parallel lists. */
async function transitions(locator: ReturnType<Page["locator"]>) {
  return locator.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const props = cs.transitionProperty.split(",").map((p) => p.trim());
    const durs = cs.transitionDuration.split(",").map((d) => d.trim());
    const ms = (d: string) => (d.endsWith("ms") ? parseFloat(d) : parseFloat(d) * 1000);
    return { props, ms: props.map((_, i) => ms(durs[i % durs.length]!)), animation: cs.animationDuration };
  });
}

test("motion: the sheet animates transform only (padding-bottom applies at once), the list and legend fade", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  const sheet = await transitions(page.getByTestId("trip-sheet"));
  const timed = sheet.props.filter((_, i) => sheet.ms[i]! > 0);
  expect(timed).toEqual(["transform"]);
  // The footer rides the same curve, also on transform alone.
  const footer = await transitions(page.locator(".pn-sheet-footer"));
  expect(footer.props.filter((_, i) => footer.ms[i]! > 0)).toEqual(["transform"]);
  // Cards and the legend panel do have motion (so the reduced-motion test below proves something).
  expect((await transitions(page.getByTestId("map-legend-panel"))).ms.some((m) => m > 0)).toBe(true);
  expect((await transitions(page.getByTestId("trip-option"))).ms.some((m) => m > 0)).toBe(true);
});

test("a lift applies the sheet padding at once (data-grow); a drop to peek delays it", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  const sheet = page.getByTestId("trip-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "0");
  const delayed = () => sheet.evaluate((el) => getComputedStyle(el).transitionProperty.split(",").map((p) => p.trim()));
  // Peek -> half: the content must fill the rising sheet, so only the transform is timed.
  // (A row tap opens Search now, dc6c0f5; the grabber is the way to lift the sheet.)
  await sheet.locator(".pn-grabber").focus();
  await page.keyboard.press("ArrowUp");
  await expect(sheet).toHaveAttribute("data-snap", "1");
  await expect(sheet).toHaveAttribute("data-grow", "");
  expect(await delayed()).toEqual(["transform"]);
  // Half -> full -> peek: shrinking keeps the padding delayed until the snap settles.
  await page.getByRole("button", { name: "Expand sheet to full" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "2");
  await page.getByRole("button", { name: "Collapse sheet" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "0");
  await expect(sheet).not.toHaveAttribute("data-grow", /.*/);
  expect(await delayed()).toEqual(["transform", "padding-bottom"]);
});

// Owner 2026-10-20: the peek cards the jeepney and the tricycle without covering the trip. The map
// fit pads by the sheet's visible height, which is the fixed two-card peek (peekOptionsVisible(2)).
test("375x812: with both peek cards, the previewed route and both pins sit fully above the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  const sheet = page.getByTestId("trip-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "0");
  await expect(page.getByTestId("options-best")).toBeVisible();
  await expect(page.getByTestId("options-alt")).toBeVisible();
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached({ timeout: 15_000 });
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await mapSettled(page);
  const measure = async () => {
    const sheetTop = (await sheet.boundingBox())!.y;
    const boxes = [];
    for (const el of await page.locator("path.pn-line--ride, path.pn-line--walk, .pn-marker").all()) {
      const b = await el.boundingBox();
      if (b) boxes.push(b);
    }
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    const top = Math.min(...boxes.map((b) => b.y));
    return { sheetTop, top, bottom, pins: await page.locator(".pn-marker").count() };
  };
  await expect.poll(async () => {
    const m = await measure();
    return m.pins === 2 && m.top >= 0 && m.bottom <= m.sheetTop;
  }, { timeout: 10_000 }).toBe(true);
  const m = await measure();
  console.log(`[peek2] 375x812 sheet top ${m.sheetTop.toFixed(1)} px; route+pins box ${m.top.toFixed(1)}-${m.bottom.toFixed(1)} px; clearance ${(m.sheetTop - m.bottom).toFixed(1)} px`);
  // The sheet does not grow at peek: the height is fixed, not measured.
  await expect(sheet).not.toHaveAttribute("data-grow", /.*/);
});

test("landscape 812x375: the peek shows one option card, so the route keeps the map strip", async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "0");
  await expect(page.getByTestId("options-best")).toBeAttached();
  await expect(page.getByTestId("options-alt")).toBeHidden();
});

test("the map is inert under the full sheet, so Tab skips its hidden controls", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  const map = page.locator(".pn-home__map");
  await expect(map).not.toHaveAttribute("inert", /.*/);
  await page.getByTestId("options-toggle").click();
  await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "2");
  await expect(map).toHaveAttribute("inert", "");
  // Tab from the sheet's first control never lands in a map control.
  await page.getByRole("button", { name: "Collapse sheet" }).focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".pn-home__map") !== null)).toBe(false);
  }
  await page.getByRole("button", { name: "Collapse sheet" }).click();
  await expect(map).not.toHaveAttribute("inert", /.*/);
});

test("reduced motion: no transition or animation on the sheet, the list items or the legend", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  for (const target of [page.getByTestId("trip-sheet"), page.locator(".pn-sheet-footer"), page.getByTestId("trip-option"), page.getByTestId("map-legend-panel")]) {
    const t = await transitions(target);
    expect(t.ms.every((m) => m === 0), `${t.props} ${t.ms}`).toBe(true);
    expect(t.animation.split(",").every((d) => parseFloat(d) === 0), t.animation).toBe(true);
  }
});
