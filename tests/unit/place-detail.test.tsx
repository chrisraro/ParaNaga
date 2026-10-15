// @vitest-environment jsdom
// Place detail (src/ui/places/place-detail.tsx) and Terminal detail
// (src/ui/terminals/terminal-detail.tsx) with the real captured data, a mocked router, a stub
// app frame and a stub map: what each kind of place shows, and what its action does.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchIndexSchema, terminalDetailSchema, type SearchIndex } from "@/domain/api/schemas";
import rawIndex from "../e2e/fixtures/network/search-index.json" with { type: "json" };
import rawSources from "../e2e/fixtures/network/sources.json" with { type: "json" };
import rawStopA1 from "../e2e/fixtures/network/stop-a1.json" with { type: "json" };
import rawT01 from "../e2e/fixtures/network/terminal-t01.json" with { type: "json" };
import rawT06 from "../e2e/fixtures/network/terminal-t06.json" with { type: "json" };

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), pathname: "/app/places/x" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
}));
// Leaflet needs a real layout engine: the map is a stub that shows what it was given.
vi.mock("@/ui/map/naga-map", () => ({
  NagaMap: (props: { label?: string; placeMarker?: { label: string }; stopPins?: unknown[]; initialView?: { center: { lat: number; lng: number } } }) => (
    <div
      data-testid="naga-map-stub"
      aria-label={props.label}
      data-marker={props.placeMarker?.label ?? ""}
      data-pins={props.stopPins?.length ?? 0}
      data-lat={props.initialView?.center.lat}
    />
  ),
}));

const { AppFrameContext, setEntryPath } = await import("@/ui/app-shell/app-frame-context");
const { PlaceDetailView } = await import("@/ui/places/place-detail");
const { TerminalDetailView } = await import("@/ui/terminals/terminal-detail");
const { findPlace } = await import("@/domain/places/place-detail");

const index: SearchIndex = searchIndexSchema.parse(rawIndex);
const SM = index.osmPlaces.find((p) => p.name === "SM City Naga")!;
const PLAZA = index.pinPlaces.find((p) => p.label === "Plaza Rizal")!;
const STUDY = index.studyLabels.find((s) => s.label === "UMA Residences")!;

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

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let urls: string[] = [];

beforeEach(() => {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url === "/api/v1/sources") return json(rawSources);
      if (url === `/api/v1/stops/${rawStopA1.stop.id}`) return json(rawStopA1);
      return new Response("{}", { status: 404 });
    }),
  );
  setEntryPath("/app/search");
  window.history.replaceState(null, "", "/app/places/x");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setEntryPath(null);
  nav.pathname = "/app/places/x";
});

function renderPlace(ref: Parameters<typeof PlaceDetailView>[0]["placeRef"]) {
  return render(
    <AppFrameContext.Provider value={frame}>
      <PlaceDetailView index={index} placeRef={ref} />
    </AppFrameContext.Provider>,
  );
}

const smRef = () => {
  const [, type, id] = /^osm:(node|way|relation)\/(\d+)$/.exec(SM.key)!;
  return { kind: "osm" as const, type: type as "node" | "way" | "relation", id: id! };
};

