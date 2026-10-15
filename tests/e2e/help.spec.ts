import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { SOURCES, routeNetwork } from "./fixtures/network";

// Help (Help · Safety · About data), the articles, the sources register and the MyNaga handoff
// (Increment A, Task 11). Tiles are aborted; every request leaving localhost is aborted too (the
// external links must never load anything during a test); every test checks for CSP (report-only)
// violations.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const EXTERNAL = (url: URL) => url.hostname !== "localhost";
const tabs = (page: Page) => page.getByRole("tablist", { name: "Help sections" });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });

test.beforeEach(async ({ context, page }) => {
  await context.route(EXTERNAL, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }));
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

async function expectAxeClean(page: Page, testId: string) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include(`[data-testid="${testId}"]`).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

async function openHelpFromMore(page: Page) {
  await page.goto("/app/more");
  await expect(h1(page, "Settings")).toBeVisible();
  await page.getByTestId("settings-help").click();
  await expect(h1(page, "Help")).toBeFocused();
}

test("Help opens from More with its three tabs, and Back returns to More", async ({ page }) => {
  await openHelpFromMore(page);
  await expect(tabs(page).getByRole("tab")).toHaveText(["Help", "Safety", "About data"]);
  await expect(page.getByTestId("help-links").getByRole("link")).toHaveText([
    "How trips are planned",
    "Why stops are not verified yet",
    "Using ParaNaga offline",
    "Report a problem with a driver",
  ]);
  await expect(page.getByTestId("help-independent")).toHaveText("ParaNaga is an independent commuter guide. It is not an official City Government app.");

  await tabs(page).getByRole("tab", { name: "Safety" }).click();
  await expect(page).toHaveURL(/\/app\/help\?tab=safety$/);
  await expect(page.getByTestId("help-emergency")).toHaveText("In an emergency, call 911. ParaNaga does not monitor reports and cannot send help.");
  await expect(page.getByTestId("help-tips").getByRole("listitem")).toHaveCount(5);
  await expect(page.getByTestId("help-report-driver")).toHaveAttribute("href", "/app/mynaga");

  await tabs(page).getByRole("tab", { name: "About data" }).click();
  await expect(page.getByTestId("help-badges").getByRole("listitem")).toHaveCount(4);
  await expect(page.getByTestId("help-data-revision")).toHaveText("Data revisionosm-places-2026-10-15 · Oct 15, 2026");
  await expect(page.getByTestId("help-data-footer")).toHaveText("No live arrival times. Stop alerts work only while ParaNaga is open on your screen.");

  await page.getByTestId("help-page").getByTestId("detail-back").click();
  await expect(h1(page, "Settings")).toBeVisible();
});

test("each article opens with its copy, and Back returns to the Help tab", async ({ page }) => {
  await openHelpFromMore(page);
  for (const [title, phrase] of [
    ["How trips are planned", "every suggestion carries the badge “Unverified route — confirm with the driver”."],
    ["Why stops are not verified yet", "Every stop on the map comes from a public My Maps snapshot (retrieved 15 October 2026)."],
    ["Using ParaNaga offline", "Planning offline uses the data from Oct 15, 2026; fares may have changed."],
  ] as const) {
    await page.getByTestId("help-links").getByRole("link", { name: title }).click();
    await expect(h1(page, title)).toBeFocused();
    // Earlier panels stay mounted (hidden) under the open one: act on the visible one.
    await expect(page.getByTestId("help-article-body").filter({ visible: true })).toContainText(phrase);
    await page.getByTestId("help-article").filter({ visible: true }).getByTestId("detail-back").click();
    await expect(h1(page, "Help")).toBeVisible();
  }
  await page.goto("/app/help/not-an-article");
  await expect(h1(page, "Not found")).toBeVisible();
});

