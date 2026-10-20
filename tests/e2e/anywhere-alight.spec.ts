import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { expandOptions, pinTrip } from "./fixtures/options";
import {
  ANYWHERE_DROP_OFF_PLAN,
  COMMUNITY_NOTE,
  NO_JEEPNEY_NO_STREETS_PLAN,
  NO_JEEPNEY_PLAN,
  OWNER_REPORT_NOTE,
  PADYAK_PLAN,
  ROUTE_NOTES_PLAN,
  SHORT_JEEP_PASSES_PLAN,
  TRICYCLE_RECOMMENDED_PLAN,
  WALK_FIRST_PLAN,
} from "./fixtures/plan-responses";

// Increment E (anywhere board and alight, tricycle and padyak options), one flow each at 375 px.
// POST /api/v1/plan is answered with fixtures that follow the planner's rules (fixtures/plan-responses.ts,
// validated against the real schema by tests/unit/e2e-plan-fixtures.test.ts). Tiles are aborted. Every state
// is checked with axe in the light and the dark scheme.

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");
test.use({ viewport: { width: 375, height: 812 } });

const mapEl = (page: Page) => page.getByTestId("naga-map");
const options = (page: Page) => page.getByTestId("trip-option");
const modes = (page: Page) => options(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-mode")));
/** A time with no service-window warning (Manila). */
const MIDDAY = "2026-10-17T11:00:00+08:00";

async function planWith(page: Page, plan: unknown, at = MIDDAY, expand = true) {
  await page.clock.setFixedTime(new Date(at));
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(plan) }),
  );
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
  await pinBoth(page);
  // The sheet rests at peek with the best option; the cards are reached through "All options".
  if (!expand) return;
  await expandOptions(page);
  await expect(page.getByRole("heading", { name: "Trip options" })).toBeVisible();
}

/** Pins the start at the default centre and the destination a little north-east of it. */
async function pinBoth(page: Page) {
  await pinTrip(page);
}

