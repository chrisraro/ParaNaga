import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { LINES, routeNetwork } from "./fixtures/network";

test.skip(({ isMobile }) => !isMobile, "The route detail lives behind the phone-only gate");

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
});

test("R4 route detail shows fleet label and no chair names", async ({ page }) => {
  await page.goto("/app/routes/R4");

  const route = page.getByTestId("route-detail");
  await expect(route).toBeVisible();

  // Fleet label from route fixture
  const fleetLabel = page.getByTestId("route-fleet-label");
  await expect(fleetLabel).toHaveText("Traditional and modern jeepneys");

  // Map and chevrons
  await expect(page.getByTestId("route-map")).toBeVisible();
  const chevrons = page.locator(".pn-chevron-icon");
  await expect(chevrons.first()).toBeAttached();

  // The legend is on the route map: this route's class, walking, and mapped stops.
  await page.getByTestId("route-map").getByTestId("map-legend-button").click();
  const legendPanel = page.getByTestId("route-map").getByTestId("map-legend-panel");
  await expect(legendPanel).toContainText("Traditional and modern jeepneys");
  await expect(legendPanel).toContainText("Walk");
  await expect(legendPanel).not.toContainText("Mapped stop"); // no stop pins on the route map
  await page.keyboard.press("Escape");

  // Trace label and status
  await expect(page.getByTestId("route-map-status")).toContainText("Approximate path, not a verified route shape");
  await expect(page.getByTestId("route-trace-badge")).toHaveText("Trace: ok");

  // R4's 460 m one-way conflict is dashed on an ok trace, with the visible caution (T12-2).
  await expect(page.locator('[data-testid="route-map"] path.pn-line--caution.pn-line--oneway-conflict').first()).toBeAttached();
  await expect(page.getByTestId("route-map-oneway-caution")).toHaveText(
    "street order conflicts with one-way mapping — confirm on the ground",
  );
  await expect(page.getByTestId("route-map-terminal-access")).toHaveCount(0);

  // Cooperatives section and footnote
  const coopsSection = page.getByTestId("route-cooperatives-section");
  await expect(coopsSection).toBeVisible();
  await expect(page.getByTestId("cooperatives-footnote")).toHaveText("Leaders' names not shown.");

  // Crucial check: never show chair or leader names, nor addresses
  const allText = await route.innerText();
  expect(allText).not.toMatch(/chair|chairman|chairperson|president|officer/i);

  // Accessibility check
  const a11y = await new AxeBuilder({ page })
    .include('[data-testid="route-detail"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
});

test("two-way route segmented control toggles inbound and outbound direction", async ({ page }) => {
  await page.goto("/app/routes/R1");

  const route = page.getByTestId("route-detail");
  await expect(route).toBeVisible();

  const seg = page.getByRole("radiogroup", { name: "Direction" });
  await expect(seg).toBeVisible();

  const outboundBtn = seg.getByRole("radio", { name: /Toward San Isidro/i });
  await outboundBtn.click();
  await expect(outboundBtn).toHaveAttribute("aria-checked", "true");

  const inboundBtn = seg.getByRole("radio", { name: /Toward Centro/i });
  await inboundBtn.click();
  await expect(inboundBtn).toHaveAttribute("aria-checked", "true");
});

test("a route with a terminal access road notes it, drawn solid", async ({ page }) => {
  await page.goto("/app/routes/R8-A");
  await expect(page.getByTestId("route-detail")).toBeVisible();
  await expect(page.locator('[data-testid="route-map"] path.pn-line--route').first()).toBeAttached();
  await expect(page.getByTestId("route-map-terminal-access")).toHaveText("terminal access road");
  // R8-A's trace is ok: its off-list sections stay solid, and it has no one-way conflict.
  await expect(page.locator('[data-testid="route-map"] path.pn-line--caution')).toHaveCount(0);
  await expect(page.getByTestId("route-map-oneway-caution")).toHaveCount(0);
});

test("an untraced direction shows no line and \"Path could not be traced\", never the other direction's line", async ({ page }) => {
  // R1 outbound is untraced in this variation of the published lines.
  const r1Outbound = LINES.lines.find((l) => l.routeCode === "R1" && l.direction === "outbound")!;
  const variation = {
    ...LINES,
    lines: LINES.lines.filter((l) => l !== r1Outbound),
    untraced: [
      ...LINES.untraced,
      { ...LINES.untraced[0]!, variantId: r1Outbound.variantId, routeId: r1Outbound.routeId, routeCode: "R1", routeName: r1Outbound.routeName, mode: "jeepney", direction: "outbound" },
    ],
  };
  await page.route(/\/api\/v1\/network\/lines\/[^/?]+$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(variation) }),
  );
  await page.goto("/app/routes/R1");
  const route = page.getByTestId("route-detail");
  await expect(route).toBeVisible();
  const lines = page.locator('[data-testid="route-map"] path.pn-line--route');
  await expect(lines.first()).toBeAttached();
  await expect(page.getByTestId("route-path-status")).toHaveText("Approximate path, not a verified route shape");

  await page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: /Toward San Isidro/i }).click();
  await expect(page.getByTestId("route-path-status")).toHaveText("Path could not be traced from the street list");
  await expect(lines).toHaveCount(0);
  await expect(page.getByTestId("route-trace-badge")).toHaveCount(0);
  // No line drawn, yet the legend is still there (walking and mapped stops).
  await expect(page.getByTestId("route-map").getByTestId("map-legend-button")).toBeVisible();
});

