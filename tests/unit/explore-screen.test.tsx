// @vitest-environment jsdom
// Explore (src/ui/explore/explore-screen.tsx) over the captured search index and route list, with
// a mocked router and a stub app frame: chips filter the cards, "How to commute here" sets the
// destination, and every directory row links to its own detail screen.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchIndexSchema, type SearchIndex } from "@/domain/api/schemas";
import rawIndex from "../e2e/fixtures/network/search-index.json" with { type: "json" };
import rawRoutes from "../e2e/fixtures/network/routes.json" with { type: "json" };
import rawSources from "../e2e/fixtures/network/sources.json" with { type: "json" };

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/explore",
}));

const { AppFrameContext, setEntryPath } = await import("@/ui/app-shell/app-frame-context");
const { ExploreScreen, ExploreView } = await import("@/ui/explore/explore-screen");
const { resetSearchIndexCache } = await import("@/client/search/use-search-index");
const { CARD_LIMIT } = await import("@/domain/places/explore");

const index: SearchIndex = searchIndexSchema.parse(rawIndex);

const frame = {
  openPanel: () => () => {},
  markHomeNavigation: () => {},
  isHomeNavigation: () => false,
  mapFocus: null,
  showOnMap: () => {},
  hideTabBar: () => () => {},
  tabBarVisible: true,
  tabBarClearance: 0,
  panelOpen: true,
  endpointRequest: null,
  requestEndpoint: vi.fn(),
  requestPick: vi.fn(),
  requestGps: vi.fn(),
  tripRequest: null,
  requestTrip: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url === "/api/v1/routes" ? rawRoutes : url === "/api/v1/sources" ? rawSources : null;
      return body
        ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 404 });
    }),
  );
  setEntryPath("/app");
  window.history.replaceState(null, "", "/app/explore");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setEntryPath(null);
});

function renderExplore(data: SearchIndex = index) {
  return render(
    <AppFrameContext.Provider value={frame}>
      <ExploreView index={data} />
    </AppFrameContext.Provider>,
  );
}

const cards = () => screen.getAllByTestId("explore-card");

