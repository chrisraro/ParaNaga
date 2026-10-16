import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// Google suggestions in Search (Task 15) with a fake proxy: our own /api/v1/places/* routes are
// answered by page routes, so nothing reaches Google. The fallback: at the daily cap (or with
// Google off) the screen keeps showing OpenStreetMap results only; with suggestions, rows are
// labelled "Google suggestion · not verified" and a pick becomes a trip end. What was typed only
// ever travels in a POST body, never in a URL.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search places, stops and routes" });
const POINT = { lat: 13.6262, lng: 123.1873 };

async function fakePlaces(page: Page, suggest: unknown) {
  const bodies: unknown[] = [];
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com|googleapis\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/places/suggest", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(suggest) });
  });
  await page.route("**/api/v1/places/resolve", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", point: POINT }) });
  });
  return { bodies, urls };
}

test("at the daily cap: says so and keeps OpenStreetMap results only", async ({ page }) => {
  const seen = await fakePlaces(page, { status: "capped" });
  await page.goto("/app/search");
  await searchBox(page).fill("zzyzx bakeshop");
  await expect(page.getByTestId("search-google-note")).toHaveText("No more Google suggestions today. Showing OpenStreetMap results only.");
  await expect(page.getByTestId("search-result-google")).toHaveCount(0);
  // On-device search still works as before.
  await searchBox(page).fill("SM City");
  await expect(page.getByTestId("search-result-osm").first()).toContainText("SM City Naga");
  expect(seen.bodies).toEqual([{ query: "zzyzx bakeshop", sessionToken: expect.any(String) }]);
  expect(seen.urls.filter((u) => /zzyzx|bakeshop/i.test(u))).toEqual([]);
});

test("with suggestions: labelled rows, and a pick sets the destination", async ({ page }) => {
  const seen = await fakePlaces(page, { status: "ok", suggestions: [{ placeId: "ChIJfake", title: "Zzyzx Bakeshop", subtitle: "Naga, Camarines Sur" }] });
  await page.goto("/app/search?for=destination");
  await searchBox(page).fill("zzyzx bakeshop");
  const row = page.getByTestId("search-result-google");
  await expect(row).toContainText("Zzyzx Bakeshop");
  await expect(row).toContainText("Google suggestion · not verified");
  await expect(page.getByTestId("search-google-attribution")).toContainText("Suggestions from Google Maps");
  await row.click();
  await expect(page.getByTestId("endpoint-destination").locator(".pn-endpoint__main")).toContainText("Zzyzx Bakeshop");
  const token = (seen.bodies[0] as { sessionToken: string }).sessionToken;
  expect(seen.bodies[1]).toEqual({ placeId: "ChIJfake", sessionToken: token });
  expect(seen.urls.filter((u) => /zzyzx|bakeshop/i.test(u))).toEqual([]);
});
