// @vitest-environment jsdom
// Facts: new test file for src/ui/guidance/guidance.tsx (Task 10 fix round 1). The component takes
// the useGuidanceSession result as a prop, so a plain object stands in for the hook. Review
// Important 2: the accuracy chip shows only a fresh fix, styled by its quality; Important 1 at the
// screen level: a GPS fall-back to the title is never announced, focus never moves on GPS alone.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseGuidanceSession } from "@/client/guidance/use-guidance-session";
import type { LocationFix } from "@/domain/geo/location-fix";
import { startSession, type GuidanceSession } from "@/domain/guidance/session";
import { guidanceView } from "@/domain/guidance/view";
import { Guidance } from "@/ui/guidance/guidance";
import { ORIGIN, oneRide, tripOf } from "./guidance-fixtures";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/client/saved/use-saved-trip-toggle", () => ({
  useSavedTripToggle: () => ({ match: null, kind: "none", waiting: false, unavailable: false, toggle: async () => undefined }),
}));

const T0 = 1_000_000;

function fake(session: GuidanceSession, fix: LocationFix | null, now: number, send = vi.fn()): UseGuidanceSession {
  return {
    session,
    card: null,
    view: guidanceView(session, fix, now),
    now,
    location: { state: fix ? "watching" : "idle", fix, watching: fix !== null },
    start: vi.fn(),
    send,
    enableLocation: vi.fn(),
  };
}

const ui = (g: UseGuidanceSession) => <Guidance guidance={g} covered={false} onEnd={vi.fn()} onDone={vi.fn()} onReplan={vi.fn()} />;

afterEach(cleanup);

describe("Guidance header", () => {
  it("shows the accuracy of a fresh fix, styled by its quality, and hides it once the fix is 31 s old", () => {
    const s = startSession(tripOf(oneRide()), T0);
    const fix = { lat: ORIGIN.lat, lng: ORIGIN.lng, accuracy: 12, timestamp: T0 };
    const { rerender } = render(ui(fake(s, fix, T0)));
    const chip = screen.getByTestId("guidance-accuracy");
    expect(chip.textContent).toContain("± 12 m");
    expect(chip.dataset.quality).toBe("precise");
    expect(chip.className).not.toContain("approx");

    rerender(ui(fake(s, { ...fix, accuracy: 45 }, T0)));
    expect(screen.getByTestId("guidance-accuracy").className).toContain("approx");

    rerender(ui(fake(s, fix, T0 + 31_000)));
    expect(screen.queryByTestId("guidance-accuracy")).toBeNull();
  });
});

describe("Guidance announcements and focus", () => {
  it("never announces a GPS fall-back to the title and never moves focus on GPS alone", () => {
    const s = startSession(tripOf(oneRide()), T0);
    const near = (m: number, at: number) => ({ lat: ORIGIN.lat + m / 111_320, lng: ORIGIN.lng, accuracy: 10, timestamp: at });
    const { rerender } = render(ui(fake(s, null, T0)));
    const heading = screen.getByRole("heading", { level: 2 });
    expect(document.activeElement).toBe(heading);
    const announcer = screen.getByTestId("guidance-announcer");

    // A distance after 20 s is announced; GPS then becomes unusable (title fall-back): quiet.
    rerender(ui(fake(s, near(0, T0 + 20_000), T0 + 20_000)));
    expect(announcer.textContent).toMatch(/m to Plaza Rizal \(A1\), straight line$/);
    const said = announcer.textContent;
    const button = screen.getByRole("button", { name: "I'm at the stop" });
    button.focus();
    rerender(ui(fake(s, { ...near(0, T0 + 21_000), accuracy: 80 }, T0 + 21_000)));
    expect(announcer.textContent).toBe(said);
    expect(document.activeElement).toBe(button);
  });

  it("moves focus to the heading after a tap", () => {
    const s = startSession(tripOf(oneRide()), T0);
    const send = vi.fn();
    render(ui(fake(s, null, T0, send)));
    const button = screen.getByRole("button", { name: "I boarded Loop A" });
    button.focus();
    fireEvent.click(button);
    expect(send).toHaveBeenCalledWith({ type: "boarded" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
  });
});
