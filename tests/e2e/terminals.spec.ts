import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SNAPSHOT, STOP_A1, routeNetwork } from "./fixtures/network";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";

// Terminals layer, terminal detail and the tricycle hint card (Increment D, Task 13) over the
// captured snapshot and terminal responses. Tiles are aborted; every test checks for CSP
// (report-only) violations.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const MAPPED = SNAPSHOT.terminals.filter((t) => t.lat !== null);
const T14 = SNAPSHOT.terminals.find((t) => t.code === "T14")!;

const homeMap = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const markers = (page: Page) => homeMap(page).locator('[data-testid="terminal-marker"]');
/** Every terminal code drawn on the home map, alone or inside a group marker. */
const drawnCodes = async (page: Page) =>
  (await homeMap(page).locator("[data-codes]").evaluateAll((els) => els.flatMap((el) => (el.getAttribute("data-codes") ?? "").split(" ")))).sort();
const MAPPED_CODES = MAPPED.map((t) => t.code).sort();
const terminal = (page: Page) => page.getByTestId("terminal-detail");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVISIONAL_PLAN) }));
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
  await expect(homeMap(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

async function expectAxeClean(page: Page, selectors: string[]) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]);
  for (const s of selectors) builder = builder.include(s);
  const results = await builder.analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

async function drag(page: Page, dx: number, dy: number) {
  const box = await homeMap(page).boundingBox();
  if (!box) throw new Error("map has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("the terminals layer draws every terminal with a coordinate, named, and the Tricycle filter leaves only T14", async ({ page }) => {
  expect(MAPPED.length).toBeLessThan(SNAPSHOT.terminals.length);
  await openApp(page);
  await expect.poll(() => drawnCodes(page)).toEqual(MAPPED_CODES);
  for (const code of ["T02", "T05", "T15", "T16"]) expect(await drawnCodes(page)).not.toContain(code);
  // At the opening zoom the PNR station and the Pacol and Carolina stations (≈ 40 m apart) overlap:
  // one group marker names them; Enter zooms in and focus follows its first terminal.
  const group = homeMap(page).locator('[data-testid="terminal-group"][data-codes~="T10"]');
  await expect(group).toHaveAttribute("aria-label", /terminals close together: .*Jeepney station to Pacol.*\. Select to see each one$/);
  const first = (await group.getAttribute("data-codes"))!.split(" ")[0]!;
  const zoom = Number(await homeMap(page).getAttribute("data-zoom"));
  await group.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => Number(await homeMap(page).getAttribute("data-zoom"))).toBeGreaterThan(zoom);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-codes") ?? "")).toContain(first);
  await expect.poll(() => drawnCodes(page)).toEqual(MAPPED_CODES);
  // Zoomed in, Bicol Central Station is a named marker of its own with one glyph per mode.
  const t01 = homeMap(page).getByRole("button", { name: "Bicol Central Station, Bus and UV Express terminal, community-mapped location" });
  await expect(t01.locator(".pn-terminal-marker__tile svg")).toHaveCount(2);

  await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
  await page.getByRole("button", { name: "Layers" }).click();
  const sheet = page.getByTestId("layers-sheet");
  await sheet.getByTestId("mode-filter-tricycle").click();
  await expect(markers(page)).toHaveCount(1);
  await expect(markers(page).first()).toHaveAttribute("data-code", "T14");
  // The list equivalent names the waiting areas that are not drawn.
  const list = sheet.getByTestId("layers-terminals-list");
  await expect(list.getByRole("link")).toHaveCount(3);
  await expect(list).toContainText("Deca Vistansa special-trimobile waiting area");
  await expect(list).toContainText("Tricycle · Location not mapped");
  await sheet.getByTestId("mode-filter-all").click();
  await expect.poll(() => drawnCodes(page)).toEqual(MAPPED_CODES);
  await sheet.getByRole("button", { name: "Close map layers" }).click();

  // Keyboard: Enter on a focused marker opens the terminal.
  const t14 = homeMap(page).locator('[data-testid="terminal-marker"][data-code="T14"]');
  await t14.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/terminals\/T14$/);
  await expect(terminal(page).getByRole("heading", { level: 1, name: "Balatas Tricycle Terminal" })).toBeFocused();
});

