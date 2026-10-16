// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fleetSummary } from "@/domain/modes/fleet";
import { MAP_CHIP_TEXT, MODE_DISPLAY_NAMES, VISUAL_KEYS } from "@/domain/modes/modes";
import { FleetChips } from "@/ui/modes/fleet-chips";
import { ModeChip } from "@/ui/modes/mode-chip";
import { ModeIcon } from "@/ui/modes/mode-icon";

afterEach(() => {
  cleanup();
});

describe("ModeIcon, ModeChip, and FleetChips (Task 11)", () => {
  it("renders an inline aria-hidden SVG icon and non-empty text for every visual key", () => {
    for (const key of VISUAL_KEYS) {
      const { unmount, container } = render(<ModeChip mode={key} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByText(MODE_DISPLAY_NAMES[key])).toBeTruthy();
      expect(MAP_CHIP_TEXT[key].length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("is never colour-only: with all CSS colour properties stripped, the text still carries the full meaning", () => {
    const r4Summary = fleetSummary(
      [
        {
          code: "FL-R4-TRAD",
          vehicleClass: "traditional_puj",
          evidenceLevels: ["legal_plan", "owner_confirmation"],
          status: "operating",
          firstReportedOn: null,
          lastReportedOn: "2026-10-16",
          unitsNote: null,
          aircon: null,
          airconSourceCodes: [],
          cooperatives: [],
          sourceCodes: ["N30", "U01"],
        },
        {
          code: "FL-R4-MOD",
          vehicleClass: "modern_puj",
          evidenceLevels: ["official_report", "news_report", "owner_confirmation"],
          status: "operating",
          firstReportedOn: "2023-04-17",
          lastReportedOn: "2026-10-16",
          unitsNote: "about 10 air-conditioned units",
          aircon: true,
          airconSourceCodes: ["N14", "U01"],
          cooperatives: ["NACIATRASCO"],
          sourceCodes: ["N14", "N38", "N39", "U01"],
        },
      ],
      "jeepney",
    );

    const { container } = render(
      <div>
        <ModeChip mode={r4Summary.colourKey} label={r4Summary.chip} />
        <FleetChips fleet={r4Summary} />
      </div>,
    );

    // Strip inline styles and class colours on every element; text content must still identify the classes.
    for (const el of container.querySelectorAll<HTMLElement>("*")) {
      el.removeAttribute("style");
    }
    expect(screen.getByText("Jeepney · traditional + modern")).toBeTruthy();
    expect(screen.getByText(/Traditional jeepney · operating/)).toBeTruthy();
    expect(screen.getByText(/Modern jeepney · air-conditioned · operating/)).toBeTruthy();
  });

  it("ModeIcon renders distinct SVG paths for each visual class", () => {
    const markups = new Set<string>();
    for (const key of VISUAL_KEYS) {
      const { container, unmount } = render(<ModeIcon mode={key} />);
      markups.add(container.innerHTML);
      unmount();
    }
    expect(markups.size).toBe(VISUAL_KEYS.length);
  });
});
