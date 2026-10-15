// @vitest-environment jsdom
// Facts: new test file for src/client/guidance/use-guidance-session.ts (Task 10), the bridge from
// navigator.geolocation (mocked watchPosition/clearWatch) to the guidance reducer, the
// sessionStorage store (paranaga.guidance + paranaga.guidance.trip) and the Screen Wake Lock
// (mocked navigator.wakeLock). The brief requires: no watchPosition call until a tap, the watch
// cleared on end / arrive / unmount, the wake lock released, history recorded on start.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanOptionDto } from "@/domain/api/plan";
import { GUIDANCE_SESSION_KEY, parseSession } from "@/domain/guidance/session";
import type { SavedTrip } from "@/domain/saved/saved";
import { LOOP_A, oneRide, tripOf } from "./guidance-fixtures";

const recordTrip = vi.fn(async () => true);
vi.mock("@/client/history/trip-history", () => ({ recordTrip: (...args: unknown[]) => recordTrip(...(args as [])) }));

const { useGuidanceSession } = await import("@/client/guidance/use-guidance-session");
const { GUIDANCE_TRIP_KEY, resetGuidanceStoreForTests } = await import("@/client/guidance/guidance-store");

type Success = (p: GeolocationPosition) => void;
let success: Success | null = null;
let nextId = 1;
const watchPosition = vi.fn();
const clearWatch = vi.fn();
const release = vi.fn(async () => undefined);
const requestLock = vi.fn(async () => ({ release }));
let permission: PermissionState = "prompt";

const NOW = new Date("2026-10-16T08:00:00+08:00").getTime();

function card(option: PlanOptionDto): SavedTrip {
  return {
    id: "c1",
    savedAt: new Date(NOW).toISOString(),
    revisionId: "67e56657-7542-462e-b57c-eb14439a0c7a",
    revisionLabel: "osm-places-2026-10-15",
    revisionKind: "provisional",
    publishedAt: "2026-10-15T12:59:57.089Z",
    start: { label: "Pinned location", point: { lat: 13.62, lng: 123.18 } },
    destination: { label: "SM City Naga", point: { lat: 13.64, lng: 123.19 } },
    option,
    stops: [{ id: LOOP_A[0]!.id, name: "Plaza Rizal", code: "A1" }],
    variants: [],
  };
}

