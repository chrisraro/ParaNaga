import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { LOOP_A_PINS, PROVISIONAL_PLAN, TWO_RIDE_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";

// Guidance (Increment A, Task 10): Walk, Ride, Transfer and Arrive in the home sheet. POST
// /api/v1/plan is intercepted with fixtures; tiles are aborted; every test checks for CSP
// (report-only) violations. Location is deterministic: most tests replace navigator.geolocation
// with a stub (window.__geo: active watches, a call counter, emit() to deliver a fix, and a
// "deny" mode); one test uses Playwright's own context.setGeolocation.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const { A1, A2, A3, A4 } = LOOP_A_PINS;
const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const guide = (page: Page) => page.getByTestId("guidance");
const heading = (page: Page) => guide(page).getByRole("heading", { level: 2 });
const SESSION_KEY = "paranaga.guidance";

type GeoStub = { watches: Map<number, unknown>; calls: number; mode: "allow" | "deny"; emit: (lat: number, lng: number, accuracy?: number) => void };

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

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

/** Replaces navigator.geolocation with a deterministic stub (before any page script runs). */
async function stubGeolocation(page: Page, mode: "allow" | "deny" = "allow") {
  await page.addInitScript((initialMode) => {
    type Watch = { success: PositionCallback; error?: PositionErrorCallback | null };
    const watches = new Map<number, Watch>();
    let next = 1;
    const stub = {
      watches,
      calls: 0,
      mode: initialMode,
      emit(lat: number, lng: number, accuracy = 10) {
        const position = {
          coords: { latitude: lat, longitude: lng, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition;
        for (const w of watches.values()) w.success(position);
      },
    };
    (window as unknown as { __geo: typeof stub }).__geo = stub;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition() {},
        watchPosition(success: PositionCallback, error?: PositionErrorCallback | null) {
          stub.calls += 1;
          const id = next++;
          if (stub.mode === "deny") {
            setTimeout(() => error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError), 0);
          } else {
            watches.set(id, { success, error });
          }
          return id;
        },
        clearWatch(id: number) {
          watches.delete(id);
        },
      },
    });
  }, mode);
}

const geoStub = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __geo: GeoStub }).__geo;
  return { watches: g.watches.size, calls: g.calls };
});
const emit = (page: Page, p: { lat: number; lng: number }, accuracy = 10) =>
  page.evaluate(([lat, lng, acc]) => (window as unknown as { __geo: GeoStub }).__geo.emit(lat!, lng!, acc), [p.lat, p.lng, accuracy]);

async function grantLocation(context: BrowserContext) {
  await context.grantPermissions(["geolocation"]);
}

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

/** Pins both ends, opens the first option and taps "Start trip". */
async function startGuidance(page: Page) {
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
  await page.getByTestId("trip-start").click();
  await expect(guide(page)).toBeVisible();
}

async function tap(page: Page, name: string) {
  await guide(page).getByRole("button", { name, exact: true }).click();
}

