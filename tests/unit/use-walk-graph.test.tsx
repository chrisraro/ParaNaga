// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { resetLinesForTests, useLines } from "@/client/network/use-lines";
import { resetWalkGraphForTests, useSavedWalkLengths, useWalkGraph, useWalkGraphDownload } from "@/client/network/use-walk-graph";
import { resetPrefs, updatePrefs } from "@/client/prefs/use-prefs";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import { WALK_LOADING_LABEL, WALK_OFFLINE_LABEL, WALK_PATH_LABEL } from "@/domain/trip/enrich";
import { WALK_PATHS_OFFLINE_NOTE } from "@/domain/pwa/offline-copy";
import type { PlanEnd } from "@/domain/trip/replan";
import linesFixture from "../e2e/fixtures/network/lines.json";
import walkGraphFixture from "../e2e/fixtures/network/walk-graph.json";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";

const REV_ID = PROVISIONAL_PLAN.revision.revisionId;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable" },
  });

let delayWalkGraph: (() => void) | null = null;
const fetchMock = vi.fn(async (url: string) => {
  if (url === "/api/v1/plan") return json(PROVISIONAL_PLAN);
  if (url === `/api/v1/network/walk-graph/${REV_ID}`) {
    if (delayWalkGraph) {
      await new Promise<void>((resolve) => {
        delayWalkGraph = resolve;
      });
    }
    return json(walkGraphFixture);
  }
  if (url === `/api/v1/network/lines/${REV_ID}`) return json(linesFixture);
  return json({}, 404);
});

