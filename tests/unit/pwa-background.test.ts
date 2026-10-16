// @vitest-environment jsdom
// Task 12 round 2: the data handoff decides BEFORE the fetch whether the worker saw the request
// (R4), and the one-time background fetch of the search index respects Low-data mode and the
// browser's Data Saver (R5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offerToWorker, workerSeesRequests } from "@/client/pwa/data-handoff";
import { prefetchSearchIndexNow, savingData } from "@/client/pwa/prefetch-index";
import { PREFS_STORAGE_KEY, DEFAULT_PREFS, serializePrefs } from "@/domain/prefs/prefs";
import snapshot from "../e2e/fixtures/network/snapshot.json";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function setConnection(saveData: boolean | undefined) {
  Object.defineProperty(navigator, "connection", { value: saveData === undefined ? undefined : { saveData }, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setConnection(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (navigator as unknown as { connection?: unknown }).connection;
});

describe("background search-index fetch", () => {
  it("fetches the head, the index and the named-places chunk of that revision once", async () => {
    const fetchMock = vi.fn(async (url: string) => (url === "/api/v1/network/head" ? json(snapshot.revision) : json({})));
    vi.stubGlobal("fetch", fetchMock);
    expect(await prefetchSearchIndexNow()).toBe("fetched");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/network/head",
      `/api/v1/network/search-index/${snapshot.revision.revisionId}`,
      `/api/v1/network/search-places/${snapshot.revision.revisionId}`,
    ]);
  });

  it("is skipped with Low-data mode on", async () => {
    localStorage.setItem(PREFS_STORAGE_KEY, serializePrefs({ ...DEFAULT_PREFS, lowData: true }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(savingData()).toBe(true);
    expect(await prefetchSearchIndexNow()).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is skipped when the browser's Data Saver is on", async () => {
    setConnection(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await prefetchSearchIndexNow()).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    setConnection(false);
    expect(savingData()).toBe(false);
  });
});

describe("data handoff", () => {
  function fakeWorkerContainer(controller: object | null) {
    const active = { postMessage: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller, ready: Promise.resolve({ active }), addEventListener: vi.fn() },
      configurable: true,
    });
    return active;
  }

  it("offers a response whose request started before the worker controlled the page", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const active = fakeWorkerContainer(null);
    const saw = workerSeesRequests(); // captured before the fetch
    expect(saw).toBe(false);
    // ... the worker takes control while the request runs: still offered.
    (navigator.serviceWorker as unknown as { controller: object | null }).controller = {};
    offerToWorker("/api/v1/network/head", "{}", "public, s-maxage=30", saw);
    await Promise.resolve();
    await Promise.resolve();
    expect(active.postMessage).toHaveBeenCalledWith({ type: "STORE_FETCHED_DATA", entries: [{ url: "/api/v1/network/head", body: "{}", cacheControl: "public, s-maxage=30" }] });
  });

  it("never offers a response the worker saw itself", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const active = fakeWorkerContainer({});
    const saw = workerSeesRequests();
    expect(saw).toBe(true);
    offerToWorker("/api/v1/network/head", "{}", "public, s-maxage=30", saw);
    await Promise.resolve();
    expect(active.postMessage).not.toHaveBeenCalled();
  });
});
