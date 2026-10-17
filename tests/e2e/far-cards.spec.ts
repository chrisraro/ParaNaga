import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { chooseOption, expandOptions, pinTrip } from "./fixtures/options";
import {
  ACCESS_NEXT_TO_WALK_PLAN, ACCESS_PLAN, FAR_JEEP_CARARAYAN_PLAN, FAR_JEEP_PACOL_PLAN, FAR_JEEP_PANICUASON_PLAN, FRANCIA_NOTE, PROVISIONAL_PLAN, SPECIAL_ONLY_PLAN,
  SPECIAL_TRIP_PLAN, VIA_PLAN,
} from "./fixtures/plan-responses";

// Increment F, T6: via chips, the access card, the special-trip card and the far note in the real app.
// Set FAR_SHOTS=<dir> to also save 375 px screenshots in light and dark (the report's screenshots).

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");

async function open(page: Page, plan: unknown, expand = true) {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(plan) }),
  );
  await routeNetwork(page);
  await page.clock.setFixedTime(new Date("2026-10-16T09:30:00+08:00"));
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await pinTrip(page);
  if (expand) await expandOptions(page);
}

/** Axe (serious and critical) on the trip sheet in the light and the dark scheme; leaves the page light. */
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

/** FAR_SHOTS=<dir>: the sheet at 375 px in light and dark. */
async function shoot(page: Page, name: string) {
  const dir = process.env.FAR_SHOTS;
  if (!dir) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
});

test("Del Rosario: each route shows its via; R2 keeps the unconfirmed Francia line in the detail", async ({ page }) => {
  await open(page, VIA_PLAN);
  await expect(page.getByTestId("card-via")).toHaveText(["via Magsaysay", "via Roxas (Diversion)", "via Panganiban"]);
  await expectAxeBothSchemes(page);
  await shoot(page, "via-chips");
  await chooseOption(page, 0);
  await expect(page.getByTestId("detail-via")).toHaveText(`via Magsaysay · ${FRANCIA_NOTE}`);
  await expect(page.getByTestId("trip-detail").getByRole("heading", { level: 2 })).toHaveText("R2");
});

test("Pacol from the south: the access card, its detail and guidance (the tricycle step does not end the trip)", async ({ page }) => {
  await open(page, ACCESS_PLAN);
  const card = page.getByTestId("trip-option").first();
  await expect(card).toContainText("Tricycle, then Jeep R6");
  await expect(card.getByTestId("access-line")).toHaveText("For when you'd rather not walk.");
  await expect(card.getByTestId("access-tricycle")).toHaveText("Tricycle min ₱15 · confirm with the driver");
  await expect(card.getByTestId("fare-chip")).toHaveText("From ₱33");
  await expect(card.getByTestId("card-unverified")).toHaveText("Unverified route");
  await expect(page.getByTestId("far-note")).toContainText("Tricycles to Pacol charge special-trip fares");
  await expectAxeBothSchemes(page);
  await shoot(page, "access-card");

  await chooseOption(page, 0);
  const detail = page.getByTestId("trip-detail");
  await expect(detail.getByTestId("far-note")).toBeVisible();
  await expect(detail.getByRole("list", { name: "Trip steps" })).toContainText("Take a tricycle to Jeepney station to Pacol");
  await expect(detail.getByTestId("leg-fare").first()).toContainText("Minimum fare ₱15 · confirm with the driver");
  await expectAxeBothSchemes(page);
  await shoot(page, "access-detail");

  await page.getByTestId("trip-start").click();
  const guide = page.getByTestId("guidance");
  await expect(guide).toHaveAttribute("data-screen", "street_ride");
  await page.getByTestId("trip-sheet").getByRole("button", { name: "I got off the tricycle", exact: true }).click();
  await expect(guide).toHaveAttribute("data-screen", "walk");
  // Focus follows the step: the new step's heading takes it (the tapped button is gone).
  await expect(page.locator("#pn-guide-title")).toBeFocused();
});

test("Cararayan from near the Balatas terminal: R1 first, the special-trip tricycle after it, the far note above", async ({ page }) => {
  await open(page, SPECIAL_TRIP_PLAN);
  const cards = page.getByTestId("trip-option");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Recommended");
  const special = cards.nth(1);
  await expect(special).not.toContainText("Recommended");
  await expect(special.getByTestId("street-special")).toHaveText([
    "Special trip · fare not fixed",
    "From Balatas Tricycle Terminal: local report, unconfirmed",
  ]);
  await expect(special.getByTestId("fare-chip")).toHaveText("Fare not fixed");
  await expect(special).not.toContainText(/min\b|minutes/);
  const note = page.getByTestId("far-note");
  await expect(note).toContainText("Local report");
  await expect(note).toContainText("special-trip fares");
  await expectAxeBothSchemes(page);
  await shoot(page, "special-trip-card");
});

