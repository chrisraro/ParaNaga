import { expect, type Page } from "@playwright/test";

/**
 * Once From and To are set the sheet rests at peek with the best option's summary; the options
 * list opens with "All options" (full). No-op when the sheet is already at full.
 */
export async function expandOptions(page: Page) {
  const toggle = page.getByTestId("options-toggle");
  if ((await page.getByTestId("trip-sheet").getAttribute("data-snap")) !== "2") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await sheetSettled(page);
}

/** Waits for the sheet's snap transition to end, so its edge (and the map fit above it) is final. */
export async function sheetSettled(page: Page) {
  await page.getByTestId("trip-sheet").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** Opens the trip options list and chooses option `index` (the way a rider does). */
export async function chooseOption(page: Page, index = 0) {
  await expandOptions(page);
  await page.getByTestId("trip-option").nth(index).click();
  await sheetSettled(page);
}

/**
 * Steps out of a planned trip to the bare map, where the tab bar is (it belongs to the map alone):
 * Escape closes an open detail, then clears the trip. A no-op on the map.
 */
export async function backToMap(page: Page) {
  const tabBar = page.getByRole("navigation", { name: "Main" });
  if (await tabBar.isVisible()) return;
  if ((await page.getByTestId("trip-detail").count()) > 0) {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trip-detail")).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
  await expect(tabBar).toBeVisible();
}

const homeMap = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const chooseOnMapButton = (page: Page) => page.getByTestId("search-screen").getByRole("button", { name: "Choose on map", exact: true });

/** Drags the home map by (dx, dy) from its centre, as a finger would, and waits for it to come to rest. */
export async function panMap(page: Page, dx: number, dy: number) {
  const box = await homeMap(page).boundingBox();
  if (!box) throw new Error("map has no box");
  const before = await homeMap(page).getAttribute("data-center-lng");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => homeMap(page).getAttribute("data-center-lng")).not.toBe(before);
  // Let the drag's inertia end: a pin confirmed mid-glide leaves the route fit racing the map.
  let last = "";
  await expect
    .poll(
      async () => {
        const now = `${await homeMap(page).getAttribute("data-center-lat")}|${await homeMap(page).getAttribute("data-center-lng")}`;
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [120] },
    )
    .toBe(true);
}

/** The trip sheet is up (an end is set); on the bare map there is only the "Where to?" bar. */
async function sheetIsUp(page: Page) {
  return (await page.getByTestId("trip-sheet").count()) > 0;
}

/**
 * Opens Search to pick `which` end. The bare map can only start with the destination ("Where to?");
 * once an end is set the sheet's row for `which` offers "Search places and stops".
 */
export async function openSearch(page: Page, which: "start" | "destination" = "destination") {
  if (!(await sheetIsUp(page))) {
    if (which !== "destination") throw new Error("the bare map starts with the destination");
    await page.getByTestId("home-search").click();
    return;
  }
  await page.getByTestId(`endpoint-${which}`).locator(".pn-endpoint__main").click();
  await page.getByTestId("endpoint-search").click();
}

/**
 * Opens the crosshair for `which` end (the "Set ... here" panel is up afterwards): from the bare
 * map through Search ("Choose on map" under "Where to?"), else from the sheet's row for that end.
 */
export async function chooseOnMapVia(page: Page, which: "start" | "destination" = "destination") {
  if (await sheetIsUp(page)) {
    await page.getByTestId(`endpoint-${which}`).locator(".pn-endpoint__main").click();
  } else {
    await openSearch(page, which);
  }
  await chooseOnMapButton(page).click();
}

/**
 * Both ends by pins: the destination a little north-east of the opening centre, then the start at
 * the centre (the bare map begins with the destination).
 */
export async function pinTrip(page: Page) {
  await chooseOnMapVia(page, "destination");
  await panMap(page, -120, 80);
  await page.getByRole("button", { name: "Set destination here" }).click();
  await chooseOnMapVia(page, "start");
  await panMap(page, 120, -80);
  await page.getByRole("button", { name: "Set start here" }).click();
}

/**
 * The bare map cannot start with the start, so "Use current location" for the start is reached
 * through Search for the start (its own URL), as the Start row's "Search places and stops" does.
 */
export async function useLocationFromSearch(page: Page) {
  await page.goto("/app/search?for=start");
  await page.getByRole("button", { name: "Use current location" }).click();
  await expect(page.getByTestId("home-screen")).toBeVisible();
}

/** Brings the trip sheet up with a destination pinned at the map centre; the Start row is then focused. */
export async function openTripSheet(page: Page) {
  await chooseOnMapVia(page, "destination");
  await page.getByRole("button", { name: "Set destination here" }).click();
  await expect(page.getByTestId("trip-sheet")).toBeVisible();
}
