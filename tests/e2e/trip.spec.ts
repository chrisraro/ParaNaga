import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { NO_ROUTE_PLAN, PROVISIONAL_PLAN, WALK_SHORTER_PLAN } from "./fixtures/plan-responses";

// Trip options and trip detail (Task 6). POST /api/v1/plan is intercepted with fixtures
// (allowed in tests only), so nothing here needs a database. Tiles are aborted.

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("naga-map");
const overlayPaths = (page: Page) => page.locator(".leaflet-overlay-pane path");
const BADGE = "Unverified route — confirm with the driver";

type PlanCall = { url: string; body: unknown };

async function interceptPlan(page: Page, respond: (route: Route, n: number) => Promise<void>): Promise<PlanCall[]> {
  const calls: PlanCall[] = [];
  await page.route("**/api/v1/plan", async (route) => {
    const request = route.request();
    calls.push({ url: request.url(), body: request.postDataJSON() });
    await respond(route, calls.length);
  });
  return calls;
}

const fulfill = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
});

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

/** Pins the start at the default centre and the destination a little north-east of it. */
async function pinBoth(page: Page) {
  const chooseOnMap = page.getByRole("button", { name: "Choose on map", exact: true });
  await chooseOnMap.click();
  await page.getByRole("button", { name: "Set start here" }).click();
  await chooseOnMap.click();
  const before = await mapEl(page).getAttribute("data-center-lng");
  await drag(page, -120, 80);
  await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
  await page.getByRole("button", { name: "Set destination here" }).click();
}

test("trip options show the unverified badge, estimate chips and no times", async ({ page }) => {
  const calls = await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);

  const options = page.getByTestId("trip-options");
  await expect(options.getByRole("heading", { name: "Trip options" })).toBeVisible();
  const cards = options.getByTestId("trip-option");
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(card.getByTestId("unverified-badge")).toHaveText(BADGE);
    await expect(card).toContainText("Time not available");
    await expect(card).toContainText("Loop A");
    await expect(card).toContainText("clockwise");
  }
  await expect(cards.nth(0).getByTestId("fare-chip")).toHaveText("Estimate ₱14–₱17");
  await expect(cards.nth(0)).toContainText("No transfers");
  await expect(cards.nth(0)).toContainText("≈ 230 m");
  // Least walking: the long loop ride is obvious.
  await expect(cards.nth(1)).toContainText("Least walking");
  await expect(cards.nth(1)).toContainText("Ride ≈ 5.5 km");
  await expect(cards.nth(1).getByTestId("fare-chip")).toHaveText("Estimate ₱14–₱20");

  // Accessible names carry the label and the fare estimate.
  await expect(page.getByRole("button", { name: /Recommended · Fewest transfers.*Estimate ₱14–₱17/ })).toBeVisible();

  await expect(options).toContainText("Walking distances are estimates; paths not verified.");
  await expect(options).toContainText("Transport data revision provisional-loops-2026-10-15");
  await expect(page.getByText("Verified route", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Exact|arrive/i)).toHaveCount(0);
  await expect(page.getByTestId("no-verified-commute")).toHaveCount(0);

  // Coordinates travel only in the POST body, never in the URL.
  expect(calls.length).toBeGreaterThan(0);
  const last = calls.at(-1)!;
  expect(new URL(last.url).search).toBe("");
  expect(last.body).toMatchObject({ origin: { lat: expect.any(Number), lng: expect.any(Number) }, destination: { lat: expect.any(Number), lng: expect.any(Number) } });
});