describe("Explore: places by category", () => {
  it("All shows the first 12 places A–Z as cards with Photo pending, the kind and attribution; Show all reveals the rest", () => {
    renderExplore();
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(cards()).toHaveLength(CARD_LIMIT);
    const showAll = screen.getByRole("button", { name: `Show all ${index.osmPlaces.length} places` });
    fireEvent.click(showAll);
    expect(cards()).toHaveLength(index.osmPlaces.length);
    expect(screen.queryByTestId("explore-show-all")).toBeNull();
    // Focus moves to the first newly revealed card.
    expect(document.activeElement).toBe(within(cards()[CARD_LIMIT]!).getByRole("link"));
    const sm = cards().find((c) => within(c).queryByRole("heading", { name: "SM City Naga" }))!;
    expect(within(sm).getByRole("img", { name: "SM City Naga, Dec 2025" })).toBeTruthy();
    expect(within(sm).getByRole("link", { name: "Photo credit" }).getAttribute("href")).toMatch(/^\/app\/help\/sources#photo-/);
    expect(within(sm).getByText("Mall")).toBeTruthy();
    const smPlace = index.osmPlaces.find((p) => p.name === "SM City Naga")!;
    expect(within(sm).getByRole("link", { name: "SM City Naga" }).getAttribute("href")).toBe(`/app/places/osm/${smPlace.key.slice(4)}`);
    // The places note and the OpenStreetMap credit live on Sources and credits.
    expect(screen.queryByTestId("explore-places-note")).toBeNull();
    expect(screen.queryByRole("link", { name: "© OpenStreetMap contributors (ODbL)" })).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "All" })).toBeTruthy();
  }, 30_000); // Show all renders every OSM place and the whole-document role queries (getByRole by name over
  // hundreds of links/images) dominate: 7-9 s standalone, more under parallel load. Not cheap to cut
  // without weakening the assertions, so it keeps a generous timeout.

  it("Jump to directory moves focus to the Directory heading", () => {
    renderExplore();
    fireEvent.click(screen.getByRole("link", { name: "Jump to directory" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Directory" }));
  });

  it("each chip lists only its categories; arrows move between chips", () => {
    renderExplore();
    fireEvent.click(screen.getByRole("tab", { name: "Markets & malls" }));
    expect(screen.queryByTestId("explore-show-all")).toBeNull();
    expect(new Set(cards().map((c) => c.dataset.category))).toEqual(new Set(["market", "mall"]));
    expect(cards()).toHaveLength(index.osmPlaces.filter((p) => p.category === "market" || p.category === "mall").length);
    expect(screen.getByRole("tabpanel", { name: "Markets & malls" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Markets & malls" }), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Health" }));
    expect(cards().every((c) => c.dataset.category === "hospital_clinic")).toBe(true);
    fireEvent.click(screen.getByTestId("explore-chip-terminals"));
    expect(cards().every((c) => c.dataset.category === "bus_terminal")).toBe(true);
    expect(cards()[0]!.textContent).toContain("Bus station");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "Other places" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the Task 14 chips list the named places; before their chunk arrived an empty chip says loading, never none on file", () => {
    const cafe = { key: "osm:node/1", name: "Bo's Coffee", aliases: [], category: "cafe" as const, lat: 13.62, lng: 123.18, osmVersion: 1, sourceCode: "OSM-2026-10-17" };
    const pharmacy = { ...cafe, key: "osm:node/2", name: "Mercury Drug", category: "pharmacy" as const };
    const { unmount } = render(<ExploreView index={{ ...index, osmPlaces: [...index.osmPlaces, cafe, pharmacy] }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Food & drink" }));
    expect(cards().map((c) => c.textContent)).toEqual([expect.stringContaining("Bo's Coffee")]);
    expect(cards()[0]!.textContent).toContain("Cafe");
    fireEvent.click(screen.getByRole("tab", { name: "Health" }));
    expect(cards().map((c) => c.dataset.category)).toContain("pharmacy");
    unmount();
    render(<ExploreView index={index} morePlaces="loading" />);
    fireEvent.click(screen.getByRole("tab", { name: "Food & drink" }));
    expect(screen.getByTestId("explore-more-pending").textContent).toBe("Loading more places…");
    expect(screen.queryByTestId("explore-empty")).toBeNull();
  });

  it("an empty category says so", () => {
    renderExplore({ ...index, osmPlaces: index.osmPlaces.filter((p) => p.category !== "hospital_clinic") });
    fireEvent.click(screen.getByRole("tab", { name: "Health" }));
    expect(screen.queryAllByTestId("explore-card")).toHaveLength(0);
    expect(screen.getByTestId("explore-empty").textContent).toBe("No health places on file yet.");
  });

  it("How to commute here sets the destination to the place's coordinate and opens the map", () => {
    renderExplore();
    fireEvent.click(screen.getByRole("tab", { name: "Faith" }));
    const first = placesFirst("place_of_worship");
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: `How to commute here: ${first.name}` }));
    expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: { lat: first.lat, lng: first.lng }, label: first.name });
    expect(nav.push).toHaveBeenCalledWith("/app");
  });
});

function placesFirst(category: string) {
  return index.osmPlaces
    .filter((p) => p.category === category)
    .sort((a, b) => new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare(a.name, b.name))[0]!;
}

