// @vitest-environment jsdom
// Facts: new test file for the useGeolocation hook (called by Task 6 home screen);
// data shape is a mocked navigator.geolocation (watchPosition/clearWatch); user asked for accurate GPS.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeolocation } from "@/client/geo/use-geolocation";

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;

const NOW = new Date("2026-01-01T00:00:00Z").getTime();

let nextId = 1;
let success: Success;
let failure: Failure;
const watchPosition = vi.fn();
const clearWatch = vi.fn();

function position(accuracy: number, timestamp = Date.now(), lat = 13.6233869, lng = 123.1846726) {
  return {
    coords: { latitude: lat, longitude: lng, accuracy, heading: null, speed: null },
    timestamp,
  } as unknown as GeolocationPosition;
}

const error = (code: number) => ({ code, message: "x" }) as GeolocationPositionError;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  nextId = 1;
  watchPosition.mockReset().mockImplementation((s: Success, f: Failure) => {
    success = s;
    failure = f;
    return nextId++;
  });
  clearWatch.mockReset();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition, clearWatch },
  });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useGeolocation", () => {
  it("never calls watchPosition before start()", () => {
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.state).toBe("idle");
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("start() requests with the exact options and enters requesting", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition.mock.calls[0]![2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    });
    expect(result.current.state).toBe("requesting");
  });

  it("start() while already watching is a no-op", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => result.current.start());
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it("a success moves to watching with a fix and assessment", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(12)));
    expect(result.current.state).toBe("watching");
    expect(result.current.fix).toMatchObject({ lat: 13.6233869, accuracy: 12 });
    expect(result.current.assessment).toMatchObject({ quality: "precise", usableAsStart: true });
  });

  it("maps error codes 1/2/3 to denied/unavailable/timeout", () => {
    const run = (code: number) => {
      const { result, unmount } = renderHook(() => useGeolocation());
      act(() => result.current.start());
      act(() => failure(error(code)));
      const s = result.current.state;
      unmount();
      return s;
    };
    expect(run(1)).toBe("denied");
    expect(run(2)).toBe("unavailable");
    expect(run(3)).toBe("timeout");
  });

  it("denied clears the watch and does not resume on visibility change", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => failure(error(1)));
    expect(clearWatch).toHaveBeenCalledWith(1);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("denied");
  });

  it("timeout with an existing fix keeps watching", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    act(() => failure(error(3)));
    expect(result.current.state).toBe("watching");
    expect(result.current.fix).not.toBeNull();
  });

  it("ignores a coarse fix that arrives after a precise one", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    act(() => success(position(500)));
    expect(result.current.fix?.accuracy).toBe(10);
  });

  it("stop() clears the watch, returns to idle and keeps the last fix", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    act(() => result.current.stop());
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(result.current.state).toBe("idle");
    expect(result.current.fix?.accuracy).toBe(10);
    expect(result.current.assessment).not.toBeNull();
  });

  it("unmount clears the watch", () => {
    const { result, unmount } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    unmount();
    expect(clearWatch).toHaveBeenCalledWith(1);
  });

  it("hidden clears the watch; visible resumes only if it was active", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => setVisibility("hidden"));
    expect(clearWatch).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it("does not resume on visible if it was never started or was stopped", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(watchPosition).not.toHaveBeenCalled();
    act(() => result.current.start());
    act(() => result.current.stop());
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it("re-assesses staleness every 5 s while watching", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    expect(result.current.assessment?.stale).toBe(false);
    act(() => vi.advanceTimersByTime(35_000));
    expect(result.current.assessment?.stale).toBe(true);
    expect(result.current.assessment?.usableAsStart).toBe(false);
  });

  it("stops the re-assessment timer on stop()", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    act(() => result.current.stop());
    const before = result.current.assessment;
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.assessment).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports insecure without touching geolocation", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    expect(result.current.state).toBe("insecure");
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("stop() from timeout or unavailable returns to idle; denied stays denied", () => {
    const stopAfter = (code: number) => {
      const { result, unmount } = renderHook(() => useGeolocation());
      act(() => result.current.start());
      act(() => failure(error(code)));
      act(() => result.current.stop());
      const s = result.current.state;
      unmount();
      return s;
    };
    expect(stopAfter(3)).toBe("idle");
    expect(stopAfter(2)).toBe("idle");
    expect(stopAfter(1)).toBe("denied");
  });

  it("stop -> start -> timeout with no new fix is timeout despite the old fix", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    act(() => result.current.stop());
    act(() => result.current.start());
    act(() => failure(error(3)));
    expect(result.current.state).toBe("timeout");
    expect(result.current.fix).not.toBeNull();
  });

  it("unavailable then success returns to watching", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => failure(error(2)));
    expect(result.current.state).toBe("unavailable");
    act(() => success(position(10)));
    expect(result.current.state).toBe("watching");
  });

  it("success -> unavailable -> timeout ends in watching", () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    act(() => success(position(10)));
    act(() => failure(error(2)));
    act(() => failure(error(3)));
    expect(result.current.state).toBe("watching");
  });

  it("reports unsupported when geolocation is missing", () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.start());
    expect(result.current.state).toBe("unsupported");
  });
});
