import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";

// Settings ("More" tab) and the device preferences (Increment A, Task 2): Appearance (Light /
// Dark / System) applied before the first paint by public/theme-init.js, High contrast, Low-data
// mode (no tile layer), Trip history, Location access, Clear data on this device. Tiles are aborted
// (but every tile request is recorded); every test checks for CSP (report-only) violations.

const TILE_RE = /tile\.openstreetmap\.org|api\.maptiler\.com/;
const PREFS_KEY = "paranaga.prefs";

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const settingsHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Settings" });

let tileRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  tileRequests = [];
  page.on("request", (request) => {
    if (TILE_RE.test(request.url())) tileRequests.push(request.url());
  });
  await page.route(TILE_RE, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }),
  );
  await routeNetwork(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[]; __themeAtDomContentLoaded: string | null };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    // The theme as parsed HTML has it, before any app script (React hydrates later).
    document.addEventListener("DOMContentLoaded", () => {
      w.__themeAtDomContentLoaded = document.documentElement.getAttribute("data-theme");
    });
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP (report-only) violations").toEqual([]);
});

async function openSettings(page: Page) {
  await page.goto("/app/more");
  await expect(settingsHeading(page)).toBeVisible();
  // Hydrated: the controls respond once React owns them.
  await expect(page.getByTestId("settings-sources")).toBeVisible();
}

async function openHome(page: Page) {
  await page.goto("/app");
  await expect(page.getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
}

async function setStoredPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("__prefsSeeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("__prefsSeeded", "1");
      }
    },
    [PREFS_KEY, JSON.stringify(prefs)] as const,
  );
}

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

