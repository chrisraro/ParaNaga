// @vitest-environment jsdom
// Trip options (Increment E Task 10): one card per mode, one Recommended, the tricycle and padyak
// card states, the soft service-window warning and the route notes with their evidence.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanOptionDto, PlanResponse, TricycleLegDto } from "@/domain/api/plan";
import type { NetworkSnapshot } from "@/domain/api/schemas";
import { TripOptions } from "@/ui/trip/trip-options";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";
import { ETA_MODEL } from "./eta-fixtures";
import { oneRide, streetOnly, walkOnly } from "./guidance-fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const planOf = (options: PlanOptionDto[], jeepneyReason: PlanResponse["plan"]["jeepneyReason"] = null): PlanResponse => ({
  ...(PROVISIONAL_PLAN as unknown as PlanResponse),
  plan: { revisionId: PROVISIONAL_PLAN.revision.revisionId, coverage: "provisional", reason: null, directWalkEstimateMeters: 900, jeepneyReason, options, notes: [] },
  stops: [],
  variants: [],
});
const label = (o: PlanOptionDto, ...labels: PlanOptionDto["labels"]) => ({ ...o, labels });
const tricycle = (labels: PlanOptionDto["labels"] = ["Recommended"], patch: Partial<TricycleLegDto> = {}) => {
  const o = streetOnly("tricycle");
  const leg = { ...(o.legs[0] as TricycleLegDto), notes: ["Avoids the restricted roads we could locate (Ordinance 2006-005/015; allowed 9 pm–5 am)", ...(o.legs[0] as TricycleLegDto).notes], ...patch };
  return { ...o, labels, legs: [leg] } as PlanOptionDto;
};
const open = () => undefined;
const cards = () => screen.getAllByTestId("trip-option");

describe("TripOptions order, labels and the one Recommended card", () => {
  it("shows the planner order and draws exactly one primary card", () => {
    const options = [label(oneRide(), "Fewest transfers"), tricycle(["Recommended"]), label(streetOnly("padyak"), "Short local ride")];
    render(<TripOptions data={planOf(options)} onOpen={open} etaModel={ETA_MODEL} />);
    expect(cards().map((c) => c.dataset.mode)).toEqual(["jeepney", "tricycle", "padyak"]);
    expect(cards().filter((c) => c.className.includes("pn-trip-card--primary"))).toHaveLength(1);
    expect(cards()[1]!.className).toContain("pn-trip-card--primary");
    expect(cards()[1]!.textContent).toContain("Recommended");
  });

  it("a walk card leads below 500 m and is the primary one", () => {
    render(<TripOptions data={planOf([label(walkOnly(), "Recommended"), tricycle([])])} onOpen={open} etaModel={ETA_MODEL} />);
    expect(cards()[0]!.textContent).toContain("Walk ≈ 390 m");
    expect(cards()[0]!.className).toContain("pn-trip-card--primary");
    expect(cards()[1]!.className).not.toContain("pn-trip-card--primary");
  });

  it("opens the option that was tapped", () => {
    const onOpen = vi.fn();
    render(<TripOptions data={planOf([tricycle()])} onOpen={onOpen} />);
    fireEvent.click(cards()[0]!);
    expect(onOpen).toHaveBeenCalledWith("tricycle");
  });
});