const FAR_JEEP_PLANS = [
  ["Pacol", FAR_JEEP_PACOL_PLAN, "R6"],
  ["Panicuason", FAR_JEEP_PANICUASON_PLAN, "R7"],
  ["Cararayan", FAR_JEEP_CARARAYAN_PLAN, "R1"],
] as const;

for (const [zone, plan, code] of FAR_JEEP_PLANS) {
  test(`${zone}: the jeepney (${code}) is Recommended, there is no tricycle card and no minutes, the far note shows`, async ({ page }) => {
    await open(page, plan);
    const cards = page.getByTestId("trip-option");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-mode", "jeepney");
    await expect(cards.first()).toContainText("Recommended");
    await expect(cards.first()).toContainText(code);
    await expect(page.locator('[data-mode="tricycle"]')).toHaveCount(0);
    await expect(page.getByTestId("far-note")).toContainText("special-trip fares");
    // No tricycle element anywhere carries minutes (a tricycle is never timed).
    await expect(page.getByTestId("trip-sheet").getByText(/tricycle/i).filter({ hasText: /\d+\s*(min|minutes)\b/i })).toHaveCount(0);
    await expectAxeBothSchemes(page);
  });
}

test("Pacol from the south with a walk option: walk, jeepney, access in order; guidance steps from the tricycle to the walk", async ({ page }) => {
  await open(page, ACCESS_NEXT_TO_WALK_PLAN);
  const cards = page.getByTestId("trip-option");
  await expect(cards).toHaveCount(3);
  // Order: walk, the unlabelled jeepney reached on foot, then the access card beside it.
  expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-mode")))).toEqual(["walk", "jeepney", "jeepney"]);
  await expect(cards.nth(0)).not.toContainText("Recommended");
  await expect(cards.nth(1)).not.toContainText("Recommended");
  await expect(cards.nth(1)).not.toContainText("Tricycle, then Jeep");
  await expect(cards.nth(2)).toContainText("Tricycle, then Jeep R6");
  await expect(cards.nth(2)).not.toContainText("Recommended");
  await expect(cards.nth(2).getByTestId("access-tricycle")).not.toContainText(/\d+\s*(min|minutes)\b/);
  await expectAxeBothSchemes(page);

  await chooseOption(page, 2);
  const steps = page.getByTestId("trip-detail").getByRole("list", { name: "Trip steps" });
  const text = await steps.innerText();
  expect(text).toMatch(/Take a tricycle[\s\S]*Walk[\s\S]*Get on/);
  await expectAxeBothSchemes(page);

  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toHaveAttribute("data-screen", "street_ride");
  await page.getByTestId("trip-sheet").getByRole("button", { name: "I got off the tricycle", exact: true }).click();
  await expect(page.getByTestId("guidance")).toHaveAttribute("data-screen", "walk");
  await expect(page.locator("#pn-guide-title")).toBeFocused();
  await expectAxeBothSchemes(page);
});

test("Pacol with nothing Recommended: the peek counts the options, never 'Best option'", async ({ page }) => {
  await open(page, ACCESS_NEXT_TO_WALK_PLAN, false);
  await expect(page.getByTestId("options-count")).toHaveText("3 options");
  await expect(page.getByTestId("options-best")).toHaveCount(0);
  await expect(page.getByTestId("options-peek")).not.toContainText("Best option");
  await expectAxeBothSchemes(page);
});

test("A special trip alone (no jeepney): unlabelled, 'Fare not fixed', never Recommended; the peek counts one option", async ({ page }) => {
  await open(page, SPECIAL_ONLY_PLAN, false);
  await expect(page.getByTestId("options-count")).toHaveText("1 option");
  await expandOptions(page);
  const card = page.getByTestId("trip-option");
  await expect(card).toHaveCount(1);
  await expect(card).not.toContainText("Recommended");
  await expect(card.getByTestId("fare-chip")).toHaveText("Fare not fixed");
  await expect(card).not.toContainText(/\d+\s*(min|minutes)\b/);
  await expectAxeBothSchemes(page);
});

test("A city trip is unchanged: the tricycle is Recommended from 500 m, no far note", async ({ page }) => {
  await open(page, PROVISIONAL_PLAN);
  const recommended = page.getByTestId("trip-option").filter({ hasText: "Recommended" });
  await expect(recommended).toHaveCount(1);
  await expect(recommended).toHaveAttribute("data-mode", "tricycle");
  await expect(page.getByTestId("far-note")).toHaveCount(0);
  await expect(page.getByTestId("street-special")).toHaveCount(0);
  await expectAxeBothSchemes(page);
});
