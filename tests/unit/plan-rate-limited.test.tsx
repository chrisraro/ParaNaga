// @vitest-environment jsdom
// Audit 2026-10-18: POST /api/v1/plan answers 429 when the rate limit is hit. That is not a bad trip:
// the screen says to wait and try again (calm copy, a retry), never "Both points must be in Naga City".
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import type { PlanEnd } from "@/domain/trip/replan";
import { TripError } from "@/ui/trip/trip-status";

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