const pageBackground = (page: Page) => page.getByTestId("more-page").evaluate((el) => getComputedStyle(el).backgroundColor);
const LIGHT_BG = "rgb(244, 246, 250)";
const DARK_BG = "rgb(11, 18, 32)";

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

  test("the Settings screen shows its sections with the exact copy", async ({ page }) => {
    await openSettings(page);
    await expect(page.getByTestId("settings-account")).toHaveText(
      "No account neededSaved trips and places stay on this phone.",
    );
    // The account card is static, not a link.
    await expect(page.getByTestId("settings-account").locator("a")).toHaveCount(0);
    await expect(page.getByTestId("more-page").getByRole("heading", { level: 2 })).toHaveText(["General", "Display and data", "Location", "Data on this device", "App", "About"]);
    // Install: only what the browser offers. Headless Chromium has made no install offer, so the
    // row is text pointing to the browser menu, never a button that does nothing.
    const install = page.getByTestId("settings-install");
    await expect(install).toContainText("Install ParaNaga");
    await expect(install).toContainText("use your browser’s menu");
    await expect(install.getByRole("button")).toHaveCount(0);
    const general = page.getByTestId("settings-general");
    await expect(general).toContainText("LanguageFilipino planned.English");
    await expect(general).toContainText("Fare categoryRegular");
    await expect(page.getByTestId("settings-fare-note")).toHaveText(
      "Discounts aren’t applied: no verified rule yet. Regular fares shown.",
    );
    await expect(page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio")).toHaveText(["Light", "Dark", "System"]);
    await expect(page.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    // One row of three equal segments.
    const boxes = await page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
    expect(boxes[0].left).toBeLessThan(boxes[1].left);
    expect(boxes[1].left).toBeLessThan(boxes[2].left);
    for (const [name, hint] of [
      ["Low-data mode", "Hide the map background; pins and trip steps still show"],
      ["High contrast", "Stronger text and borders"],
      ["Trip history", "Off by default, kept on this device"],
    ] as const) {
      const sw = page.getByRole("switch", { name });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(sw).toHaveAccessibleDescription(hint);
    }
    await expect(page.getByTestId("settings-display")).toContainText("Reduce motionFollows your device setting");
    await expect(page.getByTestId("settings-location")).toContainText("Location access");
    await expect(page.getByText("Used only on this device, when you tap “Use current location” or start guidance. Change it in your browser or phone settings.")).toBeVisible();
    await expect(page.getByTestId("settings-sources")).toHaveText("Sources and credits");
    await expect(page.getByTestId("settings-data-revision")).toHaveCount(0);
    // Help (Task 11) opens from the About group.
    await expect(page.getByTestId("settings-help")).toHaveAttribute("href", "/app/help");
    await expect(tabBar(page).getByRole("link", { name: "More", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("Location access reads the permission without asking", async ({ page, context }) => {
    await openSettings(page);
    await expect(page.getByTestId("settings-location-status")).toHaveText("Ask each time");
    await context.grantPermissions(["geolocation"]);
    await page.reload();
    await expect(page.getByTestId("settings-location-status")).toHaveText("Allowed");
  });

  test("Dark applies at once and survives a reload with no light flash", async ({ page }) => {
    await openSettings(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    expect(await pageBackground(page)).toBe(LIGHT_BG);

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => pageBackground(page)).toBe(DARK_BG);
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY))!)).toMatchObject({ theme: "dark" });

    await page.reload();
    // Set while the HTML was parsed, before hydration: no light first paint.
    expect(await page.evaluate(() => (window as unknown as { __themeAtDomContentLoaded: string | null }).__themeAtDomContentLoaded)).toBe("dark");
    await expect(settingsHeading(page)).toBeVisible();
    expect(await pageBackground(page)).toBe(DARK_BG);
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

    // Back to System: follows the device again (light here).
    await page.getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect.poll(() => pageBackground(page)).toBe(LIGHT_BG);
  });

  test.describe("on a dark device", () => {
    test.use({ colorScheme: "dark" });

    test("System follows the device and Light overrides it", async ({ page }) => {
      await openSettings(page);
      expect(await pageBackground(page)).toBe(DARK_BG);
      await page.getByRole("radio", { name: "Light" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect.poll(() => pageBackground(page)).toBe(LIGHT_BG);
      await page.reload();
      expect(await page.evaluate(() => (window as unknown as { __themeAtDomContentLoaded: string | null }).__themeAtDomContentLoaded)).toBe("light");
      await expect(settingsHeading(page)).toBeVisible();
      expect(await pageBackground(page)).toBe(LIGHT_BG);
    });
  });

  test("High contrast sets data-contrast and strengthens secondary text", async ({ page }) => {
    await openSettings(page);
    const hint = page.getByText("Stronger text and borders");
    const before = await hint.evaluate((el) => getComputedStyle(el).color);
    await page.getByRole("switch", { name: "High contrast" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    // Secondary text takes the primary label colour.
    await expect.poll(() => hint.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(15, 30, 61)");
    expect(before).not.toBe("rgb(15, 30, 61)");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    await page.getByRole("switch", { name: "High contrast" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-contrast", /.*/);
  });

  test("the map requests tiles normally, none in low-data mode, and again after Show background once", async ({ page }) => {
    // Positive control: this build has a tile URL (playwright.config.ts), so the map requests tiles.
    await openHome(page);
    await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
    await expect(page.getByTestId("map-low-data-notice")).toHaveCount(0);
    await expect(page.locator(".pn-attribution")).not.toContainText("Map data");

    // Low-data mode on (stored before load): no tile layer, no tile request.
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ lowData: true })), PREFS_KEY);
    // Reset before the reload, so a tile requested while the new page loads is caught.
    tileRequests = [];
    await page.reload();
    await expect(page.getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
    const lowData = page.getByTestId("map-low-data-notice");
    await expect(lowData).toHaveText("Map background off (low-data mode)Show background once");
    // Pins still show.
    await expect(page.getByTestId("naga-map")).not.toHaveAttribute("data-stop-pins", "0");
    await expect(page.locator(".pn-attribution")).toContainText("Map data © OpenStreetMap contributors");
    await expect(page.locator(".leaflet-tile-pane .leaflet-layer")).toHaveCount(0);
    // Pan and zoom: still nothing requested.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
    expect(tileRequests).toEqual([]);

    // Once, on request.
    await lowData.getByRole("button", { name: "Show background once" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
    await expect(lowData).toHaveCount(0);
    // The notice removed the focused button: focus moved to the map, not to <body>.
    await expect(page.getByTestId("naga-map")).toBeFocused();
  });

  test("the Low-data switch turns the map background off for the home map", async ({ page }) => {
    await openSettings(page);
    await page.getByRole("switch", { name: "Low-data mode" }).click();
    await expect(page.getByRole("switch", { name: "Low-data mode" })).toHaveAttribute("aria-checked", "true");
    tileRequests = [];
    await tabBar(page).getByRole("link", { name: "Map", exact: true }).click();
    await expect(page.getByTestId("home-search")).toBeVisible();
    await expect(page.getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
    await expect(page.getByTestId("map-low-data-notice")).toBeVisible();
    await expect(page.locator(".leaflet-tile-pane .leaflet-layer")).toHaveCount(0);
    expect(tileRequests).toEqual([]);
  });

  // Regular build, no tile URL (project "no-tiles"): there is no background to turn off.
  test("without a tile URL, low-data mode keeps the 'Map background unavailable' notice @no-tiles", async ({ page }) => {
    await setStoredPrefs(page, { lowData: true });
    await openHome(page);
    await expect(page.getByText("Map background unavailable")).toBeVisible();
    await expect(page.getByTestId("map-low-data-notice")).toHaveCount(0);
    expect(tileRequests).toEqual([]);
  });

  test("Trip history switches on and off without a question while no history exists", async ({ page }) => {
    await openSettings(page);
    const sw = page.getByRole("switch", { name: "Trip history" });
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("settings-history-dialog")).toBeHidden();
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY))!)).toMatchObject({ historyEnabled: false });
  });

  test("Clear data on this device asks first, then empties ParaNaga's storage", async ({ page }) => {
    await openSettings(page);
    await page.getByRole("radio", { name: "Dark" }).click();
    await page.getByRole("switch", { name: "Low-data mode" }).click();
    await page.evaluate(() => {
      sessionStorage.setItem("paranaga.guidance", "{}");
      localStorage.setItem("paranaga.other", "x");
    });

    const clear = page.getByRole("button", { name: "Clear data on this device" });
    await clear.click();
    const dialog = page.getByTestId("settings-clear-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveText("Remove saved trips, saved places, trip history and settings from this phone?");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(clear).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await clear.click();
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("settings-status")).toHaveText("Data on this phone removed. Settings are back to their defaults.");
    const left = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((k) => k.startsWith("paranaga.")),
      session: Object.keys(sessionStorage).filter((k) => k.startsWith("paranaga.")),
    }));
    expect(left).toEqual({ local: [], session: [] });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect(page.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Low-data mode" })).toHaveAttribute("aria-checked", "false");
  });

  for (const [scheme, prefs] of [
    ["light", { theme: "light" }],
    ["dark", { theme: "dark" }],
    ["high contrast (light)", { theme: "light", highContrast: true }],
    ["high contrast (dark)", { theme: "dark", highContrast: true }],
  ] as const) {
    test(`Settings and Home pass axe: ${scheme}`, async ({ page }) => {
      await setStoredPrefs(page, prefs);
      await openSettings(page);
      await expectAxeClean(page);
      await openHome(page);
      await expectAxeClean(page);
    });
  }

  test.describe("System on a dark device", () => {
    test.use({ colorScheme: "dark" });

    test("Settings and Home pass axe with high contrast", async ({ page }) => {
      await setStoredPrefs(page, { highContrast: true });
      await openSettings(page);
      expect(await pageBackground(page)).toBe(DARK_BG);
      await expectAxeClean(page);
      await openHome(page);
      await expectAxeClean(page);
    });
  });
});
