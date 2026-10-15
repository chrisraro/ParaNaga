import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { STOP_A1, routeNetwork } from "./fixtures/network";

// The app shell (Increment A, Task 1): the tab bar (Map · Explore · Saved · More), tab pages as
// panels over the mounted home map, and where the tab bar hides. Tiles are aborted and the network
// API is answered from captured fixtures; every test checks for CSP (report-only) violations.

const mapEl = (page: Page) => page.getByTestId("naga-map");
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const tab = (page: Page, name: string) => tabBar(page).getByRole("link", { name, exact: true });
const rowMain = (page: Page, which: "start" | "destination") => page.getByTestId(`endpoint-${which}`).locator(".pn-endpoint__main");
/** Tab label → the page's h1. */
const PAGES = [
  ["Explore", "Explore"],
  ["Saved", "Saved"],
  ["More", "Settings"],
] as const;
const homeHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "ParaNaga trip planner" });

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

async function expectAxeClean(page: Page, include?: string) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }),
  );
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

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

  test("the tab bar navigates Map ↔ Explore ↔ Saved ↔ More, focusing each screen's h1", async ({ page }) => {
    await openApp(page);
    await expect(tabBar(page).getByRole("link")).toHaveText(["Map", "Explore", "Saved", "More"]);
    await expect(tab(page, "Map")).toHaveAttribute("aria-current", "page");

    await tab(page, "Explore").click();
    await expect(page).toHaveURL(/\/app\/explore$/);
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeFocused();
    await expect(tab(page, "Explore")).toHaveAttribute("aria-current", "page");
    await expect(tab(page, "Map")).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("app-home-layer")).toHaveAttribute("inert", "");
    // Explore lists the OpenStreetMap places as cards.
    await expect(page.getByTestId("explore-card").first()).toBeVisible();

    await tab(page, "Saved").click();
    await expect(page).toHaveURL(/\/app\/saved$/);
    await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeFocused();
    await expect(page.getByTestId("saved-empty")).toHaveText("Nothing saved on this phone yet.");
    await expect(tab(page, "Saved")).toHaveAttribute("aria-current", "page");

    await tab(page, "More").click();
    await expect(page).toHaveURL(/\/app\/more$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
    await expect(tab(page, "More")).toHaveAttribute("aria-current", "page");

    await tab(page, "Explore").click();
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeFocused();

    await tab(page, "Map").click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(homeHeading(page)).toBeFocused();
    await expect(page.getByTestId("app-home-layer")).not.toHaveAttribute("inert", "");
    await expect(tab(page, "Map")).toHaveAttribute("aria-current", "page");
  });

  test("the home trip and map view survive a round trip through the tabs", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Choose on map", exact: true }).click();
    await page.getByRole("button", { name: "Set start here" }).click();
    await expect(rowMain(page, "start")).toContainText("Pinned location");
    const center = await mapEl(page).getAttribute("data-center-lng");

    await tab(page, "Saved").click();
    await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeFocused();
    await tab(page, "Explore").click();
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeFocused();
    await tab(page, "Map").click();

    await expect(rowMain(page, "start")).toContainText("Pinned location");
    await expect(mapEl(page)).toHaveAttribute("data-center-lng", center!);
  });

  test("Escape on a tab page goes back", async ({ page }) => {
    await openApp(page);
    await tab(page, "More").click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
    await expect(page.getByTestId("settings-account")).toContainText("Accounts arrive later");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("more-page")).toBeHidden();
    await expect(homeHeading(page)).toBeFocused();
  });

  test("the tab bar hides in detail panels and while a pin is placed", async ({ page }) => {
    await openApp(page);
    await expect(tabBar(page)).toBeVisible();

    // Placing a pin: the crosshair panel owns the bottom of the screen.
    await page.getByRole("button", { name: "Choose on map", exact: true }).click();
    await expect(page.getByRole("button", { name: "Set start here" })).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(tabBar(page)).toBeVisible();

    // A route opened from Explore is a detail panel: no tab bar; Back returns to Explore with it.
    await tab(page, "Explore").click();
    await page.getByRole("tablist", { name: "Directory sections" }).getByRole("tab", { name: "Routes" }).click();
    await page.getByTestId("explore-routes").getByRole("link").first().click();
    await expect(page.getByTestId("route-detail")).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
    await page.getByTestId("detail-back").click();
    await expect(page).toHaveURL(/\/app\/explore$/);
    await expect(tabBar(page)).toBeVisible();

    // A stop panel opened by link.
    await page.goto(`/app/stops/${STOP_A1.stop.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
    await page.getByTestId("detail-back").click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(tabBar(page)).toBeVisible();
  });

  /** Bottom edges of both endpoint rows and the attribution, minus the tab bar's top (≤ 0 = clear). */
  async function overlapWithTabBar(page: Page): Promise<number> {
    const bar = await tabBar(page).boundingBox();
    if (!bar) return Infinity;
    const boxes = await Promise.all([rowMain(page, "start"), rowMain(page, "destination"), page.locator(".pn-attribution")].map((l) => l.boundingBox()));
    return Math.max(...boxes.map((b) => (b ? b.y + b.height - bar.y : Infinity)));
  }

  async function collapseToPeek(page: Page) {
    const sheet = page.getByTestId("trip-sheet");
    await sheet.locator(".pn-grabber").focus();
    await page.keyboard.press("ArrowDown");
    await expect(sheet).toHaveAttribute("data-snap", "0");
  }

  test("at the peek snap the endpoint rows and the map attribution stay above the tab bar", async ({ page }) => {
    await openApp(page);
    await collapseToPeek(page);
    // Polled: the sheet glides to the snap.
    await expect.poll(() => overlapWithTabBar(page)).toBeLessThanOrEqual(0);
  });

  test("with a home-indicator inset the measured clearance still keeps the rows above the tab bar", async ({ page }) => {
    // Chromium has no safe-area emulation: lift the bar the way env(safe-area-inset-bottom) = 34 px
    // would (kit.css: bottom = max(24px, inset + 8px) = 42px). The clearance is measured, so the
    // peek snap follows.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = ".pn-tabbar { bottom: 42px !important; }";
        document.head.append(style);
      });
    });
    await openApp(page);
    await collapseToPeek(page);
    const bar = (await tabBar(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(viewport.height - bar.y).toBeGreaterThan(100); // 42 + 66: more than the old fixed 90
    await expect.poll(() => overlapWithTabBar(page)).toBeLessThanOrEqual(0);
  });

  test("the tab bar and the tab pages pass axe (light)", async ({ page }) => {
    await openApp(page);
    await expectAxeClean(page, "[data-tabbar]");
    for (const [name, title] of PAGES) {
      await tab(page, name).click();
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused();
      if (name === "Explore") await expect(page.getByTestId("explore-card").first()).toBeVisible();
      await expectAxeClean(page);
    }
  });

  test.describe("dark mode", () => {
    test.use({ colorScheme: "dark" });

    test("the tab bar and the tab pages pass axe (dark)", async ({ page }) => {
      await openApp(page);
      await expectAxeClean(page, "[data-tabbar]");
      for (const [name, title] of PAGES) {
        await tab(page, name).click();
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused();
        if (name === "Explore") await expect(page.getByTestId("explore-card").first()).toBeVisible();
        await expectAxeClean(page);
      }
    });
  });
});

test.describe("large screen", () => {
  test.skip(({ isMobile }) => isMobile, "Desktop only");

  test("tab pages stay behind the phone-only gate", async ({ page }) => {
    await page.goto("/app/explore");
    await expect(page.getByRole("heading", { level: 1, name: "ParaNaga rides in your pocket." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toHaveCount(0);
    await expect(tabBar(page)).toHaveCount(0);
  });
});
