import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { backToMap, chooseOption, pinTrip } from "./fixtures/options";
import { E2E_ADMIN_ROLES_COOKIE } from "../../src/domain/pwa/build-guard";

// AC-9 (N8): a SIGNED-IN visit online with the service worker allowed, then Cache Storage is
// inspected. Sign-in is mocked the way my-reports.spec.ts does it (GET /api/v1/me answers a user;
// the e2e server has no Neon Auth), and the admin shell opens with the test-only roles cookie.
// Every private endpoint is answered with a CACHEABLE header (public, max-age) on purpose: the
// worker's allow-list must keep them out, not the server's Cache-Control. Afterwards, offline, the
// saved trip still opens and shows how fresh its data is. Tiles are aborted; every test checks for
// CSP violations.

test.use({ serviceWorkers: "allow" });
test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const MARKER = "Pn-Private-Marker-7f3c";
const USER = { user: { id: "user-ac9", name: `Maria ${MARKER}`, roles: ["commuter", "admin"] } };
const COMPLAINT_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const CACHEABLE = { "cache-control": "public, max-age=600" };
const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });

const fulfillJson = (route: Route, body: unknown, headers: Record<string, string> = CACHEABLE) =>
  route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });

/** Private API answers, all carrying the marker, all with a header that would allow caching. */
async function routePrivate(context: BrowserContext) {
  await context.route("**/api/v1/me", (r) => fulfillJson(r, USER));
  await context.route("**/api/v1/me/saved-places", (r) => fulfillJson(r, { places: [] }));
  await context.route("**/api/v1/me/saved-trips", (r) => fulfillJson(r, { trips: [] }));
  await context.route("**/api/v1/me/corrections", (r) => fulfillJson(r, { corrections: [] }));
  await context.route("**/api/v1/me/complaints", (r) =>
    fulfillJson(r, {
      complaints: [{ id: COMPLAINT_ID, reference: "PN-7KQ4-2M", category: "overcharging", status: "under_review", submittedAt: "2026-10-17T16:00:00.000Z", incidentAt: "2026-10-17T14:30:00.000Z", evidence: [] }],
    }),
  );
  await context.route(/\/api\/v1\/(complaints|media|admin)(\/|$|\?)/, (r) => fulfillJson(r, { note: MARKER }));
  await context.route(/\/api\/auth\//, (r) => fulfillJson(r, { session: MARKER }));
}

async function cacheDump(page: Page): Promise<{ cache: string; url: string; body: string }[]> {
  return page.evaluate(async () => {
    const out: { cache: string; url: string; body: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        out.push({ cache: name, url: request.url, body: response ? await response.text() : "" });
      }
    }
    return out;
  });
}

test.beforeEach(async ({ context, page }) => {
  test.slow();
  await context.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await context.route("**/api/v1/plan", (route) => fulfillJson(route, PROVISIONAL_PLAN, { "cache-control": "no-store" }));
  await routeNetwork(context, { realCacheHeaders: true });
  await routePrivate(context);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP violations").toEqual([]);
});

test("signed in: no account, admin, complaint, media or auth response is cached; offline the saved trip shows its freshness (AC-9)", async ({ page, context }) => {
  // Online, signed in: the worker installs and takes control.
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((n) => n.startsWith("pn-snapshot-")))).toBe(true);

  // Plan and save a trip.
  await pinTrip(page);
  await chooseOption(page);
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await page.getByTestId("trip-save").click();
  await expect(page.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");
  await backToMap(page);

  // Signed-in screens: Settings (account), My reports, then the admin shell. (The map may still be
  // replacing its URL after the trip closed; a navigation that lands then is aborted, so retry.)
  await expect(async () => {
    await page.goto("/app/more");
  }).toPass();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.goto("/app/reports");
  await expect(page.getByText("PN-7KQ4-2M")).toBeVisible();
  // Direct requests from the controlled page to every private API family (GET, cacheable headers).
  const statuses = await page.evaluate(async () => {
    const urls = ["/api/v1/me", "/api/v1/me/complaints", `/api/v1/complaints`, "/api/v1/media/slots", "/api/v1/admin/dashboard", "/api/auth/get-session"];
    return Promise.all(urls.map(async (u) => (await fetch(u)).status));
  });
  expect(statuses.every((s) => s === 200)).toBe(true);
  await context.addCookies([{ name: E2E_ADMIN_ROLES_COOKIE, value: "admin", domain: "localhost", path: "/" }]);
  await page.goto("/admin");
  await expect(page.locator("body")).not.toBeEmpty();

  // Back to the app; let the worker settle, then inspect Cache Storage.
  await page.goto("/app/saved");
  await expect(page.getByTestId("saved-trip")).toHaveCount(1);
  const entries = await cacheDump(page);
  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) {
    const url = new URL(e.url);
    expect(url.pathname, e.url).not.toMatch(/^\/api\/v1\/(me|complaints|media|admin|plan)(\/|$)|^\/api\/auth|^\/admin|^\/account/);
    expect(e.body.includes(MARKER), `${e.url} holds private data`).toBe(false);
  }

  // Offline (page and worker): a cold start of Saved, the card says it is offline-ready and how
  // old its data is, and opening it shows the saved steps with the date they were saved.
  await context.setOffline(true);
  await context.route(/\/api\//, (route) => route.abort("internetdisconnected"));
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("offline-banner")).toContainText("Offline — data from");
  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  const card = page.getByTestId("saved-trip");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Available offline");
  await expect(card).toContainText(/data from \d{1,2} \w{3} \d{4}/);
  // After a cold start the phone re-plans the saved ends on the cached snapshot and says from
  // which data, with the fare caveat.
  await card.getByRole("button", { name: "Open trip" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("status").filter({ hasText: /^Planned offline from data of \w{3} \d{1,2}, \d{4}\. Fares may have changed\.$/ })).toHaveCount(1);
  await expect(page.getByTestId("trip-option").first()).toBeVisible();

  // Still nothing private after the offline session.
  for (const e of await cacheDump(page)) expect(e.body.includes(MARKER), e.url).toBe(false);
  await context.setOffline(false);
});
