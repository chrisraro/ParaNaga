import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { NO_ROUTE_PLAN } from "./fixtures/plan-responses";
import { routeNetwork } from "./fixtures/network";

// Navigation never shows a blank frame, and the on/off switches are drawn as one control.
//
// No blank frame: a requestAnimationFrame sampler records, every frame while moving among Map,
// Explore, Saved, More and Search, the body background and what covers the screen. A frame fails
// when the body turns white (or light in dark mode), or when no screen is showing: neither the home
// map (uncovered) nor a visible panel with text. The map element must also survive the round trip
// (the layout keeps it mounted; a remount would flash the map).
//
// Switches: the kit switch (More, Search) and the Layers sheet share one look: a 51 x 31 track,
// the knob centred in it and travelling 20 px, a 44 px tall hit area, a label that toggles it, and
// axe clean in light and dark.

type Frame = { p: string; body: string; home: boolean; panel: string };

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await page.route("**/api/v1/plan", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NO_ROUTE_PLAN) }),
  );
  await routeNetwork(page);
});

async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __mapEl: Element | null };
    w.__frames = [];
    w.__mapEl = document.querySelector('[data-testid="naga-map"]');
    const tick = () => {
      const home = document.querySelector('[data-testid="app-home-layer"]');
      const panel = [...document.querySelectorAll<HTMLElement>(".pn-detail")].find((el) => el.checkVisibility());
      w.__frames.push({
        p: location.pathname,
        body: getComputedStyle(document.body).backgroundColor,
        home: Boolean(home && home.checkVisibility() && !home.hasAttribute("inert")),
        panel: panel ? (panel.innerText || "").trim().slice(0, 40) : "",
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });

async function tour(page: Page) {
  const h1 = (name: string) => page.getByRole("heading", { level: 1, name });
  for (const [name, heading] of [["Explore", "Explore"], ["Saved", "Saved"], ["More", "Settings"], ["Map", "ParaNaga trip planner"], ["Saved", "Saved"], ["Explore", "Explore"]] as const) {
    await tab(page, name).click();
    await expect(h1(heading)).toBeAttached();
    await expect(page).toHaveURL(name === "Map" ? /\/app$/ : new RegExp(`/app/${name === "More" ? "more" : name.toLowerCase()}`));
  }
  await page.getByTestId("explore-search").click();
  await expect(page.getByRole("searchbox", { name: "Search places, stops and routes" })).toBeVisible();
  await page.goBack();
  await expect(h1("Explore")).toBeAttached();
  await tab(page, "Map").click();
  await expect(page).toHaveURL(/\/app$/);
}

async function expectNoBlankFrame(page: Page, dark: boolean) {
  await page.waitForTimeout(400); // let the last transition finish while sampling
  const { frames, sameMap } = await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __mapEl: Element | null };
    return { frames: w.__frames, sameMap: w.__mapEl !== null && w.__mapEl === document.querySelector('[data-testid="naga-map"]') && w.__mapEl.isConnected };
  });
  expect(frames.length).toBeGreaterThan(30);
  const lum = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number) as [number, number, number];
    return (r + g + b) / 3;
  };
  const bad = frames.filter((f) => f.body === "rgb(255, 255, 255)" || (dark && lum(f.body) > 128) || (!f.home && f.panel === ""));
  expect(bad.slice(0, 5), `blank or white frames (of ${frames.length})`).toEqual([]);
  expect(sameMap, "the home map stays mounted across navigation").toBe(true);
}

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test(`moving among Map, Explore, Saved, More and Search never shows a blank or white frame (${scheme})`, async ({ page }) => {
        await page.goto("/app");
        await expect(page.getByTestId("trip-sheet")).toBeVisible();
        await expect(page.getByTestId("naga-map")).toHaveAttribute("data-zoom", /\d/);
        await startSampler(page);
        await tour(page);
        await expectNoBlankFrame(page, scheme === "dark");
      });

      test(`the switches share one look, toggle from the label and pass axe (${scheme})`, async ({ page }) => {
        await page.goto("/app/more");
        const lowData = page.getByRole("switch", { name: "Low-data mode" });
        await expect(lowData).toHaveAttribute("aria-checked", "false");
        await expectSwitchGeometry(lowData, 2);
        await page.getByText("Low-data mode", { exact: true }).click();
        await expect(lowData).toHaveAttribute("aria-checked", "true");
        await expect.poll(() => knobOffset(lowData)).toBe(22);
        await expectSwitchGeometry(lowData, 22);
        await axeClean(page, '[data-testid="more-page"]');
        await lowData.click();
        await expect(lowData).toHaveAttribute("aria-checked", "false");

        await tab(page, "Map").click();
        await page.getByRole("button", { name: "Layers" }).click();
        const sheet = page.getByTestId("layers-sheet");
        const routes = sheet.getByRole("switch", { name: "Routes" });
        await expect(routes).toHaveAttribute("aria-checked", "true");
        await expectSwitchGeometry(routes, 22);
        await axeClean(page, '[data-testid="layers-sheet"]');
      });

      test(`panel to panel, nothing shows through a mid-transition frame (${scheme})`, async ({ page, browser }, info) => {
        await page.goto("/app/explore");
        await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeAttached();
        // Paint the map and the page canvas magenta: any magenta in a frame of a panel-to-panel swap is
        // the map, or nothing at all, showing through between the two panels.
        await page.addStyleTag({ content: "html, .leaflet-container,.leaflet-pane, .pn-map-placeholder { background: #ff00ff !important; } .leaflet-pane { opacity: 1 !important; }" });
        const analyser = await browser.newPage();
        const worst: { t: number; share: number }[] = [];
        for (const t of [40, 100, 160, 220, 280]) {
          const to = page.url().includes("/explore") ? "Saved" : "Explore";
          await tab(page, to).click();
          // Freeze the view transition at t ms and take the composited frame.
          const caught = await page.waitForFunction(
            (ms) => {
              const vt = document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"));
              if (vt.length === 0) return false;
              for (const a of vt) {
                a.pause();
                a.currentTime = ms;
              }
              return true;
            },
            t,
            { polling: "raf", timeout: 5000 },
          );
          expect(await caught.jsonValue()).toBe(true);
          const shot = await page.screenshot();
          if (process.env.VT_SHOTS) (await import("node:fs")).writeFileSync(`${process.env.VT_SHOTS}/vt-${scheme}-${t}ms.png`, shot);
          const share = await magentaShare(analyser, shot);
          worst.push({ t, share: Math.round(share * 1000) / 1000 });
          if (t === 160) await info.attach(`mid-transition-${t}ms.png`, { body: shot, contentType: "image/png" });
          await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
          await expect(page).toHaveURL(new RegExp(`/app/${to.toLowerCase()}$`));
          await expect(page.getByRole("heading", { level: 1, name: to })).toBeVisible();
          await page.waitForTimeout(300);
        }
        // Control: the detector does see the map once it is the screen.
        await tab(page, "Map").click();
        await expect(page).toHaveURL(/\/app$/);
        await page.waitForTimeout(500);
        const control = await magentaShare(analyser, await page.screenshot());
        await analyser.close();
        console.log(`map share per frame: ${JSON.stringify(worst)}; map screen: ${control.toFixed(3)}`);
        expect(control).toBeGreaterThan(0.1);
        expect(worst.filter((w) => w.share > 0.002), "map pixels visible mid-transition").toEqual([]);
      });
    });
  }

  test("reduced motion: the knob jumps and no view transition animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app/more");
    const history = page.getByRole("switch", { name: "Trip history" });
    await history.click();
    expect(await knobOffset(history)).toBe(22); // no slide in flight
    await history.click();
    await page.evaluate(() => {
      const w = window as unknown as { __vt: number };
      w.__vt = 0;
      const look = () => {
        w.__vt += document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition") && a.playState === "running" && Number(a.effect?.getComputedTiming().duration) > 0).length;
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await tab(page, "Saved").click();
    await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeAttached();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(0);
  });
});

