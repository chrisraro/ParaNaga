import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { ALL_ROUTES, ROUTE_R8A, SNAPSHOT, STOP_A1, STOPS_ALL, routeNetwork } from "./fixtures/network";

// Stop pins on the map, Stop detail and Route detail (Task 7). The network API is answered with
// REAL responses captured from a throwaway Neon branch (fixtures/network); tiles are aborted.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("naga-map");
const overlayPaths = (page: Page) => page.locator(".leaflet-overlay-pane path");
const A1_ID = STOP_A1.stop.id;
const B18 = STOPS_ALL.stops.find((s) => s.source.layer === "Loop Service B" && s.source.code === "B18")!;

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }),
  );
});

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

/** Screen position of a lat/lng from the map's reported centre and zoom (Web Mercator). */
async function screenPoint(page: Page, lat: number, lng: number) {
  const el = mapEl(page);
  const box = (await el.boundingBox())!;
  const zoom = Number(await el.getAttribute("data-zoom"));
  const cLat = Number(await el.getAttribute("data-center-lat"));
  const cLng = Number(await el.getAttribute("data-center-lng"));
  const scale = 256 * 2 ** zoom;
  const project = (la: number, ln: number) => {
    const s = Math.sin((la * Math.PI) / 180);
    return { x: ((ln + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
  };
  const p = project(lat, lng);
  const c = project(cLat, cLng);
  return { x: box.x + box.width / 2 + (p.x - c.x), y: box.y + box.height / 2 + (p.y - c.y) };
}

async function expectAxeClean(page: Page) {
  // Let the entrance animation finish so axe measures settled colours.
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), null, 1)).toEqual([]);
}

test("pins come from the snapshot as one canvas layer, with no lines and no extra DOM markers", async ({ page }) => {
  const calls = await routeNetwork(page);
  await openApp(page);
  await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  // Decision D2: one snapshot of the published revision, filtered in the browser; the map view
  // never goes to the server (no stops?bbox= request).
  expect(calls.snapshots).toEqual([SNAPSHOT.revision.revisionId]);
  expect(calls.bboxes).toEqual([]);
  // Canvas, not DOM markers or SVG paths: the overlay paths are only the boundary and the mask.
  await expect(page.locator(".leaflet-overlay-pane canvas")).toHaveCount(1);
  expect(await overlayPaths(page).count()).toBe(2);
  await expect(page.locator(".leaflet-marker-pane .leaflet-marker-icon")).toHaveCount(0);
});

