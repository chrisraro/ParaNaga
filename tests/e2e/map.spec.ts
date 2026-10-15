import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Map core e2e (Task 7). Phone-only: on desktop /app shows the large-screen gate.
// Tiles are aborted everywhere, so nothing depends on the network.

test.skip(({ isMobile }) => !isMobile, "The map lives behind the phone-only gate");

// Hardcoded from src/domain/geo/naga.ts (Playwright's loader can't import its JSON boundary).
const NAGA_MAX_BOUNDS = { south: 13.5923285, north: 13.6843613, west: 123.1651748, east: 123.3864733 };
const NAGA_MIN_ZOOM = 12;

const PLAZA_RIZAL = { latitude: 13.6233869, longitude: 123.1846726 };
const PILI = { latitude: 13.5828, longitude: 123.2756 };
/** Inside NAGA_MAX_BOUNDS but outside the city polygon (north-west of the city). */
const OUTSIDE_POLYGON = { lat: 13.6707, lng: 123.174 };

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
});

const mapEl = (page: Page) => page.getByTestId("naga-map");

async function openApp(page: Page) {
  await page.goto("/app");
  await expect(mapEl(page)).toHaveAttribute("data-zoom", /\d/);
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}

async function readView(page: Page) {
  const el = mapEl(page);
  return {
    lat: Number(await el.getAttribute("data-center-lat")),
    lng: Number(await el.getAttribute("data-center-lng")),
    zoom: Number(await el.getAttribute("data-zoom")),
  };
}

function expectInsideMaxBounds(view: { lat: number; lng: number }) {
  expect(view.lat).toBeGreaterThanOrEqual(NAGA_MAX_BOUNDS.south);
  expect(view.lat).toBeLessThanOrEqual(NAGA_MAX_BOUNDS.north);
  expect(view.lng).toBeGreaterThanOrEqual(NAGA_MAX_BOUNDS.west);
  expect(view.lng).toBeLessThanOrEqual(NAGA_MAX_BOUNDS.east);
}

/** Mouse drag inside the map's visible area (above the bottom sheet). */
async function drag(page: Page, dx: number, dy: number) {
  const box = await mapEl(page).boundingBox();
  if (!box) throw new Error("map has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

const row = (page: Page, which: "start" | "destination") => page.getByTestId(`endpoint-${which}`);
const rowMain = (page: Page, which: "start" | "destination") => row(page, which).locator(".pn-endpoint__main");
const useLocation = (page: Page) => page.getByRole("button", { name: "Use current location" });
const chooseOnMap = (page: Page) => page.getByRole("button", { name: "Choose on map", exact: true });
const overlayPaths = (page: Page) => page.locator(".leaflet-overlay-pane path");

async function zoomOutTo(page: Page, target: number) {
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  for (let z = (await readView(page)).zoom; z > target; z--) {
    await zoomOut.click();
    await expect(mapEl(page)).toHaveAttribute("data-zoom", String(z - 1));
  }
}

/** Web-mercator pixels per degree of longitude at `zoom` (256px tiles). */
const pxPerDegLng = (zoom: number) => (256 * 2 ** zoom) / 360;
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI);

/** Pans the map by mouse drags until its centre is within ~0.002 degrees of `target`. */
async function panTo(page: Page, target: { lat: number; lng: number }) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const { lat, lng, zoom } = await readView(page);
    if (Math.abs(lat - target.lat) < 0.002 && Math.abs(lng - target.lng) < 0.002) return;
    const k = pxPerDegLng(zoom);
    const dx = Math.max(-340, Math.min(340, -(target.lng - lng) * k));
    const dy = Math.max(-340, Math.min(340, (mercatorY(target.lat) - mercatorY(lat)) * k));
    const before = await mapEl(page).getAttribute("data-center-lat");
    await drag(page, dx, dy);
    await expect.poll(() => mapEl(page).getAttribute("data-center-lat")).not.toBe(before);
    // Let inertia settle before measuring again.
    await expect
      .poll(async () => {
        const a = await readView(page);
        await page.waitForTimeout(0);
        const b = await readView(page);
        return a.lat === b.lat && a.lng === b.lng;
      })
      .toBe(true);
  }
  const final = await readView(page);
  expect(Math.abs(final.lat - target.lat)).toBeLessThan(0.002);
  expect(Math.abs(final.lng - target.lng)).toBeLessThan(0.002);
}

