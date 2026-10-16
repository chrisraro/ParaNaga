// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEGEND_FOOTNOTE,
  LEGEND_MIXED_NOTE,
  LEGEND_STOP_LABEL,
  LEGEND_WALK_NOTE,
  MapLegend,
} from "@/ui/map/map-legend";
import { PALETTE_D, PALETTE_L } from "@/domain/modes/palette";
import { ONEWAY_CAUTION } from "@/ui/map/line-rules";

afterEach(() => {
  cleanup();
});

describe("MapLegend: always present with walking and stops", () => {
  it("with no vehicle class known it still has the button and lists the mapped-stop entry", () => {
    render(<MapLegend items={["walk"]} defaultOpen />);
    expect(screen.getByRole("button", { name: /Legend/i })).toBeTruthy();
    expect(screen.getByText(LEGEND_WALK_NOTE)).toBeTruthy();
    expect(screen.getByText(LEGEND_STOP_LABEL)).toBeTruthy();
    expect(screen.getByText(LEGEND_FOOTNOTE)).toBeTruthy();
  });

  it("renders even with no items at all", () => {
    render(<MapLegend items={[]} />);
    expect(screen.getByTestId("map-legend-button")).toBeTruthy();
  });
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

  it("mixed-fleet note says both fleets operate (owner-confirmed), not 'reported'", () => {
    expect(LEGEND_MIXED_NOTE).toBe("Alternating colours: traditional and modern jeepneys");
    expect(LEGEND_MIXED_NOTE).not.toMatch(/reported/);
  });

  it("toggles via button click and closes when Escape is pressed", () => {
    render(<MapLegend items={["traditional_puj", "tricycle"]} />);

    const btn = screen.getByRole("button", { name: /Legend/i });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    // The panel stays mounted so closing can fade; data-open drives its visibility (CSS).
    const panel = screen.getByTestId("map-legend-panel");
    expect(panel.getAttribute("data-open")).toBe("false");

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("data-open")).toBe("true");
    expect(screen.getByText(LEGEND_FOOTNOTE)).toBeTruthy();

    fireEvent.keyDown(btn, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(panel.getAttribute("data-open")).toBe("false");
  });

  it("draws the swatches in the palette of the surface it is given (the lines' surface, T11-1)", () => {
    const { container, unmount } = render(<MapLegend items={["traditional_puj"]} surface="light" defaultOpen />);
    expect(container.querySelector("[data-testid=map-legend]")?.getAttribute("data-surface")).toBe("light");
    const strokes = () => [...container.querySelectorAll(".pn-map-legend__swatch line")].map((l) => l.getAttribute("stroke"));
    expect(strokes()).toContain(PALETTE_L.traditional_puj.core);
    expect(strokes()).not.toContain(PALETTE_D.traditional_puj.core);
    unmount();
    const dark = render(<MapLegend items={["traditional_puj"]} surface="dark" defaultOpen />);
    expect([...dark.container.querySelectorAll(".pn-map-legend__swatch line")].map((l) => l.getAttribute("stroke"))).toContain(PALETTE_D.traditional_puj.core);
  });

  it("explains the dashed caution sections when some are drawn (T12-2)", () => {
    const { rerender } = render(<MapLegend items={["traditional_puj"]} defaultOpen caution />);
    expect(screen.getByTestId("map-legend-caution").textContent).toContain(ONEWAY_CAUTION);
    rerender(<MapLegend items={["traditional_puj"]} defaultOpen />);
    expect(screen.queryByTestId("map-legend-caution")).toBeNull();
  });
});