describe("OpenStreetMap place", () => {
  it("names the source, never an entrance, and always shows the location note and the attribution", () => {
    renderPlace(smRef());
    expect(screen.getByRole("heading", { level: 1, name: "SM City Naga" })).toBe(document.activeElement);
    expect(screen.getByTestId("place-kind").textContent).toBe("Mall · from OpenStreetMap");
    expect(screen.getByTestId("place-badge-osm").textContent).toBe("OpenStreetMap");
    expect(screen.queryByText("Mapped candidate")).toBeNull();
    expect(screen.getByTestId("place-location-note").textContent).toBe("Location from OpenStreetMap — entrance not mapped.");
    const attribution = screen.getByTestId("place-osm-attribution").querySelector("a")!;
    expect(attribution.textContent).toBe("© OpenStreetMap contributors (ODbL)");
    expect(screen.getByTestId("place-entrance").textContent).toContain("Not yet mapped");
    expect(screen.getByTestId("place-source").textContent).toContain(`OpenStreetMap, snapshot of 15 Oct 2026 · object ${smRef().type}/${smRef().id} v${SM.osmVersion}`);
    const osmLink = screen.getByTestId("place-osm-link");
    expect(osmLink.getAttribute("href")).toBe(`https://www.openstreetmap.org/${smRef().type}/${smRef().id}`);
    expect(osmLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(osmLink.getAttribute("target")).toBe("_blank");
    expect(screen.getByTestId("place-photo").textContent).toBe("Photo pendingPhotos open with community corrections.");
    // Saving opens with Task 8: a note, no button.
    expect(screen.getByTestId("place-save-note").textContent).toBe("Saving places on this phone opens soon.");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    // Map centred on the place with one named marker.
    const map = screen.getByTestId("naga-map-stub");
    expect(map.getAttribute("data-marker")).toBe("SM City Naga");
    expect(Number(map.getAttribute("data-lat"))).toBe(SM.lat);
  });

  it("lists nearest mapped stops within 600 m as links to stop detail", () => {
    renderPlace(smRef());
    const links = screen.getByTestId("place-nearest-stops").querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(3);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^\/app\/stops\/[0-9a-f-]{36}$/);
      expect(a.textContent).toMatch(/≈ \d+ m/);
    }
  });

  it("Plan trip to / from sets that end at the place's coordinate and opens the map", () => {
    renderPlace(smRef());
    fireEvent.click(screen.getByRole("button", { name: "Plan trip to SM City Naga" }));
    expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: { lat: SM.lat, lng: SM.lng }, label: "SM City Naga" });
    expect(nav.push).toHaveBeenCalledWith("/app");
    fireEvent.click(screen.getByRole("radio", { name: "Directions from here" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan trip from SM City Naga" }));
    expect(frame.requestEndpoint).toHaveBeenLastCalledWith("start", { point: { lat: SM.lat, lng: SM.lng }, label: "SM City Naga" });
  });

  it("shows other names only when OpenStreetMap has them", () => {
    renderPlace(smRef());
    expect(screen.queryByTestId("place-aka")).toBeNull();
    cleanup();
    const lto = index.osmPlaces.find((p) => p.name === "Land Transportation Office")!;
    const [, type, id] = /^osm:(node|way|relation)\/(\d+)$/.exec(lto.key)!;
    renderPlace({ kind: "osm", type: type as "node", id: id! });
    expect(screen.getByTestId("place-aka").textContent).toBe("Also known asLTO Naga District Office");
  });
});

describe("mapped-pin place", () => {
  it("shows its pins (map rings and links), the candidate badge and the dated source", async () => {
    renderPlace({ kind: "pin", key: PLAZA.key });
    expect(screen.getByRole("heading", { level: 1, name: "Plaza Rizal" })).toBeTruthy();
    expect(screen.getByTestId("place-kind").textContent).toBe(`Mapped stop · ${PLAZA.pins.length} pins`);
    expect(screen.getByTestId("place-badge-candidate").textContent).toBe("Mapped candidate");
    expect(screen.getByTestId("naga-map-stub").getAttribute("data-pins")).toBe(String(PLAZA.pins.length));
    const pins = screen.getByTestId("place-pins").querySelectorAll("a");
    expect([...pins].map((a) => a.querySelector(".pn-cell__title")!.textContent)).toEqual(PLAZA.pins.map((p) => `${p.code} · ${p.layer}`));
    expect(screen.getByTestId("place-location-note").textContent).toBe("Trips use unverified mapped pins.");
    expect(screen.queryByTestId("place-aka")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("place-source").textContent).toContain("Public My Maps snapshot · retrieved 15 Oct 2026"));
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
  });

  it("Plan trip to sets the destination at the on-route pin, labelled as a mapped pin", () => {
    renderPlace({ kind: "pin", key: PLAZA.key });
    fireEvent.click(screen.getByRole("button", { name: "Plan trip to Plaza Rizal" }));
    const a1 = PLAZA.pins.find((p) => p.onRoute)!;
    expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: { lat: a1.lat, lng: a1.lng }, label: "Plaza Rizal (mapped pin)" });
  });
});

