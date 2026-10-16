import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { LEAST_WALKING_ONLY_PLAN, PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";

// Saved trips, saved places, Share and history (Increment A, Task 8; decision D3: everything on
// this phone, IndexedDB). POST /api/v1/plan is intercepted with fixtures; tiles are aborted;
// every test checks for CSP (report-only) violations.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const BADGE = "Unverified route — confirm with the driver";

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
  await routeNetwork(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP (report-only) violations").toEqual([]);
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

/** Pins both ends on the map, then opens the first trip option. */
async function planAndOpenTrip(page: Page) {
  const chooseOnMap = page.getByRole("button", { name: "Choose on map", exact: true });
  await chooseOnMap.click();
  await page.getByRole("button", { name: "Set start here" }).click();
  await chooseOnMap.click();
  const before = await mapEl(page).getAttribute("data-center-lng");
  await drag(page, -120, 80);
  await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
  await page.getByRole("button", { name: "Set destination here" }).click();
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
}

/** Number of records in an IndexedDB store of the device database. */
async function countStore(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("paranaga.device");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(name)) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction(name).objectStore(name).count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      }),
    store,
  );
}

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="saved-page"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test("plan → Save → the card on Saved; offline the card still opens and shows the steps", async ({ page, context }) => {
  await openApp(page);
  await planAndOpenTrip(page);
  const save = page.getByTestId("trip-save");
  await expect(save).toHaveAccessibleName("Save");
  await save.click();
  await expect(save).toHaveAttribute("data-state", "saved");
  // No pressed state: the name says what a tap does now.
  await expect(save).toHaveAccessibleName("Saved, remove from saved trips");
  await expect(page.getByTestId("trip-action-status")).toContainText("Saved on this phone");

  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeFocused();
  await expect(page.getByText("Saved trips open without signal. Map tiles may be missing offline, so each card works as text.")).toBeVisible();
  const card = page.getByTestId("saved-trip");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Available offline");
  await expect(card).toContainText("From Pinned location");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Pinned location");
  await expect(card).toContainText(/Estimate (?:7–14|8–17) min \+ waiting \(unknown\) · Estimate ₱14 · data from 16 Oct 2026/);
  await expect(card).toContainText("Loop A");
  await expect(card).not.toContainText("Changed since saved");

  // A later visit, then no signal: the card opens from this phone and shows the saved steps,
  // labelled as saved.
  // Routed requests would still be answered offline, so the API fails like the network from
  // here on: the revision check (head, snapshot) and the plan.
  await page.unroute("**/api/v1/plan");
  await page.route("**/api/v1/plan", (route) => route.abort("internetdisconnected"));
  await page.route("**/api/v1/network/**", (route) => route.abort("internetdisconnected"));
  const networkCalls: string[] = [];
  page.on("requestfailed", (r) => {
    if (r.url().includes("/api/v1/network/")) networkCalls.push(r.url());
  });
  // A fresh visit: the map first (the router holds it for the way back), then Saved.
  await openApp(page);
  // Count only the Saved screen's own revision check (not the map's requests on the way).
  networkCalls.length = 0;
  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  await expect(card).toHaveCount(1);
  await context.setOffline(true);
  // The revision check failed: the card stays as saved, without a verdict.
  await expect.poll(() => networkCalls.length).toBeGreaterThan(0);
  await expect(card).not.toContainText("Changed since saved");
  await expect(card.getByRole("button", { name: "Open trip" })).toBeVisible();
  await card.getByRole("button", { name: "Open trip" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const detail = page.getByTestId("trip-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("trip-reopen-note")).toContainText("shown as saved, with data from 16 Oct 2026");
  await expect(detail.getByTestId("unverified-badge")).toHaveText(BADGE);
  const steps = detail.getByRole("list", { name: "Trip steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(1)).toContainText("Board Loop A at Plaza Rizal (A1)");
  await expect(detail.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");
  await context.setOffline(false);
});

test("reopening online re-plans on the current data and opens the same option", async ({ page }) => {
  await openApp(page);
  await planAndOpenTrip(page);
  await page.getByTestId("trip-save").click();
  await expect(page.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");
  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  await page.getByTestId("saved-trip").getByRole("button", { name: "Open trip" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const detail = page.getByTestId("trip-detail");
  await expect(detail.getByRole("heading", { name: "To your destination" })).toBeFocused();
  // Same revision: the live option, without the "shown as saved" note.
  await expect(detail.getByTestId("trip-reopen-note")).toHaveCount(0);
  await expect(detail.getByTestId("fare-chip")).toHaveText("Estimate ₱14");
});

test("reopening after the network changed: the same rides are re-planned and say so; a gone option shows the options as changed", async ({ page }) => {
  await openApp(page);
  await planAndOpenTrip(page);
  await page.getByTestId("trip-save").click();
  await expect(page.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");

  // A newer revision with the same rides.
  const NEXT = "11111111-2222-4333-8444-555555555555";
  const next = { ...PROVISIONAL_PLAN, revision: { ...PROVISIONAL_PLAN.revision, revisionId: NEXT }, plan: { ...PROVISIONAL_PLAN.plan, revisionId: NEXT } };
  await page.unroute("**/api/v1/plan");
  await page.route("**/api/v1/plan", (route) => fulfill(route, next));
  // The published head moves to it too (its snapshot is not part of the fixtures: no verdict on the card).
  await page.route("**/api/v1/network/head", (route) => fulfill(route, next.revision));
  await page.goto("/app/saved");
  await page.getByTestId("saved-trip").getByRole("button", { name: "Open trip" }).click();
  await expect(page.getByTestId("trip-detail").getByTestId("trip-reopen-note")).toHaveText("Re-planned on the current data");
  // The saved copy is on older data: offer to update it rather than showing it as saved.
  const save = page.getByTestId("trip-save");
  await expect(save).toHaveAttribute("data-state", "older");
  await expect(save).toHaveText("Update saved copy");
  await expect(page.getByTestId("trip-save-older")).toHaveText("Your saved copy uses data from 16 Oct 2026.");
  await save.click();
  await expect(save).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("trip-action-status")).toHaveText("Saved copy updated to the current data.");

  // The saved option is gone from the current plan.
  await page.unroute("**/api/v1/plan");
  await page.route("**/api/v1/plan", (route) => fulfill(route, LEAST_WALKING_ONLY_PLAN));
  await page.goto("/app/saved");
  await page.getByTestId("saved-trip").getByRole("button", { name: "Open trip" }).click();
  await expect(page.getByTestId("trip-changed-note")).toHaveText("Route changed since you saved this");
  await expect(page.getByTestId("trip-option")).toHaveCount(1);
  await expect(page.getByTestId("trip-detail")).toHaveCount(0);
});

test("Share copies a text-only summary (no coordinates, no links) when the share sheet is missing", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await openApp(page);
  await planAndOpenTrip(page);
  await page.getByTestId("trip-share").click();
  await expect(page.getByTestId("trip-action-status")).toHaveText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("ParaNaga trip: Pinned location to Pinned location");
  expect(text).toContain(BADGE);
  expect(text).toContain("Board Loop A at Plaza Rizal (A1)");
  expect(text).toContain("Avenue Square (A5)");
  expect(text).toContain("Fare: Estimate ₱14 · from reported fare rules");
  expect(text).not.toMatch(/\d+\.\d{3,}/);
  expect(text).not.toMatch(/https?:|www\./);

  // "Include exact points" adds them, on request only.
  await page.getByLabel("Include exact points when sharing").check();
  await page.getByTestId("trip-share").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/Start point: 13\.\d{5}, 123\.\d{5}/);
});

test("history is off by default and nothing is recorded", async ({ page }) => {
  await openApp(page);
  await planAndOpenTrip(page);
  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page).toHaveURL(/\/app\/saved\?tab=history$/);
  const off = page.getByTestId("history-off");
  await expect(off.getByRole("heading", { name: "History is off" })).toBeVisible();
  await expect(off).toContainText("ParaNaga keeps no record of your trips unless you turn history on. When on, it stays on this device.");
  await expect(off.getByRole("link", { name: "Turn on in More" })).toHaveAttribute("href", "/app/more");
  expect(await countStore(page, "history")).toBe(0);
});

test("Add a place: search in save mode, name it, and it is under Places; a tap plans to it", async ({ page }) => {
  await openApp(page);
  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  await page.getByRole("tab", { name: "Places" }).click();
  await expect(page.getByTestId("saved-places-empty")).toHaveText("No saved places yet.");
  await page.getByTestId("saved-add-place").click();
  await expect(page).toHaveURL(/\/app\/search\?for=save$/);
  await page.getByRole("searchbox").fill("SM City");
  await page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" }).click();
  const dialog = page.getByTestId("search-save-dialog");
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("SM City Naga");
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Name" }).fill("The mall");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/app\/saved\?tab=places$/);
  const row = page.getByTestId("saved-place");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("The mall");
  await expect(row).toContainText("Saved place · OpenStreetMap");
  await row.getByRole("button", { name: /^The mall/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("endpoint-destination").locator(".pn-endpoint__main")).toContainText("The mall");
});

async function expectTripDetailAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="trip-detail"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`Saved has no serious or critical violations (${colorScheme})`, async ({ page }) => {
      await openApp(page);
      await planAndOpenTrip(page);
      // Trip detail with the action row and the exact-points checkbox, before and after saving.
      await expectTripDetailAxeClean(page);
      await page.getByTestId("trip-save").click();
      await expect(page.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");
      await page.getByLabel("Include exact points when sharing").check();
      await expectTripDetailAxeClean(page);
      await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
      await expect(page.getByTestId("saved-trip")).toBeVisible();
      await expectAxeClean(page);
      await page.getByRole("tab", { name: "Places" }).click();
      await expect(page.getByTestId("saved-places-empty")).toBeVisible();
      await expectAxeClean(page);
      await page.getByRole("tab", { name: "History" }).click();
      await expect(page.getByTestId("history-off")).toBeVisible();
      await expectAxeClean(page);
    });
  });
}
