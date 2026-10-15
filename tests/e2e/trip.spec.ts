import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { LEAST_WALKING_ONLY_PLAN, NO_ROUTE_PLAN, PROVISIONAL_PLAN, WALK_SHORTER_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";

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
  await routeNetwork(page);
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
  // Ride distance on the ride leg of the strip too (decision B).
  await expect(cards.nth(0).locator(".pn-legstrip")).toContainText("≈ 1.2 km");
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
  await expect(detail.getByTestId("leg-fare")).toHaveText(/Loop A\s*Estimate ₱14–₱17 · from reported fare rules · matrix not verified/);
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
  // Focus is not lost with the unmounted Retry button: it lands on the results heading.
  await expect(page.getByRole("heading", { name: "Trip options" })).toBeFocused();
});

test("loading is announced through the persistent announcer", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await interceptPlan(page, async (route) => {
    await gate;
    await fulfill(route, PROVISIONAL_PLAN);
  });
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-loading")).toBeVisible();
  await expect(page.getByTestId("home-announcer")).toHaveText("Looking for provisional routes…");
  release();
  await expect(page.getByTestId("home-announcer")).toContainText("2 provisional trip options found");
});

test("a rejected request offers to change the points instead of a retry", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, { error: { code: "bad_request", message: "x", requestId: "r1" } }, 400));
  await openApp(page);
  await pinBoth(page);
  const error = page.getByTestId("trip-error");
  await expect(error).toContainText("Couldn't plan this trip");
  await expect(error.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await error.getByRole("button", { name: "Change start or destination" }).click();
  await expect(page.getByTestId("endpoint-start").locator(".pn-endpoint__main")).toBeFocused();
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

test("moving a pin by hand never shows the previous trip's options while the new plan loads", async ({ page }) => {
  let gated = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await interceptPlan(page, async (route) => {
    if (gated) await gate;
    await fulfill(route, PROVISIONAL_PLAN);
  });
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-option")).toHaveCount(2);

  gated = true;
  await page.getByTestId("endpoint-destination").locator(".pn-endpoint__main").click();
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  const before = await mapEl(page).getAttribute("data-center-lng");
  await drag(page, 40, 0);
  await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
  await page.getByRole("button", { name: "Set destination here" }).click();

  await expect(page.getByTestId("trip-loading")).toBeVisible();
  await expect(page.getByTestId("trip-option")).toHaveCount(0);
  await expect(page.getByText("Updating for your new location…")).toHaveCount(0);
  release();
  await expect(page.getByTestId("trip-option")).toHaveCount(2);
});

test("a pending focus move is dropped when an endpoint is cleared", async ({ page }) => {
  await interceptPlan(page, async (route, n) => {
    if (n === 1) return fulfill(route, { error: { code: "unavailable", message: "x", requestId: "r1" } }, 503);
    if (n === 2) return new Promise<void>(() => undefined); // the retry never settles
    return fulfill(route, PROVISIONAL_PLAN);
  });
  await openApp(page);
  await pinBoth(page);
  await page.getByTestId("trip-error").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("trip-loading")).toBeVisible();

  // Clear the destination while the retry is pending, then set it again.
  await page.getByRole("button", { name: "Clear destination", exact: true }).click();
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  await page.getByRole("button", { name: "Set destination here" }).click();

  await expect(page.getByTestId("trip-option")).toHaveCount(2);
  // Focus stays where the pin flow put it (the destination row), not on the results heading.
  await expect(page.getByTestId("endpoint-destination").locator(".pn-endpoint__main")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Trip options" })).not.toBeFocused();
});

// GPS refinements of the start (Important 1 of the review): a better fix re-dispatches the start.
test.describe("GPS refinement while results are shown", () => {
  const BISCAST = { latitude: 13.6314651, longitude: 123.1927517 };
  test.use({ permissions: ["geolocation"], geolocation: { ...BISCAST, accuracy: 30 } });

  /** The app received the refined fix (its accuracy pill updates). */
  const nextFixWithAccuracy = (page: Page, accuracy: number) =>
    expect(page.getByTestId("accuracy-pill")).toContainText(`± ${accuracy} m`);

  async function gpsStartAndPinDestination(page: Page) {
    await openApp(page);
    await page.getByRole("button", { name: "Use current location" }).click();
    await expect(page.getByTestId("endpoint-start")).toContainText("Your location");
    await page.getByRole("button", { name: "Choose on map", exact: true }).click();
    const before = await mapEl(page).getAttribute("data-center-lng");
    await drag(page, -120, 80);
    await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
    await page.getByRole("button", { name: "Set destination here" }).click();
  }

  test("the open detail stays open when the replan still has the option", async ({ page, context }) => {
    // The refinement's plan response is held until the checks below have run, so they see the
    // screen WHILE the replan is in flight (not after it settled).
    let gated = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const calls = await interceptPlan(page, async (route) => {
      if (gated) await gate;
      await fulfill(route, PROVISIONAL_PLAN);
    });
    await gpsStartAndPinDestination(page);
    await page.getByTestId("trip-option").first().click();
    const detail = page.getByTestId("trip-detail");
    await expect(detail).toBeVisible();
    const before = calls.length;

    // ~45 m north with a better accuracy: the start is refined and the trip replanned.
    gated = true;
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0004, longitude: BISCAST.longitude, accuracy: 10 });
    await nextFixWithAccuracy(page, 10);
    await expect.poll(() => calls.length).toBeGreaterThan(before);

    // In flight: the detail stays, its heading keeps focus, and no loading state replaces it.
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "To your destination" })).toBeFocused();
    await expect(page.getByTestId("trip-loading")).toHaveCount(0);
    release();

    // Settled: still open and focused.
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "To your destination" })).toBeFocused();
    await expect(page.getByTestId("trip-loading")).toHaveCount(0);
    await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(2);
  });

  test("a refinement under 25 m does not replan", async ({ page, context }) => {
    const calls = await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
    await gpsStartAndPinDestination(page);
    await expect(page.getByTestId("trip-option")).toHaveCount(2);
    const before = calls.length;

    // ~11 m: refined start, same plan.
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0001, longitude: BISCAST.longitude, accuracy: 10 });
    await nextFixWithAccuracy(page, 10);
    await expect(page.getByTestId("trip-option")).toHaveCount(2);

    // A later refinement that does cross 25 m (from the planned point) replans exactly once, so
    // the 11 m one above sent no request.
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0004, longitude: BISCAST.longitude, accuracy: 5 });
    await nextFixWithAccuracy(page, 5);
    await expect.poll(() => calls.length).toBeGreaterThan(before);
    await expect(page.getByTestId("trip-option")).toHaveCount(2);
    expect(calls.length).toBe(before + 1);
  });

  test("the detail closes when the replan drops the option; focus goes to the results heading", async ({ page, context }) => {
    let replanned = false;
    await interceptPlan(page, (route) => fulfill(route, replanned ? LEAST_WALKING_ONLY_PLAN : PROVISIONAL_PLAN));
    await gpsStartAndPinDestination(page);
    await page.getByTestId("trip-option").first().click();
    await expect(page.getByTestId("trip-detail")).toBeVisible();

    replanned = true;
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0004, longitude: BISCAST.longitude, accuracy: 10 });
    await nextFixWithAccuracy(page, 10);

    await expect(page.getByTestId("trip-detail")).toHaveCount(0);
    await expect(page.getByTestId("trip-option")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Trip options" })).toBeFocused();
    await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(0);
  });
});