describe("barangay", () => {
  it("no location: no map, the not-surveyed badge, and the S22 source with its check date", async () => {
    renderPlace({ kind: "barangay", key: "abella" });
    expect(screen.getByRole("heading", { level: 1, name: "Abella" })).toBeTruthy();
    expect(screen.getByTestId("place-kind").textContent).toBe("Barangay");
    expect(screen.getByTestId("place-badge-not-surveyed").textContent).toBe("Not surveyed");
    expect(screen.queryByTestId("naga-map-stub")).toBeNull();
    expect(screen.getByTestId("place-boundary").textContent).toBe("BoundaryNot on file");
    expect(screen.getByTestId("place-stops").textContent).toBe("Stops in this barangayUnknown until a boundary is mapped");
    await waitFor(() => expect(screen.getByTestId("place-source").textContent).toBe("SourcePSA Naga barangays · checked 15 Oct 2026"));
  });

  it("the CTA asks the map for a pick (destination by default, start when “from here”)", () => {
    renderPlace({ kind: "barangay", key: "abella" });
    fireEvent.click(screen.getByRole("button", { name: "Choose a point in Abella on the map" }));
    expect(frame.requestPick).toHaveBeenCalledWith("destination");
    expect(frame.requestEndpoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Directions from here" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a point in Abella on the map" }));
    expect(frame.requestPick).toHaveBeenLastCalledWith("start");
  });
});

describe("2025 study label", () => {
  it("no CTA: a note and a search link instead", () => {
    renderPlace({ kind: "study", code: STUDY.code });
    expect(screen.getByRole("heading", { level: 1, name: "UMA Residences" })).toBeTruthy();
    expect(screen.getByTestId("place-kind").textContent).toBe("Stop label from the 2025 route study (2025 LPTRP SimEx)");
    expect(screen.getByTestId("place-badge-documented").textContent).toBe("Documented only");
    expect(screen.queryByTestId("place-cta")).toBeNull();
    expect(screen.queryByRole("button", { name: /plan trip|choose a point/i })).toBeNull();
    expect(screen.queryByTestId("naga-map-stub")).toBeNull();
    expect(screen.getByTestId("place-location-note").textContent).toBe("No location on file, so trips can't start or end here.");
    const link = screen.getByTestId("place-search-link");
    expect(link.textContent).toBe("Search mapped stops for “UMA Residences”");
    expect(link.getAttribute("href")).toBe("/app/search#q=UMA%20Residences");
    expect(screen.getByTestId("place-route").textContent).toBe(`Route${STUDY.routeCode} ${STUDY.direction}`);
    expect(screen.getByTestId("place-location").textContent).toBe("LocationNot mapped. This is a schematic label, not a curb.");
    expect(screen.getByTestId("place-status").textContent).toBe("StatusHistorical pilot label; current status unverified");
    expect(screen.getByTestId("place-source").textContent).toBe("SourcesS33, S34");
  });
});

describe("not found", () => {
  it("an unknown place gets the Place not-found panel (one 'not found', in the h1)", () => {
    nav.pathname = "/app/places/barangay/nowhere";
    expect(findPlace(index, { kind: "barangay", key: "nowhere" })).toBeNull();
    renderPlace({ kind: "barangay", key: "nowhere" });
    expect(screen.getByRole("heading", { level: 1, name: "Place not found" })).toBeTruthy();
    expect(screen.getByTestId("detail-not-found").querySelector(".pn-detail__header-title")!.textContent).toBe("Place");
  });
});