/** Axe on the trip sheet in the light scheme and the dark scheme; the page is left in the scheme it started in. */
async function expectAxeBothSchemes(page: Page, selector = '[data-testid="trip-sheet"]') {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    );
    const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, `${colorScheme}: ${serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Exactly one card is the primary one, and exactly one carries the label "Recommended". */
async function expectOneRecommended(page: Page) {
  await expect(page.locator(".pn-trip-card--primary")).toHaveCount(1);
  await expect(options(page).filter({ has: page.locator(".pn-trip-card__label", { hasText: "Recommended" }) })).toHaveCount(1);
  await expect(page.locator(".pn-trip-card--primary .pn-trip-card__label")).toContainText("Recommended");
}

test("(a) any-point drop-off: a path-only jeepney boards and drops off anywhere, and tells the rider to say para", async ({ page }) => {
  await planWith(page, ANYWHERE_DROP_OFF_PLAN);
  expect(await modes(page)).toEqual(["jeepney", "tricycle"]);
  const jeep = options(page).nth(0);
  await expect(jeep).toContainText("E Centro-Del Rosario via Magsaysay Ave");
  await expect(jeep.getByTestId("card-unverified")).toHaveText("Unverified route");
  await expectOneRecommended(page);
  await expectAxeBothSchemes(page);

  await jeep.click();
  const detail = page.getByTestId("trip-detail");
  await expect(detail.locator("#pn-trip-detail-title")).toBeFocused();
  const steps = detail.getByRole("list", { name: "Trip steps" }).getByRole("listitem");
  await expect(steps.filter({ hasText: /Get on near/ })).toContainText("Stop not marked · confirm with the driver");
  const off = steps.filter({ hasText: /Get off near/ });
  await expect(off).toBeVisible();
  await expect(off.getByTestId("ride-free-alight")).toHaveText(/Tell the driver .para. · stop not marked/);
  await expect(off).toContainText("Para!");
  // A route with no pins names none, and never invents one.
  await expect(detail.getByTestId("ride-passed-stops")).toHaveCount(0);
  await expect(detail).toContainText("Ride along the approximate path");
  await expect(detail.getByTestId("ride-path-label")).toBeVisible();
  await expectAxeBothSchemes(page);
});

test.describe("(b) a trip under 500 m", () => {
  test("no jeepney passes the destination: the walk card is the one Recommended", async ({ page }) => {
    await planWith(page, WALK_FIRST_PLAN);
    expect(await modes(page)).toEqual(["walk", "jeepney", "tricycle"]);
    await expectOneRecommended(page);
    const walk = options(page).nth(0);
    await expect(walk).toHaveClass(/pn-trip-card--primary/);
    await expect(walk).toContainText("Walk ≈ 390 m");
    await expect(walk.getByTestId("card-unverified")).toHaveCount(0);
    await expect(options(page).nth(1).locator(".pn-trip-card__label")).toHaveText("Least walking");
    await expect(options(page).nth(2).locator(".pn-trip-card__label")).toHaveCount(0);
    await expectAxeBothSchemes(page);
  });

  test("a jeepney passes within 100 m of the destination: that jeepney is the one Recommended", async ({ page }) => {
    await planWith(page, SHORT_JEEP_PASSES_PLAN);
    expect(await modes(page)).toEqual(["walk", "jeepney", "tricycle"]);
    await expectOneRecommended(page);
    const jeep = options(page).nth(1);
    await expect(jeep).toHaveClass(/pn-trip-card--primary/);
    await expect(jeep.locator(".pn-trip-card__label")).toHaveText("Recommended");
    // The walk card is still offered first, unlabelled.
    await expect(options(page).nth(0)).not.toHaveClass(/pn-trip-card--primary/);
    await expect(options(page).nth(0)).toContainText("Walk ≈ 390 m");
    await expect(options(page).nth(0).locator(".pn-trip-card__label")).toHaveCount(0);
    await expectAxeBothSchemes(page);
  });
});

test("(c) a trip of 500 m or more: the jeepney is Recommended, the tricycle follows with the minimum fare and no minutes", async ({ page }) => {
  await planWith(page, TRICYCLE_RECOMMENDED_PLAN);
  expect(await modes(page)).toEqual(["jeepney", "tricycle"]);
  await expectOneRecommended(page);
  const tricycle = options(page).nth(1);
  await expect(options(page).first()).toHaveClass(/pn-trip-card--primary/);
  await expect(tricycle).not.toContainText("Recommended");
  await expect(tricycle.getByTestId("fare-chip")).toHaveText("Minimum fare ₱15");
  await expect(tricycle.getByTestId("trip-option-time")).toHaveText("Time not estimated");
  await expect(tricycle).not.toContainText(/\d\s*min\b/i);
  await expect(tricycle.getByTestId("street-distance")).toContainText("along streets");
  await expect(tricycle.getByTestId("street-restriction")).toContainText("Avoids the restricted roads we could locate");
  await expect(tricycle.getByTestId("card-unverified")).toHaveCount(0);
  await expectAxeBothSchemes(page);

  await tricycle.click();
  const detail = page.getByTestId("trip-detail");
  await expect(detail.locator("#pn-trip-detail-title")).toBeFocused();
  await expect(detail.getByRole("list", { name: "Trip steps" })).toContainText("Take a tricycle to");
  await expect(detail.getByTestId("street-distance")).toContainText("along streets");
  await expect(detail.getByTestId("leg-fare")).toContainText("Minimum fare ₱15 · confirm with the driver");
  await expect(detail.getByTestId("street-notes")).toContainText("Tricycle time not estimated");
  await expect(detail.getByTestId("street-notes")).toContainText("discounts not applied");
  await expect(detail).not.toContainText(/\d\s*min\b/i);
  // The terminal closest to the trip's end (T14, about 60 m away).
  await expect(detail.getByTestId("tricycle-terminal")).toHaveText(/^Nearest tricycle terminal: Balatas Tricycle Terminal, about \d+ m/);
  await expectAxeBothSchemes(page);
});

test("(c2) the peek's best option is the Recommended one, the jeepney", async ({ page }) => {
  await planWith(page, TRICYCLE_RECOMMENDED_PLAN, MIDDAY, false);
  await expect(page.getByTestId("options-best")).toContainText("E Centro-Del Rosario via Magsaysay Ave");
  await expect(page.getByTestId("options-best")).not.toContainText("Tricycle");
});

test.describe("(d) no jeepney available", () => {
  test("the tricycle is still offered and its route is honestly not confirmed", async ({ page }) => {
    await planWith(page, NO_JEEPNEY_PLAN);
    expect(await modes(page)).toEqual(["tricycle"]);
    await expectOneRecommended(page);
    await expect(page.getByTestId("trip-options")).toContainText("No jeepney route passes near your start");
    const card = options(page).first();
    await expect(card.getByTestId("street-state")).toHaveText("Route not confirmed");
    await expect(card.getByTestId("street-distance")).toContainText("approximate, not a route");
    await expect(card.getByTestId("street-restriction")).toHaveCount(0);
    await expect(card.getByTestId("fare-chip")).toHaveText("Minimum fare ₱15");
    await expect(card).not.toContainText(/\d\s*min\b/i);
    await expectAxeBothSchemes(page);

    await card.click();
    const detail = page.getByTestId("trip-detail");
    await expect(detail.getByTestId("street-state")).toHaveText("Route not confirmed");
    await expect(detail.getByTestId("street-distance")).toContainText("approximate, not a route");
    // A state that is not a route claims no avoidance of restricted roads.
    await expect(detail).not.toContainText("Avoids the restricted roads");
    await expect(detail.getByTestId("leg-fare")).toContainText("Minimum fare ₱15 · confirm with the driver");
    await expectAxeBothSchemes(page);
  });

  test("with no street map on the phone it says the street route is not available and shows no distance", async ({ page }) => {
    await planWith(page, NO_JEEPNEY_NO_STREETS_PLAN);
    const card = options(page).first();
    await expect(card.getByTestId("street-state")).toHaveText("Street route not available");
    await expect(card.getByTestId("street-distance")).toHaveCount(0);
    await expect(card.getByTestId("fare-chip")).toHaveText("Minimum fare ₱15");
    await expectAxeBothSchemes(page);
  });
});

test("(e) padyak: where both ends share an area the card follows the tricycle, PHP 10 per passenger, no minutes", async ({ page }) => {
  await planWith(page, PADYAK_PLAN);
  expect(await modes(page)).toEqual(["tricycle", "padyak"]);
  await expectOneRecommended(page);
  const padyak = options(page).nth(1);
  await expect(padyak.locator(".pn-trip-card__label")).toHaveText("Short local ride");
  await expect(padyak).toContainText("Padyak");
  await expect(padyak.getByTestId("fare-chip")).toHaveText("₱10 per passenger");
  await expect(padyak.getByTestId("trip-option-time")).toHaveText("Time not estimated");
  await expect(padyak.getByTestId("street-area")).toContainText("Area per city ordinance");
  await expect(padyak.getByTestId("street-area")).toContainText("service not confirmed today");
  await expect(padyak).not.toContainText(/\d\s*min\b/i);
  await expectAxeBothSchemes(page);

  await padyak.click();
  const detail = page.getByTestId("trip-detail");
  await expect(detail.getByRole("list", { name: "Trip steps" })).toContainText("Take a padyak to");
  await expect(detail.getByTestId("street-notes")).toContainText("₱10 per passenger (₱8 with ID discount)");
  await expect(detail.getByTestId("street-notes")).toContainText("Padyak time not estimated");
  await expect(detail.getByTestId("leg-fare")).toContainText("₱10 per passenger · confirm with the driver");
  await expect(detail).not.toContainText(/\d\s*min\b/i);
  await expectAxeBothSchemes(page);
});

test.describe("(f) route notes and the soft service window", () => {
  test("a route note carries its evidence label, owner reports are never read as fact", async ({ page }) => {
    await planWith(page, ROUTE_NOTES_PLAN);
    expect(await modes(page)).toEqual(["jeepney", "jeepney", "tricycle"]);
    const r2 = options(page).nth(0);
    await expect(r2.getByTestId("route-note")).toContainText(OWNER_REPORT_NOTE);
    await expect(r2.getByTestId("route-note-evidence")).toHaveText("Local report · unverified");
    const loopC = options(page).nth(1);
    await expect(loopC.getByTestId("route-note")).toContainText(COMMUNITY_NOTE);
    await expect(loopC.getByTestId("route-note-evidence")).toHaveText("Community-sourced");
    // Inside the usual hours there is no service-window line.
    await expect(page.getByTestId("service-window-note")).toHaveCount(0);
    await expect(options(page).nth(2).getByTestId("route-note")).toHaveCount(0);
    await expectAxeBothSchemes(page);

    await r2.click();
    const detail = page.getByTestId("trip-detail");
    await expect(detail.getByTestId("ride-route-notes")).toContainText(OWNER_REPORT_NOTE);
    await expect(detail.getByTestId("route-note-evidence")).toHaveText("Local report · unverified");
    await expectAxeBothSchemes(page);
  });

  for (const [clock, state, line] of [
    ["2026-10-17T20:30:00+08:00", "last_trips", "Last trips may already have left (unconfirmed)."],
    ["2026-10-17T22:30:00+08:00", "after_end", "Outside the usual hours (about 5 am–9 pm) · unconfirmed"],
    ["2026-10-17T04:15:00+08:00", "before_start", "Outside the usual hours (about 5 am–9 pm) · unconfirmed"],
  ] as const) {
    test(`at ${clock.slice(11, 16)} Manila a soft hint appears on the jeepney cards and never hides an option (${state})`, async ({ page }) => {
      await planWith(page, ROUTE_NOTES_PLAN, clock);
      // Every option is still there, tricycle included.
      expect(await modes(page)).toEqual(["jeepney", "jeepney", "tricycle"]);
      const hints = page.getByTestId("service-window-note");
      await expect(hints).toHaveCount(2);
      for (const hint of await hints.all()) {
        await expect(hint).toHaveAttribute("data-state", state);
        await expect(hint).toContainText(line);
      }
      await expect(options(page).nth(2).getByTestId("service-window-note")).toHaveCount(0);
      // The hint is soft wording: unconfirmed, never a promise or a prohibition.
      await expect(page.getByTestId("trip-options")).not.toContainText(/not running|closed|no service/i);
      await expectAxeBothSchemes(page);

      await options(page).nth(0).click();
      const detail = page.getByTestId("trip-detail");
      const full = detail.getByTestId("service-window-note");
      await expect(full).toContainText("Usually runs about 5:00-21:00 · unconfirmed");
      await expect(page.getByTestId("trip-start")).toBeVisible();
      await expectAxeBothSchemes(page);
    });
  }
});
