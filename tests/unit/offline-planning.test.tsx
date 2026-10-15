// @vitest-environment jsdom
// Offline planning (Task 12): POST /api/v1/plan unreachable → the same pure planner runs in the
// browser on the cached snapshot, marked offline; nothing cached → the honest offline error.
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSnapshotForTests } from "@/client/network/use-snapshot";
import { planOffline } from "@/client/trip/plan-offline";
import { useTripPlan } from "@/client/trip/use-trip-plan";
import { buildPlanResponse, planResponseSchema } from "@/domain/api/plan";
import { networkSnapshotSchema } from "@/domain/api/schemas";
import { planTrip } from "@/domain/planner/plan";
import { offlinePlanNote } from "@/domain/pwa/offline-copy";
import type { PlanEnd } from "@/domain/trip/replan";
import snapshotJson from "../e2e/fixtures/network/snapshot.json";

const snapshot = networkSnapshotSchema.parse(snapshotJson);
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
  return json({}, 404);
});

beforeEach(() => {
  resetSnapshotForTests();
  cached = true;
  planCalls = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("planOffline", () => {
  it("plans with the server's pure planner on the snapshot, as the server would answer", async () => {
    const result = await planOffline(ORIGIN, DESTINATION);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data).toEqual(planResponseSchema.parse(buildPlanResponse(snapshot, planTrip(snapshot, ORIGIN, DESTINATION))));
    expect(result.data.revision).toEqual(snapshot.revision);
    // The points never left the browser: only the head and the snapshot were requested.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/v1/network/head", `/api/v1/network/snapshot/${snapshot.revision.revisionId}`]);
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
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") return;
    expect(result.current.offline).toBe("offline");
    expect(result.current.data.revision.revisionId).toBe(snapshot.revision.revisionId);
    expect(planCalls).toHaveLength(1);
    expect(offlinePlanNote(result.current.data.revision.publishedAt, result.current.offline || "offline")).toBe("Planned offline from data of Oct 16, 2026. Fares may have changed.");
    onLine.mockRestore();
  });

  it("with a connection but no server, it says ParaNaga could not be reached (not offline)", async () => {
    const { result } = renderHook(() => useTripPlan(end(ORIGIN), end(DESTINATION)));
    await waitFor(() => expect(result.current.status).toBe("ready"));
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