beforeEach(() => {
  window.localStorage.clear();
  resetPrefs();
  resetWalkGraphForTests();
  resetLinesForTests();
  delayWalkGraph = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useWalkGraph and useLines (Task 10, D18)", () => {
  it("does not fetch before a plan exists (revisionId is null or hook disabled)", async () => {
    const a = renderHook(() => useWalkGraph(null));
    const b = renderHook(() => useWalkGraph(REV_ID, false));
    await act(async () => undefined);
    expect(a.result.current.status).toBe("idle");
    expect(b.result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch in low-data mode or when navigator.connection.saveData is true", async () => {
    updatePrefs({ lowData: true });
    const wg = renderHook(() => useWalkGraph(REV_ID));
    const ln = renderHook(() => useLines(REV_ID));
    await act(async () => undefined);
    expect(wg.result.current.status).toBe("skipped");
    expect(wg.result.current.graph).toBeNull();
    expect(ln.result.current.status).toBe("skipped");
    expect(ln.result.current.lines).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    updatePrefs({ lowData: false });
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true },
      configurable: true,
    });
    const saved = renderHook(() => useWalkGraph(REV_ID));
    await act(async () => undefined);
    expect(saved.result.current.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
  });

  it("fetches with the revision id only (never coordinates) and shares the decoded graph and lines in memory", async () => {
    const a = renderHook(() => useWalkGraph(REV_ID));
    const b = renderHook(() => useWalkGraph(REV_ID));
    const l = renderHook(() => useLines(REV_ID));
    await waitFor(() => expect(a.result.current.status).toBe("ready"));
    await waitFor(() => expect(l.result.current.status).toBe("ready"));
    expect(b.result.current.status).toBe("ready");
    expect(a.result.current.graph?.roadSource).toBe("OSMR-2026-10-16");
    expect(l.result.current.lines?.lines.length).toBeGreaterThan(0);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([`/api/v1/network/walk-graph/${REV_ID}`, `/api/v1/network/lines/${REV_ID}`]);
    for (const u of urls) {
      expect(u).not.toContain("?");
      expect(u).not.toMatch(/13\.|123\./);
    }
  });

  it("useTripPlan loads the walk graph only after a plan exists, showing loading copy first and then graph paths", async () => {
    delayWalkGraph = () => undefined;
    const idle = renderHook(({ s, d }: { s: PlanEnd | null; d: PlanEnd | null }) => useTripPlan(s, d), {
      initialProps: { s: null as PlanEnd | null, d: null as PlanEnd | null },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const origin = { point: { lat: 13.6234, lng: 123.1847 }, source: "pick" } as unknown as PlanEnd;
    const dest = { point: { lat: 13.6305, lng: 123.1912 }, source: "pick" } as unknown as PlanEnd;
    idle.rerender({ s: origin, d: dest });

    await waitFor(() => expect(idle.result.current.status).toBe("ready"));
    if (idle.result.current.status === "ready") {
      expect(idle.result.current.walkGraphStatus).toBe("loading");
      const firstLeg = idle.result.current.data.plan.options[0]!.legs[0]!;
      expect(firstLeg.kind === "walk" && firstLeg.path.label).toBe(WALK_LOADING_LABEL);
    }

    // Finish loading the walk graph -> first walk leg (inside Centro) upgrades to graph path.
    await act(async () => {
      delayWalkGraph?.();
    });
    await waitFor(() => expect(idle.result.current.status === "ready" && idle.result.current.walkGraphStatus).toBe("ready"));
    if (idle.result.current.status === "ready") {
      const firstLeg = idle.result.current.data.plan.options[0]!.legs[0]!;
      expect(firstLeg.kind === "walk" && firstLeg.path.kind).toBe("path");
      expect(firstLeg.kind === "walk" && firstLeg.path.label).toBe(WALK_PATH_LABEL);
    }
  });
  it("useTripPlan keeps the same enriched data object when rerendered with unchanged inputs (T10-1)", async () => {
    const origin = { point: { lat: 13.6234, lng: 123.1847 }, source: "pick" } as unknown as PlanEnd;
    const dest = { point: { lat: 13.6305, lng: 123.1912 }, source: "pick" } as unknown as PlanEnd;
    const hook = renderHook(({ s, d }: { s: PlanEnd | null; d: PlanEnd | null }) => useTripPlan(s, d), {
      initialProps: { s: origin, d: dest },
    });
    await waitFor(() => expect(hook.result.current.status === "ready" && hook.result.current.walkGraphStatus).toBe("ready"));
    const first = hook.result.current.status === "ready" ? hook.result.current.data : null;
    expect(first).not.toBeNull();
    hook.rerender({ s: origin, d: dest });
    hook.rerender({ s: { ...origin } as PlanEnd, d: { ...dest } as PlanEnd });
    const second = hook.result.current.status === "ready" ? hook.result.current.data : null;
    expect(second).toBe(first);
  });
});

// Task 15: offline behaviour of the walk graph (and the lines) with the service worker's caches.
describe("walk graph offline and cache safety (Task 15)", () => {
  const WG_URL = `/api/v1/network/walk-graph/${REV_ID}`;
  const defaultFetch = fetchMock.getMockImplementation()!;
  afterEach(() => {
    fetchMock.mockImplementation(defaultFetch);
  });

  /** A minimal Cache Storage: one ParaNaga cache holding `stored` (url → body). */
  function stubCaches(stored: Map<string, string>) {
    const deleted: string[] = [];
    const cache = {
      delete: vi.fn(async (url: string) => {
        deleted.push(url);
        return stored.delete(url);
      }),
    };
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => ["pn-walk-graph-b1", "pn-shell-b1", "serwist-precache-v2-x"]),
      open: vi.fn(async () => cache),
      match: vi.fn(async (url: string) => (stored.has(url) ? new Response(stored.get(url)) : undefined)),
    });
    return deleted;
  }

  it("rejects a corrupt payload, drops the stored copy and refetches it from the network once", async () => {
    const deleted = stubCaches(new Map([[WG_URL, '{"v":99}']]));
    let calls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== WG_URL) return json({}, 404);
      calls += 1;
      return calls === 1 ? new Response('{"v":99}', { status: 200 }) : json(walkGraphFixture);
    });
    const wg = renderHook(() => useWalkGraph(REV_ID));
    await waitFor(() => expect(wg.result.current.status).toBe("ready"));
    expect(deleted).toEqual([WG_URL]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown[])[1]).toMatchObject({ cache: "no-cache" });
  });

  it("a payload that stays corrupt ends in an error state, never a crash", async () => {
    stubCaches(new Map());
    fetchMock.mockImplementation(async () => new Response("not json", { status: 200 }));
    const wg = renderHook(() => useWalkGraph(REV_ID));
    await waitFor(() => expect(wg.result.current.status).toBe("error"));
    expect(wg.result.current.graph).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offline without a cached copy: status offline, and walks say street paths need a connection", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/v1/plan") return json(PROVISIONAL_PLAN);
      throw new TypeError("Failed to fetch");
    });
    const origin = { point: { lat: 13.6234, lng: 123.1847 }, source: "pick" } as unknown as PlanEnd;
    const dest = { point: { lat: 13.6305, lng: 123.1912 }, source: "pick" } as unknown as PlanEnd;
    const hook = renderHook(() => useTripPlan(origin, dest));
    await waitFor(() => expect(hook.result.current.status === "ready" && hook.result.current.walkGraphStatus).toBe("offline"));
    if (hook.result.current.status === "ready") {
      const firstLeg = hook.result.current.data.plan.options[0]!.legs[0]!;
      expect(firstLeg.kind === "walk" && firstLeg.path.kind).toBe("straight");
      expect(firstLeg.kind === "walk" && firstLeg.path.label).toBe(WALK_OFFLINE_LABEL);
      expect(WALK_OFFLINE_LABEL).toContain(WALK_PATHS_OFFLINE_NOTE);
    }
    expect(WALK_PATHS_OFFLINE_NOTE).toBe("Street paths need a connection the first time.");
    onLine.mockRestore();
  });

  it("back online after an offline attempt: loads the graph without a reload", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let online = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (!online) throw new TypeError("Failed to fetch");
      return url === WG_URL ? json(walkGraphFixture) : json({}, 404);
    });
    const wg = renderHook(() => useWalkGraph(REV_ID));
    await waitFor(() => expect(wg.result.current.status).toBe("offline"));
    online = true;
    onLine.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(wg.result.current.status).toBe("ready"));
    onLine.mockRestore();
  });

  it("low-data mode: uses a walk graph already on the phone (no network), else skips", async () => {
    updatePrefs({ lowData: true });
    stubCaches(new Map([[WG_URL, JSON.stringify(walkGraphFixture)]]));
    const wg = renderHook(() => useWalkGraph(REV_ID));
    await waitFor(() => expect(wg.result.current.status).toBe("ready"));
    expect(fetchMock).not.toHaveBeenCalled();

    resetWalkGraphForTests();
    stubCaches(new Map([[WG_URL, '{"v":99}']])); // a corrupt copy is not used either
    const none = renderHook(() => useWalkGraph(REV_ID));
    await waitFor(() => expect(none.result.current.status).toBe("skipped"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("low-data opt-in: offered while skipped, downloads only on the tap, then the paths are used", async () => {
    updatePrefs({ lowData: true });
    stubCaches(new Map());
    const both = renderHook(() => ({ graph: useWalkGraph(REV_ID), offer: useWalkGraphDownload(REV_ID) }));
    await waitFor(() => expect(both.result.current.graph.status).toBe("skipped"));
    expect(both.result.current.offer).toMatchObject({ offer: true, busy: false, failed: false });
    expect(fetchMock).not.toHaveBeenCalled(); // nothing downloads by itself
    let ok = false;
    await act(async () => {
      ok = await both.result.current.offer.download();
    });
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls.filter(([u]) => u === WG_URL)).toHaveLength(1);
    await waitFor(() => expect(both.result.current.graph.status).toBe("ready"));
    expect(both.result.current.offer.offer).toBe(false);
  });

  it("low-data opt-in: a failed download keeps the offer with a failure note", async () => {
    updatePrefs({ lowData: true });
    stubCaches(new Map());
    fetchMock.mockImplementation(async (url: string) => (url === WG_URL ? json({}, 503) : defaultFetch(url)));
    const both = renderHook(() => ({ graph: useWalkGraph(REV_ID), offer: useWalkGraphDownload(REV_ID) }));
    await waitFor(() => expect(both.result.current.graph.status).toBe("skipped"));
    await act(async () => {
      await both.result.current.offer.download();
    });
    expect(both.result.current.offer).toMatchObject({ offer: true, busy: false, failed: true });
  });

  it("no offer when not saving data (the graph loads by itself)", async () => {
    stubCaches(new Map());
    const online = renderHook(() => ({ graph: useWalkGraph(REV_ID), offer: useWalkGraphDownload(REV_ID) }));
    await waitFor(() => expect(online.result.current.graph.status).toBe("ready"));
    expect(online.result.current.offer.offer).toBe(false);
  });
});

// Saved cards (and the offline page) use the cached graph's lengths, never the network.
describe("useSavedWalkLengths", () => {
  const WG_URL = `/api/v1/network/walk-graph/${REV_ID}`;
  const option = planResponseSchema.parse(structuredClone(PROVISIONAL_PLAN)).plan.options[0]!;
  const walk = option.legs.find((l) => l.kind === "walk")!;
  if (walk.kind === "walk") {
    walk.from = { ...walk.from, lat: 13.6234, lng: 123.1847 };
    walk.to = { ...walk.to, lat: 13.6238, lng: 123.1852 };
    walk.distanceMeters = 70;
    walk.estimateMeters = 91;
  }
  const stubStored = (stored: Map<string, string>) =>
    vi.stubGlobal("caches", { match: vi.fn(async (url: string) => (stored.has(url) ? new Response(stored.get(url)) : undefined)) });

  it("uses the stored copy's path lengths for the walks, with no network request", async () => {
    stubStored(new Map([[WG_URL, JSON.stringify(walkGraphFixture)]]));
    const { result } = renderHook(() => useSavedWalkLengths(option, REV_ID));
    expect(result.current.every((m) => m === null)).toBe(true);
    await waitFor(() => expect(result.current.some((m) => typeof m === "number")).toBe(true));
    expect(result.current.map((m, i) => (option.legs[i]!.kind === "ride" ? m === null : true)).every(Boolean)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays on the x1.3 estimates (all null) with no stored copy, and never downloads one", async () => {
    stubStored(new Map());
    const { result } = renderHook(() => useSavedWalkLengths(option, REV_ID));
    await act(async () => undefined);
    expect(result.current.every((m) => m === null)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
