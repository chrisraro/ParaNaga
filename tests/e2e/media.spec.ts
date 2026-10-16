import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { routeNetwork, SEARCH_INDEX, STOP_A1 } from "./fixtures/network";

test.skip(({ isMobile }) => !isMobile, "Commuter screens use the phone gate");
test.beforeEach(async ({ page }) => {
  await routeNetwork(page);
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
});

test("licensed Explore photo loads and its credits remain available when the sources API fails", async ({ page }) => {
  await page.goto("/app/explore");
  await page.getByRole("tab", { name: "Markets & malls" }).click();
  const card = page.getByTestId("explore-card").filter({ has: page.getByRole("heading", { name: "SM City Naga", exact: true }) });
  const photo = card.getByRole("img", { name: "SM City Naga, Dec 2025" });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // The card carries only the image and one link; creator and licence are on Sources and credits.
  await expect(card.getByRole("link", { name: "Photo credit" })).toHaveAttribute("href", /^\/app\/help\/sources#photo-/);
  await expect(card).not.toContainText("CC BY-SA");
  await card.screenshot({ path: "docs/media/explore-markets-mobile.png" });
  await page.route("**/api/v1/sources", (route) => route.fulfill({ status: 503, body: "{}" }));
  await card.getByRole("link", { name: "Photo credit" }).click();
  await expect(page.getByTestId("source-credits")).toBeVisible();
  await expect(page.getByTestId("photo-credit")).toHaveCount(17);
  await expect(page.getByTestId("photo-credit").first()).toContainText("CC BY");
  await expect(page.getByText("Bundled photo credits", { exact: false })).toBeVisible();
  await page.locator("#photo-c182bd120772").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/media/sources-photo-credit-mobile.png" });
  await expect(page.getByRole("link", { name: "Geist copyright and full font license" })).toHaveAttribute("href", "/licenses/Geist-OFL.txt");
});

test("landmark image does not assert that a stop sign or boarding curb is verified", async ({ page }) => {
  await page.goto(`/app/stops/${STOP_A1.stop.id}`);
  const detail = page.getByTestId("stop-detail");
  await expect(detail.getByTestId("reference-photo")).toContainText("Landmark photo, not the stop.");
  await detail.getByTestId("reference-photo").scrollIntoViewIfNeeded();
  await expect.poll(() => detail.getByTestId("reference-photo").locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "docs/media/stop-landmark-reference-mobile.png" });
  const results = await new AxeBuilder({ page }).include('[data-testid="stop-detail"]').analyze();
  expect(results.violations).toEqual([]);
});

test("a failed photo keeps its credit and a readable fallback", async ({ page }) => {
  const sm = SEARCH_INDEX.osmPlaces.find((place) => place.name === "SM City Naga")!;
  await page.route(/\/_next\/image\?/, (route) => route.abort());
  await page.goto(`/app/places/osm/${sm.key.slice(4)}`);
  const ref = page.getByTestId("reference-photo");
  await expect(ref).toContainText("Photo unavailable on this device.");
  await expect(ref.getByRole("link", { name: "Photo credit" })).toBeVisible();
});