test("trip detail lists the legs, highlights stops as markers and draws no line", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  const pathsBefore = await overlayPaths(page).count();
  await pinBoth(page);

  await page.getByTestId("trip-option").first().click();
  const detail = page.getByTestId("trip-detail");
  await expect(detail.getByRole("heading", { name: "To your destination" })).toBeFocused();
  await expect(detail.getByTestId("unverified-badge")).toHaveText(BADGE);
  await expect(detail.getByTestId("fare-chip")).toHaveText("Estimate ₱14–₱17");
  await expect(detail).toContainText("Time not available");

  const steps = detail.getByRole("list", { name: "Trip steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText("Walk ≈ 230 m to Plaza Rizal (A1)");
  await expect(steps.nth(0)).toContainText("path not verified");
  await expect(steps.nth(1)).toContainText("Board Loop A at Plaza Rizal (A1)");
  await expect(steps.nth(1)).toContainText("Direction: clockwise (from pin order)");
  await expect(steps.nth(1)).toContainText("Signboard not yet verified");
  await expect(steps.nth(1)).toContainText("Ride 4 stops");
  await expect(steps.nth(2)).toContainText("Get off at Avenue Square (A5)");
  await expect(steps.nth(2)).toContainText("Para!");
  await expect(steps.nth(2)).not.toContainText(/buzz/i);
  await expect(steps.nth(3)).toContainText("Walk ≈ 120 m to your destination");
  await expect(detail.getByTestId("leg-fare")).toHaveText(/Loop A\s*Estimate ₱14–₱17 · reported minimum, matrix not verified/);
  await expect(detail).toContainText("Corrections open soon");
  await expect(detail.getByRole("link")).toHaveCount(0);

  // Boarding and getting-off stops are DOM markers; no path (line) is added to the map.
  await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Board at Plaza Rizal (A1)" })).toBeAttached();
  await expect(page.getByRole("img", { name: "Get off at Avenue Square (A5)" })).toBeAttached();
  expect(await overlayPaths(page).count()).toBe(pathsBefore);
  await expect(page.locator(".leaflet-overlay-pane polyline")).toHaveCount(0);

  const a11y = await new AxeBuilder({ page }).include('[data-testid="trip-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);

  await page.getByRole("button", { name: "Back to trip options" }).click();
  await expect(page.getByTestId("trip-options")).toBeVisible();
  await expect(page.getByTestId("trip-option").first()).toBeFocused();
  await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(0);
});

test("no coverage keeps a clear message", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, NO_ROUTE_PLAN));
  await openApp(page);
  const pathsBefore = await overlayPaths(page).count();
  await pinBoth(page);

  const card = page.getByTestId("no-provisional-route");
  await expect(card.getByRole("heading", { name: "No provisional route nearby yet" })).toBeVisible();
  await expect(card).toContainText("Loops A and B are the only routes we can suggest for now.");
  await expect(page.getByTestId("trip-option")).toHaveCount(0);
  expect(await overlayPaths(page).count()).toBe(pathsBefore);
});

test("walk_shorter names the walking estimate", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, WALK_SHORTER_PLAN));
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("no-provisional-route")).toContainText("Walking (≈ 850 m) is shorter than any ride we can suggest.");
});

test("a server error offers a retry that recovers", async ({ page }) => {
  await interceptPlan(page, (route, n) =>
    n === 1
      ? fulfill(route, { error: { code: "unavailable", message: "Try again.", requestId: "r1" } }, 503)
      : fulfill(route, PROVISIONAL_PLAN),
  );
  await openApp(page);
  await pinBoth(page);

  const error = page.getByTestId("trip-error");
  await expect(error).toContainText("Couldn't load trip options");
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("trip-option")).toHaveCount(2);
  await expect(page.getByTestId("trip-error")).toHaveCount(0);
});

test("offline shows the offline state; retry works once back online", async ({ page, context }) => {
  let offline = true;
  await interceptPlan(page, (route) => (offline ? route.abort("internetdisconnected") : fulfill(route, PROVISIONAL_PLAN)));
  await openApp(page);
  await context.setOffline(true);
  await pinBoth(page);

  const error = page.getByTestId("trip-error");
  await expect(error).toContainText("You're offline");
  await context.setOffline(false);
  offline = false;
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("trip-option")).toHaveCount(2);
});
