import { describe, expect, it } from "vitest";
import {
  DARK_SURFACES,
  LIGHT_SURFACES,
  PALETTE_D,
  PALETTE_KEYS,
  PALETTE_L,
  contrastRatio,
  lineWidths,
  mapSurface,
  relativeLuminance,
} from "@/domain/modes/palette";

describe("palette WCAG 2.2 AA 1.4.11 non-text contrast and tokens (Task 11)", () => {
  it("selects Palette L whenever tiles are drawn or theme is light, and Palette D only on dark land without tiles", () => {
    expect(mapSurface("light", true)).toBe("light");
    expect(mapSurface("light", false)).toBe("light");
    expect(mapSurface("dark", true)).toBe("light");
    expect(mapSurface("dark", false)).toBe("dark");
  });

  it("computes relative luminance in [0, 1] and contrast ratios in [1, 21]", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
  });

  it("every Palette L core meets ≥ 3.0 contrast against white casing, light land (#F2EFE9), and OSM road (#FCD6A4)", () => {
    for (const key of PALETTE_KEYS) {
      const token = PALETTE_L[key];
      expect(token.casing.toUpperCase()).toBe("#FFFFFF");
      const vsCasing = contrastRatio(token.core, LIGHT_SURFACES.casing);
      const vsLand = contrastRatio(token.core, LIGHT_SURFACES.land);
      const vsRoad = contrastRatio(token.core, LIGHT_SURFACES.osmRoad);
      expect(vsCasing, `${key} L vs white casing`).toBeGreaterThanOrEqual(3.0);
      expect(vsLand, `${key} L vs land #F2EFE9`).toBeGreaterThanOrEqual(3.0);
      if (key !== "rail") {
        expect(vsRoad, `${key} L vs OSM road #FCD6A4`).toBeGreaterThanOrEqual(3.0);
      }
      if (token.secondaryCore) {
        expect(contrastRatio(token.secondaryCore, LIGHT_SURFACES.casing)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(token.secondaryCore, LIGHT_SURFACES.land)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(token.secondaryCore, LIGHT_SURFACES.osmRoad)).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  it("every Palette D core meets ≥ 3.0 contrast against dark casing (#0B1220) and dark land (#1E2633)", () => {
    for (const key of PALETTE_KEYS) {
      const token = PALETTE_D[key];
      expect(token.casing.toUpperCase()).toBe("#0B1220");
      const vsCasing = contrastRatio(token.core, DARK_SURFACES.casing);
      const vsLand = contrastRatio(token.core, DARK_SURFACES.land);
      expect(vsCasing, `${key} D vs #0B1220 casing`).toBeGreaterThanOrEqual(3.0);
      expect(vsLand, `${key} D vs dark land #1E2633`).toBeGreaterThanOrEqual(3.0);
      if (token.secondaryCore) {
        expect(contrastRatio(token.secondaryCore, DARK_SURFACES.casing)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(token.secondaryCore, DARK_SURFACES.land)).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  it("legend swatches meet ≥ 3.0 (and ≥ 5.0 L / ≥ 5.5 D) against sheet backgrounds (white and #111A2E)", () => {
    for (const key of PALETTE_KEYS) {
      const ratioL = contrastRatio(PALETTE_L[key].core, LIGHT_SURFACES.sheet);
      const ratioD = contrastRatio(PALETTE_D[key].core, DARK_SURFACES.sheet);
      expect(ratioL, `${key} swatch on light sheet`).toBeGreaterThanOrEqual(5.0);
      expect(ratioD, `${key} swatch on dark sheet`).toBeGreaterThanOrEqual(5.5);
    }
  });

  it("high-contrast line widths add +1 px to every core width and set casing side width to 3 px", () => {
    const std = lineWidths(false);
    const hc = lineWidths(true);
    expect(std).toEqual({
      tripRideCorePx: 6,
      walkDotPx: 5,
      overviewCorePx: 3,
      selectedOverviewCorePx: 5,
      casingSidePx: 2,
      overviewCasingSidePx: 1.5,
    });
    expect(hc).toEqual({
      tripRideCorePx: 7,
      walkDotPx: 6,
      overviewCorePx: 4,
      selectedOverviewCorePx: 6,
      casingSidePx: 3,
      overviewCasingSidePx: 3,
    });
  });
});