test("tapping a pin opens the stop with exactly the source pin's layer, coordinates and description (A1)", async ({ page }) => {
  await routeNetwork(page);
  await openApp(page);
  await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  const before = { lat: await mapEl(page).getAttribute("data-center-lat"), lng: await mapEl(page).getAttribute("data-center-lng") };

  const a1 = await screenPoint(page, STOP_A1.stop.lat, STOP_A1.stop.lng);
  await page.mouse.click(a1.x, a1.y);
  await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));

  const detail = page.getByTestId("stop-detail");
  await expect(detail.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeFocused();
  await expect(detail.getByTestId("stop-status-badge")).toHaveText("Mapped candidate");
  await expect(detail.getByTestId("stop-warning")).toHaveText(
    "Not verified for navigation. Source: public My Maps snapshot (15 Oct 2026).",
  );
  const record = detail.getByTestId("source-record");
  await expect(record).toHaveCount(1);
  await expect(record).toContainText("Loop Service A · code A1");
  await expect(record.getByTestId("source-coordinates")).toHaveText("13.6233869, 123.1846726");
  await expect(record.getByTestId("source-description")).toContainText("Raw description: “Plaza Rizal”");
  await expect(record.getByTestId("source-description")).toContainText("same point also listed in Loop Service C (A1)");
  const serving = detail.getByTestId("serving-routes");
  await expect(serving.getByRole("link")).toHaveCount(1);
  await expect(serving).toContainText("Loop A");
  await expect(serving).toContainText("Centro–Magsaysay Loop A");
  await expect(serving).toContainText("Provisional stop 1 · clockwise (from pin order)");
  await expect(serving).toContainText("Unverified route");
  await expect(detail).toContainText("Not yet surveyed");
  await expect(detail).toContainText("Photo pending");
  await expect(detail).toContainText("Verification opens soon");
  await expect(detail.getByRole("button", { name: /help verify/i })).toHaveCount(0);
  await expect(detail).not.toContainText(/verified stop|exact/i);

  // Passing nearby is collapsed, and honest when opened.
  const nearby = detail.getByRole("button", { name: "Passing nearby · not confirmed to stop" });
  await expect(nearby).toHaveAttribute("aria-expanded", "false");
  await nearby.click();
  await expect(nearby).toHaveAttribute("aria-expanded", "true");
  await expect(detail.locator(".pn-disclosure-panel")).toContainText("Not yet surveyed");

  // The map underneath is inert while the panel is open.
  await expect(page.getByTestId("app-home-layer")).toHaveAttribute("inert", "");
  await expectAxeClean(page);

  // Back returns to the same map view.
  await detail.getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app$/);
  // Next keeps the left page mounted but hidden (back/forward state), so check visibility.
  await expect(page.getByTestId("stop-detail")).toBeHidden();
  await expect(mapEl(page)).toHaveAttribute("data-center-lat", before.lat!);
  await expect(mapEl(page)).toHaveAttribute("data-center-lng", before.lng!);
  await expect(page.getByTestId("app-home-layer")).not.toHaveAttribute("inert", /.*/);
});

test("keyboard: the Nearby stops list opens the same stop, and focus returns to it", async ({ page }) => {
  await routeNetwork(page);
  await openApp(page);
  const nearby = page.getByTestId("nearby-stops");
  const first = nearby.getByRole("link").first();
  await expect(first).toContainText("Plaza Rizal (A1)");
  await expect(first).toContainText("Mapped candidate · not yet verified");
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeFocused();

  await page.getByTestId("detail-back").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await expect(first).toBeFocused();
});

test("pins ignore taps while a start or destination pin is being placed", async ({ page }) => {
  await routeNetwork(page);
  await openApp(page);
  await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  const a1 = await screenPoint(page, STOP_A1.stop.lat, STOP_A1.stop.lng);
  await page.mouse.click(a1.x, a1.y);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: "Set start here" })).toBeVisible();
});

test("route R8-A: 30 provisional stops in pin order, the trial notice and an estimate fare", async ({ page }) => {
  await routeNetwork(page);
  await page.goto(`/app/stops/${A1_ID}`);
  await page.getByTestId("serving-routes").getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/routes\/R8-A$/);

  const route = page.getByTestId("route-detail");
  await expect(route.getByRole("heading", { level: 1, name: "Centro–Magsaysay Loop A" })).toBeFocused();
  await expect(route).toContainText("Loop A");
  await expect(route).toContainText("Group 8 · jeepney");
  await expect(route.getByTestId("route-evidence")).toHaveText("Provisional stops");
  await expect(route.getByTestId("route-partial")).toContainText("Partial data.");
  await expect(route.getByTestId("fare-tile")).toContainText("₱14–₱17");
  await expect(route.getByTestId("fare-tile")).toContainText("Estimate");
  await expect(route).toContainText("From reported fare rules · matrix not verified");
  await expect(route).toContainText("Not observed");
  await expect(route).toContainText("Class 2");
  await expect(route).toContainText("Plan only");
  await expect(route).not.toContainText(/exact/i);

  const stops = route.getByTestId("route-stops").getByRole("listitem");
  await expect(stops).toHaveCount(30);
  await expect(stops.first()).toContainText("Plaza Rizal (A1)");
  await expect(stops.nth(29)).toContainText(`(A30)`);
  await expect(route).toContainText("Direction: clockwise (from pin order).");

  const trial = route.getByTestId("trial-notice");
  await expect(trial).toHaveCount(1);
  await expect(trial).toContainText("Resolution 2025-735");
  await expect(trial).toContainText("adopted 11 Nov 2025 for 30 days; permanence unconfirmed");
  await expect(route.getByTestId("street-order").getByRole("listitem")).toHaveCount(ROUTE_R8A.route.legalStreets.circuit!.length);
  await expect(route.getByTestId("route-allocation")).toContainText(
    "71 units allocated to group 8 in the plan, no per-route count (not a count of jeepneys running). Sources S01, S02 · revision osm-places-2026-10-15.",
  );
  await expect(route).toContainText("Corrections open soon");
  await expectAxeClean(page);

  // Back goes to the stop it came from.
  await route.getByTestId("detail-back").click();
  await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));
});

