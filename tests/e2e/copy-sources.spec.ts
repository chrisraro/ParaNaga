import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ACCESS_PLAN, PROVISIONAL_PLAN, SPECIAL_TRIP_PLAN, TWO_RIDE_PLAN, VIA_PLAN } from "./fixtures/plan-responses";
import { SEARCH_INDEX, SOURCES, STOP_A1, routeNetwork } from "./fixtures/network";
import { chooseOption, expandOptions, pinTrip } from "./fixtures/options";

// U3: concise copy with word budgets, and every source, credit and revision on one screen,
// Sources and credits. Working screens carry no "Source", "Retrieved", "S0x", "OpenStreetMap" or
// "revision" text beyond the on-map attribution control and the one "Sources" link.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const CARD_WORDS_ONE_RIDE = 16;
const CARD_WORDS_TWO_RIDES = 20;
/** A tricycle or padyak card also carries its street rule (distance, restricted roads or area). */
const CARD_WORDS_STREET = 32;
/** Increment F: a via chip adds two words; the access card carries a tricycle fare line besides the jeepney card. */
const CARD_WORDS_ONE_RIDE_VIA = 18;
const CARD_WORDS_ACCESS = 31;
const cardBudget = async (card: Locator, jeepney: number) => {
  const mode = await card.getAttribute("data-mode");
  if (mode === "tricycle" || mode === "padyak") return CARD_WORDS_STREET;
  if ((await card.getByTestId("access-line").count()) > 0) return CARD_WORDS_ACCESS;
  if ((await card.getByTestId("card-via").count()) > 0) return CARD_WORDS_ONE_RIDE_VIA;
  return jeepney;
};
const DETAIL_HEADER_WORDS = 16;
const GUIDANCE_WALK_WORDS = 22;
const SM = SEARCH_INDEX.osmPlaces.find((p) => p.name === "SM City Naga")!;
const PLAZA = SEARCH_INDEX.pinPlaces.find((p) => p.label === "Plaza Rizal")!;
const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(PROVISIONAL_PLAN) }),
  );
  await routeNetwork(page);
});

/** Visible words: tokens with a letter or digit, outside screen-reader-only text (and buttons when asked). */
const words = (loc: Locator, skipButtons = false) =>
  loc.evaluate((el, skip) => {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(skip ? ".sr-only, [hidden], button" : ".sr-only, [hidden]").forEach((n) => n.remove());
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
    return parts.join(" ").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
  }, skipButtons);

/** Text of a working screen without the allowed pieces: the on-map attribution, the Sources link, the OSM badge. */
const workingText = (loc: Locator) =>
  loc.evaluate((el) => {
    const clone = el.cloneNode(true) as Element;
    // The OpenStreetMap place badge names the kind of place on its own screen; the credit itself is on Sources.
    clone
      .querySelectorAll('.pn-attribution, .leaflet-control-attribution, [data-testid="detail-sources"], .pn-trip-detail__sources, [data-variant="osm"]')
      .forEach((n) => n.remove());
    return clone.textContent ?? "";
  });
const FORBIDDEN = /Source|Retrieved|\bS0\d|OpenStreetMap|[Rr]evision|Mapped candidate · not yet verified|My Maps|snapshot|Corrections|Verification opens/;

async function pinBoth(page: Page) {
  await pinTrip(page);
}

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("home-search")).toBeVisible();
}