/** Screen position of a lat/lng from the home map's reported centre and zoom (Web Mercator). */
async function screenPoint(page: Page, lat: number, lng: number) {
  const el = homeMap(page);
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

test("with the Terminals layer on, a stop pin under a terminal marker wins the tap (A1 under Plaza Rizal's platform)", async ({ page }) => {
  await openApp(page);
  await expect.poll(() => drawnCodes(page)).toEqual(MAPPED_CODES);
  await expect.poll(() => homeMap(page).getAttribute("data-stop-pins").then(Number)).toBeGreaterThan(0);
  const a1 = await screenPoint(page, STOP_A1.stop.lat, STOP_A1.stop.lng);
  // A terminal marker really is on top at A1's position.
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".pn-terminal-marker")?.getAttribute("data-codes") ?? null, a1);
  expect(top).toContain("T13");
  await page.mouse.click(a1.x, a1.y);
  await expect(page).toHaveURL(new RegExp(`/app/stops/${STOP_A1.stop.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeVisible();
});

test("a terminal away from stops still opens on a tap (T04, Integrated Northbound Terminal)", async ({ page }) => {
  await openApp(page);
  const marker = homeMap(page).locator('[data-testid="terminal-marker"][data-code="T04"]');
  await expect(marker).toHaveCount(1);
  // The marker is the topmost element at its centre (not under the sheet or a control).
  const box = (await marker.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".pn-terminal-marker")?.getAttribute("data-code") ?? null, at);
  expect(top).toBe("T04");
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/\/app\/terminals\/T04$/);
  // (No T04 detail fixture is captured: the URL is the assertion.)
});

test("T01 detail: the coordinate badge, one Sources link, RS05 with a UV fare estimate", async ({ page }) => {
  await page.goto("/app/terminals/T01");
  const detail = terminal(page);
  await expect(detail.getByRole("heading", { level: 1, name: "Bicol Central Station" })).toBeFocused();
  await expect(detail.getByTestId("terminal-pill")).toHaveText("Community-mapped");
  const map = detail.getByTestId("naga-map");
  await expect(map).toHaveAttribute("aria-label", "Map of Bicol Central Station");
  await expect(map.getByRole("img", { name: "Bicol Central Station, Bus and UV Express terminal, community-mapped location" })).toHaveCount(1);
  await expect(detail.getByTestId("terminal-location")).toContainText("Mapped point · centroid, not an entrance");
  await expect(detail.getByTestId("terminal-osm-attribution")).toHaveCount(0);
  await expect(detail.getByTestId("detail-sources")).toHaveAttribute("href", "/app/help/sources?osm=way/293702439&v=6");
  await expect(detail.getByTestId("terminal-directions-note")).toHaveCount(0);
  await expect(detail).not.toContainText("regional services are not mapped");
  const rs05 = detail.getByTestId("terminal-regional-RS05");
  await expect(rs05.getByTestId("mode-chip")).toHaveText("UV");
  await expect(rs05).toContainText("Tabaco");
  await expect(rs05).toContainText("≈ 94 km by the community-mapped route · Estimate ₱245–₱283");
  await expect(rs05).not.toContainText("Sources");
  await expect(rs05).toContainText("operator prices may differ");

  await detail.getByRole("button", { name: "Directions to here" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("endpoint-destination").locator(".pn-endpoint__main")).toContainText(
    "Bicol Central Station (map point, entrance not mapped)",
  );
});

test("a trip ending at T14 shows the tricycle hint: ₱15, no discount, confirm with the driver, no minutes", async ({ page }) => {
  // The Terminals layer is off: the hinted terminal is still drawn (emphasized) for "Show on map".
  await page.addInitScript(() => {
    localStorage.setItem(
      "paranaga.prefs",
      JSON.stringify({ theme: "system", highContrast: false, lowData: false, historyEnabled: false, layers: { routes: true, terminals: false, modes: [] } }),
    );
  });
  await page.goto("/app/terminals/T14");
  await terminal(page).getByRole("button", { name: "Directions to here" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("endpoint-destination").locator(".pn-endpoint__main")).toContainText("Balatas Tricycle Terminal");
  await page.getByRole("button", { name: "Choose on map", exact: true }).click();
  await drag(page, 220, 220);
  await page.getByRole("button", { name: "Set start here" }).click();

  const hint = page.getByTestId("tricycle-hint");
  await expect(hint).toBeVisible();
  await expect(hint.getByRole("heading", { name: "Tricycle may serve this" })).toBeVisible();
  await expect(hint.getByTestId("tricycle-hint-terminal")).toContainText("Balatas Tricycle Terminal (T14)");
  await expect(hint).toContainText("₱15");
  await expect(hint).toContainText("discounts not applied");
  await expect(hint).toContainText("confirm with the driver");
  await expect(hint.getByTestId("tricycle-hint-time")).toHaveText("Tricycle time not estimated");
  await expect(hint).not.toContainText(/\d+\s*min/);
  await expect(hint.getByTestId("tricycle-hint-sources")).toHaveCount(0);
  // Below the options, never one of them.
  await expect(page.getByTestId("trip-option").filter({ hasText: /tricycle/i })).toHaveCount(0);
  await expect(homeMap(page).locator('[data-code="T14"]')).toHaveClass(/pn-terminal-marker--emphasized/);
  await expect(homeMap(page).locator("[data-codes]")).toHaveCount(1);

  // The hint sits below the options (peek): lift the sheet to half to reach it.
  await page.getByRole("button", { name: "Expand sheet to half" }).click();
  await hint.getByRole("button", { name: "Show on map: Balatas Tricycle Terminal" }).click();
  await expect
    .poll(async () => {
      const lat = Number(await homeMap(page).getAttribute("data-center-lat"));
      const lng = Number(await homeMap(page).getAttribute("data-center-lng"));
      return Math.abs(lat - T14.lat!) < 0.0005 && Math.abs(lng - T14.lng!) < 0.0005;
    })
    .toBe(true);
  await expectAxeClean(page, ['[data-testid="tricycle-hint"]']);
});

for (const mode of ["light", "dark", "high contrast"] as const) {
  test(`terminals layer, Layers sheet and terminal detail have no serious axe violations (${mode})`, async ({ page }) => {
    if (mode === "dark") await page.emulateMedia({ colorScheme: "dark" });
    if (mode === "high contrast") {
      await page.addInitScript(() => {
        localStorage.setItem("paranaga.prefs", JSON.stringify({ theme: "system", highContrast: true, lowData: false, historyEnabled: false }));
      });
    }
    await openApp(page);
    if (mode === "high contrast") await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    await expect.poll(() => drawnCodes(page)).toEqual(MAPPED_CODES);
    await expectAxeClean(page, ['[data-testid="home-screen"] [data-testid="naga-map"]']);
    await expect(page.locator("path.pn-line--route").first()).toBeAttached({ timeout: 15000 });
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByTestId("layers-sheet")).toBeVisible();
    await expectAxeClean(page, ['[data-testid="layers-sheet"]']);

    for (const code of ["T01", "T14"]) {
      await page.goto(`/app/terminals/${code}`);
      await expect(terminal(page).getByRole("heading", { level: 1 })).toBeFocused();
      await expectAxeClean(page, ['[data-testid="terminal-detail"]']);
    }
  });
}