async function pin(page: Page, which: "start" | "destination") {
  await chooseOnMap(page).click();
  await page.getByRole("button", { name: which === "start" ? "Set start here" : "Set destination here" }).click();
  await expect(rowMain(page, which)).toContainText("Pinned location");
}

test.describe("geolocation inside Naga", () => {
  test.use({ permissions: ["geolocation"], geolocation: { ...PLAZA_RIZAL, accuracy: 15 } });

  test("precise fix at Plaza Rizal sets the start and centres the map", async ({ page }) => {
    await openApp(page);
    await useLocation(page).click();

    await expect(page.getByTestId("accuracy-pill")).toContainText("± 15 m");
    await expect(row(page, "start")).toContainText("Your location");
    await expect(page.getByTestId("home-announcer")).toContainText("Start set: Your location");
    await expect
      .poll(async () => {
        const v = await readView(page);
        return Math.abs(v.lat - PLAZA_RIZAL.latitude) < 0.002 && Math.abs(v.lng - PLAZA_RIZAL.longitude) < 0.002;
      })
      .toBe(true);
  });

  test("approximate fix shows the accuracy chip", async ({ page, context }) => {
    await context.setGeolocation({ ...PLAZA_RIZAL, accuracy: 60 });
    await openApp(page);
    await useLocation(page).click();

    await expect(page.getByTestId("location-status").locator(".pn-chip")).toHaveText("± 60 m");
    await expect(page.getByTestId("accuracy-pill")).toContainText("± 60 m");
  });

  test("a GPS destination left after a swap is released when pinned over (watch stops)", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __clearWatch: number; __watch: number };
      w.__clearWatch = 0;
      w.__watch = 0;
      const geo = navigator.geolocation;
      const clear = geo.clearWatch.bind(geo);
      const watch = geo.watchPosition.bind(geo);
      geo.clearWatch = (id: number) => {
        w.__clearWatch += 1;
        clear(id);
      };
      geo.watchPosition = (...args: Parameters<Geolocation["watchPosition"]>) => {
        w.__watch += 1;
        return watch(...args);
      };
    });
    const clearCalls = () => page.evaluate(() => (window as unknown as { __clearWatch: number }).__clearWatch);

    await openApp(page);
    await useLocation(page).click();
    await expect(page.getByTestId("accuracy-pill")).toBeVisible();

    // Pin a destination while GPS is the start: the watch must keep running.
    await pin(page, "destination");
    await expect(page.getByTestId("accuracy-pill")).toBeVisible();
    expect(await clearCalls()).toBe(0);

    // Swap: GPS is now the destination. Replace it with a pin: no endpoint needs GPS any more.
    await page.getByRole("button", { name: "Swap start and destination" }).click();
    await expect(rowMain(page, "destination")).toContainText("Your location");
    await rowMain(page, "destination").click();
    await pin(page, "destination");

    await expect(page.getByTestId("accuracy-pill")).toBeHidden();
    await expect(page.getByTestId("location-status")).toBeHidden();
    await expect.poll(clearCalls).toBeGreaterThan(0);
  });
});

test.describe("geolocation outside Naga", () => {
  test.use({ permissions: ["geolocation"], geolocation: { ...PILI, accuracy: 20 } });

  test("Pili fix is never the start; the map stays inside Naga", async ({ page }) => {
    await openApp(page);
    const before = await readView(page);
    await useLocation(page).click();

    const status = page.getByTestId("location-status");
    await expect(status).toContainText("You're outside Naga City");
    await expect(page.getByRole("button", { name: "Choose start on map" })).toBeVisible();
    await expect(rowMain(page, "start")).toContainText("Choose start");
    await expect(row(page, "start")).not.toContainText("Your location");
    await expect(page.getByTestId("accuracy-pill")).toBeHidden();

    const after = await readView(page);
    expectInsideMaxBounds(after);
    expect(after.lat).toBeCloseTo(before.lat, 4);
    expect(after.lng).toBeCloseTo(before.lng, 4);
  });
});

