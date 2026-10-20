import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The landing page (/): links into the app, accessibility in both themes, motion that respects
// reduced motion, real captures with alt text and fixed dimensions, and no sideways scroll.

const axeIssues = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const issues = results.violations.filter((v) => v.impact !== "minor");
  return { issues, text: issues.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n") };
};

/** Scrolls through the page so every lazy capture and every scroll reveal has run. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(40);
  }
}

test("every call to action opens the app, and the credits link to Sources and credits", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("link", { name: /^Open the app/ });
  expect(await open.count()).toBeGreaterThanOrEqual(3);
  for (const href of await open.evaluateAll((els) => els.map((el) => el.getAttribute("href")))) expect(href).toBe("/app");
  await expect(page.getByRole("link", { name: "Sources and credits" }).first()).toHaveAttribute("href", "/app/help/sources");
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Para!");
  await expect(page.getByRole("contentinfo")).toContainText("OpenStreetMap contributors");
});

test("captures are real images with alt text and fixed dimensions", async ({ page }) => {
  await page.goto("/");
  await scrollThrough(page);
  const images = await page.locator("main img").evaluateAll((els) =>
    els.map((el) => ({ src: el.getAttribute("src"), alt: el.getAttribute("alt"), w: el.getAttribute("width"), h: el.getAttribute("height") })),
  );
  expect(images.length).toBeGreaterThan(8);
  for (const img of images) {
    expect(img.src, JSON.stringify(img)).toMatch(/^\/landing\/[a-z]+-(light|dark)\.webp$/);
    expect(img.alt, JSON.stringify(img)).not.toBeNull();
    expect(img.w).toBe("824");
    expect(img.h).toBe("1830");
  }
  // Every capture that is shown loaded (the other theme's copy is never fetched).
  const broken = await page.locator("main img").evaluateAll((els) =>
    els.filter((el) => (el as HTMLImageElement).checkVisibility() && !(el as HTMLImageElement).naturalWidth).map((el) => el.getAttribute("src")),
  );
  expect(broken).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`no moderate-or-worse axe issues in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    await scrollThrough(page);
    const { issues, text } = await axeIssues(page);
    expect(issues, text).toEqual([]);
  });
}

test("with motion, the hero still passes axe once its entrance has played", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) => a.timeline instanceof DocumentTimeline && a.effect?.getTiming().iterations !== Infinity)
      .every((a) => a.playState === "finished"),
  );
  const results = await new AxeBuilder({ page }).include("#top").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
});

test("reduced motion: nothing animates and everything is visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await scrollThrough(page);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a as CSSAnimation).animationName ?? "?"));
  expect(running).toEqual([]);
  // Reveal targets are fully opaque, and the hero route is drawn.
  const faded = await page.locator(".pnl-reveal, .pnl-in").evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity !== "1").length);
  expect(faded).toBe(0);
  const offsets = await page.locator(".pnl-route__mask").evaluateAll((els) => els.map((el) => getComputedStyle(el).strokeDashoffset));
  expect(offsets.length).toBeGreaterThan(0);
  for (const o of offsets) expect(o).toMatch(/^0(px)?$/);
});

test("looping motion pauses while the tab is hidden", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const loops = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations === Infinity)
      .map((a) => a.playState),
  );
  expect(loops.length).toBeGreaterThan(0);
  for (const state of loops) expect(state).toBe("paused");
});

test("no sideways scroll at 320, 375, 768 and 1280 px", async ({ page }) => {
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await scrollThrough(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
  }
});

test("the showcase phone follows the step in view", async ({ page }) => {
  await page.goto("/");
  const step = page.locator("[data-pnl-step='3']");
  await step.scrollIntoViewIfNeeded();
  await step.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect(page.locator("[data-pnl-screen='3']")).toHaveAttribute("data-on", "true");
  await expect(page.locator("[data-pnl-screen='0']")).toHaveAttribute("data-on", "false");
});

test.describe("large screens", () => {
  test.skip(({ isMobile }) => isMobile, "The QR block is for computers");

  test("shows a QR code that opens /app on a phone", async ({ page }) => {
    await page.goto("/");
    const qr = page.getByRole("img", { name: /^QR code that opens http:\/\/localhost:\d+\/app$/ });
    await qr.scrollIntoViewIfNeeded();
    await expect(qr).toBeVisible();
  });
});

test.describe("phones", () => {
  test.skip(({ isMobile }) => !isMobile, "The menu sheet is the small-screen header");

  test("the QR code is hidden and the menu opens and closes with Escape", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^QR code/ })).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.locator("#mobile-menu").getByRole("link", { name: "FAQ" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
  });
});