test("route R3 shows its two street structures separately", async ({ page }) => {
  await routeNetwork(page);
  await page.goto("/app/routes/R3");
  const route = page.getByTestId("route-detail");
  await expect(route.getByRole("heading", { level: 1, name: "Centro–Del Rosario via Roxas Avenue" })).toBeVisible();
  await expect(route.getByTestId("route-evidence")).toHaveText("Documented only");
  await expect(route.getByTestId("route-partial")).toContainText("Showing the legal plan's street order.");
  await expect(route.getByTestId("street-order").getByRole("listitem")).toHaveCount(14);
  const extra = route.getByTestId("extra-structure");
  await expect(extra).toHaveCount(1);
  await expect(extra.getByRole("listitem")).toHaveCount(9);
  await expect(extra).toContainText("Southbound Terminal");
  await expect(route).toContainText("they are shown separately and not merged");
  await expect(route).toContainText("Felix Plaxo");
  await expect(route.getByTestId("route-stops")).toHaveCount(0);
  await expect(route.getByRole("radiogroup", { name: "Direction" })).toHaveCount(0);
  await expect(route.getByTestId("trial-notice")).toHaveCount(0);
  await expect(route.getByTestId("route-allocation")).toContainText("28 units allocated in the plan (not a count of jeepneys running).");
  await expectAxeClean(page);
});

test("route R5 toggles between its inbound and outbound street order", async ({ page }) => {
  await routeNetwork(page);
  await page.goto("/app/routes/R5");
  const route = page.getByTestId("route-detail");
  const toCentro = route.getByRole("radio", { name: "Toward Centro" });
  const away = route.getByRole("radio", { name: "Toward San Felipe" });
  await expect(toCentro).toHaveAttribute("aria-checked", "true");
  const list = route.getByTestId("street-order");
  await expect(list).toHaveAttribute("aria-label", "Street order toward centro");
  const inboundFirst = await list.getByRole("listitem").first().textContent();
  await away.click();
  await expect(away).toHaveAttribute("aria-checked", "true");
  await expect(list).toHaveAttribute("aria-label", "Street order toward san felipe");
  expect(await list.getByRole("listitem").first().textContent()).not.toBe(inboundFirst);
  // Arrow keys move the choice (radiogroup pattern).
  await page.keyboard.press("ArrowLeft");
  await expect(toCentro).toHaveAttribute("aria-checked", "true");
  await expect(toCentro).toBeFocused();
});

test("Show on map closes the stop and centres the map on it", async ({ page }) => {
  await routeNetwork(page);
  await page.goto(`/app/stops/${B18.id}`);
  const detail = page.getByTestId("stop-detail");
  await expect(detail.getByRole("heading", { level: 1, name: "Unnamed pin B18" })).toBeVisible();
  await expect(detail.getByTestId("source-description")).toContainText("Raw description: empty");
  await detail.getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(async () => Math.abs(Number(await mapEl(page).getAttribute("data-center-lat")) - B18.lat)).toBeLessThan(0.0005);
  await expect.poll(async () => Math.abs(Number(await mapEl(page).getAttribute("data-center-lng")) - B18.lng)).toBeLessThan(0.0005);
});

