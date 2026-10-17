import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { SEARCH_INDEX, routeNetwork } from "./fixtures/network";

// Place detail and Terminal detail (Increment A, Task 6) over the captured search index and
// terminal responses. Tiles are aborted; every test checks for CSP (report-only) violations.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const SM = SEARCH_INDEX.osmPlaces.find((p) => p.name === "SM City Naga")!;
const SM_PATH = `/app/places/osm/${SM.key.slice("osm:".length)}`;
const PLAZA = SEARCH_INDEX.pinPlaces.find((p) => p.label === "Plaza Rizal")!;
const PLAZA_A1 = PLAZA.pins.find((p) => p.onRoute)!;
const STUDY = SEARCH_INDEX.studyLabels.find((s) => s.label === "UMA Residences")!;

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const rowMain = (page: Page, which: "start" | "destination") => page.getByTestId(`endpoint-${which}`).locator(".pn-endpoint__main");
const place = (page: Page) => page.getByTestId("place-detail");
const terminal = (page: Page) => page.getByTestId("terminal-detail");

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

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(page.getByTestId("naga-map").first()).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
}

async function expectAxeClean(page: Page, testId: string) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include(`[data-testid="${testId}"]`).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test("an OpenStreetMap place: map at its coordinate, attribution, and Plan trip to sets the destination there", async ({ page }) => {
  await openApp(page);
  await page.goto(SM_PATH);
  const detail = place(page);
  await expect(detail.getByRole("heading", { level: 1, name: "SM City Naga" })).toBeFocused();
  await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  const map = detail.getByTestId("naga-map");
  await expect(map).toHaveAttribute("aria-label", "Map of SM City Naga");
  await expect(map).toHaveAttribute("data-center-lat", SM.lat.toFixed(6));
  await expect(map.getByRole("img", { name: "SM City Naga" })).toHaveCount(1);
  await expect(detail.getByTestId("place-entrance")).toContainText("Not mapped. Trips end at the map point.");
  // Attribution, the OSM object and the snapshot are on Sources and credits: one link away.
  await expect(detail.getByTestId("place-osm-attribution")).toHaveCount(0);
  await expect(detail.getByTestId("detail-sources")).toHaveAttribute("href", /^\/app\/help\/sources\?osm=(node|way|relation)\/[0-9]+&v=[0-9]+&s=OSM-[0-9-]+$/);
  await expect(detail.getByTestId("place-nearest-stops").getByRole("link").first()).toHaveAttribute("href", /^\/app\/stops\//);

  await detail.getByRole("button", { name: "Plan trip to SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "destination")).toContainText("SM City Naga");
  await expect
    .poll(async () => {
      const lat = Number(await mapEl(page).getAttribute("data-center-lat"));
      const lng = Number(await mapEl(page).getAttribute("data-center-lng"));
      return Math.abs(lat - SM.lat) < 0.0005 && Math.abs(lng - SM.lng) < 0.0005;
    })
    .toBe(true);
});

test("Plaza Rizal from search: Plan trip to Plaza Rizal sets the destination at its pin and returns to the map", async ({ page }) => {
  await openApp(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore", exact: true }).click();
  await page.getByTestId("explore-search").click();
  await page.getByRole("searchbox", { name: "Search places, stops and routes" }).fill("plaza rizal");
  await page.getByTestId("search-group-places").getByRole("link", { name: /^Plaza Rizal Mapped stop/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/places/pin/${PLAZA.key}$`));
  const detail = place(page);
  await expect(detail.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeFocused();
  await expect(detail.getByTestId("place-kind")).toHaveText(`Mapped stop · ${PLAZA.pins.length} pins`);
  await expect(detail.getByTestId("place-pins").getByRole("link")).toHaveCount(PLAZA.pins.length);
  await expect(detail.getByTestId("naga-map")).toHaveAttribute("data-stop-pins", String(PLAZA.pins.length));
  await expect(detail.getByTestId("place-source")).toHaveCount(0);
  await expect(detail.getByTestId("detail-sources")).toHaveAttribute("href", /\/app\/help\/sources\?stop=/);
  await detail.getByRole("button", { name: "Plan trip to Plaza Rizal" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(rowMain(page, "destination")).toContainText("Plaza Rizal (mapped pin)");
  await expect
    .poll(async () => Math.abs(Number(await mapEl(page).getAttribute("data-center-lat")) - PLAZA_A1.lat) < 0.0005)
    .toBe(true);
});

test("a barangay: no map; its CTA opens Choose on map for that end", async ({ page }) => {
  await openApp(page);
  await page.goto("/app/places/barangay/abella");
  const detail = place(page);
  await expect(detail.getByRole("heading", { level: 1, name: "Abella" })).toBeFocused();
  await expect(detail.getByTestId("naga-map")).toHaveCount(0);
  await expect(detail.getByTestId("place-source")).toHaveCount(0);
  await detail.getByRole("button", { name: "Choose a point in Abella on the map" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: "Set destination here" })).toBeFocused();
});

test("a study label: no trip action; its link searches mapped stops (query in the fragment only)", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(`/app/places/study/${STUDY.code}`);
  const detail = place(page);
  await expect(detail.getByRole("heading", { level: 1, name: "UMA Residences" })).toBeFocused();
  await expect(detail.getByTestId("place-cta")).toHaveCount(0);
  const link = detail.getByRole("link", { name: "Search mapped stops for “UMA Residences”" });
  await expect(link).toHaveAttribute("href", "/app/search#q=UMA%20Residences");
  await link.click();
  // The fragment is read once, then dropped from the history entry.
  await expect(page).toHaveURL(/\/app\/search$/);
  await expect(page.getByRole("searchbox", { name: "Search places, stops and routes" })).toHaveValue("UMA Residences");
  await expect(page.getByTestId("search-announcer")).toHaveText(/^\d+ results?$/);
  expect(urls.filter((u) => /uma/i.test(u))).toEqual([]);
});

test("T01: the community-mapped badge and map, Loop A and Loop B with the trial line, directions to the map point", async ({ page }) => {
  await page.goto("/app/terminals/T01");
  const detail = terminal(page);
  await expect(detail.getByRole("heading", { level: 1, name: "Bicol Central Station" })).toBeFocused();
  await expect(detail.getByTestId("naga-map")).toHaveAttribute("aria-label", "Map of Bicol Central Station");
  await expect(detail.getByTestId("terminal-pill")).toHaveText("Community-mapped");
  await expect(detail.getByRole("note")).toHaveText("Not the PNR railway station.");
  await expect(detail.getByTestId("terminal-route-legal_plan").locator(".pn-loop-chip")).toHaveText(["Loop A", "Loop B"]);
  await expect(detail.getByTestId("terminal-route-trial").first()).toContainText("Nov 2025 trial");
  await expect(detail.getByTestId("terminal-route-trial").first()).toContainText("Trial — permanence unconfirmed");
  await expect(detail.getByTestId("terminal-directions-note")).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Directions to here" })).toBeVisible();
  await expect(detail.getByTestId("terminal-osm-attribution")).toHaveCount(0);
  await detail.getByRole("tab", { name: "Hours" }).click();
  await expect(detail.getByRole("tabpanel")).toContainText("HoursNot on file");
  await detail.getByRole("tab", { name: "Routes" }).click();
  await detail.getByTestId("terminal-route-legal_plan").first().click();
  await expect(page).toHaveURL(/\/app\/routes\/R8-A$/);
});

test("T06: no route plan names it", async ({ page }) => {
  await page.goto("/app/terminals/T06");
  const detail = terminal(page);
  await expect(detail.getByRole("heading", { level: 1, name: "Naga PNR railway station" })).toBeFocused();
  await expect(detail.getByTestId("terminal-no-routes")).toHaveText("No route plan names this terminal yet.");
  await expect(detail.getByRole("note")).toHaveText("Not Bicol Central Station (the bus terminal).");
  await expect(detail.getByTestId("terminal-location")).toContainText("Mapped point · building centroid, not an entrance");
  await expect(detail.getByTestId("terminal-status-note")).toContainText("confirm with PNR");
  await expect(detail.getByTestId("terminal-osm-attribution")).toHaveCount(0);
});

test("unknown terminal and place links get the not-found panel", async ({ page }) => {
  await page.goto("/app/terminals/T99");
  await expect(page.getByTestId("detail-not-found").getByRole("heading", { level: 1, name: "Terminal not found" })).toBeVisible();
  await page.goto("/app/places/barangay/nowhere");
  await expect(page.getByTestId("detail-not-found").getByRole("heading", { level: 1, name: "Place not found" })).toBeVisible();
  await page.goto("/app/places/osm/area/1");
  await expect(page.getByTestId("detail-not-found").getByRole("heading", { level: 1 })).toBeVisible();
});

test("Escape closes a place panel back to where it was opened", async ({ page }) => {
  await openApp(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore", exact: true }).click();
  await page.getByTestId("explore-search").click();
  await page.getByRole("searchbox", { name: "Search places, stops and routes" }).fill("Abella");
  await page.getByTestId("search-result-barangay").click();
  await expect(place(page).getByRole("heading", { level: 1, name: "Abella" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app\/search$/);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`Place and Terminal detail have no serious or critical violations (${colorScheme})`, async ({ page }) => {
      test.slow(); // five pages with an axe scan each: ~26 s alone, over the 30 s default in a full parallel run
      for (const path of [SM_PATH, `/app/places/pin/${PLAZA.key}`, "/app/places/barangay/abella", `/app/places/study/${STUDY.code}`]) {
        await page.goto(path);
        await expect(place(page).getByRole("heading", { level: 1 })).toBeFocused();
        await expectAxeClean(page, "place-detail");
      }
      await page.goto("/app/terminals/T01");
      await expect(terminal(page).getByRole("heading", { level: 1 })).toBeFocused();
      await expectAxeClean(page, "terminal-detail");
      await terminal(page).getByRole("tab", { name: "Entrances" }).click();
      await expectAxeClean(page, "terminal-detail");
      await page.goto("/app/terminals/T06");
      await expect(terminal(page).getByRole("heading", { level: 1 })).toBeFocused();
      await expectAxeClean(page, "terminal-detail");
    });
  });
}