/** Honesty: no time, no "live", no fare without "Estimate" anywhere in the guidance. */
async function expectHonest(page: Page) {
  const text = (await guide(page).innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\bmin(ute)?s?\b|\blive\b|arriving|\bETA\b|guaranteed|official/i);
  for (const m of text.matchAll(/₱/g)) expect(text.slice(Math.max(0, m.index! - 20), m.index)).toContain("Estimate");
}

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="trip-sheet"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test("one ride with GPS: Walk → Ride (rail advances, Para once) → Arrive with tracking off → Save → Done", async ({ page, context }) => {
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
  await grantLocation(context);
  await stubGeolocation(page);
  await openApp(page);
  await startGuidance(page);

  // Walk: the plan's estimate first, the honest boarding note, focus on the heading, no tab bar.
  await expect(heading(page)).toHaveText("Walk to Plaza Rizal (A1)");
  await expect(heading(page)).toBeFocused();
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 1 of 3 · Walk");
  await expect(page.getByTestId("guidance-distance")).toHaveText("≈ 230 m walk · straight-line estimate, path not verified");
  await expect(guide(page)).toContainText("Boarding side isn't mapped. Ask the driver or people waiting where Loop A stops.");
  await expect(guide(page)).toContainText("Keep ParaNaga open for guidance.");
  await expect(page.getByTestId("guidance-next-ride")).toContainText("Unverified route — confirm with the driver");
  await expect(tabBar(page)).toBeHidden();
  await expectHonest(page);

  // Location was already allowed: Start turned the watch on (one watch, no prompt).
  await expect.poll(() => geoStub(page)).toEqual({ watches: 1, calls: 1 });
  await emit(page, { lat: 13.6224, lng: 123.1838 }, 12);
  await expect(page.getByTestId("guidance-accuracy")).toHaveText("GPS accuracy ± 12 m");
  await expect(page.getByTestId("guidance-distance")).toHaveText(/^≈ \d+ m to Plaza Rizal \(A1\) in a straight line$/);
  await emit(page, A1, 8);
  await expect(page.getByTestId("guidance-proposal")).toContainText("You look close to Plaza Rizal (A1).");

  await tap(page, "I'm at the stop");
  await expect(heading(page)).toHaveText("Wait for Loop A at Plaza Rizal (A1)");
  await expect(guide(page)).toContainText("Signboard text isn't on file.");
  await tap(page, "I boarded Loop A");

  // Ride: the rail follows the fixes in pin order.
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 2 of 3 · Ride");
  await expect(page.getByTestId("guidance-ride-route")).toHaveText("Loop A · clockwise (from pin order)");
  await expect(page.getByTestId("ride-progress")).toContainText("Plaza Rizal (A1) · boarded");
  await expect(page.getByTestId("ride-progress")).toContainText("Get off · Avenue Square (A5)");
  await expectHonest(page);
  await emit(page, A2);
  await expect(page.getByTestId("ride-count")).toHaveText("1 of 4 stops passed, by pin order");
  await expect(heading(page)).toHaveText("3 stops to go");
  await expect(page.getByTestId("ride-rail").locator('[data-state="passed"]')).toHaveCount(1);
  await expect(page.getByTestId("para-alert")).toHaveCount(0);
  await emit(page, A3);
  await expect(page.getByTestId("ride-count")).toHaveText("2 of 4 stops passed, by pin order");
  await emit(page, A4);
  const alert = page.getByRole("alert").filter({ hasText: "Para! Next stop is yours" });
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText("Get off at Avenue Square (A5).");
  await emit(page, A4);
  await expect(alert).toHaveCount(1);
  await expectAxeClean(page);
  await tap(page, "I said “Para”");
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId("para-acknowledged")).toContainText("Step off when the jeepney stops at Avenue Square (A5)");
  await expect(guide(page).getByRole("link", { name: "Problem with a driver? Report it in MyNaga" })).toHaveAttribute("href", "/app/mynaga");
  await tap(page, "I got off");

  // Last walk, then Arrive: watch and wake lock stopped.
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 3 of 3 · Walk");
  await expect(heading(page)).toHaveText("Walk to Pinned location");
  await tap(page, "I've arrived");
  await expect(heading(page)).toHaveText("You've arrived");
  await expect(page.getByTestId("arrive-body")).toHaveText("Pinned location. Guidance has ended and ParaNaga has stopped using your location.");
  expect((await geoStub(page)).watches).toBe(0);
  await expect(page.getByTestId("guidance-accuracy")).toHaveCount(0);
  await expect(page.getByTestId("arrive-summary")).toContainText("≈ 350 m walk · estimate");
  await expect(page.getByTestId("arrive-summary")).toContainText("Estimate ₱14–₱17");
  await expect(guide(page)).not.toContainText(/rate|rating|helpful/i);
  await expectHonest(page);
  await expectAxeClean(page);

  // Save this trip → it is a real saved trip.
  const save = page.getByTestId("arrive-save");
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await expect(save).toContainText("Trip saved");
  await expect(save).toContainText("Available offline in Saved");

  await guide(page).getByRole("button", { name: "Done" }).click();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByTestId("endpoint-start")).toContainText("Choose start");
  await expect(tabBar(page)).toBeVisible();
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), SESSION_KEY)).toBeNull();
  expect((await geoStub(page)).watches).toBe(0);
  await tabBar(page).getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page.getByTestId("saved-trip")).toHaveCount(1);
});

