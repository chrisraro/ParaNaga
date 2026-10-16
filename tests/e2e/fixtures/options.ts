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
