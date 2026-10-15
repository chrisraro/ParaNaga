// @vitest-environment jsdom
// Explore (src/ui/explore/explore-screen.tsx) over the captured search index and route list, with
// a mocked router and a stub app frame: chips filter the cards, "How to commute here" sets the
// destination, and every directory row links to its own detail screen.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchIndexSchema, type SearchIndex } from "@/domain/api/schemas";
import rawIndex from "../e2e/fixtures/network/search-index.json" with { type: "json" };
import rawRoutes from "../e2e/fixtures/network/routes.json" with { type: "json" };

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/explore",
}));

const { AppFrameContext, setEntryPath } = await import("@/ui/app-shell/app-frame-context");
const { ExploreView } = await import("@/ui/explore/explore-screen");

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
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/v1/routes"
        ? new Response(JSON.stringify(rawRoutes), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 404 }),
    ),
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
  it("All lists every OpenStreetMap place A–Z as a card with Photo pending, the kind and attribution", () => {
    renderExplore();
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(cards()).toHaveLength(index.osmPlaces.length);
    const sm = cards().find((c) => within(c).queryByRole("heading", { name: "SM City Naga" }))!;
    expect(within(sm).getByText("Photo pending")).toBeTruthy();
    expect(within(sm).getByText("Mall · from OpenStreetMap")).toBeTruthy();
    const smPlace = index.osmPlaces.find((p) => p.name === "SM City Naga")!;
    expect(within(sm).getByRole("link", { name: "SM City Naga" }).getAttribute("href")).toBe(`/app/places/osm/${smPlace.key.slice(4)}`);
    expect(screen.getByTestId("explore-places-note").textContent).toBe("Places come from OpenStreetMap. Entrances, hours and photos are not mapped yet.");
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors (ODbL)" })).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "All" })).toBeTruthy();
  });

  it("each chip lists only its categories; arrows move between chips", () => {
    renderExplore();
    fireEvent.click(screen.getByRole("tab", { name: "Markets & malls" }));
    expect(new Set(cards().map((c) => c.dataset.category))).toEqual(new Set(["market", "mall"]));
    expect(cards()).toHaveLength(index.osmPlaces.filter((p) => p.category === "market" || p.category === "mall").length);
    expect(screen.getByRole("tabpanel", { name: "Markets & malls" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Markets & malls" }), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Health" }));
    expect(cards().every((c) => c.dataset.category === "hospital_clinic")).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(cards().every((c) => c.dataset.category === "bus_terminal")).toBe(true);
    expect(cards()[0]!.textContent).toContain("Bus station · from OpenStreetMap");
  });

  it("an empty category says so", () => {
    renderExplore({ ...index, osmPlaces: index.osmPlaces.filter((p) => p.category !== "hospital_clinic") });
    fireEvent.click(screen.getByRole("tab", { name: "Health" }));
    expect(screen.queryAllByTestId("explore-card")).toHaveLength(0);
    expect(screen.getByTestId("explore-empty").textContent).toBe("No health on file yet.");
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

  it("Routes: 11 routes by group, chip, evidence and trial badges, linking to route detail", async () => {
    renderExplore();
    segment("Routes");
    await waitFor(() => expect(screen.getAllByTestId("explore-route")).toHaveLength(11));
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

  it("Terminals: 6 rows, Location not mapped, linking to terminal detail", () => {
    renderExplore();
    segment("Terminals");
    const rows = within(screen.getByTestId("explore-terminals")).getAllByRole("link");
    expect(rows).toHaveLength(6);
    expect(rows[0]!.getAttribute("href")).toBe("/app/terminals/T01");
    expect(rows.every((r) => r.textContent!.includes("Location not mapped"))).toBe(true);
  });

  it("Barangays: 27 rows, Not surveyed, linking to place detail", () => {
    renderExplore();
    segment("Barangays");
    const rows = within(screen.getByTestId("explore-barangays")).getAllByRole("link");
    expect(rows).toHaveLength(27);
    expect(rows.every((r) => /^\/app\/places\/barangay\/[a-z0-9-]+$/.test(r.getAttribute("href")!))).toBe(true);
    expect(rows.every((r) => r.textContent!.includes("Not surveyed"))).toBe(true);
  });

  it("Leads: 5 static rows, and the rail status with its sources", () => {
    renderExplore();
    segment("Leads");
    const list = screen.getByTestId("explore-leads");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).getAllByText("Documented, not verified")).toHaveLength(5);
    expect(screen.getByTestId("explore-rail").textContent).toBe(
      "PNR Naga–Lupi Viejo: community reports say operational; Naga–Legazpi: community reports say suspended. Verify with PNR. Sources S19, S20, S21",
    );
  });
});
