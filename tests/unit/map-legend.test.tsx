// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEGEND_FOOTNOTE,
  LEGEND_MIXED_NOTE,
  LEGEND_WALK_NOTE,
  MapLegend,
} from "@/ui/map/map-legend";

afterEach(() => {
  cleanup();
});

describe("MapLegend (Task 11)", () => {
  it("lists only the items passed, includes the fixed approximate-path footnote, and shows walk and mixed-fleet notes when present", () => {
    render(<MapLegend items={["walk", "mixed_trad_modern"]} defaultOpen />);

    const btn = screen.getByRole("button", { name: /Legend/i });
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getByText(LEGEND_FOOTNOTE)).toBeTruthy();
    expect(screen.getByText(LEGEND_WALK_NOTE)).toBeTruthy();
    expect(screen.getByText(LEGEND_MIXED_NOTE)).toBeTruthy();

    // Classes not passed (e.g. Tricycle, Bus) must not appear.
    expect(screen.queryByText(/^Tricycle$/i)).toBeNull();
    expect(screen.queryByText(/^Bus$/i)).toBeNull();
  });

  it("toggles via button click and closes when Escape is pressed", () => {
    render(<MapLegend items={["traditional_puj", "tricycle"]} />);

    const btn = screen.getByRole("button", { name: /Legend/i });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(LEGEND_FOOTNOTE)).toBeNull();

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(LEGEND_FOOTNOTE)).toBeTruthy();

    fireEvent.keyDown(btn, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(LEGEND_FOOTNOTE)).toBeNull();
  });
});
