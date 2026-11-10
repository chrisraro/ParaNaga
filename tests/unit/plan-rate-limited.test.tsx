// @vitest-environment jsdom
// Audit 2026-10-18: POST /api/v1/plan answers 429 when the rate limit is hit. That is not a bad trip:
// the screen says to wait and try again (calm copy, a retry), never "Both points must be in Naga City".
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import type { PlanEnd } from "@/domain/trip/replan";
import { TripError } from "@/ui/trip/trip-status";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";

const end = (point: { lat: number; lng: number }): PlanEnd => ({ point, source: "pick" }) as unknown as PlanEnd;
const ORIGIN = end({ lat: 13.6224, lng: 123.1838 });
const DESTINATION = end({ lat: 13.6305, lng: 123.1912 });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: { code: "too_many_requests", message: "Plan rate limit exceeded", requestId: "r" } }), { status: 429 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a rate-limited plan request (429)", () => {
  it("settles as the 'busy' error, not 'invalid'", async () => {
    const { result } = renderHook(() => useTripPlan(ORIGIN, DESTINATION));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ status: "error", kind: "busy" });
  });

  it("shows calm copy with Try again (a retry can succeed), never the out-of-city message", () => {
    const onRetry = vi.fn();
    const onChange = vi.fn();
    render(<TripError kind="busy" onRetry={onRetry} onChangeEndpoints={onChange} />);
    expect(screen.getByTestId("trip-error").textContent).not.toMatch(/Naga City|went wrong/);
    expect(screen.getByRole("heading").textContent).toMatch(/many trip searches/i);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// Audit 2026-11-10: a background refresh (a refined GPS point, a tricycle rule boundary) that fails
// must not turn the plan on screen into an error card; the plan stays, marked as not updated.
describe("a failed refresh of a plan that is on screen", () => {
  const gps = (lat: number): PlanEnd => ({ point: { lat, lng: 123.1838 }, source: "gps" }) as unknown as PlanEnd;
  const HERE = gps(13.6224);
  const MOVED = gps(13.6229); // about 55 m on: a GPS refinement, so a refresh
  /** Plan requests answered in order: true = the plan, false = 429. Later ones repeat the last. */
  function planAnswers(...ok: boolean[]) {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url !== "/api/v1/plan") return new Response("{}", { status: 404 });
        const good = ok[Math.min(n++, ok.length - 1)];
        return new Response(JSON.stringify(good ? PROVISIONAL_PLAN : {}), { status: good ? 200 : 429 });
      }),
    );
  }
  const renderPlan = () =>
    renderHook(({ s, d }: { s: PlanEnd; d: PlanEnd }) => useTripPlan(s, d), { initialProps: { s: HERE, d: DESTINATION } });

  it("keeps the ready plan and flags it as not updated, then recovers when back online", async () => {
    planAnswers(true, false, true);
    const hook = renderPlan();
    await waitFor(() => expect(hook.result.current).toMatchObject({ status: "ready", refresh: { status: "current" } }));
    const options = hook.result.current.status === "ready" ? hook.result.current.data.plan.options.map((o) => o.id) : [];

    hook.rerender({ s: MOVED, d: DESTINATION });
    await waitFor(() => expect(hook.result.current).toMatchObject({ status: "ready", refresh: { status: "failed", kind: "busy" } }));
    expect(hook.result.current.status === "ready" && hook.result.current.data.plan.options.map((o) => o.id)).toEqual(options);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(hook.result.current).toMatchObject({ status: "ready", refresh: { status: "current" } }));
  });

  it("a failed load for a deliberately changed end is still the error", async () => {
    planAnswers(true, false);
    const hook = renderPlan();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    hook.rerender({ s: HERE, d: end({ lat: 13.6195, lng: 123.1951 }) });
    await waitFor(() => expect(hook.result.current).toMatchObject({ status: "error", kind: "busy" }));
  });
});
