import { expandOptions, openTripSheet, pinTrip, useLocationFromSearch } from "./fixtures/options";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";
import { AT_STOP_PLAN, NO_ROUTE_PLAN, PROVISIONAL_PLAN, WALK_FIRST_PLAN } from "./fixtures/plan-responses";

// Regression tests for the app audit (.superpowers/sdd/app-audit.md, F-01 … F-23). Tiles are
// aborted and every API call is intercepted, so nothing here needs a database. Every test also
// checks that the page raised no Content-Security-Policy (report-only) violation.

const BISCAST = { latitude: 13.6314651, longitude: 123.1927517 };

const mapEl = (page: Page) => page.getByTestId("naga-map");
const row = (page: Page, which: "start" | "destination") => page.getByTestId(`endpoint-${which}`);
const rowMain = (page: Page, which: "start" | "destination") => row(page, which).locator(".pn-endpoint__main");
const chooseOnMap = (page: Page) => page.getByRole("button", { name: "Choose on map", exact: true });

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

async function planWith(page: Page, body: unknown) {
  await page.route("**/api/v1/plan", (route) => fulfill(route, body));
}

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
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

/** Pins the start at the default centre and the destination a little north-east of it. */
async function pinBoth(page: Page) {
  await pinTrip(page);
  await expect(rowMain(page, "destination")).toContainText("Pinned location");
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
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

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

  test.describe("F-01 a GPS start keeps its fix when the phone stands still", () => {
    test("after 45 s without a new fix the pill and the start stay, with the fix's age", async ({ page }) => {
      await planWith(page, NO_ROUTE_PLAN);
      await page.clock.install();
      // One fix, stamped with the (fake) clock when the watch starts, and never another: a phone
      // standing still. Deterministic, unlike the browser's emulated position timestamp.
      await page.addInitScript(({ latitude, longitude }) => {
        const geolocation = {
          watchPosition(success: PositionCallback) {
            const timestamp = Date.now();
            setTimeout(() => {
              success({
                coords: { latitude, longitude, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
                timestamp,
              } as unknown as GeolocationPosition);
            }, 50);
            return 1;
          },
          clearWatch() {},
          getCurrentPosition() {},
        };
        Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
      }, BISCAST);
      await openApp(page);
      await useLocationFromSearch(page);
      const pill = page.getByTestId("accuracy-pill");
      await expect(pill).toContainText("± 15 m");
      await expect(rowMain(page, "start")).toContainText("Your location");

      // No new position arrives; only time passes.
      await page.clock.fastForward(45_000);
      await expect(pill).toContainText("last fix 45 s ago");
      await expect(pill).toHaveAttribute("data-stale", "true");
      await expect(page.getByText("Finding your location…")).toHaveCount(0);
      await expect(rowMain(page, "start")).toContainText("Your location");
      await expect(rowMain(page, "start")).toContainText("GPS last fix 45 s ago");
      // The user dot stays on the map, drawn as stale (no pulse).
      await expect(page.locator(".pn-dot.pn-dot--stale")).toHaveCount(1);
    });
  });

  test.describe("F-02 rotating a phone keeps the app and the trip", () => {
    test("Pixel 7 landscape (863 × 412) keeps the app; rotating back the trip is still there", async ({ page }) => {
      await planWith(page, PROVISIONAL_PLAN);
      await openApp(page);
      await pinBoth(page);
      await expect(page.getByTestId("trip-option")).toHaveCount(3);

      await page.setViewportSize({ width: 863, height: 412 });
      await expect(page.getByText("Large screen detected")).toHaveCount(0);
      await expect(page.getByTestId("trip-sheet")).toBeVisible();
      await expect(rowMain(page, "start")).toContainText("Pinned location");

      await page.setViewportSize({ width: 412, height: 839 });
      await expect(rowMain(page, "start")).toContainText("Pinned location");
      await expect(rowMain(page, "destination")).toContainText("Pinned location");
      await expect(page.getByTestId("trip-option")).toHaveCount(3);
    });
  });

  test.describe("F-05 same place", () => {
    test("a destination on top of the start is refused with inline copy", async ({ page }) => {
      let planned = 0;
      await page.route("**/api/v1/plan", (route) => {
        planned++;
        return fulfill(route, NO_ROUTE_PLAN);
      });
      await openApp(page);
      await openTripSheet(page);
      await chooseOnMap(page).click();
      const confirm = page.getByRole("button", { name: "Set start here" });
      await expect(page.getByTestId("pick-same-place-hint")).toHaveText(
        "Start and destination are the same place. Move the pin.",
      );
      await expect(confirm).toHaveAttribute("aria-disabled", "true");
      await confirm.click({ force: true });
      await expect(page.getByRole("region", { name: "Choose start on map" })).toBeVisible();
      await expect(page.getByTestId("home-announcer")).toContainText("Start and destination are the same place");
      expect(planned).toBe(0);

      // Moving the map away clears the hint and the destination can be set.
      const before = await mapEl(page).getAttribute("data-center-lng");
      await drag(page, -120, 80);
      await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
      await expect(page.getByTestId("pick-same-place-hint")).toHaveCount(0);
      await confirm.click();
      await expect(rowMain(page, "start")).toContainText("Pinned location");
    });

    test("the driver badge appears only on options with a ride", async ({ page }) => {
      await planWith(page, WALK_FIRST_PLAN);
      await openApp(page);
      await pinBoth(page);
      await expandOptions(page);
      const cards = page.getByTestId("trip-option");
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(0)).toContainText("Walk");
      await expect(cards.nth(0).getByTestId("unverified-badge")).toHaveCount(0);
      await expect(cards.nth(1).getByTestId("card-unverified")).toHaveText("Unverified route");
      await expect(cards.nth(0).getByTestId("card-unverified")).toHaveCount(0);
      await cards.nth(0).click();
      await expect(page.getByTestId("trip-detail").getByTestId("unverified-badge")).toHaveCount(0);
    });
  });

  test("F-12 no-coverage copy says why, with the walking estimate", async ({ page }) => {
    await planWith(page, { ...NO_ROUTE_PLAN, plan: { ...NO_ROUTE_PLAN.plan, reason: "no_stop_near_destination", directWalkEstimateMeters: 1460 } });
    await openApp(page);
    await pinBoth(page);
    const card = page.getByTestId("no-provisional-route");
    await expect(card.getByRole("heading", { name: "No mapped stop within 600 m of your destination" })).toBeVisible();
    await expect(card).toContainText("Walk ≈ 1.5 km (estimate, path not verified).");
  });

  test("F-20 starting at the stop: no 'Walk ≈ 0 m' step", async ({ page }) => {
    await planWith(page, AT_STOP_PLAN);
    await openApp(page);
    await pinBoth(page);
    await expandOptions(page);
    const card = page.getByTestId("trip-option").first();
    await expect(card).not.toContainText("≈ 0 m");
    await card.click();
    const steps = page.getByTestId("trip-detail").getByRole("list", { name: "Trip steps" }).getByRole("listitem");
    await expect(steps.nth(0)).toContainText("Start at Plaza Rizal (A1)");
    await expect(steps.nth(0)).not.toContainText("Board here");
    await expect(page.getByTestId("trip-detail")).not.toContainText("Walk ≈ 0 m");
  });

  test("F-16 tapping the highlighted Start row keeps its options open", async ({ page }) => {
    await openApp(page);
    await openTripSheet(page);
    await expect(rowMain(page, "start")).toHaveAttribute("aria-pressed", "true");
    await rowMain(page, "start").click();
    await expect(rowMain(page, "start")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Use current location" })).toBeVisible();
  });

  test("F-21 the swap button sits outside the focused row's outline", async ({ page }) => {
    await openApp(page);
    await openTripSheet(page);
    const rowBox = (await row(page, "start").boundingBox())!;
    const swapBox = (await page.getByRole("button", { name: "Swap start and destination" }).boundingBox())!;
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(swapBox.x);
  });

  // Runs against the regular build (no tile URL), project "no-tiles" (playwright.config.ts).
  test("F-07 'Map background unavailable' sits above the attribution @no-tiles", async ({ page }) => {
    await openApp(page);
    const notice = page.locator(".pn-map-notice");
    await expect(notice).toHaveText("Map background unavailable");
    const n = (await notice.boundingBox())!;
    const a = (await page.locator(".pn-attribution").boundingBox())!;
    expect(n.y + n.height).toBeLessThanOrEqual(a.y);
  });

  test("F-18 pins at the same point share one Nearby stops row", async ({ page }) => {
    await openApp(page);
    const rows = page.getByTestId("nearby-stops").getByRole("link");
    await expect(rows.first()).toContainText("Plaza Rizal (A1)");
    await expect(rows.first()).not.toContainText("Same point in");
    // Pins at exactly the same point never get two rows (A1 of Loops A and C, B1 of Loops B and D).
    await expect(rows.filter({ hasText: "Plaza Rizal (A1)" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Plaza Rizal (B1)" })).toHaveCount(1);
  });

  test("F-15 Escape closes a stop panel like Back", async ({ page }) => {
    await openApp(page);
    const first = page.getByTestId("nearby-stops").getByRole("link").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/stops\//);
    await expect(page.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/app$/);
    await expect(first).toBeFocused();
  });

  test("F-10 / F-22 not-found panels: honest title, 'not found' said once", async ({ page }) => {
    await page.goto("/app/stops/not-a-uuid");
    await expect(page.getByRole("heading", { level: 1, name: "Stop not found" })).toBeVisible();
    await expect(page).toHaveTitle("Stop not found · ParaNaga");
    await expect(page.getByText(/not found/i)).toHaveCount(1);

    await page.goto("/app/routes/NOPE");
    await expect(page.getByRole("heading", { level: 1, name: "Route not found" })).toBeVisible();
    await expect(page).toHaveTitle("Route not found · ParaNaga");
  });

  test("F-10 leaving a not-found panel gives the map its own title back", async ({ page }) => {
    await page.goto("/app/stops/not-a-uuid");
    await expect(page).toHaveTitle("Stop not found · ParaNaga");
    await page.getByRole("link", { name: "Back to map" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page).toHaveTitle("App · ParaNaga");
  });

  test("F-15 a held or repeated Escape goes back only once", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("nearby-stops").getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/stops\//);
    await page.keyboard.down("Escape");
    await page.keyboard.down("Escape"); // auto-repeat
    await page.keyboard.up("Escape");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/app$/);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/app$/);
  });

  test("F-17 /app has a main landmark and no moderate-or-worse axe issues", async ({ page }) => {
    await openApp(page);
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    );
    await expect(page.getByRole("main")).toHaveCount(1);
    const results = await new AxeBuilder({ page }).analyze();
    const issues = results.violations.filter((v) => v.impact !== "minor");
    expect(issues, issues.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
  });

  test("F-06 the mobile menu lands each section heading below the sticky header", async ({ page }) => {
    await page.goto("/");
    for (const [link, heading] of [
      ["How it works", /in three steps/],
      ["Features", /Built for the street/],
      ["Our data", /rather say/],
      ["FAQ", /^Questions$/],
    ] as const) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.locator("#mobile-menu").getByRole("link", { name: link }).click();
      await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
      const h = page.getByRole("heading", { level: 2, name: heading });
      await expect
        .poll(async () => {
          const top = await h.evaluate((el) => el.getBoundingClientRect().top);
          const headerBottom = await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().bottom);
          return top >= headerBottom - 1 && top < 400;
        })
        .toBe(true);
    }
  });
});

