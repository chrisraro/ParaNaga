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
    "How times are estimated",
    "Vehicle types in Naga",
    "Report a problem with a driver",
  ]);
  await expect(page.getByTestId("help-independent")).toHaveText("ParaNaga is an independent commuter guide. It is not an official City Government app.");

  await tabs(page).getByRole("tab", { name: "Safety" }).click();
  await expect(page).toHaveURL(/\/app\/help\?tab=safety$/);
  await expect(page.getByTestId("help-emergency")).toHaveText("In an emergency, call 911. ParaNaga does not monitor reports and cannot send help.");
  await expect(page.getByTestId("help-tips").getByRole("listitem")).toHaveCount(5);
  await expect(page.getByTestId("help-report-driver")).toHaveAttribute("href", "/app/mynaga");

  await tabs(page).getByRole("tab", { name: "About data" }).click();
  await expect(page.getByTestId("help-badges").getByRole("listitem")).toHaveCount(5);
  // The revision label lives on Sources and credits, not here.
  await expect(page.getByTestId("help-data-revision")).toHaveCount(0);
  await expect(page.getByTestId("help-sources-link")).toContainText("Sources and credits");
  await expect(page.getByTestId("help-data-footer")).toHaveText("ParaNaga does not track vehicles, so it cannot say when one will come. Stop alerts work only while ParaNaga is open on your screen.");

  await page.getByTestId("help-page").getByTestId("detail-back").click();
  await expect(h1(page, "Settings")).toBeVisible();
});

test("each article opens with its copy, and Back returns to the Help tab", async ({ page }) => {
  await openHelpFromMore(page);
  for (const [title, phrase] of [
    ["How trips are planned", "every suggestion carries the badge “Unverified route — confirm with the driver”."],
    ["Why stops are not verified yet", "Stops come from a public map."],
    ["How times are estimated", "Jeepney peak: 7–13 km/h (upper from N29; lower is a ParaNaga assumption)"],
    ["Vehicle types in Naga", "Air-conditioned modern jeepneys run on R4 (Centro–Del Rosario via Panganiban) and R7"],
    ["Using ParaNaga offline", "Planning offline uses the data from Oct 16, 2026; fares may have changed."],
  ] as const) {
    await page.getByTestId("help-links").getByRole("link", { name: title }).click();
    await expect(h1(page, title)).toBeFocused();
    await expect(page).toHaveTitle(`${title} · ParaNaga`);
    // Earlier panels stay mounted (hidden) under the open one: act on the visible one.
    await expect(page.getByTestId("help-article-body").filter({ visible: true })).toContainText(phrase);
    await page.getByTestId("help-article").filter({ visible: true }).getByTestId("detail-back").click();
    await expect(h1(page, "Help")).toBeVisible();
  }
  // The two Task 14 articles: the times basis comes from the snapshot's model; no e-jeepney, no "live".
  await page.goto("/app/help/how-times-are-estimated");
  const times = page.getByTestId("help-article-body");
  await expect(times).toContainText("Times are ranges. They do not include waiting, because Naga has no published jeepney schedules.");
  for (const code of ["N28", "N16", "N29", "N04"]) await expect(times).toContainText(code);
  for (const a of ["Assumption A1:", "Assumption A2:", "Assumption A3:"]) await expect(times).toContainText(a);
  await expect(times).toContainText("Based on typical speeds. ParaNaga uses no traffic service.");
  await expect(times).not.toContainText(/live/i);
  await page.goto("/app/help/vehicle-types-in-naga");
  await expect(page.getByTestId("help-article-body")).toContainText("Traditional jeepneys run on every route group (R1–R8)");
  await expect(page.getByTestId("help-article-body")).not.toContainText(/e-?jeep|electric jeep|2023|Euro-?4|live/i);

  await page.goto("/app/help/not-an-article");
  await expect(h1(page, "Not found")).toBeVisible();
});

test("Sources and credits lists the captured sources with checked dates and safe external links", async ({ page }) => {
  test.slow(); // one assertion per source row
  await page.goto("/app/help?tab=data");
  await page.getByTestId("help-sources-link").click();
  await expect(h1(page, "Sources and credits")).toBeFocused();
  const rows = page.getByTestId("source-row");
  await expect(rows).toHaveCount(SOURCES.sources.length);
  const codes = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
  expect(codes).toEqual(SOURCES.sources.map((s) => s.code));
  // The S01–S42 research codes on file (a subset: only those the published revision cites).
  expect(codes.filter((c) => /^S\d\d$/.test(c ?? ""))).toEqual(expect.arrayContaining(["S01", "S22", "S28", "S33", "S34", "S37", "S39", "S40"]));
  for (const s of SOURCES.sources) {
    const row = page.locator(`[data-testid="source-row"][data-code="${s.code}"]`);
    await expect(row).toContainText(`${s.code} · ${s.title}`);
    await expect(row).toContainText(`· checked ${Number(s.checkedOn!.slice(8))} Oct 2026`);
    if (s.code === "S40") {
      // The KML export downloads a file: listed, never offered as a link.
      await expect(row.getByTestId("source-link")).toHaveCount(0);
      await expect(row.getByTestId("source-unlinked")).toBeVisible();
      continue;
    }
    if (s.url === null) {
      // The owner confirmation (U01) has no public address: listed, with no link.
      await expect(row.getByTestId("source-unlinked")).toHaveText("No public address on file");
      continue;
    }
    const link = row.getByTestId("source-link");
    await expect(link).toHaveAttribute("href", s.url!);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  // Every register href has no query string, or one on the allow-list (the My Maps viewer's ?mid=).
  const hrefs = await page.getByTestId("source-link").evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
  expect(hrefs).toHaveLength(SOURCES.sources.filter((s) => s.url !== null).length - 1);
  for (const href of hrefs) {
    const url = new URL(href);
    expect(url.search === "" || (url.hostname === "www.google.com" && url.pathname === "/maps/d/viewer" && [...url.searchParams.keys()].join() === "mid"), href).toBe(true);
  }
  await expect(page.getByTestId("sources-owner-note")).toHaveText("Naga City Designated Stops — shared publicly by Tan Gumba");
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
    if (name === "About data") await expect(page.getByTestId("help-sources-link")).toBeVisible();
    await expectAxeClean(page, "help-page");
  }
  await page.goto("/app/help/using-paranaga-offline");
  await expect(page.getByTestId("help-article-body")).toContainText("Oct 16, 2026");
  await expectAxeClean(page, "help-article");
  await page.goto("/app/help/how-times-are-estimated");
  await expect(page.getByTestId("help-article-body")).toContainText("Assumption A3:");
  await expectAxeClean(page, "help-article");
  await page.goto("/app/help/vehicle-types-in-naga");
  await expect(page.getByTestId("help-article-body")).toContainText("UV Express and bus");
  await expectAxeClean(page, "help-article");
  await page.goto("/app/help/sources");
  await expect(page.getByTestId("source-row").first()).toBeVisible();
  await expectAxeClean(page, "sources-page");
  await page.goto("/app/mynaga");
  await expect(h1(page, "Report in MyNaga")).toBeVisible();
  await expectAxeClean(page, "mynaga-page");
}

test("Help, an article, the sources register and MyNaga pass axe (light)", async ({ page }) => {
  test.slow(); // eight pages, each with an axe scan: 26-28 s on a quiet machine, over the 30 s default under load
  await axeAll(page);
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("Help, an article, the sources register and MyNaga pass axe (dark)", async ({ page }) => {
    test.slow(); // see the light variant
    await axeAll(page);
  });
});