test("the sources register lists the captured sources with checked dates and safe external links", async ({ page }) => {
  await page.goto("/app/help?tab=data");
  await page.getByTestId("help-sources-link").click();
  await expect(h1(page, "Sources and dates")).toBeFocused();
  const rows = page.getByTestId("source-row");
  await expect(rows).toHaveCount(SOURCES.sources.length);
  const codes = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
  expect(codes).toEqual(SOURCES.sources.map((s) => s.code));
  // The S01–S42 research codes on file (a subset: only those the published revision cites).
  expect(codes.filter((c) => /^S\d\d$/.test(c ?? ""))).toEqual(expect.arrayContaining(["S01", "S22", "S28", "S33", "S34", "S37"]));
  for (const s of SOURCES.sources) {
    const row = page.locator(`[data-testid="source-row"][data-code="${s.code}"]`);
    await expect(row).toContainText(`${s.code} · ${s.title}`);
    await expect(row).toContainText("· checked 15 Oct 2026");
    const link = row.getByTestId("source-link");
    await expect(link).toHaveAttribute("href", s.url!);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(page.getByTestId("sources-owner-note")).toHaveText("The public My Maps owner is listed as “Tan Gumba”; the owner's identity is not verified.");
});

test("MyNaga: the independence note, the checklist and four verified links that change nothing in the app", async ({ page, context }) => {
  await page.goto("/app/help?tab=safety");
  await page.getByTestId("help-report-driver").click();
  await expect(h1(page, "Report in MyNaga")).toBeFocused();
  await expect(page.getByTestId("mynaga-independent")).toHaveText(
    "ParaNaga is independent. It is not affiliated with MyNaga or the City Government and is not an official channel. Opening MyNaga does not submit your report.",
  );
  await expect(page.getByTestId("mynaga-prepare").getByRole("listitem")).toHaveCount(5);
  const links = page.getByTestId("mynaga-links").getByRole("link");
  // Pixel 7 (Android): Google Play first.
  await expect(links).toHaveText(["Get MyNaga on Google Play", "Get MyNaga on the App Store", "Open mynaga.app", "About MyNaga (City of Naga)"]);
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs).toEqual([
    "https://play.google.com/store/apps/details?id=com.easybusph.myNaga",
    "https://apps.apple.com/ph/app/mynaga/id6748720972",
    "https://mynaga.app/",
    "https://www2.naga.gov.ph/available-mynaga-app/",
  ]);
  for (let i = 0; i < 4; i++) {
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    await expect(links.nth(i)).toHaveAttribute("rel", /noopener/);
  }
  await expect(page.getByTestId("mynaga-footer")).toHaveText("We can't see or confirm what happens in MyNaga.");

  // A click opens a new tab (its load is aborted here) and changes nothing in the app: no API call
  // or navigation reaches our server (background route prefetches of the map underneath are not
  // the link's doing), the page stays where it is, nothing is stored.
  await page.waitForLoadState("networkidle");
  const ours: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.hostname === "localhost" && (r.method() !== "GET" || r.isNavigationRequest() || url.pathname.startsWith("/api/"))) ours.push(`${r.method()} ${r.url()}`);
  });
  const storageBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  const popup = context.waitForEvent("page");
  await links.first().click();
  await (await popup).close();
  await expect(h1(page, "Report in MyNaga")).toBeVisible();
  expect(page.url()).toMatch(/\/app\/mynaga$/);
  expect(ours).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).toBe(storageBefore);
});

async function axeAll(page: Page) {
  await page.goto("/app/help");
  await expect(h1(page, "Help")).toBeVisible();
  await expectAxeClean(page, "help-page");
  for (const name of ["Safety", "About data"]) {
    await tabs(page).getByRole("tab", { name }).click();
    await expect(tabs(page).getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    if (name === "About data") await expect(page.getByTestId("help-data-revision")).toContainText("osm-places");
    await expectAxeClean(page, "help-page");
  }
  await page.goto("/app/help/using-paranaga-offline");
  await expect(page.getByTestId("help-article-body")).toContainText("Oct 15, 2026");
  await expectAxeClean(page, "help-article");
  await page.goto("/app/help/sources");
  await expect(page.getByTestId("source-row").first()).toBeVisible();
  await expectAxeClean(page, "sources-page");
  await page.goto("/app/mynaga");
  await expect(h1(page, "Report in MyNaga")).toBeVisible();
  await expectAxeClean(page, "mynaga-page");
}

test("Help, an article, the sources register and MyNaga pass axe (light)", async ({ page }) => {
  await axeAll(page);
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("Help, an article, the sources register and MyNaga pass axe (dark)", async ({ page }) => {
    await axeAll(page);
  });
});