test("unknown or malformed ids and codes show a not-found panel", async ({ page }) => {
  await routeNetwork(page);
  await page.goto("/app/stops/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1, name: "Stop not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to map" })).toBeVisible();

  await page.goto("/app/stops/not-a-uuid");
  await expect(page.getByRole("heading", { level: 1, name: "Stop not found" })).toBeVisible();

  await page.goto("/app/routes/R99");
  await expect(page.getByRole("heading", { level: 1, name: "Route not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to map" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("detail-not-found")).toBeHidden();
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("stop and route detail pass axe in dark mode", async ({ page }) => {
    await routeNetwork(page);
    await page.goto(`/app/stops/${A1_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeVisible();
    await expectAxeClean(page);
    await page.goto("/app/routes/R8-A");
    await expect(page.getByRole("heading", { level: 1, name: "Centro–Magsaysay Loop A" })).toBeVisible();
    await expectAxeClean(page);
  });
});

// Every route of the approved plan renders its detail screen (real captured responses).
for (const fixture of ALL_ROUTES) {
  const { code, name, hasProvisionalStops } = fixture.route;
  const { inbound, outbound, circuit } = fixture.route.legalStreets;
  test(`route detail renders for ${code}`, async ({ page }) => {
    await routeNetwork(page);
    await page.goto(`/app/routes/${code}`);
    const route = page.getByTestId("route-detail");
    await expect(route.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(route.locator(".pn-loop-chip")).toHaveCount(1);
    await expect(route.getByTestId("route-evidence")).toHaveText(hasProvisionalStops ? "Provisional stops" : "Documented only");
    await expect(route.getByTestId("fare-tile")).toContainText("₱14–₱17");
    await expect(route.getByTestId("fare-tile")).toContainText("Estimate");
    const streets = route.getByTestId("street-order").getByRole("listitem");
    if (inbound && outbound) {
      await expect(route.getByRole("radiogroup", { name: "Direction" })).toBeVisible();
      await expect(streets).toHaveCount(inbound.length);
      await route.getByRole("radio").nth(1).click();
      await expect(streets).toHaveCount(outbound.length);
    } else {
      await expect(route.getByRole("radiogroup", { name: "Direction" })).toHaveCount(0);
      await expect(streets).toHaveCount(circuit!.length);
    }
    await expect(route.getByTestId("route-stops")).toHaveCount(hasProvisionalStops ? 1 : 0);
    await expect(route).not.toContainText(/exact|street order not recorded/i);
    await expectAxeClean(page);
  });
}

test.describe("Show on map history", () => {
  async function tapA1(page: Page) {
    await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
    const a1 = await screenPoint(page, STOP_A1.stop.lat, STOP_A1.stop.lng);
    await page.mouse.click(a1.x, a1.y);
    await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeVisible();
  }
  const showOnMap = (page: Page) => page.getByTestId("stop-detail").filter({ visible: true }).getByRole("button", { name: "Show on map" });

  test("from a pin tap it goes back in history (Back does not reopen the stop)", async ({ page }) => {
    await routeNetwork(page);
    await openApp(page);
    await tapA1(page);
    await showOnMap(page).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goBack();
    expect(page.url()).not.toContain(`/app/stops/${A1_ID}`);
  });

  test("from a Nearby stops link it goes back in history too", async ({ page }) => {
    await routeNetwork(page);
    await openApp(page);
    await page.getByTestId("nearby-stops").getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));
    await showOnMap(page).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goBack();
    expect(page.url()).not.toContain(`/app/stops/${A1_ID}`);
  });

  test("after panel → panel links (stop → route → stop) it opens the map as a new entry", async ({ page }) => {
    await routeNetwork(page);
    await openApp(page);
    await tapA1(page);
    await page.getByTestId("serving-routes").getByRole("link").click();
    await expect(page).toHaveURL(/\/app\/routes\/R8-A$/);
    await page.getByTestId("route-stops").getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));
    await showOnMap(page).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/app/stops/${A1_ID}$`));
  });
});
