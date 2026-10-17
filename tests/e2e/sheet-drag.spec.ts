import { expect, test, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";

// The shared sheet drag (app-shell/sheet-drag.ts): real pointer drags on the handle, the settle,
// reduced motion, and the per-move main-thread cost. Phone-only (the map lives behind the gate).

test.skip(({ isMobile, browserName }) => !isMobile && browserName === "chromium", "The map lives behind the phone-only gate");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }),
  );
});

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(page.getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

/** Drag the handle by `dy` px in `steps` moves, releasing after `pause` ms (a pause is not a fling). */
async function dragHandle(page: Page, dy: number, steps = 12, pause = 0) {
  const box = await page.getByTestId("trip-sheet").locator(".pn-grabber").boundingBox();
  if (!box) throw new Error("no handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps });
  if (pause) await page.waitForTimeout(pause);
  await page.mouse.up();
}

const sheet = (page: Page) => page.getByTestId("trip-sheet");
const top = async (page: Page) => (await sheet(page).boundingBox())?.y ?? NaN;

test("dragging the handle up settles on full; down settles on the peek; the overrides are cleaned up", async ({ page }) => {
  await openApp(page);
  await expect(sheet(page)).toHaveAttribute("data-snap", "1");
  await dragHandle(page, -420, 12, 150);
  await expect(sheet(page)).toHaveAttribute("data-snap", "2");
  await expect(sheet(page)).not.toHaveClass(/pn-sheet--(dragging|settling)/);
  await expect.poll(() => sheet(page).evaluate((el) => (el as HTMLElement).style.transform)).toBe("");
  await expect.poll(() => sheet(page).evaluate((el) => (el as HTMLElement).style.paddingBottom)).toBe("");
  expect(await sheet(page).evaluate((el) => (el as HTMLElement).style.getPropertyValue("--pn-sheet-offset"))).toBe("0px");
  const fullTop = await top(page);
  await dragHandle(page, 700, 12, 150);
  await expect(sheet(page)).toHaveAttribute("data-snap", "0");
  await expect.poll(async () => (await top(page)) > fullTop + 300).toBe(true);
});

test("a drag renders the sheet under the finger, a short drag springs back, and arrow keys still step", async ({ page }) => {
  await openApp(page);
  const half = await top(page);
  const box = await sheet(page).locator(".pn-grabber").boundingBox();
  if (!box) throw new Error("no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 8 });
  await expect.poll(async () => half - (await top(page))).toBeGreaterThan(70);
  await expect(sheet(page)).toHaveClass(/pn-sheet--dragging/);
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(sheet(page)).toHaveAttribute("data-snap", "1");
  await expect.poll(async () => Math.abs((await top(page)) - half)).toBeLessThan(2);
  await sheet(page).locator(".pn-grabber").focus();
  await page.keyboard.press("ArrowUp");
  await expect(sheet(page)).toHaveAttribute("data-snap", "2");
});

test("with reduced motion the release lands at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await dragHandle(page, -420, 12, 150);
  await expect(sheet(page)).toHaveAttribute("data-snap", "2");
  expect(await sheet(page).evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await top(page)).toBeLessThan(60);
});

test("a pointer move costs the main thread well under 4 ms (no React render, no layout per frame)", async ({ page }) => {
  await openApp(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const cost = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return { script: m.ScriptDuration ?? 0, layout: m.LayoutDuration ?? 0, style: m.RecalcStyleDuration ?? 0, layouts: m.LayoutCount ?? 0 };
  };
  const box = await sheet(page).locator(".pn-grabber").boundingBox();
  if (!box) throw new Error("no handle");
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(x, box.y - 20, { steps: 4 }); // past the slop: the drag has begun
  const before = await cost();
  const moves = 120;
  await page.mouse.move(x, box.y - 260, { steps: moves });
  const after = await cost();
  await page.mouse.up();
  const perMove = ((after.script - before.script) + (after.layout - before.layout) + (after.style - before.style)) * 1000 / moves;
  const layoutsPerMove = (after.layouts - before.layouts) / moves;
  test.info().annotations.push({ type: "drag cost", description: `${perMove.toFixed(3)} ms/move (script+layout+style), ${layoutsPerMove.toFixed(2)} layouts/move` });
  console.info(`sheet drag cost: ${perMove.toFixed(3)} ms per move (script ${((after.script - before.script) * 1000 / moves).toFixed(3)}, layout ${((after.layout - before.layout) * 1000 / moves).toFixed(3)}, style ${((after.style - before.style) * 1000 / moves).toFixed(3)}), ${layoutsPerMove.toFixed(2)} layouts per move`);
  expect(perMove).toBeLessThan(4);
  expect(layoutsPerMove).toBeLessThan(1);
});

// Scroll hand-off: real touch input through CDP (Chromium only; WebKit and Firefox have no CDP
// touch, so those engines get the handle and tap paths above).
test.describe("scroll hand-off (touch)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP touch input is Chromium only");

  async function touchDrag(page: Page, x: number, from: number, to: number, opts: { steps?: number; stepMs?: number; holdMs?: number } = {}) {
    const { steps = 12, stepMs = 16, holdMs = 160 } = opts;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from + ((to - from) * i) / steps }] });
      await page.waitForTimeout(stepMs);
    }
    await page.waitForTimeout(holdMs); // a pause before release is not a fling
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async function atFull(page: Page) {
    await openApp(page);
    await sheet(page).locator(".pn-grabber").focus();
    await page.keyboard.press("ArrowUp");
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    await expect.poll(async () => await top(page)).toBeLessThan(60);
  }

  test("pulling the list down from its top at full drags the sheet and lands on a lower detent", async ({ page }) => {
    await atFull(page);
    const fullTop = await top(page);
    const list = (await sheet(page).locator(".pn-sheet__content").boundingBox())!;
    const x = list.x + list.width / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: list.y + 100 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: list.y + 100 + i * 30 }] });
      await page.waitForTimeout(16);
    }
    await expect(sheet(page)).toHaveClass(/pn-sheet--dragging/);
    expect((await top(page)) - fullTop).toBeGreaterThan(150);
    await page.waitForTimeout(160);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(sheet(page)).not.toHaveAttribute("data-snap", "2");
    await expect(sheet(page)).not.toHaveClass(/pn-sheet--(dragging|settling)/);
  });

  test("a list that is scrolled, or pulled up, still scrolls natively and never moves the sheet", async ({ page }) => {
    await atFull(page);
    const content = sheet(page).locator(".pn-sheet__content");
    const metrics = await content.evaluate((el) => ({ over: el.scrollHeight - el.clientHeight }));
    test.skip(metrics.over < 40, "the full sheet has nothing to scroll on this fixture");
    const box = (await content.boundingBox())!;
    const x = box.x + box.width / 2;
    await touchDrag(page, x, box.y + box.height * 0.6, box.y + 40); // finger up: the list scrolls down
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    const scrolled = await content.evaluate((el) => el.scrollTop);
    await touchDrag(page, x, box.y + 60, box.y + 160); // finger down, list not at its top: scrolls back
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeLessThan(scrolled);
    await expect(sheet(page)).toHaveAttribute("data-snap", "2");
    expect(await top(page)).toBeLessThan(60);
  });
});
