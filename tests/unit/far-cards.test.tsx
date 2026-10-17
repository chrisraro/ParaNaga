// @vitest-environment jsdom
// Increment F, T6: the cards for vias, the access option, the special trip and the far note. Fixtures are the
// plan shapes the planner produces (tests/e2e/fixtures/plan-responses.ts, schema-checked here).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLinesForTests } from "@/client/network/use-lines";
import { resetPrefs } from "@/client/prefs/use-prefs";
import { planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import { guidanceSteps } from "@/domain/guidance/steps";
import { enrichPlan } from "@/domain/trip/enrich";
import { highlightsFor } from "@/ui/home/home-screen";
import { TripDetail } from "@/ui/trip/trip-detail";
import { OptionsPeek, TripOptions } from "@/ui/trip/trip-options";
import { ACCESS_PLAN, FRANCIA_NOTE, SPECIAL_ONLY_PLAN, SPECIAL_TRIP_PLAN, VIA_PLAN } from "../e2e/fixtures/plan-responses";
import { ETA_MODEL, manila } from "./eta-fixtures";

vi.mock("@/client/saved/use-saved-trip-toggle", () => ({
  useSavedTripToggle: () => ({ match: null, kind: "none", waiting: false, unavailable: false, toggle: async () => undefined }),
}));

beforeEach(() => {
  window.localStorage.clear();
  resetPrefs();
  resetLinesForTests();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(manila("09:30"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const load = (plan: unknown): PlanResponse => enrichPlan(planResponseSchema.parse(plan) as PlanResponse, null, { walkGraphStatus: "skipped" });
const noop = () => undefined;
const cards = () => screen.getAllByTestId("trip-option");

describe("jeepney cards with a via", () => {
  it("each Del Rosario route shows its via chip; R2 keeps the Francia line for the detail", () => {
    render(<TripOptions data={load(VIA_PLAN)} onOpen={noop} etaModel={ETA_MODEL} />);
    const chips = screen.getAllByTestId("card-via").map((c) => c.textContent);
    expect(chips).toEqual(["via Magsaysay", "via Roxas (Diversion)", "via Panganiban"]);
    for (const card of cards().filter((c) => c.dataset.mode === "jeepney")) {
      expect(within(card).getByTestId("card-via")).toBeTruthy();
      expect(card.textContent).toContain("Unverified route");
      expect(card.textContent).not.toContain("Francia");
    }
    expect(cards().find((c) => c.dataset.mode === "tricycle")!.textContent).not.toContain("via");
  });

  it("the detail names the via and R2's unconfirmed local name; the other vias have no such line", () => {
    const data = load(VIA_PLAN);
    const show = (i: number) => {
      cleanup();
      render(<TripDetail data={data} option={data.plan.options[i]!} onBack={noop} etaModel={ETA_MODEL} />);
      return screen.getByTestId("detail-via").textContent;
    };
    expect(show(0)).toBe(`via Magsaysay · ${FRANCIA_NOTE}`);
    expect(show(1)).toBe("via Roxas (Diversion)");
    expect(show(2)).toBe("via Panganiban");
  });
});

describe("the access card", () => {
  const access = () => {
    render(<TripOptions data={load(ACCESS_PLAN)} onOpen={noop} etaModel={ETA_MODEL} />);
    return cards()[0]!;
  };

  it("names the tricycle and the jeep, says why, and prices from the sum with no maximum", () => {
    const card = access();
    expect(card.dataset.mode).toBe("jeepney");
    expect(card.querySelector("strong")!.textContent).toBe("Tricycle, then Jeep R6");
    expect(screen.getByTestId("access-line").textContent).toBe("Tricycle to the jeepney station, then ride R6. For when you'd rather not walk.");
    expect(screen.getByTestId("access-tricycle").textContent).toBe("Tricycle min ₱15 · confirm with the driver");
    expect(screen.getByTestId("fare-chip").textContent).toBe("From ₱33");
    expect(card.textContent).not.toMatch(/Est\.Estimate ₱|₱33–|Minimum fare/);
  });

  it("keeps the waiting unknown and the caution; the tricycle part gets no minutes", () => {
    const card = access();
    expect(card.textContent).toContain("waiting (unknown)");
    expect(card.textContent).toContain("tricycle time not estimated");
    expect(card.textContent).toContain("Unverified route");
    expect(card.textContent).not.toMatch(/No transfers|Fare n\/a/);
  });

  it("the peek of a plan whose only option is the access one names the whole option", () => {
    render(<OptionsPeek data={load(ACCESS_PLAN)} expanded={false} listShown={false} onToggle={noop} etaModel={ETA_MODEL} />);
    const best = screen.getByTestId("options-best").textContent ?? "";
    expect(best).toContain("Tricycle, then Jeep R6");
    expect(best).toContain("From ₱33");
    expect(best).not.toContain("Time not estimated");
  });

  it("the detail has the tricycle step to the loading point, the fare rows and the total", () => {
    const data = load(ACCESS_PLAN);
    render(<TripDetail data={data} option={data.plan.options[0]!} onBack={noop} etaModel={ETA_MODEL} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Tricycle, then Jeep R6");
    const steps = within(screen.getByRole("list", { name: "Trip steps" })).getAllByRole("listitem");
    expect(steps[0]!.textContent).toContain("Take a tricycle to Jeepney station to Pacol");
    expect(steps[0]!.textContent).toContain("Minimum fare ₱15 (Ordinance 2024-002)");
    expect(steps[0]!.textContent).toContain("Tricycle time not estimated");
    const rows = screen.getAllByTestId("leg-fare").map((r) => r.textContent);
    expect(rows[0]).toBe("TricycleMinimum fare ₱15 · confirm with the driver");
    expect(rows[1]).toMatch(/^R6/);
    expect(screen.getByRole("region", { name: "Fare estimate" }).textContent).toContain("TotalFrom ₱33");
    expect(screen.getByTestId("trip-detail-header").textContent).toContain("From ₱33");
  });

  it("the map names the loading point where the tricycle drops off", () => {
    const hl = highlightsFor(load(ACCESS_PLAN), ACCESS_PLAN.plan.options[0]!.id);
    expect(hl[0]).toMatchObject({ role: "alight", label: "Jeepney station to Pacol" });
    expect(hl).toHaveLength(3);
  });

  it("guidance: the tricycle step ends at the loading point, then the walk, the ride and the walk", () => {
    const data = load(ACCESS_PLAN);
    const steps = guidanceSteps({ option: data.plan.options[0]!, stops: [], variants: [], destinationLabel: "Pacol" });
    expect(steps.map((s) => s.kind)).toEqual(["street_ride", "walk_to_board", "ride", "walk_to_destination"]);
    const first = steps[0]!;
    if (first.kind !== "street_ride") throw new Error("first step");
    expect(first.text).toBe("Take a tricycle to Jeepney station to Pacol · about 2.9 km along streets · minimum fare ₱15 (Ordinance 2024-002) · confirm with the driver");
    expect(first.notes).toContain("Tricycle time not estimated");
  });
});

describe("the special-trip card", () => {
  const special = () => {
    render(<TripOptions data={load(SPECIAL_TRIP_PLAN)} onOpen={noop} etaModel={ETA_MODEL} />);
    return cards().find((c) => c.dataset.mode === "tricycle")!;
  };

  it("says special trip, fare not fixed, the terminal as a local report, and never a fare or minutes", () => {
    const card = special();
    expect(card.className).not.toContain("primary");
    const lines = within(card).getAllByTestId("street-special").map((l) => l.textContent);
    expect(lines).toEqual(["Special trip · fare not fixed", "From Balatas Tricycle Terminal: local report, unconfirmed"]);
    expect(within(card).getByTestId("fare-chip").textContent).toBe("Fare not fixed");
    expect(card.textContent).toContain("Time not estimated");
    expect(card.textContent).not.toMatch(/₱|Est\.|Minimum fare|Fare n\/a|unavailable/);
  });

  it("the detail does not call it unavailable", () => {
    const data = load(SPECIAL_TRIP_PLAN);
    render(<TripDetail data={data} option={data.plan.options[1]!} onBack={noop} etaModel={ETA_MODEL} />);
    expect(screen.getByTestId("leg-fare").textContent).toBe("TricycleFare not fixed · confirm with the driver");
    expect(screen.getByTestId("trip-detail-header").textContent).toContain("Fare not fixed");
    expect(screen.getByTestId("street-notes").textContent).toContain("From Balatas Tricycle Terminal: local report, unconfirmed");
  });
});

describe("the far note", () => {
  it("sits above the cards with its evidence label and reads as a sentence", () => {
    render(<TripOptions data={load(SPECIAL_TRIP_PLAN)} onOpen={noop} etaModel={ETA_MODEL} />);
    const note = screen.getByTestId("far-note");
    expect(note.textContent).toBe(
      "Local report: " +
        "Tricycles to Cararayan and San Isidro charge special-trip fares, so we point you to the jeepney terminal instead. " +
        "A special-trip tricycle is listed only if you still want one.",
    );
    expect(note.querySelector(".pn-trip-farnote__label")!.textContent).toBe("Local report");
    expect(note.compareDocumentPosition(screen.getByRole("list")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is also in the trip detail, and absent when the plan has none", () => {
    const data = load(ACCESS_PLAN);
    render(<TripDetail data={data} option={data.plan.options[0]!} onBack={noop} etaModel={ETA_MODEL} />);
    expect(screen.getByTestId("far-note").textContent).toContain("Tricycles to Pacol");
    expect(screen.getByTestId("far-note").textContent).not.toContain("is listed"); // the access card says itself that it goes to the jeepney
    cleanup();
    render(<TripOptions data={load(VIA_PLAN)} onOpen={noop} etaModel={ETA_MODEL} />);
    expect(screen.queryByTestId("far-note")).toBeNull();
  });
});

describe("nothing Recommended", () => {
  it("the options list has no primary card, the reason line stays, and the peek counts the options", () => {
    const data = load(SPECIAL_ONLY_PLAN);
    render(<TripOptions data={data} onOpen={noop} etaModel={ETA_MODEL} />);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.className).not.toContain("primary");
    expect(screen.getByTestId("jeepney-reason").textContent).toBe("No jeepney route passes near your destination");
    cleanup();
    render(<OptionsPeek data={data} expanded={false} listShown={false} onToggle={noop} etaModel={ETA_MODEL} />);
    expect(screen.getByTestId("options-count").textContent).toBe("1 option");
    expect(screen.queryByTestId("options-best")).toBeNull();
  });

  it("two options and none Recommended read '2 options', not a best option", () => {
    const base = load(SPECIAL_TRIP_PLAN);
    const none = { ...base, plan: { ...base.plan, options: base.plan.options.map((o) => ({ ...o, labels: [] })) } };
    render(<OptionsPeek data={none} expanded={false} listShown={false} onToggle={noop} etaModel={ETA_MODEL} />);
    expect(screen.getByTestId("options-count").textContent).toBe("2 options");
  });
});
