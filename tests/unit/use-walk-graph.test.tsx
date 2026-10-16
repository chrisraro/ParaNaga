// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLinesForTests, useLines } from "@/client/network/use-lines";
import { resetWalkGraphForTests, useWalkGraph } from "@/client/network/use-walk-graph";
import { resetPrefs, updatePrefs } from "@/client/prefs/use-prefs";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import { WALK_LOADING_LABEL, WALK_PATH_LABEL } from "@/domain/trip/enrich";
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