test.describe("geolocation denied", () => {
  test("denied copy shows and pinning still works", async ({ page }) => {
    await openApp(page);
    await useLocation(page).click();

    await expect(page.getByTestId("location-status")).toContainText("Location is off. You can still pin your start on the map.");
    await chooseOnMap(page).click();
    await expect(page.getByRole("region", { name: "Choose start on map" })).toBeVisible();
    await page.getByRole("button", { name: "Set start here" }).click();
    await expect(rowMain(page, "start")).toContainText("Pinned location");
  });
});

test.describe("pinning without GPS", () => {
  test("start and destination pins show the honest card with no line between them", async ({ page }) => {
    await openApp(page);
    const pathsBefore = await overlayPaths(page).count();
    expect(pathsBefore).toBeGreaterThan(0); // boundary outline + mask

    await pin(page, "start");

    // Destination is offered next; pan so the two pins differ.
    await chooseOnMap(page).click();
    const view = await readView(page);
    await drag(page, -120, 80);
    await expect.poll(async () => (await readView(page)).lng).not.toBe(view.lng);
    await page.getByRole("button", { name: "Set destination here" }).click();

    await expect(page.getByTestId("no-verified-commute")).toContainText("No verified commute yet for this trip");
    await expect(page.getByRole("heading", { name: "No verified commute yet for this trip" })).toBeVisible();
    await expect(page.locator(".leaflet-marker-pane").getByRole("img")).toHaveCount(2);
    expect(await overlayPaths(page).count()).toBe(pathsBefore);
  });
});

test.describe("Naga lock", () => {
  test("panning far away and zooming out never leaves the city bounds or goes below the min zoom", async ({ page }) => {
    await openApp(page);

    // Away (east/south), then back (west/north), 20 large drags each.
    for (const [dx, dy] of [
      [-300, -300],
      [300, 300],
    ] as const) {
      for (let i = 0; i < 20; i++) {
        await drag(page, dx, dy);
        expectInsideMaxBounds(await readView(page));
      }
    }
    // Make sure the lock was really exercised: we ended up near an edge, not still at the start.
    const far = await readView(page);
    expect(Math.abs(far.lat - 13.6233869) + Math.abs(far.lng - 123.1846726)).toBeGreaterThan(0.03);

    // Zoom out as far as the button allows, then keep tapping.
    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    await zoomOutTo(page, NAGA_MIN_ZOOM);
    for (let i = 0; i < 3; i++) {
      await zoomOut.click({ force: true });
      const v = await readView(page);
      expect(v.zoom).toBeGreaterThanOrEqual(NAGA_MIN_ZOOM);
      expectInsideMaxBounds(v);
    }
    await expect(mapEl(page)).toHaveAttribute("data-zoom", String(NAGA_MIN_ZOOM));
    await expect(zoomOut).toHaveAttribute("aria-disabled", "true");
    expectInsideMaxBounds(await readView(page));
  });
});

