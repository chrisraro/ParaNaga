import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { LEAST_WALKING_ONLY_PLAN, NO_ROUTE_PLAN, PROVISIONAL_PLAN, WALK_SHORTER_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";
import { chooseOption, chooseOnMapVia, expandOptions, openTripSheet, pinTrip } from "./fixtures/options";

// Trip options and trip detail (Task 6). POST /api/v1/plan is intercepted with fixtures
// (allowed in tests only), so nothing here needs a database. Tiles are aborted.

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("naga-map");
const overlayPaths = (page: Page) => page.locator(".leaflet-overlay-pane path");
const BADGE = "Unverified route — confirm with the driver";
// PROVISIONAL_PLAN with the snapshot's model (walks on the walk-graph fixture's paths where found).
const EST_0930_FIRST = "Estimate 8–15 min + waiting (unknown)";
const EST_0930_SECOND = "Estimate 30–47 min + waiting (unknown)";
const EST_0710_FIRST = "Estimate 9–18 min + waiting (unknown)";
const EST_0710_SECOND = "Estimate 34–62 min + waiting (unknown)";

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

/** Pins the start at the default centre and the destination a little north-east of it. */
async function pinBoth(page: Page) {
  await pinTrip(page);
}

test("trip options show the unverified badge, estimate chips and honest time estimates", async ({ page }) => {
  const calls = await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);

  const options = page.getByTestId("trip-options");
  await expect(options.getByRole("heading", { name: "Trip options" })).toBeVisible();
  const cards = options.getByTestId("trip-option");
  await expect(cards).toHaveCount(3);
  // Two jeepney cards, then the Recommended tricycle (a trip of 500 m or more has no walk card).
  await expect(cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-mode")))).resolves.toEqual(["jeepney", "jeepney", "tricycle"]);
  for (const card of await options.locator('[data-mode="jeepney"]').all()) {
    // A card is minimal: the caution chip (the full badge is in the detail), the route, an estimated range.
    await expect(card.getByTestId("card-unverified")).toHaveText("Unverified route");
    await expect(card.getByTestId("unverified-badge")).toHaveCount(0);
    await expect(card).toContainText(/Estimate \d+–\d+ min \+ waiting \(unknown\)/);
    await expect(card).toContainText("Loop A");
    await expect(card.locator('abbr[title="Estimate"]').first()).toHaveText("Est.Estimate");
  }
  await expect(cards.nth(0).getByTestId("fare-chip")).toHaveText("Est.Estimate ₱14");
  await expect(cards.nth(0)).toContainText("Fewest transfers");
  await expect(cards.nth(0)).toContainText("No transfers");
  // Leg-by-leg text, distances, the vehicle chip and the footers are not on the card.
  await expect(cards.nth(0)).not.toContainText(/≈ 230 m|≈ 1.2 km|clockwise|Walk ≈|Jeepney/);
  await expect(cards.nth(1)).toContainText("Least walking");
  await expect(cards.nth(1).getByTestId("fare-chip")).toHaveText("Est.Estimate ₱16–₱18");
  // The tricycle card: Recommended, the minimum fare, no minutes, no driver badge (it is not a jeepney ride).
  await expect(cards.nth(2)).toContainText("Recommended");
  await expect(cards.nth(2).getByTestId("fare-chip")).toHaveText("Minimum fare ₱15");
  await expect(cards.nth(2).getByTestId("trip-option-time")).toHaveText("Time not estimated");
  await expect(cards.nth(2).getByTestId("card-unverified")).toHaveCount(0);
  await expect(page.locator(".pn-trip-card--primary")).toHaveCount(1);

  // Accessible names carry the label, the caution and the fare estimate, with the full word.
  await expect(page.getByRole("button", { name: /Fewest transfers.*Unverified route.*Loop A.*Estimate ₱14(?!–)/ })).toBeVisible();

  await expect(options).not.toContainText(/Walking distances|revision|Source/);
  await expect(page.getByText("Verified route", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Exact|arrive/i)).toHaveCount(0);
  await expect(page.getByTestId("no-verified-commute")).toHaveCount(0);

  // Coordinates travel only in the POST body, never in the URL.
  expect(calls.length).toBeGreaterThan(0);
  const last = calls.at(-1)!;
  expect(new URL(last.url).search).toBe("");
  expect(last.body).toMatchObject({ origin: { lat: expect.any(Number), lng: expect.any(Number) }, destination: { lat: expect.any(Number), lng: expect.any(Number) } });
});

test("setting both ends fits the whole route above the sheet instead of zooming in", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);
  await expect(page.getByTestId("trip-options")).toBeVisible();

  const box = (await mapEl(page).boundingBox())!;
  const pins = page.locator(".pn-marker");
  await expect(pins).toHaveCount(2);
  // The fit animates (0.8 s): wait until both pins settle inside the area above the sheet.
  await expect
    .poll(async () => {
      const sheetTop = (await page.getByTestId("trip-sheet").boundingBox())!.y;
      for (const pin of await pins.all()) {
        const b = await pin.boundingBox();
        if (!b || b.x < box.x || b.x + b.width > box.x + box.width || b.y < box.y || b.y + b.height > sheetTop - 24) return false;
      }
      return true;
    }, { timeout: 10_000 })
    .toBe(true);
  const zoom = Number(await mapEl(page).getAttribute("data-zoom"));
  expect(zoom).toBeLessThanOrEqual(17);
  // Concise, and never "Map centered on ..." when fitting a route.
  await expect(page.getByTestId("home-announcer")).toContainText("Route shown.");
  await expect(page.getByTestId("naga-map").locator("p.sr-only")).not.toHaveText("Route shown");
  await expect(page.getByText(/Map centered on/)).toHaveCount(0);
});