describe("Terminal detail", () => {
  const renderTerminal = (raw: unknown) =>
    render(
      <AppFrameContext.Provider value={frame}>
        <TerminalDetailView data={terminalDetailSchema.parse(raw)} />
      </AppFrameContext.Provider>,
    );

  it("T01: no map, Location not mapped, the note, Loop A and Loop B with the trial line", () => {
    renderTerminal(rawT01);
    expect(screen.getByRole("heading", { level: 1, name: "Bicol Central Station" })).toBe(document.activeElement);
    expect(screen.queryByTestId("naga-map-stub")).toBeNull();
    expect(screen.getByTestId("terminal-pill").textContent).toBe("Location not mapped");
    expect(screen.getByTestId("terminal-sub").textContent).toBe("Bus · Ninoy & Cory Avenue, Triangulo");
    expect(screen.getByText("Documented only")).toBeTruthy();
    expect(screen.getByTestId("terminal-address").textContent).toBe("Address: city source S09");
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("Not the PNR railway station.");
    const legal = screen.getAllByTestId("terminal-route-legal_plan");
    const trial = screen.getAllByTestId("terminal-route-trial");
    expect(legal.map((a) => a.querySelector(".pn-loop-chip")!.textContent)).toEqual(["Loop A", "Loop B"]);
    expect(legal[0]!.textContent).toContain("Named in the legal route plan · bay not mapped");
    expect(trial[0]!.textContent).toContain("Named in the Nov 2025 trial · permanence unconfirmed");
    expect(trial[0]!.textContent).toContain("Trial — permanence unconfirmed");
    expect(legal[0]!.getAttribute("href")).toBe("/app/routes/R8-A");
    expect(screen.getByText("From the legal route plan. Bays and regional services are not mapped yet.")).toBeTruthy();
    expect(screen.getByTestId("terminal-directions-note").textContent).toBe("Directions unavailable until the terminal's location is mapped.");
    expect(screen.queryByRole("button", { name: /directions/i })).toBeNull();
  });

  it("tabs: Entrances and Hours say what is not on file", () => {
    renderTerminal(rawT01);
    fireEvent.click(screen.getByRole("tab", { name: "Entrances" }));
    expect(screen.getByRole("tabpanel").textContent).toBe(
      "No entrances surveyed yetParaNaga has no location for this terminal yet, so trips can't start or end here.",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Hours" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Opening hoursNot on fileEvidenceNone on file");
  });

  it("the tab panel is labelled by the active tab; Regional destinations by its heading", () => {
    renderTerminal({
      ...rawT01,
      destinationCategories: [{ category: "eastbound", destinations: ["Pili"], evidenceStatus: null, sourceCodes: ["S12"] }],
    });
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Routes" }).id);
    expect(screen.getByRole("tabpanel", { name: "Routes" })).toBe(panel);
    expect(screen.getByRole("region", { name: "Regional destinations" }).getAttribute("aria-label")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Hours" }));
    expect(screen.getByRole("tabpanel", { name: "Hours" })).toBeTruthy();
  });

  it("with no own sources but an evidence status, no chip cites the response's other sources", () => {
    renderTerminal({ ...rawT01, terminal: { ...rawT01.terminal, sourceCodes: [] } });
    const address = screen.getByTestId("terminal-address");
    expect(address.textContent).toBe("Address: city source");
    expect(address.querySelectorAll(".pn-mono")).toHaveLength(0);
    for (const s of rawT01.sources) expect(address.textContent).not.toContain(s.code);
  });

  it("address chips come only from the terminal's own sources (none: no chips)", () => {
    renderTerminal({ ...rawT01, terminal: { ...rawT01.terminal, sourceCodes: [], evidenceStatus: null } });
    expect(screen.getByTestId("terminal-address").textContent).toBe("Address: no evidence on file");
  });

  it("T06: the rail station note and no route plan", () => {
    renderTerminal(rawT06);
    expect(screen.getByRole("note").textContent).toBe("Not Bicol Central Station (the bus terminal).");
    expect(screen.getByTestId("terminal-no-routes").textContent).toBe("No route plan names this terminal yet.");
    expect(screen.queryByText(/From the legal route plan/)).toBeNull();
  });

  it("a terminal with destination categories lists them, unverified, and explains the labels", () => {
    const t02 = {
      ...rawT01,
      terminal: { ...rawT01.terminal, code: "T02", name: "Eastbound Terminal" },
      routes: [],
      destinationCategories: [{ category: "eastbound", destinations: ["Pili", "Iriga"], evidenceStatus: null, sourceCodes: ["S12"] }],
    };
    renderTerminal(t02);
    expect(screen.getByRole("note").textContent).toBe("Category labels such as northbound and eastbound are administrative, not compass directions.");
    expect(screen.getByTestId("terminal-destinations").textContent).toBe("Eastbound: Pili, Iriga · services not verified");
    expect(screen.getByTestId("terminal-no-routes")).toBeTruthy();
  });
});
