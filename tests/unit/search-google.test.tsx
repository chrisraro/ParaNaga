// @vitest-environment jsdom
// Google suggestions on the Search screen (Task 15): asked only when on-device results are fewer
// than 3 (after 3 characters and a 400 ms pause) or on "Search more places"; one session token per
// typing session; rows labelled "Google suggestion", never verified; a pick resolves to a point
// and becomes a trip end with source "google". Any non-ok answer leaves OpenStreetMap results only.
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "../e2e/fixtures/network/search-index.json" with { type: "json" };

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ back: nav.back, push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/search",
}));

const { AppFrameContext, setEntryPath } = await import("@/ui/app-shell/app-frame-context");
const { SEARCH_DEBOUNCE_MS, SearchScreen } = await import("@/ui/search/search-screen");
const { GOOGLE_DEBOUNCE_MS } = await import("@/domain/places/google");
const { resetSearchIndexCache } = await import("@/client/search/use-search-index");
const { clearAllStores } = await import("@/client/storage/db");

const HEAD = raw.revision;
const frame = {
  openPanel: () => () => {},
  markHomeNavigation: () => {},
  isHomeNavigation: () => false,
  mapFocus: null,
  showOnMap: () => {},
  hideTabBar: () => () => {},
  tabBarVisible: false,
  tabBarClearance: 0,
  panelOpen: true,
  endpointRequest: null,
  requestEndpoint: vi.fn(),
  requestPick: vi.fn(),
  requestGps: vi.fn(),
  tripRequest: null,
  requestTrip: vi.fn(),
};

const POINT = { lat: 13.6262, lng: 123.1873 };
let suggestAnswer: unknown = { status: "ok", suggestions: [{ placeId: "ChIJx", title: "Zzyzx Bakeshop", subtitle: "Naga, Camarines Sur" }] };
let posts: { url: string; body: { query?: string; placeId?: string; sessionToken: string } }[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  await clearAllStores();
  posts = [];
  suggestAnswer = { status: "ok", suggestions: [{ placeId: "ChIJx", title: "Zzyzx Bakeshop", subtitle: "Naga, Camarines Sur" }] };
  resetSearchIndexCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/network/head") return json(HEAD);
      if (url === `/api/v1/network/search-index/${HEAD.revisionId}`) return json(raw);
      if (url === `/api/v1/network/search-places/${HEAD.revisionId}`) return json({ revision: raw.revision, places: [] });
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        if (url === "/api/v1/places/suggest") return json(suggestAnswer);
        if (url === "/api/v1/places/resolve") return json({ status: "ok", point: POINT });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  nav.params = new URLSearchParams();
  setEntryPath("/app");
  window.history.replaceState(null, "", "/app/search");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setEntryPath(null);
});

function renderSearch(forParam?: string) {
  if (forParam) nav.params = new URLSearchParams({ for: forParam });
  return render(
    <AppFrameContext.Provider value={frame}>
      <SearchScreen />
    </AppFrameContext.Provider>,
  );
}

const box = () => screen.getByRole("searchbox", { name: "Search places, stops and routes" });
const ready = () => waitFor(() => expect(screen.queryByTestId("search-loading")).toBeNull());

/** Types, then waits `pause` ms of fake time (the local debounce, then Google's). */
async function type(text: string, pause = GOOGLE_DEBOUNCE_MS) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    fireEvent.change(box(), { target: { value: text } });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(pause);
    });
  } finally {
    vi.useRealTimers();
  }
}

const suggests = () => posts.filter((p) => p.url === "/api/v1/places/suggest");

describe("Search: Google suggestions", () => {
  it("asks Google after the 400 ms pause when on-device search finds fewer than 3, labelled and unverified", async () => {
    renderSearch("destination");
    await ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.change(box(), { target: { value: "zzyzx bakeshop" } });
      await act(async () => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      await act(async () => {
        vi.advanceTimersByTime(GOOGLE_DEBOUNCE_MS - 1);
      });
      expect(suggests()).toEqual([]);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(suggests()).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("search-google")).toBeTruthy());
    expect(suggests()).toHaveLength(1);
    expect(suggests()[0]!.body.query).toBe("zzyzx bakeshop");
    const row = screen.getByTestId("search-result-google");
    expect(row.textContent).toContain("Zzyzx Bakeshop");
    expect(row.textContent).toContain("Google suggestion");
    expect(row.textContent).toContain("not verified");
    expect(row.textContent).not.toContain("Verified");
    expect(screen.getByTestId("search-google").textContent).toContain("Suggestions from Google Maps");
  });

  it("does not ask with fewer than 3 characters", async () => {
    renderSearch();
    await ready();
    await type("zz");
    expect(suggests()).toEqual([]);
  });

  it("with 3 or more local results, asks only after 'Search more places'", async () => {
    renderSearch();
    await ready();
    await type("Diversion");
    expect(suggests()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Search more places" }));
    await waitFor(() => expect(suggests()).toHaveLength(1));
  });

  it("keeps one session token while typing, then a new one after a pick", async () => {
    renderSearch("destination");
    await ready();
    await type("zzyzx");
    await type("zzyzx bakeshop");
    await waitFor(() => expect(suggests()).toHaveLength(2));
    const [a, b] = suggests();
    expect(a!.body.sessionToken).toBe(b!.body.sessionToken);
    fireEvent.click(await screen.findByTestId("search-result-google"));
    await waitFor(() => expect(frame.requestEndpoint).toHaveBeenCalled());
    const resolve = posts.find((p) => p.url === "/api/v1/places/resolve")!;
    expect(resolve.body).toEqual({ placeId: "ChIJx", sessionToken: a!.body.sessionToken });
  });

  it("for=destination: a pick resolves to a point and sets the destination with source google", async () => {
    renderSearch("destination");
    await ready();
    await type("zzyzx bakeshop");
    fireEvent.click(await screen.findByTestId("search-result-google"));
    await waitFor(() => expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: POINT, label: "Zzyzx Bakeshop", place: "google" }));
  });

  it("at the daily cap says so and shows OpenStreetMap results only", async () => {
    suggestAnswer = { status: "capped" };
    renderSearch();
    await ready();
    await type("zzyzx bakeshop");
    await waitFor(() => expect(screen.getByTestId("search-google-note").textContent).toContain("No more Google suggestions today"));
    expect(screen.queryByTestId("search-result-google")).toBeNull();
  });

  it("when Google is unavailable shows nothing more and stops asking", async () => {
    suggestAnswer = { status: "unavailable" };
    renderSearch();
    await ready();
    await type("zzyzx bakeshop");
    await waitFor(() => expect(suggests()).toHaveLength(1));
    expect(screen.queryByTestId("search-google")).toBeNull();
    expect(screen.queryByTestId("search-google-note")).toBeNull();
    await type("qqqq other");
    expect(suggests()).toHaveLength(1);
  });
});
