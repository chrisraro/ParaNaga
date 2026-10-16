// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLinesForTests } from "@/client/network/use-lines";
import { resetPrefs, updatePrefs } from "@/client/prefs/use-prefs";
import { PATH_LABEL, linesSchema } from "@/domain/api/schemas";
import type { PlanResponse } from "@/domain/api/plan";
import { enrichPlan } from "@/domain/trip/enrich";
import { TERMINAL_ACCESS_NOTE, UNTRACED_RIDE_LABEL } from "@/ui/map/line-rules";
import { TripDetail } from "@/ui/trip/trip-detail";
import linesFixture from "../e2e/fixtures/network/lines.json";
import { PROVISIONAL_PLAN, TWO_RIDE_PLAN } from "../e2e/fixtures/plan-responses";
import { ETA_MODEL, manila } from "./eta-fixtures";

const REV_ID = PROVISIONAL_PLAN.revision.revisionId;
const LINES = linesSchema.parse(linesFixture);
const fetchMock = vi.fn(async (url: string) =>
  url === `/api/v1/network/lines/${REV_ID}`
    ? new Response(JSON.stringify(LINES), { status: 200, headers: { "content-type": "application/json" } })
    : new Response("{}", { status: 404 }),
);

beforeEach(() => {
  window.localStorage.clear();
  resetPrefs();
  resetLinesForTests();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const plan = PROVISIONAL_PLAN as unknown as PlanResponse;
const two = TWO_RIDE_PLAN as unknown as PlanResponse;

describe("TripDetail ride path labels (T12-5) and notes (T12-2)", () => {
  it("in low-data mode (no lines loaded) a ride along a published path is not called untraced; a straight-line ride is", async () => {
    updatePrefs({ lowData: true });
    const data = enrichPlan(two, null, { walkGraphStatus: "skipped" });
    render(<TripDetail data={data} option={data.plan.options[0]!} onBack={() => undefined} />);
    const labels = screen.getAllByTestId("ride-path-label").map((el) => el.textContent);
    expect(labels).toEqual([PATH_LABEL, UNTRACED_RIDE_LABEL]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the terminal access note for a ride that uses a terminal access road", async () => {
    const data = enrichPlan(plan, null, { walkGraphStatus: "skipped" });
    render(<TripDetail data={data} option={data.plan.options[1]!} onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("ride-terminal-access").textContent).toBe(TERMINAL_ACCESS_NOTE));
    expect(screen.queryByTestId("ride-oneway-caution")).toBeNull();
  });
});

describe("TripDetail street-path status (Minor: polite announcement)", () => {
  it("announces loading street paths politely, then that they were updated", () => {
    const loading = enrichPlan(plan, null, { walkGraphStatus: "loading" });
    const view = render(<TripDetail data={loading} option={loading.plan.options[0]!} onBack={() => undefined} />);
    const status = screen.getByTestId("trip-paths-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("Loading street paths…");

    const ready = enrichPlan(plan, null, { walkGraphStatus: "error" });
    view.rerender(<TripDetail data={ready} option={ready.plan.options[0]!} onBack={() => undefined} />);
    expect(screen.getByTestId("trip-paths-status").textContent).toBe("Street paths updated");
  });
});

describe("TripDetail time estimates (Task 14 fixes: basis, fleet evidence, spoken ranges)", () => {
  afterEach(() => vi.useRealTimers());
  const at = (hhmm: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(manila(hhmm));
  };

  it("total and leg ranges are spoken in words; the legs say only what is needed", () => {
    at("09:30");
    const data = enrichPlan(two, null, { walkGraphStatus: "skipped" });
    render(<TripDetail data={data} option={data.plan.options[0]!} onBack={() => undefined} etaModel={ETA_MODEL} />);
    const total = screen.getByTestId("trip-detail-time");
    const shown = total.textContent!;
    expect(total.querySelector("[aria-hidden='true'], .sr-only")).toBeNull(); // the text is in the DOM once
    expect(shown).toMatch(/^Estimate (\d+)–(\d+) min \+ waiting \(unknown, 2 rides\)$/);
    const [, lo, hi] = /(\d+)–(\d+)/.exec(shown)!;
    expect(total.querySelector("[role='img']")!.getAttribute("aria-label")).toBe(`${lo} to ${hi} minutes`);
    expect(total.querySelector("[role='img']")!.textContent).toBe(`${lo}–${hi} min`);
    expect(screen.queryByTestId("trip-peak-note")).toBeNull();

    const legs = screen.getAllByTestId("leg-time").map((el) => el.textContent);
    const rides = legs.filter((t) => t!.includes(" ride"));
    expect(rides).toEqual([expect.stringMatching(/^≈ \d+–\d+ min ride$/), expect.stringMatching(/^≈ \d+–\d+ min ride$/)]);
    expect(legs.filter((t) => t!.includes(" walk")).every((t) => /^≈ \d+–\d+ min walk · path not verified$/.test(t!))).toBe(true);
    for (const el of screen.getAllByTestId("leg-time")) expect(el.querySelector("[role='img']")!.getAttribute("aria-label")).toMatch(/^\d+ to \d+ minutes$/);
  });

  it("each ride shows its vehicle classes with their evidence label and date", () => {
    at("09:30");
    const data = enrichPlan(plan, null, { walkGraphStatus: "skipped" });
    render(<TripDetail data={data} option={data.plan.options[0]!} onBack={() => undefined} etaModel={ETA_MODEL} />);
    const ride = data.plan.options[0]!.legs.find((l) => l.kind === "ride")!;
    if (ride.kind !== "ride") throw new Error("ride");
    expect(screen.getAllByTestId("ride-fleet-class").map((el) => el.textContent)).toEqual(ride.fleet.classes.map((c) => c.label.split(" · ")[0]));
    expect(ride.fleet.classes[0]!.label).toMatch(/^Traditional jeepney · operating \(owner-confirmed \w+ \d{4}\)$/);
  });

  it("at 07:10 Manila the peak band is used and the peak note shows; no model → Time not available, no sheet link", () => {
    at("07:10");
    const data = enrichPlan(plan, null, { walkGraphStatus: "skipped" });
    const view = render(<TripDetail data={data} option={data.plan.options[0]!} onBack={() => undefined} etaModel={ETA_MODEL} />);
    expect(screen.getByTestId("trip-peak-note").textContent).toBe("Peak hours: slower (06:00–08:00)");
    view.rerender(<TripDetail data={data} option={data.plan.options[0]!} onBack={() => undefined} etaModel={null} />);
    expect(screen.getByTestId("trip-detail-time").textContent).toBe("Time not available");
    expect(screen.queryByTestId("how-times-estimated-btn")).toBeNull();
  });
});
