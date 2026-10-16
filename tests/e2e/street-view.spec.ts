import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { routeNetwork, SEARCH_INDEX, STOP_A1 } from "./fixtures/network";

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
  await expect(page.getByTestId("stop-detail")).toContainText("Stop sign photo pending");
});

test("Street View opens inside place detail at 375 px with a fake embed and no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await routeNetwork(page);
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  let calls = 0;
  await page.route("https://www.google.com/maps/embed/v1/streetview?**", (route) => {
    calls++;
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="en"><title>Test Street View</title><body><main><h1>Stub</h1></main></body></html>' });
  });
  const sm = SEARCH_INDEX.osmPlaces.find((p) => p.name === "SM City Naga")!;
  await page.goto(`/app/places/osm/${sm.key.slice("osm:".length)}`);
  const section = page.getByTestId("stop-street-view");
  await section.scrollIntoViewIfNeeded();
  expect(calls).toBe(0);
  const open = section.getByRole("button", { name: "View surroundings" });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => calls).toBe(1);
  const box = await section.locator("iframe").boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(section).toContainText("entrance and signage unverified");
  await expect(section.getByRole("link", { name: "Open Street View in Google Maps" })).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-testid="stop-street-view"]').analyze();
  expect(results.violations).toEqual([]);
});
