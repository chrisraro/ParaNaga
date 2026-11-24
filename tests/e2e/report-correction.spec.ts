import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// Report a correction (S16, task B6): a 3-step wizard at /app/report. Reading and filling it works
// as a guest; sending needs an account. The API is answered with page routes, so no database is
// needed. Tiles are aborted. Every test checks for CSP (report-only) violations.

const TILE_RE = /tile\.openstreetmap\.org|api\.maptiler\.com/;
const PREFS_KEY = "paranaga.prefs";
const STOP_URL = "/app/report?type=stop&id=stop-101&label=Plaza%20Rizal";
const USER = { user: { id: "user-1", name: "Maria", roles: ["commuter"] } };

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

async function mockApi(page: Page, opts: { signedIn: boolean }) {
  await page.route(TILE_RE, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(opts.signedIn ? USER : { user: null }) }),
  );
}

test.beforeEach(async ({ page }) => {
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

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

async function open(page: Page, url = STOP_URL) {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Report a correction" })).toBeFocused();
  await expect(heading(page, "What's wrong")).toBeVisible();
}

async function fillStep1And2(page: Page) {
  await page.getByRole("radio", { name: /Wrong curb side/ }).check();
  await page.getByTestId("report-next").click();
  await expect(heading(page, "Tell us what you saw")).toBeFocused();
  await page.getByLabel("What did you see?").fill("The stop sign is on the opposite side of the road now.");
  await page.getByTestId("report-next").click();
  await expect(heading(page, "Review and send")).toBeFocused();
}

test.describe("guest", () => {
  test("can fill the wizard but is asked to sign in to send", async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await open(page);
    await expect(page.getByTestId("report-progress")).toHaveText("Step 1 of 3");

    // Step 1 needs a choice.
    await page.getByTestId("report-next").click();
    await expect(page.getByTestId("report-error")).toContainText("Choose what is wrong");

    await fillStep1And2(page);
    await expect(page.getByTestId("report-summary")).toContainText("Wrong curb side");
    await expect(page.getByTestId("report-summary")).toContainText("Plaza Rizal");
    await expect(page.getByTestId("report-signin")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /^\/app\/sign-in\?next=%2Fapp%2Freport/);
    await expect(page.getByTestId("report-send")).toHaveCount(0);
  });
});

/** A soft navigation, as a link makes it: the router keeps the page it leaves mounted but hidden. */
async function go(page: Page, path: string) {
  await page.evaluate((p) => (window as unknown as { next: { router: { push(p: string): void } } }).next.router.push(p), path);
  await page.waitForURL((u) => u.pathname + u.search === path);
}

test.describe("leaving", () => {
  test("a report about something else starts empty; the same one keeps its answers", async ({ page }) => {
    await mockApi(page, { signedIn: true });
    await open(page);
    await fillStep1And2(page);
    await go(page, "/app/explore");
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
    await page.waitForTimeout(1500); // hidden pages update late: give a wrong reset time to happen
    await go(page, STOP_URL);
    await expect(page.getByTestId("report-summary").filter({ visible: true })).toContainText("opposite side");
    await go(page, "/app/explore");
    await go(page, "/app/report?type=route&id=R4&label=Route%204");
    await expect(page.getByTestId("report-progress").filter({ visible: true })).toHaveText("Step 1 of 3");
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  });

  for (const how of ["sent", "signed out"] as const) {
    test(`the same entity starts empty once the report was ${how}`, async ({ page }) => {
      let user: typeof USER | { user: null } = USER;
      await mockApi(page, { signedIn: true });
      await page.route("**/api/v1/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
      await page.route("**/api/v1/corrections", (route) =>
        route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ correction: { id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99", category: "wrong_curb_side", entityType: "stop", entityId: "stop-101", entityLabel: "Plaza Rizal", status: "submitted", submittedAt: "2026-10-18T01:00:00.000Z" } }) }),
      );
      await open(page);
      await fillStep1And2(page);
      await expect(page.getByTestId("report-send")).toBeVisible();
      if (how === "sent") {
        await page.getByTestId("report-ack").check();
        await page.getByTestId("report-send").click();
        await expect(page.getByTestId("report-done")).toBeVisible();
      } else user = { user: null };
      await go(page, "/app/explore");
      await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
      await go(page, STOP_URL);
      await expect(page.getByTestId("report-progress").filter({ visible: true })).toHaveText("Step 1 of 3");
      await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    });
  }

  test("signing in keeps what was typed, never the location", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 13.6233869, longitude: 123.1846726, accuracy: 18 });
    let signedIn = false;
    await mockApi(page, { signedIn: false });
    await page.route("**/api/v1/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signedIn ? USER : { user: null }) }));
    await page.route("**/api/auth/**", (route) => {
      if (route.request().url().includes("sign-in/email-otp")) signedIn = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signedIn ? { token: "t", user: { id: "user-1", email: "a@example.com" } } : { success: true }) });
    });
    await open(page);
    await page.getByRole("radio", { name: /Wrong curb side/ }).check();
    await page.getByTestId("report-next").click();
    await page.getByLabel("What did you see?").fill("Kept while signing in.");
    await page.getByTestId("report-add-location").click();
    await expect(page.getByTestId("report-location")).toBeVisible();
    await page.getByTestId("report-next").click();
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.waitForURL("**/app/sign-in?next=**");
    const stored = await page.evaluate(() => sessionStorage.getItem("paranaga.reportDraft"));
    expect(stored).toContain("Kept while signing in.");
    expect(stored).not.toMatch(/13\.62|123\.18|"lat"/);

    await page.locator("#signin-email").fill("a@example.com");
    await page.getByTestId("send-otp-btn").click();
    await page.locator("#signin-otp").fill("123456");
    await page.getByTestId("verify-otp-btn").click();
    await page.waitForURL((u) => u.pathname === "/app/report" && u.searchParams.get("id") === "stop-101");
    await expect(page.getByTestId("report-progress")).toHaveText("Step 2 of 3");
    await expect(page.getByLabel("What did you see?")).toHaveValue("Kept while signing in.");
    await expect(page.getByText("Your location was not kept")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("paranaga.reportDraft"))).toBeNull();
    await page.getByTestId("report-next").click();
    await expect(page.getByTestId("report-send")).toBeVisible();
  });
});