test("word budgets: an option card, the trip detail header and the first guidance step stay short", async ({ page }) => {
  // Off-peak Manila: the header carries no peak-hours line (that line is real copy, but not part of this budget).
  await page.clock.setFixedTime(new Date("2026-10-16T09:30:00+08:00"));
  await openApp(page);
  await pinBoth(page);
  await expandOptions(page);
  for (const card of await page.getByTestId("trip-option").all()) expect(await words(card)).toBeLessThanOrEqual(await cardBudget(card, CARD_WORDS_ONE_RIDE));

  await chooseOption(page);
  const detail = page.getByTestId("trip-detail");
  expect(await words(detail.getByTestId("trip-detail-header"))).toBeLessThanOrEqual(DETAIL_HEADER_WORDS);
  await expect(detail.getByTestId("unverified-badge")).toHaveText("Unverified route — confirm with the driver");
  await expect(detail.getByTestId("how-times-estimated-btn")).toHaveText("How times are estimated");

  await page.getByTestId("trip-start").click();
  const walk = page.getByTestId("guidance-walk");
  await expect(walk).toBeVisible();
  expect(await words(walk, true)).toBeLessThanOrEqual(GUIDANCE_WALK_WORDS);
});

test("working screens carry no source, retrieval, revision or attribution text", async ({ page }) => {
  await openApp(page);
  await pinBoth(page);
  await expandOptions(page);
  const options = page.getByTestId("trip-options");
  expect(await workingText(options)).not.toMatch(FORBIDDEN);

  await chooseOption(page);
  const detail = page.getByTestId("trip-detail");
  expect(await workingText(detail)).not.toMatch(FORBIDDEN);
  await expect(detail.getByRole("link", { name: "Sources" })).toHaveCount(1);

  await page.getByTestId("trip-start").click();
  const guide = page.getByTestId("guidance");
  await expect(guide.getByTestId("guidance-walk")).toBeVisible();
  expect(await workingText(guide)).not.toMatch(FORBIDDEN);
  const sheet = page.getByTestId("trip-sheet");
  await sheet.getByRole("button", { name: "I'm at the stop", exact: true }).click();
  await sheet.getByRole("button", { name: "I boarded Loop A", exact: true }).click();
  await expect(guide.getByTestId("guidance-ride")).toBeVisible();
  expect(await workingText(guide)).not.toMatch(FORBIDDEN);

  for (const [path, testId] of [
    [`/app/stops/${STOP_A1.stop.id}`, "stop-detail"],
    [`/app/places/osm/${SM.key.slice("osm:".length)}`, "place-detail"],
    [`/app/places/pin/${PLAZA.key}`, "place-detail"],
    ["/app/terminals/T01", "terminal-detail"],
    ["/app/routes/R8-A", "route-detail"],
  ] as const) {
    await page.goto(path);
    const screen = page.getByTestId(testId).filter({ visible: true });
    await expect(screen).toBeVisible();
    await expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await workingText(screen), path).not.toMatch(FORBIDDEN);
    // One small "Sources" link in the top bar, nothing else named Source.
    await expect(screen.getByTestId("detail-sources")).toHaveText("Sources");
    await expect(screen.getByTestId("detail-sources")).toHaveAccessibleName("Sources and credits");
  }
});