test.describe("crosshair outside the city", () => {
  test("confirm is disabled with a hint and never sets the start", async ({ page }) => {
    await openApp(page);
    // Zoom in one level: when zoomed out, the max bounds are smaller than the view and the
    // centre cannot reach the city's edge. At 16 the north-west corner is reachable.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(mapEl(page)).toHaveAttribute("data-zoom", "16");
    await chooseOnMap(page).click();
    await panTo(page, OUTSIDE_POLYGON);
    expectInsideMaxBounds(await readView(page));

    await expect(page.getByTestId("pick-outside-hint")).toHaveText("Move the pin inside Naga City");
    const confirm = page.getByRole("button", { name: "Set start here" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");

    await confirm.click({ force: true });
    // Still picking, nothing was set, and nothing was announced as set.
    await expect(page.getByRole("region", { name: "Choose start on map" })).toBeVisible();
    await expect(page.getByTestId("home-announcer")).not.toContainText("set:");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(rowMain(page, "start")).toContainText("Choose start");
  });
});

test.describe("focus and sheet behaviour", () => {
  test("confirm and cancel return focus to the endpoint row; Escape works from the map", async ({ page }) => {
    await openApp(page);

    // Confirm start -> focus on the start row.
    await chooseOnMap(page).click();
    await expect(page.getByRole("button", { name: "Set start here" })).toBeFocused();
    await page.getByRole("button", { name: "Set start here" }).click();
    await expect(rowMain(page, "start")).toBeFocused();

    // Cancel destination via the button -> focus on the destination row.
    await chooseOnMap(page).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(rowMain(page, "destination")).toBeFocused();
    await expect(row(page, "destination")).toContainText("Where to?");

    // Escape with focus outside the pick panel (on the page body) cancels too.
    await chooseOnMap(page).click();
    await expect(page.getByRole("region", { name: "Choose destination on map" })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Choose destination on map" })).toBeHidden();
    await expect(rowMain(page, "destination")).toBeFocused();
    await expect(page.getByTestId("home-announcer")).toHaveText("Pin cancelled");
  });

  test("the peek snap makes the options inert; tapping a row lifts the sheet to half", async ({ page }) => {
    await openApp(page);
    const sheet = page.getByTestId("trip-sheet");
    const rest = sheet.locator(".pn-sheet__rest");
    const isInert = () => rest.evaluate((el) => (el as HTMLElement).inert);

    await expect(sheet).toHaveAttribute("data-snap", "1");
    expect(await isInert()).toBe(false);
    await expect(useLocation(page)).toBeVisible();

    // Collapse to peek with the grabber (ArrowDown).
    const grabber = sheet.locator(".pn-grabber");
    await grabber.focus();
    await page.keyboard.press("ArrowDown");
    await expect(sheet).toHaveAttribute("data-snap", "0");
    expect(await isInert()).toBe(true);

    // Tab through the sheet: never reaches the offscreen options; rows stay reachable.
    await rowMain(page, "start").focus();
    const reached = new Set<string>();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "";
        return `${el.getAttribute("aria-label") ?? ""}|${(el.textContent ?? "").slice(0, 80)}`;
      });
      reached.add(name);
    }
    for (const name of reached) {
      // (focus may also land on <body> or browser chrome; only named controls matter)
      expect(name).not.toContain("Use current location");
      expect(name).not.toContain("Choose on map");
    }
    await rowMain(page, "destination").focus();
    await expect(rowMain(page, "destination")).toBeFocused();

    // Fix B: tapping a row at peek expands to half and its options become usable.
    await rowMain(page, "destination").click();
    await expect(sheet).toHaveAttribute("data-snap", "1");
    expect(await isInert()).toBe(false);
    await expect(page.getByRole("heading", { name: "Set destination" })).toBeVisible();
    await chooseOnMap(page).focus();
    await expect(chooseOnMap(page)).toBeFocused();
    await expect(useLocation(page)).toHaveCount(0);

    // Tapping the start row at peek works the same way.
    // (Focusing an option below the fold may have lifted the sheet to full, so step down until peek.)
    await expect
      .poll(async () => {
        const snap = await sheet.getAttribute("data-snap");
        if (snap !== "0") {
          await grabber.focus();
          await page.keyboard.press("ArrowDown");
        }
        return snap;
      })
      .toBe("0");
    await rowMain(page, "start").click();
    await expect(sheet).toHaveAttribute("data-snap", "1");
    await expect(page.getByRole("heading", { name: "Set start" })).toBeVisible();
    await useLocation(page).focus();
    await expect(useLocation(page)).toBeFocused();
  });
});

test("home screen has no serious accessibility violations", async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
});
