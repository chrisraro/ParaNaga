import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { chooseOption, expandOptions } from "./fixtures/options";
import { ACCESS_PLAN, FRANCIA_NOTE, SPECIAL_TRIP_PLAN, VIA_PLAN } from "./fixtures/plan-responses";

// Increment F, T6: via chips, the access card, the special-trip card and the far note in the real app.
// Set FAR_SHOTS=<dir> to also save 375 px screenshots in light and dark (the report's screenshots).

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");

async function open(page: Page, plan: unknown) {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(plan) }),
  );
  await routeNetwork(page);
  await page.clock.setFixedTime(new Date("2026-10-16T09:30:00+08:00"));
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  await page.getByRole("button", { name: "Set start here" }).click();
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  const before = await mapEl(page).getAttribute("data-center-lng");
  const box = (await mapEl(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y + 40, { steps: 4 });
  await page.mouse.move(x - 120, y + 80, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
  await page.getByRole("button", { name: "Set destination here" }).click();
  await expandOptions(page);
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
  await shoot(page, "via-chips");
  await chooseOption(page, 0);
  await expect(page.getByTestId("detail-via")).toHaveText(`via Magsaysay · ${FRANCIA_NOTE}`);
  await expect(page.getByTestId("trip-detail").getByRole("heading", { level: 2 })).toHaveText("R2");
});

test("Pacol from the south: the access card, its detail and guidance (the tricycle step does not end the trip)", async ({ page }) => {
  await open(page, ACCESS_PLAN);
  const card = page.getByTestId("trip-option").first();
  await expect(card).toContainText("Tricycle, then Jeep R6");
  await expect(card.getByTestId("access-line")).toHaveText("Tricycle to the jeepney station, then ride R6. For when you'd rather not walk.");
  await expect(card.getByTestId("access-tricycle")).toHaveText("Tricycle min ₱15 · confirm with the driver");
  await expect(card.getByTestId("fare-chip")).toHaveText("From ₱33");
  await expect(card.getByTestId("card-unverified")).toHaveText("Unverified route");
  await expect(page.getByTestId("far-note")).toContainText("Tricycles to Pacol charge special-trip fares");
  await shoot(page, "access-card");

  await chooseOption(page, 0);
  const detail = page.getByTestId("trip-detail");
  await expect(detail.getByTestId("far-note")).toBeVisible();
  await expect(detail.getByRole("list", { name: "Trip steps" })).toContainText("Take a tricycle to Jeepney station to Pacol");
  await expect(detail.getByTestId("leg-fare").first()).toContainText("Minimum fare ₱15 · confirm with the driver");
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
  await shoot(page, "special-trip-card");
});
