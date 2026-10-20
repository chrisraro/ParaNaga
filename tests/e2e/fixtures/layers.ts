import { expect, type Page } from "@playwright/test";

/** The home map starts with route lines and stop pins off: turns the named Layers switches on, then closes the sheet. */
export async function showMapLayers(page: Page, ...names: ("Routes" | "Stops")[]) {
  await page.getByRole("button", { name: "Layers" }).click();
  const sheet = page.getByTestId("layers-sheet");
  await expect(sheet).toBeVisible();
  for (const name of names) {
    const toggle = sheet.getByRole("switch", { name });
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await sheet.getByRole("button", { name: "Close map layers" }).click();
  await expect(sheet).toHaveCount(0);
}
