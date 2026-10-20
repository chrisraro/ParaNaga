// Landing page screen captures (public/landing/*.webp), taken from the real running app.
//
// Refresh them in two steps (any free port; 3631 is the default):
//   1. Build and start the app with a basemap. The public OSM tile server is the app's own
//      non-production fallback (src/client/map/tile-config.ts); a MapTiler URL works the same way
//      and its credit then shows in the captures:
//        NEXT_DIST_DIR=.next-capture NEXT_PUBLIC_TILE_URL="https://tile.openstreetmap.org/{z}/{x}/{y}.png" pnpm build
//        NEXT_DIST_DIR=.next-capture pnpm start --port 3631
//   2. pnpm capture:landing            (CAPTURE_URL=http://localhost:3631 by default)
//
// Data: every /api/v1 request is answered by the published public API (CAPTURE_API, by default
// https://para-naga.vercel.app), read-only GETs plus the trip planner, so the screens show real
// routes, places and fares. Nothing is written: sign-in, saving to an account and reports are
// never sent. Images are encoded to WebP in the browser (canvas), so no image tool is needed.
// The map's attribution control stays in every capture (licence terms: never remove it).
import { writeFile, mkdir } from "node:fs/promises";
import { chromium, devices, type BrowserContext, type Page } from "@playwright/test";

const BASE = process.env.CAPTURE_URL ?? "http://localhost:3631";
const API = process.env.CAPTURE_API ?? "https://para-naga.vercel.app";
const OUT = new URL("../public/landing/", import.meta.url);
const SIZE = { width: 412, height: 915 };
/** Byte budget per image (2x phone frame). Quality steps down until the file fits. */
const BUDGET = 120 * 1024;

// Plaza Rizal, Naga City: the rider's simulated position for the captures.
const PLAZA_RIZAL = { latitude: 13.6236, longitude: 123.1851 };

type Theme = "light" | "dark";