test("two rides, location denied: every step completes by buttons (Transfer included)", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) => fulfill(route, TWO_RIDE_PLAN));
  await stubGeolocation(page, "deny");
  await openApp(page);
  await startGuidance(page);

  // Not allowed yet: nothing watches until the tap, and a refusal leaves the buttons.
  expect(await geoStub(page)).toEqual({ watches: 0, calls: 0 });
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 1 of 5 · Walk");
  await page.getByTestId("guidance-use-location").click();
  await expect(page.getByTestId("guidance-location-off")).toHaveText("Location is off. Follow the steps and tap “I'm at the stop” when you get there.");
  expect((await geoStub(page)).watches).toBe(0);
  await expectAxeClean(page);

  await tap(page, "I'm at the stop");
  await tap(page, "I boarded Loop A");
  await expect(heading(page)).toHaveText("Ride to Magsaysay Junction (A3)");
  await expect(page.getByTestId("ride-count")).toHaveText("2 stops after Plaza Rizal (A1), by pin order");
  await expect(guide(page)).toContainText("Stop alerts work only while ParaNaga is open on your screen.");
  await tap(page, "My stop is next");
  await expect(page.getByRole("alert").filter({ hasText: "Para! Next stop is yours" })).toHaveCount(1);
  await tap(page, "I said “Para”");
  await tap(page, "I got off");

  // Transfer: the ordered checklist, then the next boarding.
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 3 of 5 · Transfer");
  await expect(heading(page)).toHaveText("Walk to Del Rosario (B1)");
  await expect(guide(page)).toContainText("Magsaysay Junction (A3) → Del Rosario (B1)");
  const checklist = page.getByTestId("guidance-checklist").getByRole("listitem");
  await expect(checklist).toHaveCount(3);
  await expect(checklist.nth(0)).toContainText("Got off at Magsaysay Junction (A3)");
  await expect(checklist.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("guidance-distance")).toHaveText("≈ 80 m walk · straight-line estimate, path not verified");
  await expectHonest(page);
  await expectAxeClean(page);
  await tap(page, "I'm at the stop");
  await expect(guide(page)).toContainText("Signboard text isn't on file. Before you get on, ask the driver: “Loop B?”");
  await tap(page, "I boarded Loop B");
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 4 of 5 · Ride");
  await expect(page.getByTestId("guidance-ride-route")).toHaveText("Loop B · counterclockwise (from pin order)");
  await tap(page, "I got off");
  await tap(page, "I've arrived");
  await expect(heading(page)).toHaveText("You've arrived");
  await expect(page.getByTestId("arrive-summary")).toContainText("Loop A");
  await expect(page.getByTestId("arrive-summary")).toContainText("Loop B");
  await guide(page).getByRole("button", { name: "Done" }).click();
  await expect(guide(page)).toHaveCount(0);
  expect((await geoStub(page)).calls).toBe(1);
});

test("Report it in MyNaga opens the handoff, and closing it returns to the running ride", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
  await stubGeolocation(page, "deny");
  await openApp(page);
  await startGuidance(page);
  await tap(page, "I'm at the stop");
  await tap(page, "I boarded Loop A");
  const rideTitle = await heading(page).textContent();
  const stepLabel = await page.getByTestId("guidance-step-label").textContent();

  await guide(page).getByTestId("guidance-report-driver").click();
  await expect(page).toHaveURL(/\/app\/mynaga$/);
  await expect(page.getByRole("heading", { level: 1, name: "Report in MyNaga" })).toBeFocused();
  await expect(page.getByTestId("app-home-layer")).toHaveAttribute("inert", "");

  // Back (history, not a new /app entry): the same ride step, still running.
  const historyLength = await page.evaluate(() => history.length);
  await page.getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(guide(page)).toBeVisible();
  await expect(heading(page)).toHaveText(rideTitle!);
  await expect(page.getByTestId("guidance-step-label")).toHaveText(stepLabel!);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).not.toBeNull();

  // Escape closes it the same way.
  await guide(page).getByTestId("guidance-report-driver").click();
  await expect(page.getByRole("heading", { level: 1, name: "Report in MyNaga" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app$/);
  await expect(heading(page)).toHaveText(rideTitle!);
});

test("Undo last step goes back one confirmation; after Arrive it never restarts location", async ({ page, context }) => {
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
  await grantLocation(context);
  await stubGeolocation(page);
  await openApp(page);
  await startGuidance(page);
  await expect.poll(() => geoStub(page)).toEqual({ watches: 1, calls: 1 });
  await expect(page.getByTestId("guidance-undo")).toHaveCount(0);

  await tap(page, "I'm at the stop");
  await tap(page, "I boarded Loop A");
  await expect(page.getByTestId("guidance-step-label")).toHaveText("Step 2 of 3 · Ride");
  await page.getByTestId("guidance-undo").click();
  await expect(heading(page)).toHaveText("Wait for Loop A at Plaza Rizal (A1)");
  await expect(heading(page)).toBeFocused();
  await page.getByTestId("guidance-undo").click();
  await expect(heading(page)).toHaveText("Walk to Plaza Rizal (A1)");
  await expect(page.getByTestId("guidance-undo")).toHaveCount(0);

  await tap(page, "I boarded Loop A");
  await tap(page, "I got off");
  await tap(page, "I've arrived");
  expect((await geoStub(page)).watches).toBe(0);
  await expect(page.getByTestId("guidance-undo")).toHaveText("Undo last step");
  await page.getByTestId("guidance-undo").click();
  await expect(heading(page)).toHaveText("Walk to Pinned location");
  // Location stays off until tapped again.
  expect(await geoStub(page)).toEqual({ watches: 0, calls: 1 });
  await expect(page.getByTestId("guidance-use-location")).toBeVisible();
  await page.getByTestId("guidance-use-location").click();
  await expect.poll(() => geoStub(page)).toEqual({ watches: 1, calls: 2 });
});

