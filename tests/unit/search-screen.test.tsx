// @vitest-environment jsdom
// The Search screen (src/ui/search/search-screen.tsx) with the real captured index, a mocked
// router and a stub app frame: what it fetches (never the query), the states, the live region,
// and what picking a result does. Saved places live in IndexedDB (fake-indexeddb here).
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
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
const { clearAllStores, listSavedPlaces, putSavedPlace } = await import("@/client/storage/db");

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

let urls: string[] = [];
let failing = false;
/** The lazy named-places chunk: null = the request fails. */
let morePlaces: { revision: typeof raw.revision; places: unknown[] } | null = null;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  await clearAllStores();
  urls = [];
  failing = false;
  morePlaces = { revision: raw.revision, places: [] };
  resetSearchIndexCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (failing) throw new TypeError("Failed to fetch");
      if (url === "/api/v1/network/head") return json(HEAD);
      if (url === `/api/v1/network/search-index/${HEAD.revisionId}`) return json(raw);
      if (url === `/api/v1/network/search-places/${HEAD.revisionId}` && morePlaces) return json(morePlaces);
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

  it("fetches the head, the index and the lazy places chunk once; the query is never sent anywhere", async () => {
    renderSearch("destination");
    await ready();
    await type("plaza rizal");
    await type("Diversion");
    // Task 14: the named-places chunk follows the index (a lazy second GET); neither carries the query.
    expect(urls).toEqual(["/api/v1/network/head", `/api/v1/network/search-index/${HEAD.revisionId}`, `/api/v1/network/search-places/${HEAD.revisionId}`]);
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
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(screen.getByTestId("search-group-routes").querySelectorAll("li")).toHaveLength(12);
  });

  it("finds a cafe from the lazy places chunk, from OpenStreetMap, never verified; a failed chunk is said plainly", async () => {
    morePlaces = {
      revision: raw.revision,
      places: [{ key: "osm:node/42", name: "Synthetic Brew Cafe", aliases: [], category: "cafe", lat: 13.62, lng: 123.18, osmVersion: 1, sourceCode: "OSM-2026-10-17" }],
    };
    renderSearch();
    await ready();
    await type("synthetic brew");
    await waitFor(() => expect(screen.getByTestId("search-group-places").textContent).toContain("Synthetic Brew Cafe"));
    expect(screen.getByTestId("search-group-places").textContent).toContain("Cafe · from OpenStreetMap");
    expect(screen.getByTestId("search-group-places").textContent).not.toMatch(/verified/i);
    expect(screen.queryByTestId("search-more-failed")).toBeNull();
    cleanup();

    morePlaces = null;
    resetSearchIndexCache();
    renderSearch();
    await ready();
    await type("Centro");
    await waitFor(() => expect(screen.getByTestId("search-more-failed")).toBeTruthy());
    // The core index still answers.
    expect(screen.getByTestId("search-group-routes")).toBeTruthy();
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
    expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: { lat: sm.lat, lng: sm.lng }, label: "SM City Naga", place: "osm" });
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
    // Read once: the fragment leaves the history entry, so a later visit does not prefill it.
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/app/search");
  });

  it("under Strict Mode the #q= prefill survives the effect re-run, then the hash is cleared", async () => {
    window.history.replaceState(null, "", "/app/search#q=Plaza%20Rizal");
    render(
      <StrictMode>
        <AppFrameContext.Provider value={frame}>
          <SearchScreen />
        </AppFrameContext.Provider>
      </StrictMode>,
    );
    await ready();
    expect(box()).toHaveProperty("value", "Plaza Rizal");
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(box()).toHaveProperty("value", "Plaza Rizal");
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
    await waitFor(() => expect(screen.getByTestId("search-offline").textContent).toBe("Offline · searching data from 16 Oct 2026"));
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

  it("a saved place is searched; its notice offers both trip ends and Close puts focus back on its row", async () => {
    await putSavedPlace({ id: "p1", label: "Lola's house", point: { lat: 13.625, lng: 123.185 }, source: "pinned", savedAt: "2026-10-16T02:00:00.000Z" });
    renderSearch();
    await ready();
    await type("Lola");
    const row = await screen.findByTestId("search-result-saved");
    expect(screen.getByTestId("search-group-saved").textContent).toContain("Lola's house");
    fireEvent.click(row);
    expect(document.activeElement?.textContent).toBe("Lola's house");
    expect(screen.getByRole("button", { name: "Set as start" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("search-notice")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("search-result-saved"));
  });

  it("Show all moves focus to the first row it revealed", async () => {
    renderSearch();
    await ready();
    await type("Centro");
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    const rows = screen.getByTestId("search-group-routes").querySelectorAll("li > *");
    expect(document.activeElement).toBe(rows[5]);
  });

  it("for=save: a place already saved at that point is not saved twice", async () => {
    const sm = raw.osmPlaces.find((p) => p.name === "SM City Naga")!;
    await putSavedPlace({ id: "p1", label: "The mall", point: { lat: sm.lat, lng: sm.lng }, source: "osm", savedAt: "2026-10-16T02:00:00.000Z" });
    renderSearch("save");
    await ready();
    // The saved places are read once the saved row shows for its own name; then one tap.
    await type("The mall");
    await screen.findByTestId("search-group-saved");
    await type("SM City");
    fireEvent.click(screen.getAllByTestId("search-result-osm")[0]!);
    expect(screen.getByTestId("search-already-saved").textContent).toBe("Already saved on this phone as “The mall”.");
    expect(screen.getByTestId("search-save-dialog").hasAttribute("open")).toBe(false);
    expect((await listSavedPlaces()).records).toHaveLength(1);
  });

  it("for=save: a place opens the name dialog prefilled; Save stores it on this phone and goes back", async () => {
    renderSearch("save");
    await ready();
    expect(screen.getByTestId("search-save-note").textContent).toBe("Pick a place to save on this phone. OpenStreetMap places and mapped pins can be saved.");
    expect(screen.queryByText(/opens soon/)).toBeNull();
    await type("SM City");
    fireEvent.click(screen.getAllByTestId("search-result-osm")[0]!);
    const dialog = screen.getByTestId("search-save-dialog");
    const input = dialog.querySelector("input")!;
    expect(input.value).toBe("SM City Naga");
    // Too long or empty names are refused with a message.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(dialog.textContent).toContain("Enter a name of 1 to 40 characters.");
    fireEvent.change(input, { target: { value: "  The   mall " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(nav.back).toHaveBeenCalledTimes(1));
    const sm = raw.osmPlaces.find((p) => p.name === "SM City Naga")!;
    const { records } = await listSavedPlaces();
    expect(records).toMatchObject([{ label: "The mall", point: { lat: sm.lat, lng: sm.lng }, source: "osm" }]);
    expect(frame.requestEndpoint).not.toHaveBeenCalled();
  });
});
