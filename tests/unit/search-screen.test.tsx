// @vitest-environment jsdom
// The Search screen (src/ui/search/search-screen.tsx) with the real captured index, a mocked
// router and a stub app frame: what it fetches (never the query), the states, the live region,
// and what picking a result does.
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
const { resetSearchIndexCache } = await import("@/client/search/use-search-index");

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
};

let urls: string[] = [];
let failing = false;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  urls = [];
  failing = false;
  resetSearchIndexCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (failing) throw new TypeError("Failed to fetch");
      if (url === "/api/v1/network/head") return json(HEAD);
      if (url === `/api/v1/network/search-index/${HEAD.revisionId}`) return json(raw);
      return new Response("{}", { status: 404 });
    }),
  );
  nav.params = new URLSearchParams();
  // The search was opened from the map in this tab: Cancel and picks go back in history.
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

async function type(text: string) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    fireEvent.change(box(), { target: { value: text } });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
  } finally {
    vi.useRealTimers();
  }
}

async function ready() {
  await waitFor(() => expect(screen.queryByTestId("search-loading")).toBeNull());
}

describe("SearchScreen", () => {
  it("opens with the keyboard on the labelled box and the artboard's placeholder", async () => {
    renderSearch("start");
    expect(box()).toHaveProperty("placeholder", "Place, stop, street, route or barangay");
    expect(document.activeElement).toBe(box());
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeTruthy();
    await ready();
  });

  it("fetches the head and the index once; the query is never sent anywhere", async () => {
    renderSearch("destination");
    await ready();
    await type("plaza rizal");
    await type("Diversion");
    expect(urls).toEqual(["/api/v1/network/head", `/api/v1/network/search-index/${HEAD.revisionId}`]);
    for (const u of urls) expect(u.toLowerCase()).not.toMatch(/plaza|diversion|\?/);
  });

  it("announces the count politely, groups results and footnotes old names", async () => {
    renderSearch();
    await ready();
    await type("Diversion");
    const live = screen.getByTestId("search-announcer");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toMatch(/^\d+ results?$/);
    expect(screen.getByTestId("search-group-places").textContent).toContain("Cor. Diversion Rd. & Fraternidad St.");
    expect(screen.getByTestId("search-legacy-note").textContent).toBe("Old route names are historical hints, not current routes.");
    expect(screen.getByTestId("search-osm-attribution").textContent).toBe("© OpenStreetMap contributors (ODbL)");
  });

  it("shows 5 per group and \"Show all {n}\"", async () => {
    renderSearch();
    await ready();
    await type("Centro");
    const routes = screen.getByTestId("search-group-routes");
    expect(routes.querySelectorAll("li")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 11" }));
    expect(screen.getByTestId("search-group-routes").querySelectorAll("li")).toHaveLength(11);
  });

  it("says plainly when nothing matches", async () => {
    renderSearch();
    await ready();
    await type("xyz");
    expect(screen.getByTestId("search-empty").textContent).toBe("No match in Naga — try a place, stop name, street, route or barangay.");
    expect(screen.getByTestId("search-announcer").textContent).toBe("0 results");
  });

  it("regional destinations only with the switch on, with its note", async () => {
    renderSearch();
    await ready();
    await type("Iriga");
    expect(screen.queryByTestId("search-group-regional")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Include regional connections" }));
    expect(screen.getByTestId("search-regional-note").textContent).toBe(
      "Regional connections on: terminal destination categories are included. Individual services are not verified.",
    );
    expect(screen.getByTestId("search-group-regional").textContent).toContain("Eastbound destinations from Eastbound Terminal · services not verified");
  });

  it("for=destination: an OpenStreetMap place sets the destination and goes back to the map", async () => {
    renderSearch("destination");
    await ready();
    await type("SM City");
    fireEvent.click(screen.getAllByTestId("search-result-osm")[0]!);
    const sm = raw.osmPlaces.find((p) => p.name === "SM City Naga")!;
    expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: { lat: sm.lat, lng: sm.lng }, label: "SM City Naga" });
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it("places, terminals, barangays and study labels link to their own screens (no notice)", async () => {
    renderSearch("start");
    await ready();
    await type("Abella");
    expect(screen.getByTestId("search-result-barangay").getAttribute("href")).toBe("/app/places/barangay/abella");
    await type("Bicol Central");
    expect(screen.getByTestId("search-result-terminal").getAttribute("href")).toBe("/app/terminals/T01");
    await type("UMA Residences");
    expect(screen.getByTestId("search-result-study").getAttribute("href")).toMatch(/^\/app\/places\/study\/DSC-/);
    expect(screen.queryByTestId("search-notice")).toBeNull();
    expect(frame.requestEndpoint).not.toHaveBeenCalled();
  });

  it("browsing: an OpenStreetMap place and a mapped-pin place open place detail", async () => {
    renderSearch();
    await ready();
    await type("SM City");
    const sm = raw.osmPlaces.find((p) => p.name === "SM City Naga")!;
    expect(screen.getAllByTestId("search-result-osm")[0]!.getAttribute("href")).toBe(`/app/places/osm/${sm.key.slice("osm:".length)}`);
    await type("Plaza Rizal");
    const plaza = raw.pinPlaces.find((p) => p.label === "Plaza Rizal")!;
    expect(screen.getAllByTestId("search-result-pin")[0]!.getAttribute("href")).toBe(`/app/places/pin/${plaza.key}`);
  });

  it("a #q= fragment prefills the box and shows its results", async () => {
    window.history.replaceState(null, "", "/app/search#q=Plaza%20Rizal");
    renderSearch();
    await ready();
    expect(box()).toHaveProperty("value", "Plaza Rizal");
    await waitFor(() => expect(screen.getAllByTestId("search-result-pin").length).toBeGreaterThan(0));
  });

  it("routes link to route detail; old route names are not tappable", async () => {
    renderSearch();
    await ready();
    await type("r8a");
    expect(screen.getAllByTestId("search-result-route")[0]!.getAttribute("href")).toBe("/app/routes/R8-A");
    await type("Pacol/Carolina");
    expect(screen.getByTestId("search-result-legacy").tagName).toBe("DIV");
  });

  it("Use current location and Choose on map go through the frame (no location request here)", async () => {
    const geolocation = { watchPosition: vi.fn(), getCurrentPosition: vi.fn() };
    vi.stubGlobal("navigator", { ...navigator, geolocation });
    renderSearch("start");
    fireEvent.click(screen.getByRole("button", { name: "Use current location" }));
    expect(frame.requestGps).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Choose on map" }));
    expect(frame.requestPick).toHaveBeenCalledWith("start");
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await ready();
  });

  it("for=destination offers Choose on map but not Use current location", async () => {
    renderSearch("destination");
    expect(screen.queryByRole("button", { name: "Use current location" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose on map" })).toBeTruthy();
    await ready();
  });

  it("no connection and nothing cached: says so, and Try again works", async () => {
    failing = true;
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderSearch();
    await waitFor(() => expect(screen.getByTestId("search-error").textContent).toContain("Search needs a connection the first time. Try again."));
    failing = false;
    online.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByTestId("search-error")).toBeNull());
    await ready();
  });

  it("offline with the index from earlier in the session: searches it and says from when", async () => {
    const first = renderSearch();
    await ready();
    first.unmount();
    failing = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderSearch();
    await waitFor(() => expect(screen.getByTestId("search-offline").textContent).toBe("Offline · searching data from 15 Oct 2026"));
    await type("plaza rizal");
    expect(screen.getByTestId("search-group-places")).toBeTruthy();
  });

  it("a server error (online) is not called offline: the cached index stays, with a retry", async () => {
    const first = renderSearch();
    await ready();
    first.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    renderSearch();
    await waitFor(() => expect(screen.getByTestId("search-failed").textContent).toContain("Search data couldn't load. Try again."));
    expect(screen.queryByTestId("search-offline")).toBeNull();
    await type("plaza rizal");
    expect(screen.getByTestId("search-group-places")).toBeTruthy();
  });

  it("nothing cached and a server error: says the data couldn't load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    renderSearch();
    await waitFor(() => expect(screen.getByTestId("search-error").textContent).toBe("Search data couldn't load. Try again.Try again"));
  });

  it("Close on a notice puts focus back on the row that opened it", async () => {
    renderSearch("save");
    await ready();
    await type("SM City");
    const row = screen.getAllByTestId("search-result-osm")[0]!;
    fireEvent.click(row);
    expect(document.activeElement?.textContent).toBe("SM City Naga");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("search-notice")).toBeNull();
    expect(document.activeElement).toBe(screen.getAllByTestId("search-result-osm")[0]);
  });

  it("Show all moves focus to the first row it revealed", async () => {
    renderSearch();
    await ready();
    await type("Centro");
    fireEvent.click(screen.getByRole("button", { name: "Show all 11" }));
    const rows = screen.getByTestId("search-group-routes").querySelectorAll("li > *");
    expect(document.activeElement).toBe(rows[5]);
  });

  it("for=save: the page note says saving opens soon; the notice gives the place's facts once", async () => {
    renderSearch("save");
    await ready();
    expect(screen.getByTestId("search-save-note").textContent).toBe("Saving places on this phone opens soon.");
    await type("SM City");
    fireEvent.click(screen.getAllByTestId("search-result-osm")[0]!);
    expect(screen.getByTestId("search-notice").textContent).not.toMatch(/opens soon/);
    expect(screen.getAllByText(/Saving places on this phone opens soon\./)).toHaveLength(1);
  });
});
