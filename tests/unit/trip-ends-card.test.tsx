// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAGA_DEFAULT_CENTER } from "@/domain/geo/naga";
import { TripEndsCard, endpointRowMainId } from "@/ui/home/trip-ends-card";

afterEach(cleanup);

describe("TripEndsCard", () => {
  it("renders start and destination rows with placeholders and disables Swap when both are empty", () => {
    render(
      <TripEndsCard
        endpoints={{ start: null, destination: null }}
        focused="start"
        onFocus={vi.fn()}
        onClear={vi.fn()}
        onSwap={vi.fn()}
      />,
    );
    expect(screen.getByTestId("trip-ends")).toBeTruthy();
    expect(screen.getByTestId("endpoint-start").textContent).toContain("Choose start");
    expect(screen.getByTestId("endpoint-destination").textContent).toContain("Where to?");
    expect(document.getElementById(endpointRowMainId("start"))?.getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById(endpointRowMainId("destination"))?.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Swap start and destination" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders set labels, sublines, Clear buttons, and fires focus/clear/swap callbacks", () => {
    const onFocus = vi.fn();
    const onClear = vi.fn();
    const onSwap = vi.fn();
    render(
      <TripEndsCard
        endpoints={{
          start: { point: NAGA_DEFAULT_CENTER, source: "gps", label: "Your location" },
          destination: { point: NAGA_DEFAULT_CENTER, source: "search", label: "SM City Naga" },
        }}
        focused="destination"
        startSub="GPS 2 min ago"
        onFocus={onFocus}
        onClear={onClear}
        onSwap={onSwap}
      />,
    );
    expect(screen.getByTestId("endpoint-start").textContent).toContain("Your location");
    expect(screen.getByTestId("endpoint-start").textContent).toContain("GPS 2 min ago");
    expect(screen.getByTestId("endpoint-destination").textContent).toContain("SM City Naga");
    fireEvent.click(document.getElementById(endpointRowMainId("start"))!);
    expect(onFocus).toHaveBeenCalledWith("start");
    fireEvent.click(screen.getByRole("button", { name: "Clear start" }));
    expect(onClear).toHaveBeenCalledWith("start");
    fireEvent.click(screen.getByRole("button", { name: "Swap start and destination" }));
    expect(onSwap).toHaveBeenCalledTimes(1);
  });
});
