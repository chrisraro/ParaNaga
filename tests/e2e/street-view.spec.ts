import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { routeNetwork, STOP_A1 } from "./fixtures/network";

test.skip(({ isMobile }) => !isMobile, "Stop detail uses the phone gate");
test("Street View is on demand, uses the stop coordinate and closes without changing stop evidence", async ({ page }) => {
  await routeNetwork(page);
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  let calls = 0;
  let location: string | null = null;
  await page.route("https://www.google.com/maps/embed/v1/streetview?**", (route) => {
    calls++;
    location = new URL(route.request().url()).searchParams.get("location");
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="en"><title>Test Street View</title><body><main><h1>Stub panorama viewer</h1><p>No Google imagery captured</p></main></body></html>' });
  });
  await page.goto(`/app/stops/${STOP_A1.stop.id}`);
  const section = page.getByTestId("stop-street-view");
  await expect(section).toBeVisible();
  expect(calls).toBe(0);
  await expect(section.locator("iframe")).toHaveCount(0);
  await section.getByRole("button", { name: "View surroundings" }).click();
  await expect.poll(() => calls).toBe(1);
  expect(location).toBe(`${STOP_A1.stop.lat},${STOP_A1.stop.lng}`);
  await expect(section.locator("iframe")).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  await expect(section).toContainText("signage and boarding location unverified");
  const results = await new AxeBuilder({ page }).include('[data-testid="stop-street-view"]').analyze();
  expect(results.violations).toEqual([]);
  await section.getByRole("button", { name: "Close Street View" }).click();
  await expect(section.locator("iframe")).toHaveCount(0);
  await expect(page.getByTestId("stop-detail")).toContainText("Not verified for navigation.");
});
