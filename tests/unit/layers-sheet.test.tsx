// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { linesSchema } from "@/domain/api/schemas";
import { DEFAULT_LAYERS_PREF, type LayersPref } from "@/domain/prefs/prefs";
import { LINES_NOT_LOADED, LayersSheet, SelectedRouteCard, distinctRoutesFromLines } from "@/ui/map/layers-sheet";
import { ONEWAY_CAUTION, TERMINAL_ACCESS_NOTE } from "@/ui/map/line-rules";
import linesFixture from "../e2e/fixtures/network/lines.json";

const LINES = linesSchema.parse(linesFixture);

afterEach(() => {
  cleanup();
});

function Harness() {
  const [open, setOpen] = useState(false);
  const [layers, setLayers] = useState<LayersPref>({ ...DEFAULT_LAYERS_PREF, modes: [] });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Layers
      </button>
      <button type="button">Behind the sheet</button>
      <LayersSheet
        open={open}
        onClose={() => setOpen(false)}
        layers={layers}
        onUpdateLayers={(patch) => setLayers((prev) => ({ ...prev, ...patch }))}
        tracedLines={LINES.lines.slice(0, 2)}
        terminals={[]}
      />
    </>
  );
}

function openSheet() {
  render(<Harness />);
  const layersButton = screen.getByRole("button", { name: "Layers" });
  layersButton.focus();
  fireEvent.click(layersButton);
  return layersButton;
}

describe("LayersSheet (T12-4, T12-6)", () => {
  it("has no historical-routes switch", () => {
    openSheet();
    expect(screen.queryByText(/historical/i)).toBeNull();
    expect(screen.queryByTestId("layer-switch-historical")).toBeNull();
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("data-testid"))).toEqual(["layer-switch-routes", "layer-switch-terminals"]);
  });

  it("traps Tab inside the dialog in both directions", () => {
    openSheet();
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close map layers" });
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first focusable wraps to the last one inside the dialog.
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    const last = document.activeElement as HTMLElement;
    expect(dialog.contains(last)).toBe(true);
    expect(last).not.toBe(close);

    // Tab from the last focusable wraps to the first.
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("returns focus to the Layers button when closed (Close button and Escape)", () => {
    const layersButton = openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close map layers" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(layersButton);

    fireEvent.click(layersButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(layersButton);
  });
});

describe("SelectedRouteCard notes (T12-2)", () => {
  it("shows the one-way caution and the terminal access note for a route that has them", () => {
    const r8b = distinctRoutesFromLines(LINES.lines).find((r) => r.routeCode === "R8-B")!;
    expect(r8b.notes).toEqual({ onewayCaution: true, terminalAccess: true });
    render(<SelectedRouteCard route={r8b} onClose={() => undefined} />);
    expect(screen.getByText(ONEWAY_CAUTION)).toBeTruthy();
    expect(screen.getByText(TERMINAL_ACCESS_NOTE)).toBeTruthy();
  });

  it("shows neither for a route without such sections", () => {
    const r5 = distinctRoutesFromLines(LINES.lines).find((r) => r.routeCode === "R5")!;
    render(<SelectedRouteCard route={r5} onClose={() => undefined} />);
    expect(screen.queryByText(ONEWAY_CAUTION)).toBeNull();
    expect(screen.queryByText(TERMINAL_ACCESS_NOTE)).toBeNull();
  });
});

describe("LayersSheet without route lines (final-review fix)", () => {
  it("opens with no lines and says route lines are not loaded, instead of 'no match'", () => {
    render(
      <LayersSheet open onClose={() => {}} layers={DEFAULT_LAYERS_PREF} onUpdateLayers={() => {}} tracedLines={[]} linesLoaded={false} terminals={[]} />,
    );
    expect(screen.getByTestId("layers-lines-not-loaded").textContent).toBe("Route lines aren't loaded on this device.");
    expect(LINES_NOT_LOADED).toBe("Route lines aren't loaded on this device.");
    expect(screen.queryByText("No routes match the current filter.")).toBeNull();
  });
});