test("F-04 the landing and the gate promise nothing that does not ship", async ({ page }) => {
  await page.goto("/");
  const text = await page.locator("body").innerText();
  for (const claim of [/English and Filipino/i, /verified trip/i, /exact curb/i, /buzz/i, /stop countdown/i, /Search a place/i, /Exact ·/]) {
    expect(text, String(claim)).not.toMatch(claim);
  }
  await expect(page.getByText("Coming soon").first()).toBeVisible();
});

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "The large-screen gate is a desktop (mouse) view");

  test("F-04 the desktop gate promises no stop alerts and shows no search box", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText("Large screen detected")).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/stop alerts/i);
    // The only input is the app link; the phone mock has no search field or place chips.
    await expect(page.locator("input")).toHaveCount(1);
    await expect(page.locator("#app-link")).toHaveCount(1);
    await expect(page.getByText("Ateneo de Naga")).toHaveCount(0);
  });

  test("F-02 widening a window covers the app with the gate (inert) and keeps its state", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    await openApp(page);
    await chooseOnMap(page).click();
    await page.getByRole("button", { name: "Set start here" }).click();
    await expect(rowMain(page, "start")).toContainText("Pinned location");

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("large-screen-overlay")).toBeVisible();
    await expect(page.getByText("Large screen detected")).toBeVisible();
    expect(await page.getByTestId("app-root").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    // Escape on the covered app does nothing (its listeners ignore keys while inert).
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 800, height: 720 });
    await expect(page.getByTestId("large-screen-overlay")).toHaveCount(0);
    expect(await page.getByTestId("app-root").evaluate((el) => (el as HTMLElement).inert)).toBe(false);
    await expect(rowMain(page, "start")).toContainText("Pinned location");
  });
});

test("F-11 an unknown URL shows the branded 404 with a way back", async ({ page }) => {
  const response = await page.goto("/nope-not-a-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Wrong stop." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/app");
  await expect(page.getByRole("link", { name: "ParaNaga home" })).toHaveAttribute("href", "/");
  await expect(page).toHaveTitle("Page not found · ParaNaga");
});

test("F-14 robots.txt allows the site and keeps crawlers out of the API and admin", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/User-Agent: \*/i);
  expect(body).toContain("Allow: /");
  expect(body).toContain("Disallow: /api/");
  expect(body).toContain("Disallow: /admin/");
});

test("F-17 the landing page has one main landmark and no moderate-or-worse axe issues", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  await expect(page.getByRole("main")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  const issues = results.violations.filter((v) => v.impact !== "minor");
  expect(issues, issues.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
});