test("Sources and credits opens from More > About and from a detail screen link, and holds every source", async ({ page }) => {
  await page.goto("/app/more");
  await page.getByTestId("settings-sources").click();
  await expect(page).toHaveURL(/\/app\/help\/sources$/);
  await expect(h1(page, "Sources and credits")).toBeFocused();
  await expect(page).toHaveTitle(/Sources and credits/);

  // Revision label and published date, data basis and retrieval date, owner confirmation, fare basis.
  await expect(page.getByTestId("sources-data-revision")).toContainText("modes-lines-2026-10-16");
  await expect(page.getByTestId("sources-data-revision")).toContainText("Oct 16, 2026");
  await expect(page.getByTestId("sources-data-basis")).toContainText("retrieved 15 Oct 2026");
  await expect(page.getByTestId("sources-list")).toBeVisible();
  await expect(page.getByTestId("source-row")).toHaveCount(SOURCES.sources.length);
  await expect(page.getByTestId("sources-owner-note")).toBeVisible();
  await expect(page.getByTestId("sources-fare-basis")).toContainText("reported fare rules");
  // Attribution and per-list notes.
  await expect(page.getByTestId("sources-osm-attribution")).toContainText("© OpenStreetMap contributors (ODbL)");
  await expect(page.getByTestId("sources-places-note")).toBeVisible();
  await expect(page.getByTestId("sources-rail-note")).toContainText("S19");
  // Photo credits in full, and the rights notes unchanged.
  await expect(page.getByTestId("photo-credit").first()).toContainText("Captured:");
  await expect(page.getByTestId("photo-credit").first()).toContainText("CC BY");
  const rights = page.getByTestId("research-rights");
  for (const code of ["S33", "S34", "S39", "S40"]) await expect(rights).toContainText(code);
  await expect(page.getByTestId("sources-corrections-note")).toHaveText("Corrections and verification aren’t open yet.");

  // From a detail screen: the one Sources link names the item and its raw source record shows here.
  await page.goto(`/app/stops/${STOP_A1.stop.id}`);
  await page.getByTestId("stop-detail").getByTestId("detail-sources").click();
  await expect(h1(page, "Sources and credits")).toBeFocused();
  const record = page.getByTestId("entity-sources").getByTestId("source-record");
  await expect(record).toContainText("Loop Service A · code A1");
  await expect(record.getByTestId("source-coordinates")).toHaveText("13.6233869, 123.1846726");

  await page.goto("/app/routes/R8-A");
  await page.getByTestId("route-detail").getByTestId("detail-sources").click();
  await expect(page.getByTestId("entity-sources")).toContainText("Centro–Magsaysay Loop A");
  await expect(page.getByTestId("entity-sources")).toContainText("Trial revision");
  await expect(page.getByTestId("entity-sources")).toContainText("Sources S01, S02");

  // And from the trip detail.
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
  await page.getByTestId("trip-detail").getByRole("link", { name: "Sources" }).click();
  await expect(h1(page, "Sources and credits")).toBeFocused();
});

for (const mode of ["light", "dark", "high contrast"] as const) {
  test(`axe is clean on Sources and credits, an option card and the trip detail (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode === "dark" ? "dark" : "light" });
    await page.addInitScript((highContrast) => {
      localStorage.setItem(
        "paranaga.prefs",
        JSON.stringify({ theme: "system", highContrast, lowData: false, historyEnabled: false, layers: { routes: true, terminals: true, modes: [] } }),
      );
    }, mode === "high contrast");
    const axe = async (selector: string) => {
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include(selector).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
    };

    await page.goto("/app/help/sources");
    await expect(page.getByTestId("source-row").first()).toBeVisible();
    await axe('[data-testid="sources-page"]');

    await openApp(page);
    await pinBoth(page);
    await expandOptions(page);
    await axe('[data-testid="trip-sheet"]');
    await chooseOption(page);
    await expect(page.getByTestId("trip-detail")).toBeVisible();
    await axe('[data-testid="trip-sheet"]');
  });
}

test("a two-ride option card stays within 20 words and keeps the caution", async ({ page }) => {
  // Off-peak Manila by day: after the last trips the cards add a "Last trips may already have left" line.
  await page.clock.setFixedTime(new Date("2026-10-16T09:30:00+08:00"));
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(TWO_RIDE_PLAN) }),
  );
  await openApp(page);
  await pinBoth(page);
  await expandOptions(page);
  const cards = page.getByTestId("trip-option");
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    expect(await words(card)).toBeLessThanOrEqual(await cardBudget(card, CARD_WORDS_TWO_RIDES));
    if ((await card.getAttribute("data-mode")) === "tricycle") continue;
    await expect(card.getByTestId("card-unverified")).toHaveText("Unverified route");
  }
});

for (const [name, plan] of [["via", VIA_PLAN], ["access", ACCESS_PLAN], ["special-trip", SPECIAL_TRIP_PLAN]] as const) {
  test(`the ${name} plan cards stay within their word budgets and keep the caution`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-16T09:30:00+08:00"));
    await page.route("**/api/v1/plan", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(plan) }),
    );
    await openApp(page);
    await pinBoth(page);
    await expandOptions(page);
    const cards = page.getByTestId("trip-option");
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      expect(await words(card)).toBeLessThanOrEqual(await cardBudget(card, CARD_WORDS_ONE_RIDE));
      if ((await card.getAttribute("data-mode")) === "tricycle") continue;
      await expect(card.getByTestId("card-unverified")).toHaveText("Unverified route");
    }
  });
}

test("hash links land on their target: a photo credit and the fare basis", async ({ page }) => {
  await page.goto("/app/help/sources");
  await expect(page.getByTestId("photo-credit").first()).toBeAttached();
  const ids = await page.getByTestId("photo-credit").evaluateAll((els) => els.map((e) => e.id));
  const last = ids.at(-1)!;
  await page.goto("/app/more"); // a new page load, as a link from another screen is
  await page.goto(`/app/help/sources#${last}`);
  await expect(page.locator(`[id="${last}"]`)).toBeInViewport();
  await expect.poll(() => page.evaluate((id) => document.getElementById(id)!.contains(document.activeElement), last)).toBe(true);
  await page.goto("/app/more");
  await page.goto("/app/help/sources#fare-basis");
  await expect(page.locator("#fare-basis")).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.getElementById("fare-basis")!.contains(document.activeElement))).toBe(true);
  // No hash: the h1 takes focus.
  await page.goto("/app/more");
  await page.goto("/app/help/sources");
  await expect(h1(page, "Sources and credits")).toBeFocused();
});

