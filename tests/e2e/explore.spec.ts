import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { SEARCH_INDEX, SEARCH_PLACES, routeNetwork } from "./fixtures/network";

// Explore (Increment A, Task 7): OpenStreetMap places by category from the captured search index,
// and the directory of everything else on file. Tiles are aborted; every test checks for CSP
// (report-only) violations.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const CHIPS = [
  ["All", null],
  ["Faith", ["place_of_worship"]],
  ["Schools", ["school", "college_university"]],
  ["Markets & malls", ["market", "mall"]],
  ["Health", ["hospital_clinic", "health_service", "pharmacy"]],
  ["Government", ["government"]],
  ["Parks & plazas", ["park", "square"]],
  ["Terminals", ["bus_terminal"]],
  ["Food & drink", ["restaurant", "fast_food", "cafe", "bar", "bakery"]],
  ["Shops", ["supermarket", "convenience_store", "department_store", "shop"]],
  ["Services", ["bank", "atm", "fuel", "office", "craft", "library"]],
  ["Stay", ["hotel", "lodging"]],
  ["Sights & sports", ["museum", "attraction", "historic", "sports", "leisure"]],
  ["Other places", ["building", "other_place"]],
] as const;

/** The core index places plus the lazy chunk (Task 14), as Explore merges them. */
const ALL_PLACES = [...SEARCH_INDEX.osmPlaces, ...SEARCH_PLACES.places];

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const namesOf = (categories: readonly string[] | null) =>
  ALL_PLACES
    .filter((p) => categories === null || categories.includes(p.category))
    .map((p) => p.name)
    .sort(collator.compare);

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const rowMain = (page: Page, which: "start" | "destination") => page.getByTestId(`endpoint-${which}`).locator(".pn-endpoint__main");
const chips = (page: Page) => page.getByRole("tablist", { name: "Categories" });
const segments = (page: Page) => page.getByRole("tablist", { name: "Directory sections" });
const cardNames = (page: Page) => page.getByTestId("explore-card").locator("h2");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }));
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

async function openExplore(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeFocused();
  await expect(page.getByTestId("explore-card").first()).toBeVisible();
}

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="explore-page"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test("header, intro and search action; the sourcing note and attribution are on Sources and credits", async ({ page }) => {
  await openExplore(page);
  const explore = page.getByTestId("explore-page");
  await expect(explore.getByText("Places in Naga, and how to get there.")).toBeVisible();
  await expect(explore.getByTestId("explore-places-note")).toHaveCount(0);
  await expect(explore.getByTestId("explore-osm-attribution")).toHaveCount(0);
  await expect(page.getByTestId("explore-card").first().getByText("Photo pending")).toBeVisible();
  await page.getByTestId("explore-search").click();
  await expect(page).toHaveURL(/\/app\/search$/);
});

test("each category chip lists the OpenStreetMap places of that category only, A–Z", async ({ page }) => {
  await openExplore(page);
  await expect(chips(page).getByRole("tab")).toHaveText(CHIPS.map(([label]) => label));
  for (const [label, categories] of CHIPS) {
    await chips(page).getByRole("tab", { name: label, exact: true }).click();
    await expect(chips(page).getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
    const names = namesOf(categories);
    if (names.length > 12) {
      await expect(cardNames(page)).toHaveText(names.slice(0, 12));
      await page.getByRole("button", { name: `Show all ${names.length} places` }).click();
    }
    await expect(cardNames(page)).toHaveText(names);
    if (categories) {
      const shown = await page.getByTestId("explore-card").evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.category))]);
      expect(shown.every((c) => (categories as readonly string[]).includes(c!))).toBe(true);
    }
  }
});

test("on All only 12 cards render until Show all, and Jump to directory reaches the directory", async ({ page }) => {
  await openExplore(page);
  await expect(page.getByTestId("explore-card")).toHaveCount(12);
  await page.getByRole("link", { name: "Jump to directory" }).click();
  const heading = page.getByRole("heading", { level: 2, name: "Directory" });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(page.getByTestId("explore-card")).toHaveCount(12);
  const showAll = page.getByRole("button", { name: `Show all ${ALL_PLACES.length} places` });
  await showAll.click();
  await expect(page.getByTestId("explore-card")).toHaveCount(ALL_PLACES.length);
  await expect(page.getByTestId("explore-card").nth(12).getByRole("link")).toBeFocused();
});

