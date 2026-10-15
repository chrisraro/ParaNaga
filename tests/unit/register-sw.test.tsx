// @vitest-environment jsdom
// The update flow's state (src/client/pwa/register-sw.ts), with fake workers: a version is "ready"
// only while it really waits; activated elsewhere (another tab, the installed app window) clears
// the card; Reload asks once and reloads once; a version already active just reloads.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, postponeUpdate, resetServiceWorkerForTests, setReloadForTests, trackRegistration, useUpdateCard, useUpdateReady } from "@/client/pwa/register-sw";

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState) {
    super();
  }
  set(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
}

let container: EventTarget & { controller: FakeWorker | null };
let reloads = 0;

beforeEach(() => {
  resetServiceWorkerForTests();
  reloads = 0;
  setReloadForTests(() => {
    reloads += 1;
  });
  container = Object.assign(new EventTarget(), { controller: new FakeWorker("activated") as FakeWorker | null });
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { serviceWorker: container }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const track = (reg: FakeRegistration) => act(() => trackRegistration(reg as unknown as ServiceWorkerRegistration));
const fire = (target: EventTarget, type: string) => act(() => void target.dispatchEvent(new Event(type)));

describe("update readiness", () => {
  it("a version waiting at registration is ready; activated in another tab, it no longer is", () => {
    const reg = new FakeRegistration();
    const next = new FakeWorker("installed");
    reg.waiting = next;
    const { result } = renderHook(() => useUpdateReady());
    track(reg);
    expect(result.current).toBe(true);
    act(() => next.set("activating"));
    expect(result.current).toBe(false);
    // The Reload button would have nothing to do: nothing is posted, nothing reloads.
    act(() => applyUpdate());
    expect(next.postMessage).not.toHaveBeenCalled();
    expect(reloads).toBe(0);
  });

  it("a controller change this tab did not ask for clears the card", () => {
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker("installed");
    const { result } = renderHook(() => useUpdateReady());
    track(reg);
    expect(result.current).toBe(true);
    fire(container, "controllerchange");
    expect(result.current).toBe(false);
    expect(reloads).toBe(0);
  });

  it("an update found later becomes ready once installed; a first install never does", () => {
    const reg = new FakeRegistration();
    const { result } = renderHook(() => useUpdateReady());
    track(reg);
    const next = new FakeWorker("installing");
    reg.installing = next;
    fire(reg, "updatefound");
    act(() => next.set("installed"));
    expect(result.current).toBe(true);

    resetServiceWorkerForTests();
    container.controller = null; // first visit: nothing controls the page yet
    const first = new FakeRegistration();
    const { result: r2 } = renderHook(() => useUpdateReady());
    track(first);
    const worker = new FakeWorker("installing");
    first.installing = worker;
    fire(first, "updatefound");
    act(() => worker.set("installed"));
    expect(r2.current).toBe(false);
  });

  it("a redundant waiting version is dropped", () => {
    const reg = new FakeRegistration();
    const next = new FakeWorker("installed");
    reg.waiting = next;
    const { result } = renderHook(() => useUpdateReady());
    track(reg);
    act(() => next.set("redundant"));
    expect(result.current).toBe(false);
  });
});

describe("applyUpdate", () => {
  it("asks the waiting version once (repeated taps) and reloads once when it takes control", () => {
    const reg = new FakeRegistration();
    const next = new FakeWorker("installed");
    reg.waiting = next;
    track(reg);
    act(() => applyUpdate());
    act(() => applyUpdate());
    expect(next.postMessage).toHaveBeenCalledTimes(1);
    expect(next.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    // Activating is this tab's doing: the card stays until the reload.
    act(() => next.set("activating"));
    fire(container, "controllerchange");
    fire(container, "controllerchange");
    expect(reloads).toBe(1);
  });

  it("reloads directly when the waiting version is already active", () => {
    const reg = new FakeRegistration();
    const next = new FakeWorker("installed");
    reg.waiting = next;
    track(reg);
    // Activated without a statechange reaching this tab yet, but already controlling it.
    next.state = "activated";
    act(() => applyUpdate());
    expect(next.postMessage).not.toHaveBeenCalled();
    expect(reloads).toBe(1);
  });

  it("a version this tab asked for that becomes redundant releases Reload for the next one", () => {
    const reg = new FakeRegistration();
    const first = new FakeWorker("installed");
    reg.waiting = first;
    const { result } = renderHook(() => useUpdateReady());
    track(reg);
    act(() => applyUpdate());
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    act(() => first.set("redundant")); // superseded before it activated
    expect(result.current).toBe(false);
    const second = new FakeWorker("installing");
    reg.installing = second;
    fire(reg, "updatefound");
    act(() => second.set("installed"));
    expect(result.current).toBe(true);
    act(() => applyUpdate());
    expect(second.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
});

describe("Later", () => {
  it("hides the card for this page session while the update stays ready", () => {
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker("installed");
    const card = renderHook(() => useUpdateCard());
    const ready = renderHook(() => useUpdateReady());
    track(reg);
    expect(card.result.current).toBe(true);
    act(() => postponeUpdate());
    expect(card.result.current).toBe(false);
    expect(ready.result.current).toBe(true);
  });
});