test("trip detail lists the legs, highlights stops as markers above the trip lines", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);

  await chooseOption(page);
  const detail = page.getByTestId("trip-detail");
  await expect(detail.getByRole("heading", { name: "Loop A" })).toBeFocused();
  await expect(detail.getByTestId("unverified-badge")).toHaveText(BADGE);
  await expect(detail.getByTestId("fare-chip")).toHaveText("Estimate ₱14");
  await expect(detail).toContainText(/Estimate \d+–\d+ min \+ waiting \(unknown\)/);

  const steps = detail.getByRole("list", { name: "Trip steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText("Walk ≈ 230 m to Plaza Rizal (A1)");
  await expect(steps.nth(0)).toContainText("path not verified");
  await expect(steps.nth(1)).toContainText("Board Loop A (clockwise) at Plaza Rizal (A1)");
  await expect(steps.nth(1)).toContainText("4 stops");
  await expect(steps.nth(1)).not.toContainText(/Signboard|1.2 km/);
  await expect(steps.nth(1)).toContainText("Approximate path, not a verified route shape");
  await expect(steps).not.toContainText(["Mapped candidate"]);
  await expect(steps.nth(2)).toContainText("Get off at Avenue Square (A5)");
  await expect(steps.nth(2)).toContainText("Say “Para!” near here");
  await expect(steps.nth(2)).not.toContainText(/buzz/i);
  await expect(steps.nth(3)).toContainText("Walk ≈ 120 m to your destination");
  await expect(detail.getByTestId("leg-fare")).toHaveText(/Loop A\s*Estimate ₱14$/);
  await expect(detail).not.toContainText(/Corrections|from reported fare rules|matrix not verified/);
  // Only two links: the Sources link in the top bar and the fare basis.
  await expect(detail.getByRole("link")).toHaveText(["Sources", "How fares are estimated"]);

  // Boarding and getting-off stops are DOM markers above the trip's own lines (Task 12); the
  // routes overview is not drawn while a trip is shown.
  await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Board at Plaza Rizal (A1)" })).toBeAttached();
  await expect(page.getByRole("img", { name: "Get off at Avenue Square (A5)" })).toBeAttached();
  await expect(page.locator(".leaflet-overlay-pane path.pn-line--ride").first()).toBeAttached();
  await expect(page.locator(".leaflet-overlay-pane path.pn-line--route")).toHaveCount(0);
  await expect(page.locator(".leaflet-overlay-pane polyline")).toHaveCount(0);

  const a11y = await new AxeBuilder({ page }).include('[data-testid="trip-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);

  await page.getByRole("button", { name: "Back to trip options" }).click();
  await expect(page.getByTestId("trip-options")).toBeVisible();
  await expect(page.getByTestId("trip-option").first()).toBeFocused();
  await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(0);
});

// Time estimates with a pinned Manila clock (Task 14 fix): exact ranges from the snapshot's model,
// the peak note only when the peak band is used, the "How times are estimated" sheet (sources,
// assumptions, focus), and axe in light and dark on the options, the detail and the sheet.
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
async function expectAxeClean(page: Page, selector: string) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

const TIMES = {
  "09:30": { peak: null, first: EST_0930_FIRST, second: EST_0930_SECOND },
  "07:10": { peak: "Peak hours: slower (06:00–08:00)", first: EST_0710_FIRST, second: EST_0710_SECOND },
} as const;

for (const colorScheme of ["light", "dark"] as const) {
  for (const clock of ["09:30", "07:10"] as const) {
    test(`time estimates at ${clock} Manila: exact ranges, peak note ${clock === "07:10" ? "shown" : "absent"}, the basis sheet, axe (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.clock.setFixedTime(new Date(`2026-10-16T${clock}:00+08:00`));
      await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
      await openApp(page);
      await pinBoth(page);
      await expandOptions(page);
      const want = TIMES[clock];
      const cards = page.getByTestId("trip-option");
      await expect(cards.nth(0).getByTestId("trip-option-time")).toContainText(want.first);
      await expect(cards.nth(1).getByTestId("trip-option-time")).toContainText(want.second);
      // The peak note is in the detail only; the card's range already includes the peak band.
      await expect(page.getByTestId("trip-option").getByTestId("trip-peak-note")).toHaveCount(0);
      // The range is spoken in words in the card's accessible name.
      await expect(cards.nth(0)).toHaveAccessibleName(/Estimate \d+ to \d+ minutes \+ waiting \(unknown\)/);
      await expectAxeClean(page, '[data-testid="trip-sheet"]');

      await cards.nth(0).click();
      const detail = page.getByTestId("trip-detail");
      await expect(detail.getByTestId("trip-detail-time")).toContainText(want.first);
      if (want.peak) await expect(detail.getByTestId("trip-peak-note")).toHaveText(want.peak);
      else await expect(detail.getByTestId("trip-peak-note")).toHaveCount(0);
      await expect(detail.getByTestId("leg-time").filter({ hasText: "ride" })).toHaveText(/^≈ \d+–\d+ min ride$/);
      await expect(detail.getByTestId("ride-fleet-class").first()).toHaveText("Traditional jeepney");
      await expectAxeClean(page, '[data-testid="trip-sheet"]');

      const opener = detail.getByTestId("how-times-estimated-btn");
      await opener.click();
      const sheet = page.getByTestId("eta-basis-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Close how times are estimated" })).toBeFocused();
      for (const code of ["N28", "N16", "N29", "N04"]) await expect(sheet).toContainText(code);
      for (const a of ["A1:", "A2:", "A3:"]) await expect(sheet).toContainText(a);
      await expect(sheet).toContainText("Times are ranges. They do not include waiting, because Naga has no published jeepney schedules.");
      await expect(sheet).not.toContainText(/\blive\b/i);
      // Modal focus: Tab cycles inside the sheet (Close, the scrollable body); Escape closes and
      // focus returns to the opener.
      await page.keyboard.press("Tab");
      await expect(sheet.getByTestId("eta-basis-body")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(sheet.getByRole("button", { name: "Close how times are estimated" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(sheet.getByTestId("eta-basis-body")).toBeFocused();
      await expectAxeClean(page, '[data-testid="eta-basis-sheet"]');
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  }
}

test("opening and closing a trip detail keeps exactly one stop-pin canvas", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);
  const canvases = page.locator(".leaflet-overlay-pane canvas");
  await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  await expect(canvases).toHaveCount(1);
  for (let i = 0; i < 2; i++) {
    await chooseOption(page);
    await expect(page.getByTestId("trip-detail")).toBeVisible();
    await expect(mapEl(page)).toHaveAttribute("data-stop-pins", "0");
    await page.getByRole("button", { name: "Back to trip options" }).click();
    await expect(page.getByTestId("trip-detail")).toHaveCount(0);
    await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  }
  await expect(canvases).toHaveCount(1);
});

test("no coverage keeps a clear message", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, NO_ROUTE_PLAN));
  await openApp(page);
  await expect(page.locator(".leaflet-overlay-pane path.pn-line--route").first()).toBeAttached();
  const pathsBefore = await overlayPaths(page).count();
  await pinBoth(page);

  const card = page.getByTestId("no-provisional-route");
  await expect(card.getByRole("heading", { name: "No provisional route connects these points yet" })).toBeVisible();
  await expect(card).toContainText("Only Loops A and B for now.");
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
  await expect(error).toContainText("Couldn't load options");
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("trip-option")).toHaveCount(3);
  await expect(page.getByTestId("trip-error")).toHaveCount(0);
  // Focus is not lost with the unmounted Retry button: the list rests at peek, so it lands on the
  // "All options" toggle; once the list is open the toggle's target heading takes it.
  await expect(page.getByTestId("options-toggle")).toBeFocused();
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
  await expect(page.getByTestId("home-announcer")).toHaveText("Looking for routes…");
  release();
  await expect(page.getByTestId("home-announcer")).toContainText("3 options found");
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
  await openTripSheet(page);
  await context.setOffline(true);
  await chooseOnMapVia(page, "start");
  await drag(page, 120, -80);
  await page.getByRole("button", { name: "Set start here" }).click();

  const error = page.getByTestId("trip-error");
  await expect(error).toContainText("You're offline");
  await context.setOffline(false);
  offline = false;
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("trip-option")).toHaveCount(3);
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
  await expect(page.getByTestId("trip-option")).toHaveCount(3);

  gated = true;
  await page.getByTestId("endpoint-destination").locator(".pn-endpoint__main").click();
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  const before = await mapEl(page).getAttribute("data-center-lng");
  await drag(page, 40, 0);
  await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
  await page.getByRole("button", { name: "Set destination here" }).click();

  await expect(page.getByTestId("trip-loading")).toBeVisible();
  await expect(page.getByTestId("trip-option")).toHaveCount(0);
  await expect(page.getByText("Updating…")).toHaveCount(0);
  release();
  await expect(page.getByTestId("trip-option")).toHaveCount(3);
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

  await expect(page.getByTestId("trip-option")).toHaveCount(3);
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
    await chooseOnMapVia(page, "destination");
    await drag(page, -120, 80);
    await page.getByRole("button", { name: "Set destination here" }).click();
    await page.getByRole("button", { name: "Use current location" }).click();
    await expect(page.getByTestId("endpoint-start")).toContainText("Your location");
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
    await chooseOption(page);
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
    await expect(detail.getByRole("heading", { name: "Loop A" })).toBeFocused();
    await expect(page.getByTestId("trip-loading")).toHaveCount(0);
    release();

    // Settled: still open and focused.
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Loop A" })).toBeFocused();
    await expect(page.getByTestId("trip-loading")).toHaveCount(0);
    await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(2);
  });

  test("a refinement under 25 m does not replan", async ({ page, context }) => {
    const calls = await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
    await gpsStartAndPinDestination(page);
    await expect(page.getByTestId("trip-option")).toHaveCount(3);
    const before = calls.length;

    // ~11 m: refined start, same plan.
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0001, longitude: BISCAST.longitude, accuracy: 10 });
    await nextFixWithAccuracy(page, 10);
    await expect(page.getByTestId("trip-option")).toHaveCount(3);

    // A later refinement that does cross 25 m (from the planned point) replans exactly once, so
    // the 11 m one above sent no request.
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0004, longitude: BISCAST.longitude, accuracy: 5 });
    await nextFixWithAccuracy(page, 5);
    await expect.poll(() => calls.length).toBeGreaterThan(before);
    await expect(page.getByTestId("trip-option")).toHaveCount(3);
    expect(calls.length).toBe(before + 1);
  });

  test("the detail closes when the replan drops the option; focus goes to the results heading", async ({ page, context }) => {
    let replanned = false;
    await interceptPlan(page, (route) => fulfill(route, replanned ? LEAST_WALKING_ONLY_PLAN : PROVISIONAL_PLAN));
    await gpsStartAndPinDestination(page);
    await chooseOption(page);
    await expect(page.getByTestId("trip-detail")).toBeVisible();

    replanned = true;
    await context.setGeolocation({ latitude: BISCAST.latitude + 0.0004, longitude: BISCAST.longitude, accuracy: 10 });
    await nextFixWithAccuracy(page, 10);

    await expect(page.getByTestId("trip-detail")).toHaveCount(0);
    await expect(page.getByTestId("trip-option")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Trip options" })).toBeFocused();
    await expect(page.locator(".leaflet-marker-pane .pn-trip-stop")).toHaveCount(0);
  });
});

// U2: options rest at peek with the best option and a toggle; the toggle lifts the sheet to full.
test("options peek: best-option summary and a labelled toggle; full lists every option; Back returns as left", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);
  const sheet = page.getByTestId("trip-sheet");
  const toggle = page.getByTestId("options-toggle");
  await expect(sheet).toHaveAttribute("data-snap", "0");
  // The Recommended option is the tricycle here (500 m or more), so that is what the peek reads, with no minutes and no wait.
  await expect(page.getByTestId("options-best")).toContainText(/Tricycle.*Time not estimated.*Minimum fare ₱15/);
  await expect(page.getByTestId("options-best")).not.toContainText(/waiting|Loop A/);
  await expect(toggle).toHaveText("All options");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // A tricycle is not a jeepney ride: no unverified-route chip at the peek.
  await expect(page.getByTestId("options-best-unverified")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-controls", "pn-trip-options-list");
  // Both rows, the summary and the toggle are inside the visible sheet, targets >= 44 px.
  const vh = page.viewportSize()!.height;
  for (const el of [toggle, page.getByTestId("options-best"), page.getByTestId("endpoint-destination")]) {
    const box = (await el.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    expect(box.height).toBeGreaterThanOrEqual(44 - 1);
  }

  await toggle.click();
  await expect(sheet).toHaveAttribute("data-snap", "2");
  await expect(toggle).toHaveText("All options");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("options-best")).toHaveCount(0); // the list is open: no duplicate summary
  await expect(page.getByRole("heading", { name: "Trip options" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Trip options" })).toBeVisible();
  await expect(page.getByTestId("trip-option")).toHaveCount(3);

  // Choosing an option opens its detail at half; Back returns to the list at full, focus on the card.
  await page.getByTestId("trip-option").nth(1).click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await expect(sheet).toHaveAttribute("data-snap", "1");
  await page.getByRole("button", { name: "Back to trip options" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "2");
  await expect(page.getByTestId("trip-option").nth(1)).toBeFocused();

  // Collapse: back to peek, focus stays on the toggle.
  await toggle.click();
  await expect(sheet).toHaveAttribute("data-snap", "0");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("options-best")).toBeVisible();
});

test("a re-plan of the same ends keeps the detent the rider chose; new ends return to peek", async ({ page }) => {
  await interceptPlan(page, (route, n) => (n === 2 ? fulfill(route, { error: { code: "unavailable", message: "Try again.", requestId: "r1" } }, 503) : fulfill(route, PROVISIONAL_PLAN)));
  await openApp(page);
  await pinBoth(page);
  const sheet = page.getByTestId("trip-sheet");
  await page.getByTestId("options-toggle").click();
  await expect(sheet).toHaveAttribute("data-snap", "2");
  // Swap -> new ends -> peek again.
  await page.getByRole("button", { name: "Swap start and destination" }).click();
  await expect(page.getByTestId("trip-error")).toBeVisible();
  await page.getByTestId("trip-error").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("options-toggle")).toBeVisible();
  await expect(sheet).toHaveAttribute("data-snap", "0");
  await page.getByTestId("options-toggle").click();
  await expect(sheet).toHaveAttribute("data-snap", "2");
});

test("the list leaving and returning for the same ends (a cancelled pick) keeps full and stays interactive", async ({ page }) => {
  await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await pinBoth(page);
  const sheet = page.getByTestId("trip-sheet");
  await page.getByTestId("options-toggle").click();
  await expect(sheet).toHaveAttribute("data-snap", "2");
  await page.getByTestId("endpoint-start").locator(".pn-endpoint__main").click();
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("options-toggle")).toBeVisible();
  await expect(sheet).toHaveAttribute("data-snap", "2");
  await expect(page.getByTestId("options-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".pn-sheet__rest")).not.toHaveAttribute("inert", /.*/);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
});

for (const mode of ["light", "dark", "high contrast"] as const) {
  test(`axe is clean on options peek, options full, detail and a guidance step (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode === "dark" ? "dark" : "light" });
    if (mode === "high contrast") {
      await page.addInitScript(() => {
        localStorage.setItem("paranaga.prefs", JSON.stringify({ theme: "system", highContrast: true, lowData: false, historyEnabled: false }));
      });
    }
    await interceptPlan(page, (route) => fulfill(route, PROVISIONAL_PLAN));
    await openApp(page);
    await pinBoth(page);
    if (mode === "high contrast") await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    await expect(page.getByTestId("options-toggle")).toBeVisible();
    await expectAxeClean(page, '[data-testid="trip-sheet"]');
    await expandOptions(page);
    await expectAxeClean(page, '[data-testid="trip-sheet"]');
    await chooseOption(page);
    await expect(page.getByTestId("trip-detail")).toBeVisible();
    await expectAxeClean(page, '[data-testid="trip-sheet"]');
    await page.getByTestId("trip-start").click();
    await expect(page.getByTestId("guidance")).toBeVisible();
    await expectAxeClean(page, '[data-testid="trip-sheet"]');
    // Keyboard focus on the primary action: it is the focused element, visible and inside the viewport.
    const primary = page.getByTestId("guidance-atStop");
    await primary.focus();
    await expect(primary).toBeFocused();
    const box = (await primary.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(page.getByTestId("trip-sheet")).toHaveAttribute("data-snap", "1");
  });
}