/** Share of the screenshot's pixels that are magenta-ish (the painted map, even partly blended). */
async function magentaShare(analyser: Page, shot: Buffer): Promise<number> {
  return analyser.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let hits = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! - d[i + 1]! > 24 && d[i + 2]! - d[i + 1]! > 24) hits++;
    return hits / (d.length / 4);
  }, shot.toString("base64"));
}

async function knobOffset(sw: Locator): Promise<number> {
  return sw.evaluate((el) => Math.round(el.firstElementChild!.getBoundingClientRect().x - el.getBoundingClientRect().x));
}

async function expectSwitchGeometry(sw: Locator, knobX: number) {
  await expect.poll(() => knobOffset(sw)).toBe(knobX);
  const g = await sw.evaluate((el) => {
    const track = el.getBoundingClientRect();
    const knob = el.firstElementChild!.getBoundingClientRect();
    const hit = getComputedStyle(el, "::after");
    return {
      w: Math.round(track.width),
      h: Math.round(track.height),
      knobTop: Math.round(knob.y - track.y),
      knobBottom: Math.round(track.bottom - knob.bottom),
      knobSize: Math.round(knob.height),
      hitHeight: Math.round(track.height + 2 * Math.abs(parseFloat(hit.top))),
      before: getComputedStyle(el, "::before").content,
    };
  });
  expect(g).toEqual({ w: 51, h: 31, knobTop: 2, knobBottom: 2, knobSize: 27, hitHeight: 45, before: "none" });
}

async function axeClean(page: Page, include: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const results = await new AxeBuilder({ page }).include(include).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}