async function newContext(theme: Theme): Promise<BrowserContext> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: SIZE,
    screen: SIZE,
    deviceScaleFactor: 2,
    colorScheme: theme,
    geolocation: PLAZA_RIZAL,
    permissions: ["geolocation"],
    serviceWorkers: "block",
    locale: "en-PH",
    timezoneId: "Asia/Manila",
  });
  // tsx keeps function names with a __name helper that page.evaluate callbacks do not carry.
  await context.addInitScript("window.__name = (f) => f;");
  await context.route(/\/api\/v1\//, async (route) => {
    const req = route.request();
    if (req.method() !== "GET" && !/\/api\/v1\/plan(\?|$)/.test(req.url())) return route.fulfill({ status: 401, body: "{}" });
    const url = new URL(req.url());
    const response = await route.fetch({ url: `${API}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  return context;
}

/** Waits until the visible map tiles have loaded and the map has stopped moving. */
async function mapSettled(page: Page) {
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll<HTMLImageElement>(".leaflet-tile")];
    return tiles.length > 0 && tiles.every((t) => t.complete);
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

async function save(page: Page, name: string) {
  const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const webp = await page.evaluate(
    async ({ dataUrl, budget }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      let out = "";
      for (const q of [0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44]) {
        out = canvas.toDataURL("image/webp", q);
        if (out.length * 0.75 <= budget) break;
      }
      return out;
    },
    { dataUrl, budget: BUDGET },
  );
  const bytes = Buffer.from(webp.split(",")[1]!, "base64");
  await writeFile(new URL(`${name}.webp`, OUT), bytes);
  console.log(`${name}.webp ${(bytes.length / 1024).toFixed(1)} KB`);
}

const heroLines: Record<string, unknown[]> = {};

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    const context = await newContext(theme);
    const page = await context.newPage();
    await page.goto(`${BASE}/app`);
    await page.getByTestId("home-search").waitFor();
    await mapSettled(page);
    await save(page, `home-${theme}`);

    // Search with a place result.
    await page.getByTestId("home-search").click();
    const box = page.getByRole("searchbox", { name: "Search places, stops and routes" });
    await box.fill("Ateneo");
    await page.getByTestId("search-announcer").filter({ hasText: /result/ }).waitFor();
    await page.waitForTimeout(800);
    await save(page, `search-${theme}`);
    await page.locator("[data-testid^=search-result]").filter({ hasText: "Ateneo de Naga University" }).first().click();
    await page.getByTestId("trip-sheet").waitFor();

    // Start: Plaza Rizal.
    await page.getByTestId("endpoint-start").locator(".pn-endpoint__main").click();
    await page.getByTestId("endpoint-search").click();
    await box.fill("Plaza Rizal");
    await page.getByTestId("search-announcer").filter({ hasText: /result/ }).waitFor();
    await page.locator("[data-testid^=search-result]").filter({ hasText: "Plaza Rizal" }).first().click();
    await page.getByTestId("options-toggle").waitFor({ timeout: 30_000 });
    await mapSettled(page);
    await save(page, `directions-${theme}`);

    // The hero: the same screen without the trip lines, which the landing redraws from the real
    // line geometry (sampled here, in screen pixels) so they can draw themselves in.
    heroLines[theme] = await readHeroLines(page);
    await page.addStyleTag({ content: ".pn-line, .pn-map-line-chip-wrap, .pn-chevron-icon { visibility: hidden !important; }" });
    await save(page, `hero-${theme}`);
    await page.evaluate(() => document.querySelectorAll("style").forEach((s) => s.textContent?.includes(".pn-line, .pn-map-line-chip-wrap") && s.remove()));

    // All options, then the Recommended trip's steps.
    await page.getByTestId("options-toggle").click();
    await sheetSettled(page);
    await page.waitForTimeout(500);
    await save(page, `options-${theme}`);
    await page.getByTestId("trip-option").first().click();
    await page.getByTestId("trip-detail").waitFor();
    await sheetSettled(page);
    await mapSettled(page);
    await save(page, `detail-${theme}`);
    await page.getByTestId("trip-detail").evaluate((el) => el.scrollTo(0, 0));

    // Saved: the trip saved on this phone (no account).
    await page.getByTestId("trip-save").click();
    await page.getByTestId("trip-save").filter({ hasText: "Saved" }).waitFor();
    await page.goto(`${BASE}/app/saved`);
    await page.getByTestId("saved-screen").waitFor();
    await page.waitForTimeout(600);
    await save(page, `saved-${theme}`);

    // A far area: Pacol, from the rider's location at Plaza Rizal.
    await page.goto(`${BASE}/app/search?for=destination`);
    await box.fill("Pacol");
    await page.getByTestId("search-announcer").filter({ hasText: /result/ }).waitFor();
    await page.getByTestId("search-group-places").locator("[data-testid^=search-result]").filter({ hasText: /^Pacol/ }).first().click();
    await page.getByTestId("trip-sheet").waitFor();
    if (!(await page.getByTestId("options-toggle").isVisible())) {
      await page.getByTestId("endpoint-start").locator(".pn-endpoint__main").click();
      await page.getByTestId("endpoint-search").click();
      await box.fill("Plaza Rizal");
      await page.getByTestId("search-announcer").filter({ hasText: /result/ }).waitFor();
      await page.locator("[data-testid^=search-result]").filter({ hasText: "Plaza Rizal" }).first().click();
    }
    await page.getByTestId("options-toggle").waitFor({ timeout: 30_000 });
    await page.getByTestId("options-toggle").click();
    await sheetSettled(page);
    await page.waitForTimeout(500);
    // Opening the list can leave it scrolled a little: show it from its top.
    await page.getByTestId("trip-sheet").evaluate((el) => {
      for (const n of [el, ...el.querySelectorAll("*")]) if (n.scrollTop) n.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    await save(page, `far-${theme}`);

    // Report a correction (the first step of the wizard; nothing is sent).
    await page.goto(`${BASE}/app/report`);
    await page.getByTestId("report-page").waitFor();
    await page.waitForTimeout(600);
    await save(page, `report-${theme}`);

    await context.browser()?.close();
  }
  const file = [
    "// Generated by scripts/capture-landing.ts from the real trip lines (Plaza Rizal to Ateneo de Naga",
    "// University), in screen pixels of the 412 x 915 capture, one set per theme. Do not edit by hand.",
    "// `step` is the piece's place in the trip (0 = leaving the start), for the draw-in order.",
    "export type HeroLine = { kind: \"casing\" | \"walk\" | \"ride\"; color: string; width: number; dash: string | null; points: string; step: number };",
    `export const HERO_LINES: Record<"light" | "dark", readonly HeroLine[]> = ${JSON.stringify(heroLines)};`,
    "",
  ].join("\n");
  await writeFile(new URL("../src/ui/landing/hero-lines.ts", import.meta.url), file);
}

async function sheetSettled(page: Page) {
  await page.getByTestId("trip-sheet").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** Samples every visible trip line into screen-pixel polylines (for src/ui/landing/hero-lines.ts). */
async function readHeroLines(page: Page) {
  const lines = await page.evaluate(() => {
    const out: { kind: string; color: string; width: number; dash: string | null; points: string }[] = [];
    for (const path of document.querySelectorAll<SVGPathElement>(".pn-map path.pn-line")) {
      const style = getComputedStyle(path);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const ctm = path.getScreenCTM();
      if (!ctm) continue;
      const total = path.getTotalLength();
      const pts: string[] = [];
      for (let l = 0; l <= total; l += 3) {
        const p = path.getPointAtLength(Math.min(l, total)).matrixTransform(ctm);
        pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
      const end = path.getPointAtLength(total).matrixTransform(ctm);
      pts.push(`${end.x.toFixed(1)},${end.y.toFixed(1)}`);
      const kind = path.classList.contains("pn-line--casing") ? "casing" : path.classList.contains("pn-line--walk") ? "walk" : "ride";
      const dash = style.strokeDasharray === "none" ? null : style.strokeDasharray;
      out.push({ kind, color: style.stroke, width: Number.parseFloat(style.strokeWidth), dash, points: pts.join(" ") });
    }
    // Order and orient the pieces from the start pin onwards, so the lines draw in trip order.
    const startEl = document.querySelector(".pn-map .pn-pin--start");
    const sb = startEl?.getBoundingClientRect();
    let at = sb ? { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 } : { x: 0, y: 0 };
    const pt = (s: string) => { const [x, y] = s.split(",").map(Number); return { x: x!, y: y! }; };
    const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const groups = new Map<string, typeof out>();
    for (const line of out) {
      const ends = line.points.split(" ");
      const key = `${ends[0]}|${ends.at(-1)}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    const ordered: (typeof out[number] & { step: number })[] = [];
    const left = [...groups.values()];
    for (let step = 0; left.length; step++) {
      let best = 0, bestD = Infinity, flip = false;
      left.forEach((g, i) => {
        const p = g[0]!.points.split(" ");
        const a = d2(at, pt(p[0]!)), b = d2(at, pt(p.at(-1)!));
        if (Math.min(a, b) < bestD) { bestD = Math.min(a, b); best = i; flip = b < a; }
      });
      const [g] = left.splice(best, 1);
      for (const line of g!) {
        const points = flip ? line.points.split(" ").reverse().join(" ") : line.points;
        ordered.push({ ...line, points, step });
      }
      const last = ordered.at(-1)!.points.split(" ").at(-1)!;
      at = pt(last);
    }
    // Casings under cores, as on the map.
    return ordered.sort((a, b) => Number(b.kind === "casing") - Number(a.kind === "casing"));
  });
  return lines;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