test.describe("signed in", () => {
  test("sends a report after the AI disclosure, with focus and Escape handled per step", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 13.6233869, longitude: 123.1846726, accuracy: 18 });
    await mockApi(page, { signedIn: true });
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/v1/corrections", async (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({
          correction: {
            id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99",
            category: "wrong_curb_side",
            entityType: "stop",
            entityId: "stop-101",
            entityLabel: "Plaza Rizal",
            status: "submitted",
            submittedAt: "2026-10-18T01:00:00.000Z",
          },
        }),
      });
    });

    await open(page);
    await page.getByRole("radio", { name: /Wrong curb side/ }).check();
    await page.getByTestId("report-next").click();
    await expect(heading(page, "Tell us what you saw")).toBeFocused();
    await expect(page.getByTestId("report-entity")).toContainText("Plaza Rizal");

    // Too short: stays on the step with a message.
    await page.getByLabel("What did you see?").fill("short");
    await page.getByTestId("report-next").click();
    await expect(page.getByTestId("report-error")).toContainText("at least 10");

    // Location is asked only on tap, and shows its accuracy.
    await expect(page.getByTestId("report-location")).toHaveCount(0);
    await page.getByTestId("report-add-location").click();
    await expect(page.getByTestId("report-location")).toContainText("accurate to about 18 m");

    await page.getByLabel("What did you see?").fill("The stop sign is on the opposite side of the road now.");
    await page.getByTestId("report-next").click();
    await expect(heading(page, "Review and send")).toBeFocused();
    await expect(page.getByTestId("report-disclosure")).toContainText("Photos are never sent");

    // Escape steps out one step, back to step 2 with the answers kept.
    await page.keyboard.press("Escape");
    await expect(heading(page, "Tell us what you saw")).toBeFocused();
    await expect(page.getByLabel("What did you see?")).toHaveValue(/opposite side/);
    await page.getByTestId("report-next").click();

    // The disclosure must be accepted first.
    await page.getByTestId("report-send").click();
    await expect(page.getByTestId("report-error")).toContainText("Tick the box");
    expect(sent).toBeNull();
    await page.getByTestId("report-ack").check();
    await page.getByTestId("report-send").click();

    await expect(heading(page, "Report sent")).toBeFocused();
    await expect(page.getByTestId("report-done")).toContainText("Received");
    await expect(page.getByTestId("report-done")).not.toContainText(/\b(ETA|live|arriving)\b/i);
    expect(sent).toMatchObject({
      category: "wrong_curb_side",
      entityType: "stop",
      entityId: "stop-101",
      aiDisclosureAccepted: true,
      location: { accuracyM: 18 },
      mediaIds: [],
    });
    expect(String((sent as unknown as { clientRequestId: string }).clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("keeps the answers and says so when sending fails", async ({ page }) => {
    await mockApi(page, { signedIn: true });
    await page.route("**/api/v1/corrections", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ error: { code: "too_many_requests", message: "Slow down", requestId: "r1" } }),
      }),
    );
    await open(page);
    await fillStep1And2(page);
    await page.getByTestId("report-ack").check();
    await page.getByTestId("report-send").click();
    await expect(page.getByTestId("report-error")).toContainText("too quickly");
    await expect(page.getByTestId("report-send")).toBeEnabled();
  });

  test("without a prefilled entity it asks what the report is about", async ({ page }) => {
    await mockApi(page, { signedIn: true });
    await open(page, "/app/report");
    await page.getByRole("radio", { name: /Something else/ }).check();
    await page.getByTestId("report-next").click();
    await page.getByLabel("What did you see?").fill("Something is wrong with this thing here.");
    await page.getByTestId("report-next").click();
    await expect(page.getByTestId("report-error")).toContainText("Choose what this is about");
    await page.getByLabel("What is it about?").selectOption("route");
    await page.getByLabel("Name or code").fill("Route 4");
    await page.getByTestId("report-next").click();
    await expect(heading(page, "Review and send")).toBeFocused();
    await expect(page.getByTestId("report-summary")).toContainText("Route · Route 4");
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`all three steps pass axe: ${scheme}`, async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!sessionStorage.getItem("__prefsSeeded")) {
          localStorage.setItem(key, value);
          sessionStorage.setItem("__prefsSeeded", "1");
        }
      },
      [PREFS_KEY, JSON.stringify({ theme: scheme })] as const,
    );
    await mockApi(page, { signedIn: true });
    await open(page);
    await expectAxeClean(page);

    await page.getByRole("radio", { name: /Wrong curb side/ }).check();
    await page.getByTestId("report-next").click();
    await expect(heading(page, "Tell us what you saw")).toBeFocused();
    await expectAxeClean(page);

    await page.getByLabel("What did you see?").fill("The stop sign is on the opposite side of the road now.");
    await page.getByTestId("report-next").click();
    await expect(heading(page, "Review and send")).toBeFocused();
    await expectAxeClean(page);
  });
}
