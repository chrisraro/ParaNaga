// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapLegend } from "@/ui/map/map-legend";

afterEach(cleanup);

describe("legend Escape", () => {
  const open = () => {
    render(<MapLegend items={["walk"]} />);
    fireEvent.click(screen.getByTestId("map-legend-button"));
    expect(screen.getByTestId("map-legend-panel").dataset.open).toBe("true");
  };
  it("closes from the document and focuses the button when focus was on body", () => {
    open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByTestId("map-legend-panel").dataset.open).toBe("false");
    expect(document.activeElement).toBe(screen.getByTestId("map-legend-button"));
  });
  it("does not steal focus from an element outside the legend", () => {
    open();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByTestId("map-legend-panel").dataset.open).toBe("false");
    expect(document.activeElement).toBe(input);
    input.remove();
  });
  it("leaves the legend open when a handler already took the Escape or a modal is open", () => {
    open();
    const early = vi.fn((e: Event) => e.preventDefault());
    document.addEventListener("keydown", early, true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", early, true);
    expect(screen.getByTestId("map-legend-panel").dataset.open).toBe("true");
    const modal = document.createElement("section");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByTestId("map-legend-panel").dataset.open).toBe("true");
    modal.remove();
  });
});
