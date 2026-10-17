// @vitest-environment jsdom
// Offline planning (Task 12): POST /api/v1/plan unreachable → the same pure planner runs in the
// browser on the cached snapshot, marked offline; nothing cached → the honest offline error.
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLinesForTests } from "@/client/network/use-lines";
import { resetSnapshotForTests } from "@/client/network/use-snapshot";
import { resetWalkGraphForTests } from "@/client/network/use-walk-graph";
import { planOffline } from "@/client/trip/plan-offline";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import { buildPlanResponse, planResponseSchema } from "@/domain/api/plan";
import { linesSchema, networkSnapshotSchema } from "@/domain/api/schemas";
import { planTrip } from "@/domain/planner/plan";
import { offlinePlanNote } from "@/domain/pwa/offline-copy";
import type { PlanEnd } from "@/domain/trip/replan";
import { parseWalkGraph } from "@/domain/walk/walk-graph";
import linesJson from "../e2e/fixtures/network/lines.json";
import snapshotJson from "../e2e/fixtures/network/snapshot.json";
import walkGraphJson from "../e2e/fixtures/network/walk-graph.json";

const snapshot = networkSnapshotSchema.parse(snapshotJson);
const lines = linesSchema.parse(linesJson);
const walkGraph = parseWalkGraph(walkGraphJson);
const NOW = new Date("2026-10-17T02:00:00Z"); // 10:00 Manila
const ORIGIN = { lat: 13.6224, lng: 123.1838 };
const DESTINATION = { lat: 13.6305, lng: 123.1912 };
const end = (point: { lat: number; lng: number }): PlanEnd => ({ point, source: "pick" }) as unknown as PlanEnd;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let cached = true;
let planCalls: { url: string; body: string }[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/v1/plan") {
    planCalls.push({ url, body: String(init?.body) });
    throw new TypeError("Failed to fetch");
  }
  if (!cached) throw new TypeError("Failed to fetch");
  if (url === "/api/v1/network/head") return json(snapshot.revision);
  if (url.startsWith("/api/v1/network/snapshot/")) return json(snapshot);
  if (url.startsWith("/api/v1/network/lines/")) return json(linesJson);
  if (url.startsWith("/api/v1/network/walk-graph/")) return json(walkGraphJson);
  return json({}, 404);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetSnapshotForTests();
  resetLinesForTests();
  resetWalkGraphForTests();
  cached = true;
  planCalls = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe("planOffline", () => {
  it("plans with the server's pure planner on the snapshot, Lines and street graph, as the server would answer", async () => {
    const result = await planOffline(ORIGIN, DESTINATION);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const streets = walkGraph.ok ? walkGraph.graph : null;
    const expected = planResponseSchema.parse(buildPlanResponse(snapshot, planTrip(snapshot, { lines, streets }, ORIGIN, DESTINATION, { now: NOW }), lines));
    expect(result.data).toEqual(expected);
    expect(expected.plan.options.map((o) => o.mode)).toContain("jeepney");
    expect(result.data.revision).toEqual(snapshot.revision);
    // The points never left the browser: only the head, the snapshot, the Lines and the street graph (revision id only) were requested.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls.sort()).toEqual([
      "/api/v1/network/head",
      `/api/v1/network/lines/${snapshot.revision.revisionId}`,
      `/api/v1/network/snapshot/${snapshot.revision.revisionId}`,
      `/api/v1/network/walk-graph/${snapshot.revision.revisionId}`,
    ].sort());
    expect(urls.join()).not.toMatch(/13\.6|123\.1/);
  });

  it("in Low-data mode it still fetches the Lines once, and plans without the street graph (walks and tricycle say so)", async () => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    try {
      const result = await planOffline(ORIGIN, DESTINATION);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.startsWith("/api/v1/network/lines/"))).toBe(true);
      expect(urls.some((u) => u.startsWith("/api/v1/network/walk-graph/"))).toBe(false);
      expect(result.data).toEqual(planResponseSchema.parse(buildPlanResponse(snapshot, planTrip(snapshot, { lines, streets: null }, ORIGIN, DESTINATION, { now: NOW }), lines)));
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });

  it("Plaza Rizal to Del Rosario offline: the same via options as the server's pure planner (parity)", async () => {
    const from = { lat: 13.6233869, lng: 123.1846726 };
    const to = { lat: 13.6173903, lng: 123.2375487 };
    const result = await planOffline(from, to);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const streets = walkGraph.ok ? walkGraph.graph : null;
    const expected = planResponseSchema.parse(buildPlanResponse(snapshot, planTrip(snapshot, { lines, streets }, from, to, { now: NOW }), lines));
    expect(result.data).toEqual(expected);
    const labels = result.data.plan.options.flatMap((o) => (o.via ? [o.via.label] : [])).sort();
    expect(labels).toEqual(["Magsaysay", "Panganiban", "Roxas (Diversion)"]);
  });

  it("refuses points outside Naga City like the server does", async () => {
    expect((await planOffline({ lat: 14.6, lng: 121.0 }, DESTINATION)).status).toBe("invalid");
  });

  it("is unavailable without a cached snapshot", async () => {
    cached = false;
    expect((await planOffline(ORIGIN, DESTINATION)).status).toBe("unavailable");
  });
});

describe("useTripPlan offline", () => {
  it("falls back to the plan made on the phone; without a connection it is marked offline", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useTripPlan(end(ORIGIN), end(DESTINATION)));
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 15_000 });
    if (result.current.status !== "ready") return;
    expect(result.current.offline).toBe("offline");
    expect(result.current.data.revision.revisionId).toBe(snapshot.revision.revisionId);
    expect(planCalls).toHaveLength(1);
    expect(offlinePlanNote(result.current.data.revision.publishedAt, result.current.offline || "offline")).toBe("Planned offline from data of Oct 16, 2026. Fares may have changed.");
    onLine.mockRestore();
  });

  it("with a connection but no server, it says ParaNaga could not be reached (not offline)", async () => {
    const { result } = renderHook(() => useTripPlan(end(ORIGIN), end(DESTINATION)));
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 15_000 });
    if (result.current.status !== "ready") return;
    expect(result.current.offline).toBe("unreachable");
    expect(offlinePlanNote(result.current.data.revision.publishedAt, "unreachable")).toBe(
      "Couldn't reach ParaNaga — planned on this phone with data from Oct 16, 2026. Fares may have changed.",
    );
  });

  it("says offline (not a server error) when nothing is cached and the browser is offline", async () => {
    cached = false;
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useTripPlan(end(ORIGIN), end(DESTINATION)));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.status === "error" && result.current.kind).toBe("offline");
    onLine.mockRestore();
  });
});
