import AxeBuilder from "@axe-core/playwright";
import { FILIPINO_ENABLED } from "../../src/i18n/locales";
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

test("the header language toggle persists across a reload and sets the page language", async ({ page }) => {
  test.skip(!FILIPINO_ENABLED, "Filipino is hidden until its review (plan T10)");
  await page.goto("/");
  // Phones reach the toggle through the menu; wider screens show it in the header.
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  const toggle = page.getByRole("group", { name: "Language" }).filter({ visible: true }).first();
  await expect(toggle.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  await toggle.getByRole("button", { name: "Filipino" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "fil");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fil");
  await expect(page.getByRole("group", { name: "Language" }).last().getByRole("button", { name: "Filipino" })).toHaveAttribute("aria-pressed", "true");
});

test("the header language toggle translates the landing copy without a reload, and back", async ({ page }) => {
  test.skip(!FILIPINO_ENABLED, "Filipino is hidden until its review (plan T10)");
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toContainText("Which jeepney, where to board,");
  const menu = page.getByRole("button", { name: /^(Open menu|Buksan ang menu)$/ });
  const choose = async (name: "English" | "Filipino") => {
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("group", { name: "Language" }).filter({ visible: true }).first().getByRole("button", { name }).click();
    // The phone's menu sheet closes itself only on a section link; close it so the page is clear.
    if (await page.getByRole("button", { name: /^(Close|Isara ang) menu$/ }).isVisible()) await page.keyboard.press("Escape");
  };
  await choose("Filipino");
  await expect(h1).toContainText("Aling jeep, saan sasakay,");
  await expect(h1).toContainText("Para!");
  await expect(page.getByRole("link", { name: /^Buksan ang app/ }).first()).toHaveAttribute("href", "/app");
  await expect(page.getByRole("img", { name: /^Lunad sa isang phone/ })).toHaveCount(1);
  await choose("English");
  await expect(h1).toContainText("Which jeepney, where to board,");
});

test("every call to action opens the app, and the credits link to Sources and credits", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("link", { name: /^Open the app/ });
  expect(await open.count()).toBeGreaterThanOrEqual(3);
  for (const href of await open.evaluateAll((els) => els.map((el) => el.getAttribute("href")))) expect(href).toBe("/app");
  await expect(page.getByRole("link", { name: "Sources and credits" }).first()).toHaveAttribute("href", "/app/help/sources");
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Para!");
  await expect(page.getByRole("contentinfo")).toContainText("OpenStreetMap contributors");
  // The hero capture (the LCP candidate) is preloaded at high priority, one per colour scheme.
  await expect(page.locator('head link[rel="preload"][as="image"][href="/landing/hero-light.webp"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="preload"][as="image"][href="/landing/hero-dark.webp"]')).toHaveCount(1);
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
  // Reveal targets are fully opaque, and nothing is held back for a reveal.
  const reveals = page.locator(".pnl-reveal");
  expect(await reveals.count()).toBeGreaterThan(3);
  expect(await reveals.evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity !== "1").length)).toBe(0);
  await expect(page.locator("html")).not.toHaveClass(/pnl-io/);
});

test("with motion, captures below the fold rise in as they enter, and no text is ever faded", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/pnl-io/);
  // Only captures take part: no reveal target holds text.
  expect(await page.locator(".pnl-reveal").evaluateAll((els) => els.filter((el) => (el as HTMLElement).innerText.trim()).length)).toBe(0);
  const last = page.locator(".pnl-reveal").last();
  await expect(last).not.toHaveAttribute("data-in", "");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute("data-in", "");
  await expect(last).toHaveCSS("opacity", "1");
  // Nothing loops on this page.
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming().iterations === Infinity).length)).toBe(0);
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

test("the showcase shows the screen of the step that is open", async ({ page }) => {
  await page.goto("/");
  const list = page.getByRole("list", { name: "Lunad screens" });
  const step = (name: string) => list.getByRole("button", { name });
  await expect(step("Start from the map.")).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("img")).toHaveAttribute("src", "/landing/home-light.webp");
  await step("Compare every way there.").click();
  await expect(step("Compare every way there.")).toHaveAttribute("aria-expanded", "true");
  await expect(step("Start from the map.")).toHaveAttribute("aria-expanded", "false");
  await expect(list.getByRole("img")).toHaveAttribute("src", "/landing/options-light.webp");
  await expect(list.getByText(/One option is Recommended/)).toBeVisible();
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