describe("Explore: directory", () => {
  const segment = (name: string) => fireEvent.click(within(screen.getByRole("tablist", { name: "Directory sections" })).getByRole("tab", { name }));

  it("Mapped stops: one row per mapped-pin place, A–Z, with pins and loops, linking to place detail", () => {
    renderExplore();
    const list = screen.getByTestId("explore-stops");
    const rows = within(list).getAllByRole("link");
    expect(rows).toHaveLength(index.pinPlaces.length);
    const shop = index.pinPlaces.find((p) => p.label === "101 Shopping Centre")!;
    const row = rows.find((r) => r.getAttribute("href") === `/app/places/pin/${shop.key}`)!;
    expect(row.textContent).toContain("4 pins · Loop A, B, C, D");
    expect(row.textContent).toContain("Mapped candidate");
    expect(screen.getByRole("tabpanel", { name: "Mapped stops" })).toBeTruthy();
  });

  it("Routes: 13 routes by group (11 LPTRP + 2 feeders), chip, evidence and trial badges, linking to route detail", async () => {
    renderExplore();
    segment("Routes");
    await waitFor(() => expect(screen.getAllByTestId("explore-route")).toHaveLength(13));
    const rows = screen.getAllByTestId("explore-route");
    expect(screen.getByRole("heading", { level: 3, name: "Group 8" })).toBeTruthy();
    const a = rows.find((r) => r.getAttribute("href") === "/app/routes/R8-A")!;
    expect(a.textContent).toContain("Loop A");
    expect(a.textContent).toContain("Provisional stops");
    expect(a.textContent).toContain("Trial — permanence unconfirmed");
    const r1 = rows.find((r) => r.getAttribute("href") === "/app/routes/R1")!;
    expect(r1.textContent).toContain("Documented only");
    expect(r1.textContent).not.toContain("Trial");
  });

  it("Terminals: 16 rows, the OSM badge or Location not mapped, linking to terminal detail", () => {
    renderExplore();
    segment("Terminals");
    const rows = within(screen.getByTestId("explore-terminals")).getAllByRole("link");
    expect(rows).toHaveLength(16);
    expect(rows[0]!.getAttribute("href")).toBe("/app/terminals/T01");
    expect(rows[0]!.textContent).toContain("Community-mapped location (OpenStreetMap)");
    const unmapped = rows.filter((r) => r.textContent!.includes("Location not mapped")).map((r) => r.getAttribute("href"));
    expect(unmapped).toEqual(["/app/terminals/T02", "/app/terminals/T05", "/app/terminals/T15", "/app/terminals/T16"]);
    // Kind sub-label and mode chips (icon + text).
    const t05 = rows.find((r) => r.getAttribute("href") === "/app/terminals/T05")!;
    expect(t05.textContent).toContain("Loading point · Location not mapped");
    const t15 = rows.find((r) => r.getAttribute("href") === "/app/terminals/T15")!;
    expect(t15.textContent).toContain("Waiting area · Location not mapped");
    expect([...rows[0]!.querySelectorAll('[data-testid="mode-chip"]')].map((c) => c.textContent)).toEqual(["Bus", "UV Express"]);
  });

  it("Terminals: the mode filter (Tricycle) leaves T14 and the two waiting areas; All restores 16", () => {
    renderExplore();
    segment("Terminals");
    fireEvent.click(screen.getByRole("button", { name: "Tricycle" }));
    const rows = () => within(screen.getByTestId("explore-terminals")).getAllByRole("link");
    expect(rows().map((r) => r.getAttribute("href"))).toEqual(["/app/terminals/T14", "/app/terminals/T15", "/app/terminals/T16"]);
    expect(screen.getByRole("button", { name: "Tricycle" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(rows()).toHaveLength(16);
  });

  it("Barangays: 27 rows, Not surveyed, linking to place detail", () => {
    renderExplore();
    segment("Barangays");
    const rows = within(screen.getByTestId("explore-barangays")).getAllByRole("link");
    expect(rows).toHaveLength(27);
    expect(rows.every((r) => /^\/app\/places\/barangay\/[a-z0-9-]+$/.test(r.getAttribute("href")!))).toBe(true);
    expect(rows.every((r) => r.textContent!.includes("Not surveyed"))).toBe(true);
  });

  it("Leads: 5 static rows, and the rail status without source codes", async () => {
    renderExplore();
    segment("Leads");
    const list = screen.getByTestId("explore-leads");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).getAllByText("Documented, not verified")).toHaveLength(5);
    expect(screen.getByTestId("explore-rail").textContent).toBe(
      "PNR Naga–Lupi Viejo: reported operating. Naga–Legazpi: reported suspended. Verify with PNR.",
    );
    expect(screen.queryByTestId("explore-rail-sources")).toBeNull();
  });
});

describe("Explore without the search index", () => {
  it("shows the error with Try again, and the Routes directory still lists the 13 routes", async () => {
    resetSearchIndexCache();
    render(
      <AppFrameContext.Provider value={frame}>
        <ExploreScreen />
      </AppFrameContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("explore-error")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Directory sections" })).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("explore-route")).toHaveLength(13));
  });
});
