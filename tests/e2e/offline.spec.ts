import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { SNAPSHOT, STOP_A1, routeNetwork, type NetworkCalls } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";

// The PWA (Task 12) on the production build with the service worker ALLOWED: first visit online,
// then context.setOffline(true) and cold loads. The API is answered by context routes (they also
// answer the worker's own requests) with the production Cache-Control headers, so the worker's
// allow-list really decides what is stored. Tiles are aborted; every test checks for CSP
// (report-only) violations.

test.use({ serviceWorkers: "allow" });
test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const A1_ID = STOP_A1.stop.id;
const DATA_DATE = "Oct 16, 2026";

let calls: NetworkCalls;
let planRequests = 0;
/**
 * API requests that tried the network after a test cut it (the abort routes record them). The
 * counting handlers of routeNetwork never see those requests (the last route registered wins), so
 * "nothing was fetched" is checked here: a request served from Cache Storage never shows up.
 */
let attempted: string[] = [];

test.beforeEach(async ({ context, page }) => {
  // Every test installs a worker (and the update tests a second one): more than the default 30 s
  // on a loaded machine.
  test.slow();
  await context.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  planRequests = 0;
  attempted = [];
  await context.route("**/api/v1/plan", (route) => {
    planRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(PROVISIONAL_PLAN) });
  });
  calls = await routeNetwork(context, { realCacheHeaders: true });
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

/**
 * First visit online: the worker installs (the shells), takes control, and the page hands it the
 * head and snapshot it fetched before that (no second download).
 */
async function firstVisit(page: Page, { backgroundIndex = true }: { backgroundIndex?: boolean } = {}) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).some((n) => n.startsWith("pn-snapshot-"))))
    .toBe(true);
  // The one background fetch of the search index (not with Low-data mode) has finished, so no
  // request is in flight in the worker when a test goes offline or deploys a new version.
  if (backgroundIndex) {
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).some((n) => n.startsWith("pn-search-index-"))), { timeout: 20_000 })
      .toBe(true);
  }
}

/**
 * Offline for the page AND the worker. A request answered by a route never reaches the network,
 * so setOffline alone would still let the mocked API answer: the last route registered wins, and
 * this one fails every API request like a dropped connection.
 */
async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
  await context.route(/\/api\//, (route) => abortRecorded(route));
}

/** Fails a request like a dropped connection, and records that it tried the network. */
function abortRecorded(route: Route) {
  attempted.push(new URL(route.request().url()).pathname);
  return route.abort("internetdisconnected");
}
const attemptsTo = (re: RegExp) => attempted.filter((p) => re.test(p));

async function cacheEntries(page: Page): Promise<{ cache: string; url: string; cacheControl: string | null }[]> {
  return page.evaluate(async () => {
    const out: { cache: string; url: string; cacheControl: string | null }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        out.push({ cache: name, url: request.url, cacheControl: response?.headers.get("cache-control") ?? null });
      }
    }
    return out;
  });
}

test("after one online visit the worker controls the page, also after a reload", async ({ page }) => {
  await firstVisit(page);
  await page.reload();
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/serwist\/sw\.js$/);
});

