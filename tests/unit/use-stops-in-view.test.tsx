// @vitest-environment jsdom
// Home pins from the snapshot (decision D2): one head + one snapshot request, then every view is
// filtered in memory; no map view ever goes to the server.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STOP_PINS, useStopsInView } from "@/client/map/use-stops-in-view";
import { resetSnapshotForTests } from "@/client/network/use-snapshot";
import type { Bounds } from "@/domain/geo/types";
import snapshot from "../e2e/fixtures/network/snapshot.json";

const VIEW_A: Bounds = { west: 123.1801, south: 13.6201, east: 123.1899, north: 13.6299 };
const VIEW_A_PAN: Bounds = { west: 123.1812, south: 13.6215, east: 123.1888, north: 13.6281 }; // same grid cell
const VIEW_B: Bounds = { west: 123.1901, south: 13.6301, east: 123.1999, north: 13.6399 };
const CITY: Bounds = { west: 123.1, south: 13.55, east: 123.35, north: 13.7 };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let answer: (url: string) => Response | Promise<Response>;
const fetchMock = vi.fn((url: string) => Promise.resolve(answer(url)));
const urls = () => fetchMock.mock.calls.map((c) => c[0]);

beforeEach(() => {
  resetSnapshotForTests();
  fetchMock.mockClear();
  answer = (url) => (url === "/api/v1/network/head" ? json(snapshot.revision) : url.startsWith("/api/v1/network/snapshot/") ? json(snapshot) : json({}, 404));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const inBox = (b: Bounds) => snapshot.stops.filter((s) => s.lng >= b.west && s.lng <= b.east && s.lat >= b.south && s.lat <= b.north);

describe("useStopsInView", () => {
  it("reads the head, then the snapshot of that revision, and shows the pins in the snapped view", async () => {
    const { result } = renderHook(() => useStopsInView(VIEW_A));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(urls()).toEqual(["/api/v1/network/head", `/api/v1/network/snapshot/${snapshot.revision.revisionId}`]);
    // Snapped to the 0.005° grid: 123.18,13.62 → 123.19,13.63.
    const expected = inBox({ west: 123.18, south: 13.62, east: 123.19, north: 13.63 });
    expect(result.current.stops.map((s) => s.id)).toEqual(expected.map((s) => s.id));
    expect(result.current.stops.length).toBeGreaterThan(0);
    const a1 = result.current.stops.find((s) => s.source.code === "A1" && s.source.layer === "Loop Service A");
    expect(a1?.routeCodes).toEqual(["R8-A"]);
    expect(result.current.truncated).toBe(false);
  });

  it("never asks the server for a view: pans and new views are filtered in memory", async () => {
    const { result, rerender } = renderHook(({ v }) => useStopsInView(v), { initialProps: { v: VIEW_A } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ v: VIEW_A_PAN });
    rerender({ v: VIEW_B });
    expect(result.current.stops.map((s) => s.id)).toEqual(inBox({ west: 123.19, south: 13.63, east: 123.2, north: 13.64 }).map((s) => s.id));
    rerender({ v: CITY });
    expect(result.current.stops).toHaveLength(128);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls().some((u) => u.includes("bbox"))).toBe(false);
  });

  it(`draws at most ${MAX_STOP_PINS} pins and says so`, async () => {
    const stop = snapshot.stops[0]!;
    const many = Array.from({ length: MAX_STOP_PINS + 1 }, (_, i) => ({ ...stop, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    answer = (url) => (url === "/api/v1/network/head" ? json(snapshot.revision) : json({ ...snapshot, stops: many, variants: [] }));
    const { result } = renderHook(() => useStopsInView(CITY));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stops).toHaveLength(MAX_STOP_PINS);
    expect(result.current.truncated).toBe(true);
  });

  it("a failed load is an error; the next map move tries again", async () => {
    answer = () => json({ error: {} }, 503);
    const { result, rerender } = renderHook(({ v }) => useStopsInView(v), { initialProps: { v: VIEW_A } });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.stops).toEqual([]);
    answer = (url) => (url === "/api/v1/network/head" ? json(snapshot.revision) : json(snapshot));
    await act(async () => rerender({ v: { ...VIEW_A } }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("with no network and no revision stored on the phone, it reports an error", async () => {
    answer = () => {
      throw new TypeError("Failed to fetch");
    };
    const { result } = renderHook(() => useStopsInView(VIEW_A));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("is idle while disabled or without a view", async () => {
    const { result, rerender } = renderHook(({ v, on }) => useStopsInView(v, on), { initialProps: { v: VIEW_A as Bounds | null, on: false } });
    expect(result.current).toEqual({ stops: [], status: "idle", truncated: false });
    rerender({ v: null, on: true });
    expect(result.current.status).toBe("idle");
    rerender({ v: VIEW_A, on: false });
    await act(async () => undefined);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("snapshot")).length).toBeLessThanOrEqual(1);
  });
});
