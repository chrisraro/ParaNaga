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