test("a reload resumes the step with location off; End guidance puts the trip back in the options", async ({ page, context }) => {
  // Playwright's own geolocation here (no stub): 80 m, too coarse for distances.
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
  await openApp(page);
  await startGuidance(page);
  await tap(page, "I'm at the stop");
  await expect(heading(page)).toHaveText("Wait for Loop A at Plaza Rizal (A1)");
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), SESSION_KEY)).not.toBeNull();

  await page.reload();
  await expect(guide(page)).toBeVisible();
  await expect(heading(page)).toHaveText("Wait for Loop A at Plaza Rizal (A1)");
  await expect(page.getByTestId("guidance-accuracy")).toHaveCount(0);
  await expect(tabBar(page)).toBeHidden();

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 13.6228, longitude: 123.1842, accuracy: 80 });
  await page.getByTestId("guidance-use-location").click();
  await expect(page.getByTestId("guidance-accuracy")).toHaveText("GPS accuracy ± 80 m");
  await expect(page.getByTestId("guidance-location-note")).toHaveText("Your location is approximate (± 80 m), so distance and direction are hidden.");
  await expectAxeClean(page);

  await page.getByRole("button", { name: "End guidance" }).click();
  const dialog = page.getByTestId("guidance-end-confirm");
  await expect(dialog).toContainText("End guidance?");
  await expect(dialog).toContainText("Your trip stays in the options.");
  await dialog.getByRole("button", { name: "End guidance" }).click();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByTestId("trip-option")).toHaveCount(2);
  await expect(page.getByTestId("endpoint-destination")).toContainText("Pinned location");
  await expect(tabBar(page)).toBeVisible();
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), SESSION_KEY)).toBeNull();
});

test("missed stop with a fresh fix plans again from there", async ({ page, context }) => {
  const calls: unknown[] = [];
  await page.route("**/api/v1/plan", (route) => {
    calls.push(route.request().postDataJSON());
    return fulfill(route, PROVISIONAL_PLAN);
  });
  await grantLocation(context);
  await stubGeolocation(page);
  await openApp(page);
  await startGuidance(page);
  await tap(page, "I'm at the stop");
  await tap(page, "I boarded Loop A");
  await expect.poll(() => geoStub(page)).toEqual({ watches: 1, calls: 1 });
  await emit(page, A2);
  await expect(page.getByTestId("ride-count")).toHaveText("1 of 4 stops passed, by pin order");

  await tap(page, "I missed my stop");
  await expect(heading(page)).toHaveText("Missed your stop?");
  await expect(guide(page)).toContainText("Get off when the jeepney next stops, then plan again from where you are.");
  expect((await geoStub(page)).watches).toBe(0);
  await expectAxeClean(page);
  const before = calls.length;
  await page.getByTestId("guidance-replan").click();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByTestId("endpoint-start")).toContainText("Your location");
  await expect(page.getByTestId("endpoint-destination")).toContainText("Pinned location");
  await expect.poll(() => calls.length).toBeGreaterThan(before);
  expect(calls.at(-1)).toMatchObject({ origin: { lat: A2.lat, lng: A2.lng } });
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
});

test("missed stop without any fix opens pick mode: Choose where you are on the map", async ({ page }) => {
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
  await stubGeolocation(page);
  await openApp(page);
  await startGuidance(page);
  await tap(page, "I boarded Loop A");
  await tap(page, "I missed my stop");
  await page.getByTestId("guidance-replan").click();
  await expect(page.locator(".pn-pick__title")).toHaveText("Choose where you are on the map");
  await page.getByRole("button", { name: "Set start here" }).click();
  await expect(page.getByTestId("endpoint-destination")).toContainText("Pinned location");
  await expect(page.getByTestId("trip-option").first()).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`each guidance step has no serious or critical violations (${colorScheme})`, async ({ page }) => {
      await page.route("**/api/v1/plan", (route) => fulfill(route, TWO_RIDE_PLAN));
      await stubGeolocation(page);
      await openApp(page);
      await startGuidance(page);
      await expectAxeClean(page); // Walk
      await tap(page, "I'm at the stop");
      await tap(page, "I boarded Loop A");
      await expectAxeClean(page); // Ride
      await tap(page, "My stop is next");
      await expect(page.getByTestId("para-alert")).toBeVisible();
      await expectAxeClean(page); // Ride + Para
      await tap(page, "I got off");
      await expectAxeClean(page); // Transfer
      await tap(page, "I boarded Loop B");
      await tap(page, "I missed my stop");
      await expectAxeClean(page); // Missed
      await page.getByTestId("guidance-undo").click();
      await tap(page, "I got off");
      await tap(page, "I've arrived");
      await expectAxeClean(page); // Arrive
    });
  });
}