function position(p: { lat: number; lng: number }, accuracy = 10) {
  return { coords: { latitude: p.lat, longitude: p.lng, accuracy, heading: null, speed: null }, timestamp: Date.now() } as unknown as GeolocationPosition;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

function startTrip(result: { current: ReturnType<typeof useGuidanceSession> }) {
  const option = oneRide();
  act(() => result.current.start(tripOf(option), card(option)));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  resetGuidanceStoreForTests();
  nextId = 1;
  success = null;
  permission = "prompt";
  watchPosition.mockReset().mockImplementation((s: Success) => {
    success = s;
    return nextId++;
  });
  clearWatch.mockReset();
  release.mockClear();
  requestLock.mockClear();
  recordTrip.mockClear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch } });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: permission })) },
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: requestLock } });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useGuidanceSession", () => {
  it("starts the session, records history and never watches location without permission", async () => {
    const { result } = renderHook(() => useGuidanceSession());
    expect(result.current.session).toBeNull();
    startTrip(result);
    await flush();
    expect(result.current.view?.screen).toBe("walk");
    expect(recordTrip).toHaveBeenCalledWith("Pinned location", "SM City Naga");
    expect(watchPosition).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(GUIDANCE_SESSION_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(GUIDANCE_TRIP_KEY)).not.toBeNull();
  });

  it("watches only after the 'Use my location' tap when not yet allowed", async () => {
    const { result } = renderHook(() => useGuidanceSession());
    startTrip(result);
    await flush();
    expect(watchPosition).not.toHaveBeenCalled();
    act(() => result.current.enableLocation());
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it("Start turns the watch on when location is already allowed", async () => {
    permission = "granted";
    const { result } = renderHook(() => useGuidanceSession());
    startTrip(result);
    await flush();
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it("dispatches every fix to the session (ride progress) and keeps it in sessionStorage", async () => {
    const { result } = renderHook(() => useGuidanceSession());
    startTrip(result);
    act(() => result.current.send({ type: "atStop" }));
    act(() => result.current.send({ type: "boarded" }));
    act(() => result.current.enableLocation());
    act(() => success!(position(LOOP_A[1]!)));
    expect(result.current.session?.ride?.passedIndex).toBe(1);
    expect(result.current.view?.screen === "ride" && result.current.view.title).toBe("4 stops to go");
    const stored = parseSession(window.sessionStorage.getItem(GUIDANCE_SESSION_KEY), Date.now());
    expect(stored?.ride?.passedIndex).toBe(1);
  });

  it("stops the watch and releases the wake lock on Arrive, and never restarts on undo", async () => {
    const { result } = renderHook(() => useGuidanceSession());
    startTrip(result);
    await flush();
    expect(requestLock).toHaveBeenCalledWith("screen");
    act(() => result.current.enableLocation());
    act(() => result.current.send({ type: "boarded" }));
    act(() => result.current.send({ type: "gotOff" }));
    act(() => result.current.send({ type: "arrived" }));
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalled();
    expect(result.current.view?.screen).toBe("arrive");
    expect(result.current.view?.usesLocation).toBe(false);
    expect(result.current.location.watching).toBe(false);

    act(() => result.current.send({ type: "back" }));
    await flush();
    expect(result.current.view?.screen).toBe("walk");
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it("the first render of Arrive already has the watch cleared and the wake lock released", async () => {
    let clearsAtArrive: number | null = null;
    let releasesAtArrive: number | null = null;
    const { result } = renderHook(() => {
      const r = useGuidanceSession();
      if (r.view?.screen === "arrive" && clearsAtArrive === null) {
        clearsAtArrive = clearWatch.mock.calls.length;
        releasesAtArrive = release.mock.calls.length;
      }
      return r;
    });
    startTrip(result);
    await flush();
    act(() => result.current.enableLocation());
    act(() => result.current.send({ type: "boarded" }));
    act(() => result.current.send({ type: "gotOff" }));
    expect(clearWatch).not.toHaveBeenCalled();
    act(() => result.current.send({ type: "arrived" }));
    expect(clearsAtArrive).toBe(1);
    expect(releasesAtArrive).toBe(1);
  });

  it("End removes both keys, stops the watch and frees the wake lock", async () => {
    const { result } = renderHook(() => useGuidanceSession());
    startTrip(result);
    await flush();
    act(() => result.current.enableLocation());
    act(() => result.current.send({ type: "end" }));
    expect(result.current.session).toBeNull();
    expect(clearWatch).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(GUIDANCE_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(GUIDANCE_TRIP_KEY)).toBeNull();
  });

  it("clears the watch and the wake lock on unmount", async () => {
    const { result, unmount } = renderHook(() => useGuidanceSession());
    startTrip(result);
    await flush();
    act(() => result.current.enableLocation());
    unmount();
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalled();
  });

  it("releases the wake lock while hidden and asks again when visible", async () => {
    const { result } = renderHook(() => useGuidanceSession());
    startTrip(result);
    await flush();
    expect(requestLock).toHaveBeenCalledTimes(1);
    act(() => setVisibility("hidden"));
    expect(release).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    await flush();
    expect(requestLock).toHaveBeenCalledTimes(2);
  });

  it("restores the step after a reload, with location off until tapped", async () => {
    const first = renderHook(() => useGuidanceSession());
    startTrip(first.result);
    act(() => first.result.current.send({ type: "atStop" }));
    first.unmount();
    resetGuidanceStoreForTests();

    const { result } = renderHook(() => useGuidanceSession());
    expect(result.current.session?.atStop).toBe(true);
    expect(result.current.view?.screen === "walk" && result.current.view.title).toMatch(/^Wait for .+ at Plaza Rizal \(A1\)$/);
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("drops a stored session that is older than 6 h or unreadable", () => {
    const first = renderHook(() => useGuidanceSession());
    startTrip(first.result);
    first.unmount();
    resetGuidanceStoreForTests();
    vi.setSystemTime(NOW + 6 * 60 * 60 * 1000 + 1);
    const { result } = renderHook(() => useGuidanceSession());
    expect(result.current.session).toBeNull();
    expect(window.sessionStorage.getItem(GUIDANCE_SESSION_KEY)).toBeNull();

    cleanup();
    resetGuidanceStoreForTests();
    window.sessionStorage.setItem(GUIDANCE_SESSION_KEY, "{not json");
    const again = renderHook(() => useGuidanceSession());
    expect(again.result.current.session).toBeNull();
    expect(window.sessionStorage.getItem(GUIDANCE_SESSION_KEY)).toBeNull();
  });
});