describe("tricycle card", () => {
  it("shows the distance along streets, the avoidance line, the minimum fare, Time not estimated and no minutes", () => {
    render(<TripOptions data={planOf([tricycle()])} onOpen={open} etaModel={ETA_MODEL} />);
    const card = cards()[0]!;
    expect(within(card).getByTestId("street-distance").textContent).toBe("≈ 1.5 km along streets");
    expect(within(card).getByTestId("street-restriction").textContent).toMatch(/^Avoids the restricted roads we could locate/);
    expect(within(card).getByTestId("fare-chip").textContent).toBe("Minimum fare ₱15");
    expect(within(card).getByTestId("trip-option-time").textContent).toBe("Time not estimated");
    expect(card.textContent).not.toMatch(/\d\s*min\b|Estimate \d|waiting/);
    expect(card.textContent).not.toMatch(/Unverified route/);
  });

  it("Route not confirmed: a straight-line distance is approximate, not a route, and nothing is avoided", () => {
    const o = tricycle([], { basis: "straight_line", path: null, distanceMeters: 900, notes: ["Route not confirmed: no street route found on the map; straight-line distance shown"] });
    render(<TripOptions data={planOf([o])} onOpen={open} />);
    const card = cards()[0]!;
    expect(within(card).getByTestId("street-state").textContent).toBe("Route not confirmed");
    expect(within(card).getByTestId("street-distance").textContent).toBe("≈ 900 m straight line · approximate, not a route");
    expect(within(card).queryByTestId("street-restriction")).toBeNull();
  });

  it("Street route not available has no distance and does not say offline", () => {
    const o = tricycle([], { basis: "unavailable", path: null, distanceMeters: null, notes: ["Street route not available"] });
    render(<TripOptions data={planOf([o])} onOpen={open} />);
    const card = cards()[0]!;
    expect(within(card).getByTestId("street-state").textContent).toBe("Street route not available");
    expect(within(card).queryByTestId("street-distance")).toBeNull();
    expect(card.textContent).not.toMatch(/offline/i);
  });

  it("the jeepney reason sits above the tricycle card, only when the plan gives one", () => {
    const { rerender } = render(<TripOptions data={planOf([tricycle()], "no_path_near_origin")} onOpen={open} />);
    expect(screen.getByTestId("jeepney-reason").textContent).toBe("No jeepney route passes near your start");
    rerender(<TripOptions data={planOf([tricycle()], null)} onOpen={open} />);
    expect(screen.queryByTestId("jeepney-reason")).toBeNull();
  });
});

describe("padyak card", () => {
  it("shows ₱10 per passenger, the area note and no minutes", () => {
    const o = streetOnly("padyak");
    const leg = { ...o.legs[0]!, notes: ["Area per city ordinance · approximate boundary · service not confirmed today", "Padyak time not estimated"] };
    render(<TripOptions data={planOf([{ ...o, labels: ["Short local ride"], legs: [leg] } as PlanOptionDto])} onOpen={open} />);
    const card = cards()[0]!;
    expect(card.textContent).toContain("Padyak");
    expect(card.textContent).toContain("Short local ride");
    expect(within(card).getByTestId("fare-chip").textContent).toBe("₱10 per passenger");
    expect(within(card).getByTestId("street-area").textContent).toMatch(/^Area per city ordinance/);
    expect(within(card).getByTestId("trip-option-time").textContent).toBe("Time not estimated");
  });
});

describe("jeepney card", () => {
  const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
  const withNote = (): { option: PlanOptionDto; routes: NetworkSnapshot["routes"] } => {
    const base = oneRide();
    const text = "A local reports drivers may turn into side streets on request. Ask the driver.";
    const option = { ...base, legs: base.legs.map((l) => (l.kind === "ride" ? { ...l, notes: [text] } : l)) } as PlanOptionDto;
    const routes = [{ routeCode: "R01", notes: [{ text, evidence: "owner_report_unverified", sourceCodes: ["U02"], near: null }] }] as unknown as NetworkSnapshot["routes"];
    return { option, routes };
  };

  it("shows the soft service-window warning at 22:00 Manila and keeps the option", () => {
    at("2026-10-17T14:00:00Z");
    render(<TripOptions data={planOf([oneRide()])} onOpen={open} etaModel={ETA_MODEL} />);
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]!).getByTestId("service-window-note").textContent).toBe("Outside the usual hours (about 5 am–9 pm) · unconfirmed");
  });

  it("shows no warning inside the usual hours, and none on a walk or tricycle", () => {
    at("2026-10-17T04:00:00Z");
    render(<TripOptions data={planOf([oneRide(), tricycle()])} onOpen={open} etaModel={ETA_MODEL} />);
    expect(screen.queryByTestId("service-window-note")).toBeNull();
    cleanup();
    at("2026-10-17T14:00:00Z");
    render(<TripOptions data={planOf([walkOnly(), tricycle()])} onOpen={open} />);
    expect(screen.queryByTestId("service-window-note")).toBeNull();
  });

  it("an owner-report note is labelled as a local report, unverified", () => {
    at("2026-10-17T04:00:00Z");
    const { option, routes } = withNote();
    render(<TripOptions data={planOf([option])} routes={routes} onOpen={open} etaModel={ETA_MODEL} />);
    const note = within(cards()[0]!).getByTestId("route-note");
    expect(note.textContent).toContain("A local reports drivers may turn into side streets");
    expect(within(note).getByTestId("route-note-evidence").textContent).toBe("Local report · unverified");
  });
});
