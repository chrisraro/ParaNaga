// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reduceSession, startSession } from "@/domain/guidance/session";
import { guidanceView } from "@/domain/guidance/view";
import { GuidanceBanner } from "@/ui/guidance/guidance-banner";
import { GuidanceStrip } from "@/ui/guidance/guidance-strip";
import { ORIGIN, oneRide, tripOf } from "./guidance-fixtures";

afterEach(cleanup);

describe("GuidanceBanner and GuidanceStrip (T6)", () => {
  const now = 1_000_000;

  it("renders the active walk step in GuidanceBanner with next-ride hint and no live region", () => {
    const session = startSession(tripOf(oneRide()), now);
    const view = guidanceView(session, { lat: ORIGIN.lat, lng: ORIGIN.lng, accuracy: 10, timestamp: now }, now);
    render(<GuidanceBanner view={view} />);

    const banner = screen.getByTestId("guidance-banner");
    expect(banner.getAttribute("aria-live")).toBeNull();
    expect(screen.getByTestId("guidance-banner-title").textContent).toBe("Walk to Plaza Rizal (A1)");
    expect(screen.getByTestId("guidance-banner-sub").textContent).toContain("Then ride Loop A");
    expect(screen.queryByTestId("guidance-recenter")).toBeNull();
  });

  it("shows Re-center when panned is true and calls onRecenter on click", () => {
    const session = startSession(tripOf(oneRide()), now);
    const view = guidanceView(session, null, now);
    const onRecenter = vi.fn();
    render(<GuidanceBanner view={view} panned onRecenter={onRecenter} />);

    const btn = screen.getByTestId("guidance-recenter");
    expect(btn.textContent).toBe("Re-center");
    fireEvent.click(btn);
    expect(onRecenter).toHaveBeenCalledTimes(1);
  });

  it("renders the ride step in GuidanceBanner and GuidanceStrip and dispatches primary action", () => {
    let session = startSession(tripOf(oneRide()), now);
    session = reduceSession(session, { type: "atStop" });
    session = reduceSession(session, { type: "boarded" });
    const view = guidanceView(session, null, now);
    const onEnd = vi.fn();
    const onAction = vi.fn();
    const onSteps = vi.fn();

    render(
      <>
        <GuidanceBanner view={view} />
        <GuidanceStrip view={view} onEnd={onEnd} onAction={onAction} onSteps={onSteps} />
      </>,
    );

    expect(screen.getByTestId("guidance-banner").getAttribute("data-screen")).toBe("ride");
    expect(screen.getByTestId("guidance-strip-step").textContent).toBe("Step 2 of 3 · Ride");
    fireEvent.click(screen.getByTestId("guidance-steps-toggle"));
    expect(onSteps).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("guidance-strip-primary"));
    expect(onAction).toHaveBeenCalledWith({ type: "nextStopIsMine" });
    fireEvent.click(screen.getByTestId("guidance-strip-end"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
