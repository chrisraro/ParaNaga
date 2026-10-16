import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";
import { sheetSettled } from "./fixtures/options";

// Short, zoomed and landscape screens (WCAG 1.4.10 Reflow, 1.4.4 Resize text, 1.3.4 Orientation):
// the home sheet's peek, options at full, a trip option's detail and a guidance step at 320x568,
// 360x640, 375x812, landscape 667x375 and 568x320, and 1280x720 at 400 % zoom (320x180 CSS px).
// The trip is set up at the device size, then the viewport changes (a rotation or a zoom). In every
// state: the primary action can be brought into the viewport inside the sheet and a real tap lands
// on it (not on the tab bar or the map), the content scrolls vertically, nothing scrolls sideways,
// and at peek and half a strip of map stays above the sheet (a quarter of the sheet's height).

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const mapEl = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const sheet = (page: Page) => page.getByTestId("trip-sheet");
const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/plan", (route) => fulfill(route, PROVISIONAL_PLAN));
});

async function drag(page: Page, dx: number, dy: number) {
  const box = (await mapEl(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function planTrip(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  const chooseOnMap = page.getByRole("button", { name: "Choose on map", exact: true });
  await chooseOnMap.click();
  await page.getByRole("button", { name: "Set start here" }).click();
  await chooseOnMap.click();
  const before = await mapEl(page).getAttribute("data-center-lng");
  await drag(page, -120, 80);
  await expect.poll(() => mapEl(page).getAttribute("data-center-lng")).not.toBe(before);
  await page.getByRole("button", { name: "Set destination here" }).click();
  await expect(page.getByTestId("options-toggle")).toBeVisible();
}

/** Sheet geometry: visible height, map strip above it, the content's own window and overflow. */
async function geometry(page: Page) {
  // A resize retargets the snap transition (its finished promise then rejects): wait again.
  await sheetSettled(page).catch(() => sheetSettled(page));
  return sheet(page).evaluate((el: HTMLElement) => {
    const content = el.querySelector<HTMLElement>(".pn-sheet__content")!;
    const footer = el.querySelector<HTMLElement>(".pn-sheet-footer")!;
    const tab = document.querySelector<HTMLElement>('[data-testid="tab-bar"]');
    const H = window.innerHeight;
    const top = el.getBoundingClientRect().top;
    const c = content.getBoundingClientRect();
    const pinned = footer.offsetHeight > 0 && getComputedStyle(footer).position === "absolute";
    const bottom = Math.min(c.bottom, pinned ? footer.getBoundingClientRect().top : H, tab ? tab.getBoundingClientRect().top : H, H);
    return {
      snap: el.dataset.snap,
      sheetHeight: el.offsetHeight,
      mapStrip: top - el.offsetTop,
      contentWindow: bottom - Math.max(c.top, 0),
      overflowY: getComputedStyle(content).overflowY,
      sideways: document.documentElement.scrollWidth - window.innerWidth + Math.max(0, content.scrollWidth - content.clientWidth),
      tabTop: tab ? tab.getBoundingClientRect().top : H,
    };
  });
}

/** The control can be brought into view inside the sheet, above the tab bar, and a tap there lands on it. */
async function expectReachable(page: Page, control: Locator, name: string) {
  await control.scrollIntoViewIfNeeded();
  const g = await geometry(page);
  const box = (await control.boundingBox())!;
  const sheetBox = (await sheet(page).boundingBox())!;
  expect(box, `${name} has a box`).not.toBeNull();
  // The part on screen: inside the sheet, above the tab bar and the screen edge. A control taller
  // than the content window (an option card) shows at least a 44 px band of itself.
  const top = Math.max(box.y, sheetBox.y);
  const bottom = Math.min(box.y + box.height, g.tabTop);
  expect(bottom - top, `${name} on screen inside the sheet, above the tab bar`).toBeGreaterThanOrEqual(Math.min(box.height, 44) - 1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const hit = await control.evaluate((el, [x, y]) => {
    const at = document.elementFromPoint(x!, y!);
    return at !== null && (at === el || el.contains(at));
  }, [box.x + box.width / 2, (top + bottom) / 2]);
  expect(hit, `a tap on ${name} lands on it`).toBe(true);
}

/** The content scrolls vertically (when it is taller than its window) and never sideways. */
async function expectReflow(page: Page) {
  const g = await geometry(page);
  expect(g.sideways, "no horizontal scrolling").toBeLessThanOrEqual(0);
  expect(g.overflowY).toBe("auto");
  const scrolled = await sheet(page).evaluate((el) => {
    const content = el.querySelector<HTMLElement>(".pn-sheet__content")!;
    if (content.closest("[inert]") || content.scrollHeight <= content.clientHeight) return true;
    const before = content.scrollTop;
    content.scrollTop = content.scrollHeight;
    const moved = content.scrollTop > before;
    content.scrollTop = before;
    return moved;
  });
  expect(scrolled, "the sheet content scrolls").toBe(true);
}

/** At peek and half a quarter of the sheet's height stays map. */
async function expectMapStrip(page: Page) {
  const g = await geometry(page);
  expect(["0", "1"]).toContain(g.snap);
  expect(g.mapStrip, `map strip at snap ${g.snap}`).toBeGreaterThanOrEqual(Math.floor(g.sheetHeight * 0.25) - 1);
}

for (const [width, height] of [
  [320, 568],
  [360, 640],
  [375, 812],
  [667, 375],
  [568, 320],
  [320, 180],
] as const) {
  test(`peek, options, detail and guidance reflow on ${width}x${height}`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.grantPermissions(["geolocation"]);
    await planTrip(page);
    await page.setViewportSize({ width, height });
    const tiny = height <= 300;

    // Options at peek: the "All options" toggle (on a tiny screen only the grabber shows; the rows are inert).
    await expect(sheet(page)).toHaveAttribute("data-snap", "0");
    await expectMapStrip(page);
    await expectReflow(page);
    if (tiny) {
      await expectReachable(page, page.getByRole("button", { name: "Expand sheet to half" }), "grabber");
      await page.getByRole("button", { name: "Expand sheet to half" }).click();
      await expect(sheet(page)).toHaveAttribute("data-snap", "1");
      await expectMapStrip(page);
    }
    const toggle = page.getByTestId("options-toggle");
    await expectReachable(page, toggle, "options toggle");
    await toggle.click();

    // Options at full: the content keeps at least 120 px; the first option is reachable.
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    expect((await geometry(page)).contentWindow).toBeGreaterThanOrEqual(120);
    await expectReflow(page);
    const option = page.getByTestId("trip-option").first();
    await expectReachable(page, option, "first option");
    await option.click();

    // Detail at half: Start trip is reachable, the content scrolls, a map strip stays.
    await expect(page.getByTestId("trip-detail")).toBeVisible();
    await expect(sheet(page)).toHaveAttribute("data-snap", "1");
    await expectMapStrip(page);
    if (height >= 320) expect((await geometry(page)).contentWindow).toBeGreaterThanOrEqual(120);
    await expectReflow(page);
    const start = page.getByTestId("trip-start");
    await expectReachable(page, start, "Start trip");
    await start.click();

    // Guidance: the step's first button is reachable and the step title can be scrolled back to.
    await expect(page.getByTestId("guidance")).toBeVisible();
    await expectMapStrip(page);
    await expectReflow(page);
    await expectReachable(page, sheet(page).getByRole("button", { name: "I'm at the stop", exact: true }), "I'm at the stop");
    const title = page.getByTestId("guidance").locator(".pn-guide__title").first();
    await title.scrollIntoViewIfNeeded();
    await expect(title).toBeInViewport();

    // Full in guidance: at least 120 px for the content.
    await page.getByRole("button", { name: "Expand sheet to full" }).click();
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    expect((await geometry(page)).contentWindow).toBeGreaterThanOrEqual(120);
    await expectReflow(page);
  });
}

test("on a short screen the actions are in flow and the tab bar is compact; upright they are pinned", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await planTrip(page);
  await page.getByTestId("options-toggle").click();
  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  const footer = page.locator(".pn-sheet-footer");
  const tab = page.getByTestId("tab-bar");
  await expect(footer).toHaveCSS("position", "absolute");
  const tall = (await tab.boundingBox())!.height;

  await page.setViewportSize({ width: 667, height: 375 });
  await expect(footer).toHaveCSS("position", "static");
  await expect.poll(async () => (await tab.boundingBox())!.height).toBeLessThan(tall);
  // Icons only, the names stay: every tab keeps its accessible label.
  for (const name of ["Map", "Explore", "Saved", "More"]) await expect(tab.getByRole("link", { name })).toHaveCount(1);
});

test("at 400 % zoom (320x180) the tab bar steps aside at half and full and returns at peek", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await planTrip(page);
  await page.setViewportSize({ width: 320, height: 180 });
  const tab = page.getByTestId("tab-bar");
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  await expect(tab).toBeVisible();
  await page.getByRole("button", { name: "Expand sheet to half" }).click();
  await expect(tab).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sheet to full" }).click();
  await expect(tab).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse sheet" }).click();
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  await expect(tab).toBeVisible();
});
