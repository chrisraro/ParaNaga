import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

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
  await expect(fleetLabel).toHaveText(/Traditional and modern jeepneys/);

  // Map and chevrons
  await expect(page.getByTestId("route-map")).toBeVisible();
  const chevrons = page.locator(".pn-chevron-icon");
  await expect(chevrons.first()).toBeAttached();

  // Trace label and status
  await expect(page.getByTestId("route-map-status")).toContainText("Approximate path, not a verified route shape");
  await expect(page.getByTestId("route-trace-badge")).toHaveText("Trace: ok");

  // Cooperatives section and footnote
  const coopsSection = page.getByTestId("route-cooperatives-section");
  await expect(coopsSection).toBeVisible();
  await expect(page.getByTestId("cooperatives-footnote")).toHaveText("Cooperative leaders' names are not shown; sources disagree.");

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

test("EJ-2017 historical route shows Historical badge and J5 copy", async ({ page }) => {
  // Mock EJ-2017 route response
  await page.route("**/api/v1/routes/EJ-2017", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: {
          revisionId: "de72168a-7f94-4c1b-8c0d-05a2c488ce6a",
          label: "modes-lines-2026-10-16",
          kind: "provisional",
          publishedAt: "2026-10-16T01:49:26.840Z",
        },
        route: {
          code: "EJ-2017",
          name: "E-Jeepney Circuit (2017 Ordinance)",
          groupNumber: null,
          modeCode: "e_jeepney",
          legalStatus: "historical",
          allocatedUnits: null,
          allocationIsActiveFleetCount: null,
          groupAllocatedUnits: null,
          evidenceLevel: "documentary",
          verification: "unverified",
          hasProvisionalStops: false,
          hasTrial: false,
          mode: "jeepney",
          serviceStatus: "historical_unknown",
          planning: "none",
          fleet: {
            label: "E-jeepneys · status unknown, not confirmed running",
            chip: "E-jeep",
            colourKey: "traditional_puj",
            classes: [],
          },
          operatingStatus: null,
          notes: "2017 e-jeepney ordinance route",
          sourceCodes: ["S01"],
          legalStreets: { inbound: null, outbound: null, circuit: ["Peñafrancia Ave", "Panganiban Drive"], branch: null },
          additionalSourceStructures: [],
          normalizationNote: null,
        },
        variants: [],
        trials: [],
        aliases: [],
        cooperatives: [],
        fareEvidence: { basis: "route_mode", rules: [], observations: [], conflicts: [], reportedPractice: [] },
        sources: [{ code: "S01", title: "City Ordinance 2017-024", url: null, evidenceType: "ordinance", publishedOrEnacted: "2017", checkedOn: null }],
      }),
    });
  });

  await page.goto("/app/routes/EJ-2017");

  const route = page.getByTestId("route-detail");
  await expect(route).toBeVisible();

  await expect(page.getByTestId("historical-badge")).toBeVisible();
  await expect(page.getByTestId("historical-notice")).toContainText(
    "A documented 2017 route with status \"unknown, not confirmed running\". Not used for planning."
  );
});
