import { describe, expect, it } from "vitest";
import { HALF_VISIBLE, MAP_MIN_SHARE, PEEK_OPTIONS_VISIBLE, PEEK_VISIBLE, mapInsetFor, offsetFor, sheetGrows } from "@/ui/app-shell/bottom-sheet";

describe("offsetFor with a taller peek (options listed)", () => {
  it("defaults to the 214 px peek and keeps half and full", () => {
    expect(offsetFor(0, 800)).toBe(800 - PEEK_VISIBLE);
    expect(offsetFor(1, 800)).toBe(800 - HALF_VISIBLE);
    expect(offsetFor(2, 800)).toBe(0);
  });
  it("shows the options peek height (plus the tab bar) at snap 0 only", () => {
    expect(offsetFor(0, 800, 90, PEEK_OPTIONS_VISIBLE)).toBe(800 - PEEK_OPTIONS_VISIBLE - 90);
    expect(offsetFor(1, 800, 90, PEEK_OPTIONS_VISIBLE)).toBe(800 - HALF_VISIBLE);
    expect(offsetFor(2, 800, 90, PEEK_OPTIONS_VISIBLE)).toBe(0);
  });
  it("peek leaves room for the rows, the summary and a 44 px toggle", () => {
    expect(PEEK_OPTIONS_VISIBLE).toBeGreaterThanOrEqual(PEEK_VISIBLE + 44);
    expect(PEEK_OPTIONS_VISIBLE).toBeLessThan(HALF_VISIBLE);
  });
});

describe("sheetGrows", () => {
  it("is true only when the offset shrinks (a lift), so the padding does not trail the lift", () => {
    expect(sheetGrows(offsetFor(0, 800), offsetFor(1, 800))).toBe(true);
    expect(sheetGrows(offsetFor(1, 800), offsetFor(2, 800))).toBe(true);
    expect(sheetGrows(offsetFor(2, 800), offsetFor(0, 800))).toBe(false);
    expect(sheetGrows(300, 300)).toBe(false);
    expect(sheetGrows(null, 300)).toBe(false);
  });
});

describe("short and zoomed screens (WCAG 1.4.10)", () => {
  it("clamps peek and half to three quarters of the sheet, so a map strip stays above it", () => {
    for (const h of [154, 294, 349]) {
      const cap = h * (1 - MAP_MIN_SHARE);
      expect(h - offsetFor(0, h, 60, PEEK_OPTIONS_VISIBLE)).toBeLessThanOrEqual(Math.ceil(cap));
      expect(h - offsetFor(1, h, 60, PEEK_OPTIONS_VISIBLE)).toBeLessThanOrEqual(Math.ceil(cap));
      expect(offsetFor(1, h)).toBeLessThanOrEqual(offsetFor(0, h, 60, PEEK_OPTIONS_VISIBLE));
      expect(offsetFor(2, h)).toBe(0);
    }
  });
  it("on a tiny sheet (about 300 px of viewport) the peek is the grabber over the tab bar", () => {
    expect(154 - offsetFor(0, 154, 60, PEEK_OPTIONS_VISIBLE)).toBe(44 + 60);
    expect(154 - offsetFor(0, 154, 0, PEEK_OPTIONS_VISIBLE)).toBe(44);
  });
  it("keeps the upright phone detents (peek 214 / options 276 + tab bar, half 444) from 673 px up", () => {
    expect(647 - offsetFor(0, 647, 90, PEEK_OPTIONS_VISIBLE)).toBe(PEEK_OPTIONS_VISIBLE + 90);
    expect(647 - offsetFor(1, 647)).toBe(HALF_VISIBLE);
  });
  it("on a shorter phone half stops short of the map controls (they end 229 px from the top)", () => {
    for (const vh of [664, 640, 568]) expect(vh - 26 - offsetFor(1, vh - 26)).toBeLessThanOrEqual(vh - 229);
    expect(664 - 26 - offsetFor(1, 664 - 26)).toBe(664 - 229);
  });
  it("ends the map just under the clamped peek sheet's top (186 px upright)", () => {
    expect(mapInsetFor(null)).toBe(PEEK_VISIBLE - 28);
    expect(mapInsetFor(813)).toBe(PEEK_VISIBLE - 28);
    expect(mapInsetFor(154)).toBe(Math.round(154 * (1 - MAP_MIN_SHARE) - 28));
  });
  it("orders the snaps tiny <= peek <= half <= full on every screen height (sheet height = viewport - 26)", () => {
    for (const [peek, clearance] of [[PEEK_VISIBLE, 0], [PEEK_VISIBLE, 90], [PEEK_OPTIONS_VISIBLE, 60], [PEEK_OPTIONS_VISIBLE, 90]] as const) {
      const heights = [...Array.from({ length: 29 }, (_, i) => 440 + i * 16), 640, 664, 568, 360, 300];
      for (const vh of heights) {
        const h = vh - 26;
        const shown = (snap: 0 | 1 | 2) => h - offsetFor(snap, h, clearance, peek);
        expect(shown(1), `half >= peek at ${vh} (${peek}+${clearance})`).toBeGreaterThanOrEqual(shown(0));
        expect(shown(2)).toBeGreaterThanOrEqual(shown(1));
      }
    }
  });
});