test("per-item sources: a terminal names its address, mode and regional-service sources; the route its fare rules", async ({ page }) => {
  await page.goto("/app/help/sources?terminal=T01");
  const terminal = page.getByTestId("entity-terminal-sources");
  await expect(terminal).toContainText("Address:");
  await expect(terminal).toContainText("S09");
  await expect(terminal).toContainText("Bus:");
  await expect(terminal).toContainText("RS05");
  await expect(terminal).toContainText("View on OpenStreetMap");
  await expect(page.getByTestId("entity-sources")).toContainText("28 Sep 2026 national per-km rates");
  await page.goto("/app/help/sources?route=R8-A");
  await expect(page.getByTestId("entity-fare-sources")).toContainText("Fare rule");
  await page.goto("/app/help/sources?src=S33,S34");
  await expect(page.getByTestId("entity-coded-sources")).toContainText("S33");
  await page.goto("/app/help/sources?osm=way/293702439&v=6&s=OSM-2026-10-15");
  await expect(page.getByTestId("entity-osm-object")).toContainText("OSM snapshot 15 Oct 2026 · object way/293702439 v6");
});

test("unknown or malformed source links show a short fallback and never echo the value", async ({ page }) => {
  for (const query of ["stop=zz", "osm=node/1;x", `route=${encodeURIComponent("<script>alert(1)</script>")}`, "terminal=T99", "src=S1", "src=S33,<b>"]) {
    await page.goto(`/app/help/sources?${query}`);
    await expect(page.getByTestId("entity-sources-none")).toHaveText("Nothing found for that link.");
    expect(await page.getByTestId("sources-page").textContent()).not.toMatch(/<script>|alert\(1\)|<b>|node\/1;x/);
  }
});

test("Back from Sources returns to the open trip detail with focus kept in the detail", async ({ page }) => {
  await openApp(page);
  await pinBoth(page);
  await chooseOption(page);
  const link = page.getByTestId("trip-detail").getByRole("link", { name: "Sources and credits" });
  await link.click();
  await expect(h1(page, "Sources and credits")).toBeFocused();
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  // Focus is never lost: the detail takes it back on its heading (U2).
  await expect(page.getByTestId("trip-detail").getByRole("heading", { level: 2 })).toBeFocused();
});
