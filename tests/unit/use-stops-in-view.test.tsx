// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STOP_PINS, STOPS_DEBOUNCE_MS, useStopsInView } from "@/client/map/use-stops-in-view";
import type { Bounds } from "@/domain/geo/types";
import stopsAll from "../e2e/fixtures/network/stops-all.json";

const VIEW_A: Bounds = { west: 123.1801, south: 13.6201, east: 123.1899, north: 13.6299 };
const VIEW_A_PAN: Bounds = { west: 123.1812, south: 13.6215, east: 123.1888, north: 13.6281 }; // same grid cell
const VIEW_B: Bounds = { west: 123.1901, south: 13.6301, east: 123.1999, north: 13.6399 };

type Pending = { url: string; signal: AbortSignal; resolve: (r: Response) => void; reject: (e: unknown) => void };
let pending: Pending[] = [];
const fetchMock = vi.fn((url: string, init: { signal: AbortSignal }) =>
  new Promise<Response>((resolve, reject) => {
    pending.push({ url, signal: init.signal, resolve, reject });
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }),
);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function settle(i: number, body: unknown, status = 200) {
  await act(async () => {
    pending[i]!.resolve(json(body, status));
    await Promise.resolve();
  });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useStopsInView", () => {
  it("waits for the debounce, then requests the snapped bbox", async () => {
    const { result } = renderHook(() => useStopsInView(VIEW_A));
    expect(result.current.status).toBe("loading");
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS - 1));
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pending[0]!.url).toBe(`/api/v1/stops?bbox=${encodeURIComponent("123.18,13.62,123.19,13.63")}`);
    await settle(0, stopsAll);
    expect(result.current.status).toBe("ready");
    expect(result.current.stops).toHaveLength(128);
    expect(result.current.truncated).toBe(false);
  });

  it("debounces rapid view changes into one request and aborts a superseded one", async () => {
    const { rerender } = renderHook(({ v }) => useStopsInView(v), { initialProps: { v: VIEW_A } });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: VIEW_B });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pending[0]!.url).toContain(encodeURIComponent("123.19,13.63,123.2,13.64"));

    rerender({ v: VIEW_A });
    expect(pending[0]!.signal.aborted).toBe(true);
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached view and does not refetch for a pan inside the same grid cell", async () => {
    const { result, rerender } = renderHook(({ v }) => useStopsInView(v), { initialProps: { v: VIEW_A } });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    await settle(0, stopsAll);
    rerender({ v: VIEW_A_PAN });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("keeps the pins already shown when a later request fails or is invalid", async () => {
    const { result, rerender } = renderHook(({ v }) => useStopsInView(v), { initialProps: { v: VIEW_A } });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    await settle(0, stopsAll);
    rerender({ v: VIEW_B });
    expect(result.current.stops).toHaveLength(128); // loading the new view: old pins stay
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    await settle(1, { nope: true });
    expect(result.current.status).toBe("error");
    expect(result.current.stops).toHaveLength(128);
  });

  it("caps the pins it returns", async () => {
    const many = { ...stopsAll, stops: Array.from({ length: MAX_STOP_PINS + 5 }, (_, i) => ({ ...stopsAll.stops[i % 128]! })) };
    const { result } = renderHook(() => useStopsInView(VIEW_A));
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    await settle(0, many);
    expect(result.current.stops).toHaveLength(MAX_STOP_PINS);
    expect(result.current.truncated).toBe(true);
  });

  it("requests nothing while disabled or with no view, and never logs", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const { result, rerender } = renderHook(({ v, on }) => useStopsInView(v, on), {
      initialProps: { v: null as Bounds | null, on: true },
    });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS * 2));
    expect(result.current.status).toBe("idle");
    rerender({ v: VIEW_A, on: false });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS * 2));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.stops).toEqual([]);
    rerender({ v: VIEW_A, on: true });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    await settle(0, {}, 500);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("useStopsInView retry", () => {
  it("retries a failed view on the next map move, even inside the same grid cell", async () => {
    const { result, rerender } = renderHook(({ v }) => useStopsInView(v), { initialProps: { v: VIEW_A } });
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    await settle(0, {}, 503);
    expect(result.current.status).toBe("error");
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry loop without a move
    rerender({ v: { ...VIEW_A_PAN } });
    expect(result.current.status).toBe("loading");
    act(() => vi.advanceTimersByTime(STOPS_DEBOUNCE_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(1, stopsAll);
    expect(result.current.status).toBe("ready");
  });
});
