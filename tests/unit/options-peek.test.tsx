// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { offlinePlanChip } from "@/domain/pwa/offline-copy";
import { UndoButton } from "@/ui/guidance/guidance-parts";
import { OptionsPeek } from "@/ui/trip/trip-options";
import { FareShort } from "@/ui/trip/trip-parts";
import { PROVISIONAL_PLAN, SHORT_JEEP_PASSES_PLAN, TRICYCLE_RECOMMENDED_PLAN } from "../e2e/fixtures/plan-responses";

const data = planResponseSchema.parse(PROVISIONAL_PLAN);
const noop = () => undefined;
afterEach(cleanup);

describe("OptionsPeek", () => {
  it("shows the staleness notes at the peek, outside the inert list, and not once the list is visible", () => {
    const notes = ["Changed since saved", offlinePlanChip("2026-10-15T12:59:57.089Z")];
    const { rerender } = render(<OptionsPeek data={data} expanded={false} listShown={false} notes={notes} onToggle={noop} />);
    expect(screen.getAllByTestId("options-peek-note").map((n) => n.textContent)).toEqual(["Changed since saved", "Offline plan, data of Oct 15, 2026"]);
    rerender(<OptionsPeek data={data} expanded={false} listShown notes={notes} onToggle={noop} />);
    expect(screen.queryByTestId("options-peek-note")).toBeNull();
  });

  it("the toggle reads expanded whenever the list is visible (half or full)", () => {
    const { rerender } = render(<OptionsPeek data={data} expanded={false} listShown={false} onToggle={noop} />);
    expect(screen.getByTestId("options-toggle").getAttribute("aria-expanded")).toBe("false");
    rerender(<OptionsPeek data={data} expanded={false} listShown onToggle={noop} />);
    expect(screen.getByTestId("options-toggle").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("OptionsPeek names the Recommended option, not the first card", () => {
  it("a trip of 1.26 km: the tricycle is Recommended, so the peek reads the tricycle", () => {
    const plan = planResponseSchema.parse(TRICYCLE_RECOMMENDED_PLAN);
    expect(plan.plan.options[0]!.mode).toBe("jeepney");
    render(<OptionsPeek data={plan} expanded={false} listShown={false} onToggle={noop} />);
    const best = screen.getByTestId("options-best").textContent ?? "";
    expect(best).toContain("Tricycle");
    expect(best).not.toContain("Loop");
    expect(best).toContain("Time not estimated");
    expect(best).not.toContain("waiting");
    // A tricycle is not a jeepney ride: no unverified-route chip.
    expect(screen.queryByTestId("options-best-unverified")).toBeNull();
  });

  it("under 500 m with a jeepney passing the destination: the peek reads that jeepney, not the walk card", () => {
    const plan = planResponseSchema.parse(SHORT_JEEP_PASSES_PLAN);
    expect(plan.plan.options[0]!.mode).toBe("walk");
    render(<OptionsPeek data={plan} expanded={false} listShown={false} onToggle={noop} />);
    const best = screen.getByTestId("options-best").textContent ?? "";
    expect(best).not.toContain("Walk");
    expect(screen.getByTestId("options-best-unverified").textContent).toBe("Unverified route");
  });
});

describe("OptionsPeek with nothing Recommended (review I1)", () => {
  it("says how many options there are and never announces a best option", () => {
    const plan = planResponseSchema.parse(TRICYCLE_RECOMMENDED_PLAN);
    const unlabelled = { ...plan, plan: { ...plan.plan, options: plan.plan.options.map((o) => ({ ...o, labels: [] })) } };
    render(<OptionsPeek data={unlabelled} expanded={false} listShown={false} onToggle={noop} />);
    expect(screen.getByTestId("options-count").textContent).toBe(`${plan.plan.options.length} options`);
    expect(screen.queryByTestId("options-best")).toBeNull();
    expect(screen.getByTestId("options-peek").textContent).not.toContain("Best option");
  });
});

describe("spoken names", () => {
  it("a fare range is spoken like the time range", () => {
    render(<FareShort fare={{ status: "estimate", minCentavos: 1400, maxCentavos: 1700 }} />);
    expect(screen.getByRole("img", { name: "₱14 to ₱17" }).textContent).toBe("₱14–₱17");
  });
  it("Undo says what it undoes", () => {
    render(<UndoButton undo={{ label: "Undo", event: { type: "back" } } as never} onSend={noop} />);
    expect(screen.getByRole("button", { name: "Undo last step" }).textContent).toBe("Undo");
  });
});