test("cold start offline: /app renders with pins from the cached snapshot and the offline banner", async ({ page, context }) => {
  await firstVisit(page);
  await goOffline(context);
  const snapshotsBefore = calls.snapshots.length;
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect.poll(() => mapEl(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  await expect(page.getByTestId("offline-banner")).toHaveText(`Offline — data from ${DATA_DATE}. Fares may have changed.`);
  // The snapshot came from the cache, not the network.
  expect(calls.snapshots.length).toBe(snapshotsBefore);
  // The pre-paint theme script came from the precache, so a Dark choice applies before paint.
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).not.toBeNull();
});

test("cold start offline: Saved, Explore and Help shells open; a page that needs the network gets /offline", async ({ page, context }) => {
  await firstVisit(page);
  await goOffline(context);
  for (const [path, heading] of [
    ["/app/saved", "Saved"],
    ["/app/explore", "Explore"],
    ["/app/help", "Help"],
    ["/app/more", "Settings"],
    ["/app/help/how-times-are-estimated", "How times are estimated"],
    ["/app/help/vehicle-types-in-naga", "Vehicle types in Naga"],
  ] as const) {
    await page.goto(path);
    const h1 = page.getByRole("heading", { level: 1, name: heading });
    await expect(h1, path).toBeVisible();
    const banner = page.getByTestId("offline-banner");
    await expect(banner).toBeVisible();
    // The banner sits above the screen's own header, never over its heading.
    await expect.poll(async () => (await banner.boundingBox())!.y + (await banner.boundingBox())!.height <= (await h1.boundingBox())!.y, path).toBe(true);
  }
  // A stop detail is rendered per request (never cached): the offline page, not a browser error.
  await page.goto(`/app/stops/${A1_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
  await expect(page.getByTestId("offline-data-date")).toHaveText(`Data from ${DATA_DATE}. Fares may have changed.`);
  await expect(page.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/app");
  await page.goto("/app/does-not-exist");
  await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
});

test("offline: search works from a cold start without searching first (index fetched once in the background)", async ({ page, context }) => {
  // After the worker takes control the index of the current revision is fetched once, when idle
  // (firstVisit waits for it to be cached).
  await firstVisit(page);
  expect(calls.searchIndexes).toEqual([SNAPSHOT.revision.revisionId]);
  await goOffline(context);
  await page.goto("/app/search?for=destination");
  await searchBox(page).fill("SM City");
  await expect(page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" })).toBeVisible();
});

test("Low-data mode: the search index is not fetched in the background", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("paranaga.prefs", JSON.stringify({ theme: "system", highContrast: false, lowData: true, historyEnabled: false }));
  });
  await firstVisit(page, { backgroundIndex: false });
  await page.waitForTimeout(12_000); // past the idle callback's 10 s timeout
  expect(calls.searchIndexes).toEqual([]);
});

test("Low-data mode: street paths download only on the tap, then stay stored (Task 15 follow-up)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("paranaga.prefs", JSON.stringify({ theme: "system", highContrast: false, lowData: true, historyEnabled: false }));
  });
  await firstVisit(page, { backgroundIndex: false });
  await setEnds(page);
  await page.getByTestId("trip-option").first().click();
  const detail = page.getByTestId("trip-detail");
  const download = detail.getByTestId("walk-graph-download");
  await expect(download).toHaveText("Download street paths (≈ 80 KB)");
  await expect(detail).not.toContainText("Approximate walking path");
  expect(calls.walkGraphs).toEqual([]);
  const a11y = await new AxeBuilder({ page }).include('[data-testid="trip-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await download.click();
  await expect(detail).toContainText("Approximate walking path");
  await expect(detail.getByTestId("walk-graph-offer")).toHaveCount(0);
  await expect(detail.getByRole("heading", { name: "To your destination" })).toBeFocused();
  expect(calls.walkGraphs).toEqual([SNAPSHOT.revision.revisionId]);
  await expect
    .poll(async () => (await cacheEntries(page)).some((e) => e.url.endsWith(`/api/v1/network/walk-graph/${SNAPSHOT.revision.revisionId}`)))
    .toBe(true);

  // A later low-data visit uses the stored copy: no offer, no new download.
  await page.reload();
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await setEnds(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toContainText("Approximate walking path");
  await expect(page.getByTestId("walk-graph-offer")).toHaveCount(0);
  expect(calls.walkGraphs).toEqual([SNAPSHOT.revision.revisionId]);
});

test("offline: the tab bar opens the cached shells by document navigation", async ({ page, context }) => {
  await firstVisit(page);
  await goOffline(context);
  await page.goto("/app");
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await page.getByTestId("tab-saved").click();
  await expect(page).toHaveURL(/\/app\/saved$/);
  await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeVisible();
  await page.getByTestId("tab-map").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
});

test("offline: a trip is re-planned on the phone from the cached snapshot, with the honest note", async ({ page, context }) => {
  await firstVisit(page);
  await setEnds(page);
  await expect(page.getByTestId("trip-options")).toBeVisible();
  const before = planRequests;
  await goOffline(context);
  await page.getByRole("button", { name: "Swap start and destination" }).click();
  await expect(page.getByTestId("trip-offline-note")).toHaveText(`Planned offline from data of ${DATA_DATE}. Fares may have changed.`);
  // The request never reached the server; the plan came from the cached snapshot.
  expect(planRequests).toBe(before);
});

test("offline after one online trip: overview, ride lines and street walk paths draw from the cache; no plan is stored (Task 15)", async ({ page, context }) => {
  await firstVisit(page);
  await setEnds(page);
  await page.getByTestId("trip-option").first().click();
  // Online: the walk graph is fetched the first time a trip is shown, and the worker keeps it.
  await expect(page.getByTestId("trip-detail")).toContainText("Approximate walking path");
  await expect
    .poll(async () => (await page.evaluate(() => caches.keys())).filter((n) => /^pn-(lines-f\d+|walk-graph)-/.test(n)).length)
    .toBe(2);
  // Guidance keeps the trip across a reload (sessionStorage): a cold start offline with a trip,
  // where nothing is held in memory any more.
  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await goOffline(context);
  await page.reload();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await endGuidance(page);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
  // The route overview (on by default) draws from the stored lines.
  await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("trip-option").first().click();
  await expect(page.locator("path.pn-line--ride").first()).toBeAttached();
  await expect(page.locator("path.pn-line--walk").first()).toBeAttached();
  // Street paths, not straight lines: the walk graph came from the cache.
  await expect(page.getByTestId("trip-detail")).toContainText("Approximate walking path");
  await expect(page.getByTestId("trip-detail")).not.toContainText("Street paths need a connection");
  // Neither the lines nor the walk graph tried the network: both came from Cache Storage.
  expect(attemptsTo(/\/api\/v1\/network\/(lines|walk-graph)\//)).toEqual([]);
  // The time estimate is computed on the phone from the cached snapshot's model.
  await expect(page.getByTestId("trip-detail-time")).toContainText(/^Estimate \d+–\d+ min \+ waiting \(unknown\)/);

  const entries = await cacheEntries(page);
  expect(entries.some((e) => new URL(e.url).pathname.startsWith("/api/v1/plan"))).toBe(false);
  expect(entries.some((e) => e.url.endsWith(`/api/v1/network/walk-graph/${SNAPSHOT.revision.revisionId}`))).toBe(true);
});

test("offline before the walk graph was ever stored: walks are straight dotted lines that say street paths need a connection (Task 15)", async ({ page, context }) => {
  // The walk graph never arrives online (so it is never stored).
  await context.route(/\/api\/v1\/network\/walk-graph\//, (route) => route.abort("connectionfailed"));
  await firstVisit(page);
  await setEnds(page);
  await page.getByTestId("trip-option").first().click();
  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await goOffline(context);
  await page.reload();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await endGuidance(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.locator("path.pn-line--walk").first()).toBeAttached();
  await expect(page.getByTestId("trip-detail")).toContainText("Street paths need a connection the first time.");
  expect((await cacheEntries(page)).some((e) => e.url.includes("/api/v1/network/walk-graph/"))).toBe(false);
});

async function endGuidance(page: Page) {
  await page.getByRole("button", { name: "End guidance" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End guidance" }).click();
  await expect(page.getByTestId("guidance")).toHaveCount(0);
}

test("route detail draws its path from the stored lines when the lines endpoint is unreachable (Task 15)", async ({ page, context }) => {
  await firstVisit(page);
  await expect.poll(async () => (await page.evaluate(() => caches.keys())).some((n) => /^pn-lines-f\d+-/.test(n))).toBe(true);
  await context.route(/\/api\/v1\/network\/lines\//, (route) => abortRecorded(route));
  await page.goto("/app/routes/R1");
  await expect(page.locator('[data-testid="route-map"] path.pn-line--route').first()).toBeAttached({ timeout: 15_000 });
  expect(attemptsTo(/\/api\/v1\/network\/lines\//)).toEqual([]);
});

test("tap a stop offline: the panel says it opens when back online, the trip stays in the sheet (F-03)", async ({ page, context }) => {
  await firstVisit(page);
  await setEnds(page);
  await expect(page.getByTestId("trip-options")).toBeVisible();
  await goOffline(context);
  await page.getByTestId("nearby-stops").getByRole("link").first().click();
  await expect(page.getByTestId("detail-offline")).toContainText("You're offline · This opens when you're back online.");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("trip-options")).toBeVisible();
});

test("Cache Storage holds no plan, auth, RSC, admin or private response", async ({ page, context }) => {
  await firstVisit(page);
  await setEnds(page);
  await expect(page.getByTestId("trip-options")).toBeVisible();
  await page.goto(`/app/stops/${A1_ID}`);
  await expect(page.getByTestId("stop-detail")).toBeVisible();
  await page.goto("/app/saved");
  await goOffline(context);
  await page.goto("/app/explore");
  const entries = await cacheEntries(page);
  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) {
    const url = new URL(e.url);
    expect(url.pathname, e.url).not.toMatch(/^\/api\/v1\/plan|^\/api\/auth|^\/admin|^\/account/);
    expect(url.searchParams.has("_rsc"), e.url).toBe(false);
    expect(url.search.includes("bbox"), e.url).toBe(false);
    expect(e.cacheControl ?? "", e.url).not.toMatch(/private|no-store/);
  }
  const names = [...new Set(entries.map((e) => e.cache))];
  expect(names.some((n) => n.startsWith("pn-snapshot-"))).toBe(true);
  expect(entries.some((e) => e.url.endsWith(`/api/v1/network/snapshot/${SNAPSHOT.revision.revisionId}`))).toBe(true);
  expect(entries.some((e) => e.url.endsWith(`/api/v1/stops/${A1_ID}`))).toBe(true);
  // The pre-paint theme script is precached (a cold start offline never flashes the wrong theme).
  expect(entries.some((e) => new URL(e.url).pathname === "/theme-init.js")).toBe(true);
  // The two Task 14 Help articles are install-time shells.
  for (const path of ["/app/help/how-times-are-estimated", "/app/help/vehicle-types-in-naga"]) {
    expect(entries.some((e) => e.cache.startsWith("pn-shell-") && new URL(e.url).pathname === path), path).toBe(true);
  }
});

test("Clear data on this device removes the data caches; the app still opens offline", async ({ page, context }) => {
  await firstVisit(page);
  // A trip shown once stores the walk graph (and the overview stored the lines).
  await setEnds(page);
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toContainText("Approximate walking path");
  await expect
    .poll(async () => (await page.evaluate(() => caches.keys())).filter((n) => /^pn-(lines-f\d+|walk-graph)-/.test(n)).length)
    .toBe(2);
  await page.goto(`/app/stops/${A1_ID}`);
  await expect(page.getByTestId("stop-detail")).toBeVisible();
  await page.goto("/app/more");
  // The map under More may load the lines afresh after clearing, as a new visit would: keep them
  // from coming back so the check below sees only what Clear data left.
  await context.route(/\/api\/v1\/network\/(lines|walk-graph)\//, (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Clear data on this device" }).click();
  await page.getByTestId("settings-clear-dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("settings-status")).toHaveText("Data on this phone removed. Settings are back to their defaults.");
  const names = await page.evaluate(() => caches.keys());
  // The stop read earlier and the reference data are gone. (The map still open under More loads
  // the current head and snapshot afresh, as a new visit would, so those may be back.)
  expect(names.filter((n) => /^pn-(search-index|reference)-/.test(n))).toEqual([]);
  expect((await cacheEntries(page)).some((e) => e.url.endsWith(`/api/v1/stops/${A1_ID}`))).toBe(false);
  expect((await cacheEntries(page)).filter((e) => /\/api\/v1\/network\/(lines|walk-graph)\//.test(e.url))).toEqual([]);
  expect(names.some((n) => n.startsWith("pn-shell-"))).toBe(true);
  expect(names.some((n) => n.includes("precache"))).toBe(true);
  // The app code stays: the map still opens offline.
  await goOffline(context);
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
});

test("update: new worker bytes at the same URL wait; the card offers Reload, and Reload switches to them", async ({ page, context }) => {
  await firstVisit(page);
  const first = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  expect(first).toMatch(/\/serwist\/sw\.js$/);
  await expect(page.getByTestId("update-prompt")).toHaveCount(0);
  await deployNextVersion(page, context, "next");
  // It installs and waits: nothing reloads by itself.
  const prompt = page.getByTestId("update-prompt");
  await expect(prompt).toContainText("A new version of ParaNaga is ready.");
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  const before = await page.evaluate(() => performance.timeOrigin);
  // Tapping Reload activates the waiting version, and the page reloads once it controls it.
  await Promise.all([page.waitForEvent("load"), prompt.getByRole("button", { name: "Reload" }).click()]);
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(before);
  // Same URL, new version in control; nothing left waiting, no card.
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(first);
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(false);
  await expect(page.getByTestId("update-prompt")).toHaveCount(0);
});

test("update: Later hides the card; More still offers Update ready — Reload", async ({ page, context }) => {
  // Records what the page asks a worker to do (activation itself is covered by the Reload tests:
  // under heavy parallel load Chromium may hold a waiting version back while the active worker is
  // busy, which would only make this test slow, not tell us more).
  // Recorded in sessionStorage, not on window: SKIP_WAITING activates the new version and the page
  // may reload before the poll below reads it, which would reset a window variable.
  await page.addInitScript(() => {
    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (this: ServiceWorker, message: unknown, ...rest: unknown[]) {
      const seen = JSON.parse(sessionStorage.getItem("__swMessages") ?? "[]") as unknown[];
      sessionStorage.setItem("__swMessages", JSON.stringify([...seen, message]));
      return (post as (...args: unknown[]) => void).call(this, message, ...rest);
    } as typeof post;
  });
  await firstVisit(page);
  await deployNextVersion(page, context, "later");
  const prompt = page.getByTestId("update-prompt");
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Later" }).click();
  await expect(prompt).toHaveCount(0);
  // Hidden for this page session, not gone: More offers the same Reload.
  await page.getByTestId("tab-more").click();
  const row = page.getByTestId("settings-update");
  await expect(row).toContainText("Update ready — Reload");
  await expect(page.getByTestId("update-prompt")).toHaveCount(0);
  await row.click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("__swMessages") ?? "[]") as unknown[]).catch(() => []))
    .toEqual(expect.arrayContaining([expect.objectContaining({ type: "SKIP_WAITING" })]));
});

test("update in two tabs: Reload in one; the other's card goes away instead of staying dead", async ({ page, context }) => {
  await firstVisit(page);
  const other = await context.newPage();
  await other.goto("/app/saved");
  await expect.poll(() => other.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await deployNextVersion(page, context, "two-tabs");
  await expect(page.getByTestId("update-prompt")).toBeVisible();
  // Every tab of the registration sees the new version install and wait.
  await expect(other.getByTestId("update-prompt")).toBeVisible();
  await Promise.all([other.waitForEvent("load"), other.getByTestId("update-prompt").getByRole("button", { name: "Reload" }).click()]);
  // The first tab is now controlled by the new version too: no card with a Reload that does nothing.
  await expect(page.getByTestId("update-prompt")).toHaveCount(0);
  await other.close();
});

test("update: the card never shows during guidance, and appears once it ends", async ({ page, context }) => {
  await firstVisit(page);
  await setEnds(page);
  await page.getByTestId("trip-option").first().click();
  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await deployNextVersion(page, context, "guidance");
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  await expect(page.getByTestId("update-prompt")).toHaveCount(0);
  await page.getByRole("button", { name: "End guidance" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End guidance" }).click();
  await expect(page.getByTestId("update-prompt")).toBeVisible();
});

/**
 * A new deployment: the e2e build (PARANAGA_E2E_SW_VARIANT=1) appends this cookie's value to
 * /serwist/sw.js, so the browser's own update check finds new bytes at the same URL.
 */
async function deployNextVersion(page: Page, context: BrowserContext, variant: string) {
  await context.addCookies([{ name: "e2e-sw-variant", value: variant, url: new URL("/", page.url()).href }]); // path "/"
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  // Installing the new version (it caches the shells) can take a while on a loaded machine.
  await expect
    .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)), { timeout: 20_000 })
    .toBe(true);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`/offline has no serious axe violations (${colorScheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme });
    await firstVisit(page);
    await goOffline(context);
    await page.goto("/app/stops/x-unknown");
    await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), null, 1)).toEqual([]);
  });
}

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search places, stops and routes" });

/** Plaza Rizal → SM City Naga through Search, inside the app (the home frame keeps the trip). */
async function setEnds(page: Page) {
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await searchBox(page).fill("plaza rizal");
  await page.getByTestId("search-group-places").getByRole("button", { name: /^Plaza Rizal Mapped stop/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Search places and stops" }).click();
  await searchBox(page).fill("SM City");
  await page.getByTestId("search-result-osm").filter({ hasText: "SM City Naga" }).click();
  await expect(page).toHaveURL(/\/app$/);
}
