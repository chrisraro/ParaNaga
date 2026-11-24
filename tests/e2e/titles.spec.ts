import { expect, test, type Page } from "@playwright/test";
import { en } from "../../src/i18n/en";
import { fil } from "../../src/i18n/fil";
import { routeNetwork } from "./fixtures/network";

// Tab titles (WCAG 2.4.2): a route page names its route, tab pages follow the UI language, and a
// soft navigation between screens (and back to the map) never leaves a stale title.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const PREFS_KEY = "paranaga.prefs";
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
});

test("a route page is titled with its route, and the map gets its own title back", async ({ page }) => {
  await page.goto("/app/routes/R4");
  await expect(page.getByTestId("route-detail")).toBeVisible();
  const h1 = (await page.locator(".pn-detail__title").textContent())!.trim();
  await expect(page).toHaveTitle(`${h1} · Lunad`);
  expect(h1).not.toBe("Route");
  await page.getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page).toHaveTitle("App · Lunad");
});

test("soft navigation between tab pages and back keeps each title", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveTitle("App · Lunad");
  for (const [name, title] of [
    ["Saved", en.saved.title],
    ["Explore", en.explore.title],
    ["Saved", en.saved.title],
  ] as const) {
    await tabBar(page).getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveTitle(`${title} · Lunad`);
  }
  await tabBar(page).getByRole("link", { name: "Map", exact: true }).click();
  await expect(page).toHaveTitle("App · Lunad");
});

test("in Filipino the tab titles are Filipino, static screens included", async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("__prefsSeeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("__prefsSeeded", "1");
      }
    },
    [PREFS_KEY, JSON.stringify({ locale: "fil" })] as const,
  );
  await page.goto("/app/saved");
  await expect(page.getByRole("heading", { level: 1, name: fil.saved.title })).toBeVisible();
  await expect(page).toHaveTitle(`${fil.saved.title} · Lunad`);
  await page.goto("/app/explore");
  await expect(page.getByRole("heading", { level: 1, name: fil.explore.title })).toBeVisible();
  await expect(page).toHaveTitle(`${fil.explore.title} · Lunad`);
  await page.goto("/app/help");
  await expect(page).toHaveTitle(`${fil.help.title} · Lunad`);
});