test("route detail never shows e-jeepney or historical-route copy", async ({ page }) => {
  await page.goto("/app/routes/R4");
  const route = page.getByTestId("route-detail");
  await expect(route).toBeVisible();
  await expect(page.getByTestId("route-fleet-label")).toHaveText("Traditional and modern jeepneys");
  const text = await route.innerText();
  expect(text).not.toMatch(/e-jeep|historical route/i);
  await expect(page.getByTestId("historical-badge")).toHaveCount(0);
});

for (const mode of ["dark", "high contrast"] as const) {
  test(`route detail with its line has no serious axe violations (${mode})`, async ({ page }) => {
    if (mode === "dark") await page.emulateMedia({ colorScheme: "dark" });
    else {
      await page.addInitScript(() => {
        localStorage.setItem("paranaga.prefs", JSON.stringify({ theme: "system", highContrast: true, lowData: false, historyEnabled: false }));
      });
    }
    await page.goto("/app/routes/R4");
    await expect(page.getByTestId("route-detail")).toBeVisible();
    await expect(page.locator('[data-testid="route-map"] path.pn-line--route').first()).toBeAttached();
    await expect(page.getByTestId("route-map-oneway-caution")).toBeVisible();
    if (mode === "high contrast") await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    const a11y = await new AxeBuilder({ page })
      .include('[data-testid="route-detail"]')
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const serious = a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join(", ")).toEqual([]);
  });
}

test("route detail names the letter and title, the ordinance route and where the letter comes from", async ({ page }) => {
  const title = page.getByTestId("route-detail").getByRole("heading", { level: 1 });
  await page.goto("/app/routes/R3");
  await expect(title).toHaveText("Centro-Del Rosario via Roxas Ave (Diversion)");
  await expect(page.getByTestId("route-provenance")).toHaveText(/Route 3 of the City of Naga route plan, Ordinance 2025-070 · 28 units authorised/);
  await page.goto("/app/routes/R8-A");
  await expect(title).toHaveText("A Centro-Magsaysay Loop A (clockwise)");
  await expect(page.getByTestId("route-provenance")).toContainText("Letter A of the Loop Service in the ordinance");
  await page.goto("/app/routes/R1");
  await expect(title).toHaveText("Centro-Cararayan-San Isidro");
  const r1 = await page.getByTestId("route-provenance").textContent();
  expect(r1).toContain("Route 1 of the City of Naga route plan");
  expect(r1).not.toMatch(/Letter/);
});