test("How to commute here sets the destination to the place's coordinate and returns to the map", async ({ page }) => {
  await openExplore(page);
  await chips(page).getByRole("tab", { name: "Markets & malls" }).click();
  const sm = SEARCH_INDEX.osmPlaces.find((p) => p.name === "SM City Naga")!;
  const card = page.getByTestId("explore-card").filter({ has: page.getByRole("heading", { name: "SM City Naga" }) });
  await card.getByRole("button", { name: "How to commute here: SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "destination")).toContainText("SM City Naga");
  await expect
    .poll(async () => {
      const lat = Number(await mapEl(page).getAttribute("data-center-lat"));
      const lng = Number(await mapEl(page).getAttribute("data-center-lng"));
      return Math.abs(lat - sm.lat) < 0.0005 && Math.abs(lng - sm.lng) < 0.0005;
    })
    .toBe(true);
});

test("a card opens the place detail of that OpenStreetMap place", async ({ page }) => {
  await openExplore(page);
  await chips(page).getByRole("tab", { name: "Markets & malls" }).click();
  await page.getByTestId("explore-card").getByRole("link", { name: "SM City Naga" }).click();
  await expect(page.getByTestId("place-detail").getByRole("heading", { level: 1, name: "SM City Naga" })).toBeFocused();
  await page.getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app\/explore$/);
});

test("the directory: each segment lists the right count and its rows open the right panels", async ({ page }) => {
  await openExplore(page);
  const directory = page.getByTestId("explore-directory");
  await expect(segments(page).getByRole("tab")).toHaveText(["Mapped stops", "Routes", "Terminals", "Barangays", "Leads"]);

  // Mapped stops: the mapped-pin places of the fixture, each a link to its place detail.
  await expect(directory.getByTestId("explore-stops").getByRole("link")).toHaveCount(SEARCH_INDEX.pinPlaces.length);
  const plaza = SEARCH_INDEX.pinPlaces.find((p) => p.label === "Plaza Rizal")!;
  const plazaRow = directory.getByTestId("explore-stops").locator(`a[href="/app/places/pin/${plaza.key}"]`);
  await expect(plazaRow).toContainText("Mapped candidate");
  await plazaRow.click();
  await expect(page.getByTestId("place-detail").getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeVisible();
  await page.getByTestId("place-detail").getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app\/explore$/);

  // Routes: 11, → route detail.
  await segments(page).getByRole("tab", { name: "Routes" }).click();
  await expect(directory.getByTestId("explore-route")).toHaveCount(11); // active routes only (97dd3f5)
  await expect(directory.locator('a[href="/app/routes/R8-A"]')).toContainText("Trial — permanence unconfirmed");
  await directory.locator('a[href="/app/routes/R8-A"]').click();
  await expect(page.getByTestId("route-detail")).toBeVisible();
  await page.getByTestId("route-detail").getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app\/explore$/);

  // Terminals: 16, the OSM badge (or Location not mapped), → terminal detail.
  await segments(page).getByRole("tab", { name: "Terminals" }).click();
  const terminals = directory.getByTestId("explore-terminals").getByRole("link");
  await expect(terminals).toHaveCount(16);
  await expect(terminals.first()).toContainText("Community-mapped location (OpenStreetMap)");
  await expect(terminals.nth(1)).toContainText("Location not mapped");
  await expect(terminals.first().getByTestId("mode-chip")).toHaveText(["Bus", "UV Express"]);
  await directory.getByTestId("explore-terminal-filter-tricycle").click();
  await expect(terminals).toHaveCount(3);
  await expect(terminals.nth(1)).toContainText("Waiting area · Location not mapped");
  await directory.getByRole("button", { name: "All", exact: true }).click();
  await expect(terminals).toHaveCount(16);
  await terminals.first().click();
  await expect(page.getByTestId("terminal-detail").getByRole("heading", { level: 1, name: "Bicol Central Station" })).toBeFocused();
  await page.getByTestId("terminal-detail").getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app\/explore$/);

  // Barangays: 27, Not surveyed, → place detail.
  await segments(page).getByRole("tab", { name: "Barangays" }).click();
  const barangays = directory.getByTestId("explore-barangays").getByRole("link");
  await expect(barangays).toHaveCount(27);
  await expect(barangays.first()).toContainText("Not surveyed");
  const firstName = (await barangays.first().locator(".pn-cell__title").textContent())!;
  await barangays.first().click();
  const barangayPanel = page.getByTestId("place-detail").filter({ has: page.getByRole("heading", { level: 1, name: firstName }) });
  await expect(barangayPanel).toBeVisible();
  await barangayPanel.getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app\/explore$/);

  // Leads: 5 static rows and the rail status line.
  await segments(page).getByRole("tab", { name: "Leads" }).click();
  await expect(directory.getByTestId("explore-leads").getByRole("listitem")).toHaveCount(5);
  await expect(directory.getByTestId("explore-leads").getByRole("link")).toHaveCount(0);
  await expect(directory.getByTestId("explore-rail")).toContainText("Verify with PNR.");
  await expect(directory.getByTestId("explore-rail-sources")).toHaveCount(0);
});

test("Explore passes axe (light)", async ({ page }) => {
  await openExplore(page);
  await expectAxeClean(page);
  await segments(page).getByRole("tab", { name: "Routes" }).click();
  await expect(page.getByTestId("explore-route")).toHaveCount(11); // active routes only (97dd3f5)
  await expectAxeClean(page);
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("Explore passes axe (dark)", async ({ page }) => {
    await openExplore(page);
    await expectAxeClean(page);
    await segments(page).getByRole("tab", { name: "Leads" }).click();
    await expectAxeClean(page);
  });
});
