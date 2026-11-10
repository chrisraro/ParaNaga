import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { en } from "../../src/i18n/en";
import { routeNetwork } from "./fixtures/network";
import { sheetSettled } from "./fixtures/options";
import { FAR_JEEP_PACOL_PLAN, PROVISIONAL_PLAN } from "./fixtures/plan-responses";

// The landing page's screen captures (public/landing/*.webp), taken from the running app.
//
//   LANDING_SHOTS=1 pnpm test:e2e tests/e2e/landing-captures.spec.ts --project=mobile
//
// Skipped unless LANDING_SHOTS is set, so a normal run never rewrites the images. Provenance: the
// e2e build with the suite's recorded network fixtures (fixtures/network) and its illustrative
// plan responses (fixtures/plan-responses.ts), at 412 x 915 CSS px and 2x, light and dark. Map
// tiles are aborted like everywhere in the suite, so the map is the app's own land colour with the
// city outline, pins and trip lines; nothing is drawn in afterwards. PNG from Playwright, WebP
// through the sharp that ships with Next.

test.skip(!process.env.LANDING_SHOTS, "Set LANDING_SHOTS=1 to rewrite public/landing");
test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

const OUT = path.resolve("public/landing");
const START = "Plaza Rizal";
const DESTINATION = "Camarines Sur National High School";

type Sharp = (input: Buffer) => { webp: (o: { quality: number; effort: number }) => { toFile: (file: string) => Promise<{ size: number }> } };
const local = createRequire(path.resolve("package.json"));
const sharp = createRequire(local.resolve("next/package.json"))("sharp") as Sharp;

async function save(page: Page, name: string, theme: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
  await page.waitForTimeout(300);
  const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  const { size } = await sharp(png).webp({ quality: 82, effort: 6 }).toFile(path.join(OUT, `${name}-${theme}.webp`));
  test.info().annotations.push({ type: `${name}-${theme}.webp`, description: `${(size / 1024).toFixed(1)} KB` });
}

const box = (page: Page) => page.getByPlaceholder(en.search.placeholder);

async function pick(page: Page, query: string, name: string) {
  await box(page).fill(query);
  const result = page.getByTestId("search-group-places").locator("[data-testid^=search-result]").filter({ hasText: name }).first();
  await expect(result).toBeVisible();
  return result;
}

async function planTo(page: Page, query: string, name: string) {
  await page.goto("/app/search?for=destination");
  await (await pick(page, query, name)).click();
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
  await page.getByTestId("endpoint-start").locator(".pn-endpoint__main").click();
  await (await pick(page, START, START)).click();
  await expect(page.getByTestId("options-toggle")).toBeVisible();
  await sheetSettled(page);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });

    test(`landing captures (${theme})`, async ({ page }) => {
      test.setTimeout(120_000);
      mkdirSync(OUT, { recursive: true });
      await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
      await routeNetwork(page);
      let plan: unknown = PROVISIONAL_PLAN;
      await page.route("**/api/v1/plan", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(plan) }),
      );
      await page.clock.setFixedTime(new Date("2026-10-16T09:30:00+08:00"));

      // Home: the map with the Where to? bar.
      await page.goto("/app");
      await expect(page.getByTestId("home-screen").getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
      await save(page, "home", theme);

      // Search for a place.
      await page.getByTestId("home-search").click();
      await pick(page, "camarines sur", DESTINATION);
      await save(page, "search", theme);

      // The trip: the map with the ride, and the two best options under it (the hero).
      await planTo(page, "camarines sur", DESTINATION);
      await save(page, "hero", theme);

      // Every option, then the Recommended one's steps.
      await page.getByTestId("options-toggle").click();
      await expect(page.getByTestId("options-toggle")).toHaveAttribute("aria-expanded", "true");
      await sheetSettled(page);
      await save(page, "options", theme);
      await page.getByTestId("trip-option").first().click();
      await expect(page.getByTestId("trip-detail")).toBeVisible();
      await sheetSettled(page);
      await save(page, "detail", theme);

      // Saved on this phone (no account).
      await page.getByTestId("trip-save").click();
      await expect(page.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");
      await page.goto("/app/saved");
      await expect(page.getByTestId("saved-trip")).toHaveCount(1);
      await save(page, "saved", theme);

      // A far barangay: the jeepney, with the local-report note.
      plan = FAR_JEEP_PACOL_PLAN;
      await planTo(page, "pacol", "Pacol Barangay Hall");
      await page.getByTestId("options-toggle").click();
      await sheetSettled(page);
      await save(page, "far", theme);

      // Report a correction, first step (nothing is sent).
      await page.goto("/app/report");
      await expect(page.getByTestId("report-page")).toBeVisible();
      await save(page, "report", theme);
    });
  });
}
