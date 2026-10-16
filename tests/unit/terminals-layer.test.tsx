// @vitest-environment jsdom
// Terminals layer, the Layers sheet terminal list and the tricycle hint card (Increment D, Task 13)
// over the captured snapshot: which terminals are drawn, their accessible names, never colour
// alone, and the D15 card copy.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { networkSnapshotSchema } from "@/domain/api/schemas";
import {
  TERMINAL_DOM_MARKER_LIMIT,
  groupScreenPoints,
  terminalGroupName,
  regionalServiceRow,
  terminalDirectionsLabel,
  terminalKindLabel,
  terminalMarkerName,
  terminalMarkerRender,
  terminalModesPhrase,
  terminalOsmLocationText,
} from "@/domain/places/terminals";
import { DEFAULT_LAYERS_PREF, type LayersPref } from "@/domain/prefs/prefs";
import { tricycleHint, tricycleHintSources } from "@/domain/trip/tricycle-hint";
import { filterMapTerminals, listTerminals } from "@/ui/map/layers-sheet";
import { TerminalMarkerTiles, TerminalsLayer, type MapTerminal } from "@/ui/map/terminals-layer";
import { TricycleHintCard } from "@/ui/trip/tricycle-hint";
import rawSnapshot from "../e2e/fixtures/network/snapshot.json" with { type: "json" };

const SNAPSHOT = networkSnapshotSchema.parse(rawSnapshot);
const layers = (patch: Partial<LayersPref> = {}): LayersPref => ({ ...DEFAULT_LAYERS_PREF, modes: [], ...patch });
const toMap = (ts: ReturnType<typeof filterMapTerminals>): MapTerminal[] =>
  ts.map((t) => ({ code: t.code, name: t.name, modes: t.modes, lat: t.lat!, lng: t.lng! }));

afterEach(() => cleanup());

describe("terminal copy (pure)", () => {
  it("names a marker by name, modes and the community-mapped location", () => {
    expect(terminalMarkerName({ name: "Bicol Central Station", modes: ["bus", "uv_express"] })).toBe(
      "Bicol Central Station, Bus and UV Express terminal, community-mapped location",
    );
    expect(terminalModesPhrase(["jeepney", "uv_express", "bus"])).toBe("Jeepney, UV Express and Bus");
    expect(terminalModesPhrase(["tricycle"])).toBe("Tricycle");
  });

  it("kind labels, OSM provenance, the directions label", () => {
    expect(terminalKindLabel("loading_point")).toBe("Loading point");
    expect(terminalKindLabel("waiting_area")).toBe("Waiting area");
    expect(terminalKindLabel(null)).toBeNull();
    expect(terminalOsmLocationText({ osmType: "way", osmId: 293702439, osmVersion: 6, note: "centroid, not an entrance" })).toBe(
      "OSM way/293702439 v6 · centroid, not an entrance",
    );
    expect(terminalOsmLocationText({ osmType: "node", osmId: 1, osmVersion: null, note: null })).toBe("OSM node/1");
    expect(terminalDirectionsLabel("Balatas Tricycle Terminal")).toBe("Balatas Tricycle Terminal (map point, entrance not mapped)");
  });

  it("regional rows: distance + estimate, or distance not on file with the rates", () => {
    const withKm = regionalServiceRow({
      destination: "Tabaco",
      operators: [],
      distanceKm: 94.278,
      fareEstimate: { text: "Estimate ₱245–₱283 (provisional per-km rate, 28 Sep 2026) · operator prices may differ" },
    });
    expect(withKm).toEqual({
      title: "Tabaco · operator not on file",
      detail: "≈ 94 km by the community-mapped route · Estimate ₱245–₱283 (provisional per-km rate, 28 Sep 2026) · operator prices may differ",
    });
    const noKm = regionalServiceRow({
      destination: "Legazpi",
      operators: ["A", "B"],
      distanceKm: null,
      fareEstimate: { text: "₱2.60–₱3.00/km (provisional) · distance not on file · operator prices may differ" },
    });
    expect(noKm.title).toBe("Legazpi · A, B");
    expect(noKm.detail).toBe("Distance not on file · ₱2.60–₱3.00/km (provisional) · operator prices may differ");
  });

  it("groups markers closer than the spacing, anchored on a member, so anchors never overlap", () => {
    const groups = groupScreenPoints([
      { code: "A", x: 0, y: 0 },
      { code: "B", x: 30, y: 0 },
      { code: "C", x: 60, y: 0 },
      { code: "D", x: 200, y: 0 },
    ]);
    expect(groups).toEqual([
      { anchor: "B", codes: ["A", "B", "C"] },
      { anchor: "D", codes: ["D"] },
    ]);
    expect(terminalGroupName([{ name: "Jeepney station to Pacol" }, { name: "Jeepney station to Carolina and Panicuason" }])).toBe(
      "2 terminals close together: Jeepney station to Pacol; Jeepney station to Carolina and Panicuason. Select to see each one",
    );
  });

  it("DOM markers up to the limit, canvas beyond", () => {
    expect(terminalMarkerRender(TERMINAL_DOM_MARKER_LIMIT)).toBe("dom");
    expect(terminalMarkerRender(TERMINAL_DOM_MARKER_LIMIT + 1)).toBe("canvas");
  });
});

describe("which terminals are drawn and listed", () => {
  it("draws only terminals with a coordinate; T02, T05, T15 and T16 are never drawn", () => {
    const drawn = filterMapTerminals(SNAPSHOT.terminals, layers()).map((t) => t.code);
    const withCoordinate = SNAPSHOT.terminals.filter((t) => t.lat !== null).map((t) => t.code);
    expect(drawn).toEqual(withCoordinate);
    for (const code of ["T02", "T05", "T15", "T16"]) expect(drawn).not.toContain(code);
  });

  it("the Tricycle filter leaves only T14 on the map; the list adds the unmapped waiting areas", () => {
    expect(filterMapTerminals(SNAPSHOT.terminals, layers({ modes: ["tricycle"] })).map((t) => t.code)).toEqual(["T14"]);
    expect(listTerminals(SNAPSHOT.terminals, layers({ modes: ["tricycle"] })).map((t) => t.code)).toEqual(["T14", "T15", "T16"]);
  });

  it("the Terminals switch off draws none", () => {
    expect(filterMapTerminals(SNAPSHOT.terminals, layers({ terminals: false }))).toEqual([]);
  });
});

describe("TerminalMarkerTiles (never colour alone)", () => {
  it("one tile per mode, each with its glyph, coloured by the surface tokens", () => {
    const { container } = render(<TerminalMarkerTiles modes={["bus", "uv_express"]} />);
    const tiles = container.querySelectorAll<HTMLElement>(".pn-terminal-marker__tile");
    expect([...tiles].map((t) => t.dataset.mode)).toEqual(["bus", "uv_express"]);
    for (const tile of tiles) {
      expect(tile.querySelector("svg[data-mode-icon]")).not.toBeNull();
      expect(tile.style.getPropertyValue("--pn-tile")).toBe(`var(--pn-mode-${tile.dataset.mode})`);
      expect(tile.style.getPropertyValue("--pn-tile-glyph")).toBe(`var(--pn-mode-${tile.dataset.mode}-casing)`);
    }
  });

  it("a jeepney terminal uses the traditional jeepney glyph and colour", () => {
    const { container } = render(<TerminalMarkerTiles modes={["jeepney"]} />);
    expect(container.querySelector<HTMLElement>(".pn-terminal-marker__tile")!.dataset.mode).toBe("traditional_puj");
  });
});

describe("TerminalsLayer on a Leaflet map", () => {
  it("draws every mapped terminal once (alone or in a group), named, and opens one on Enter or Space", async () => {
    const onSelect = vi.fn();
    const terminals = toMap(filterMapTerminals(SNAPSHOT.terminals, layers()));
    const { container } = render(
      <MapContainer center={[13.62, 123.19]} zoom={14} style={{ width: 400, height: 400 }}>
        <TerminalsLayer terminals={terminals} surface="light" emphasizedCode="T14" onSelect={onSelect} />
      </MapContainer>,
    );
    await waitFor(() => expect(container.querySelector('[data-codes~="T14"]')).not.toBeNull());
    const drawn = [...container.querySelectorAll<HTMLElement>("[data-codes]")].flatMap((el) => el.dataset.codes!.split(" "));
    expect(drawn.sort()).toEqual(terminals.map((t) => t.code).sort());
    // At zoom 14 the Centro stations overlap: one group marker names them and is a button too.
    const group = container.querySelector<HTMLElement>('[data-testid="terminal-group"]')!;
    expect(group.getAttribute("aria-label")).toMatch(/^\d+ terminals close together: .+\. Select to see each one$/);
    expect(group.getAttribute("role")).toBe("button");
    const t14 = container.querySelector<HTMLElement>('[data-testid="terminal-marker"][data-code="T14"]')!;
    expect(t14.getAttribute("aria-label")).toBe("Balatas Tricycle Terminal, Tricycle terminal, community-mapped location");
    expect(t14.getAttribute("role")).toBe("button");
    expect(t14.getAttribute("tabindex")).toBe("0");
    expect(t14.classList.contains("pn-terminal-marker--emphasized")).toBe(true);
    await waitFor(() => expect(t14.querySelector(".pn-terminal-marker__tile")).not.toBeNull());
    fireEvent.keyDown(t14, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("T14");
    fireEvent.keyDown(t14, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("non-interactive (terminal detail): a named image, not a button", async () => {
    const t01 = toMap(filterMapTerminals(SNAPSHOT.terminals, layers())).filter((t) => t.code === "T01");
    const { container } = render(
      <MapContainer center={[13.62, 123.19]} zoom={16} style={{ width: 400, height: 400 }}>
        <TerminalsLayer terminals={t01} surface="dark" interactive={false} />
      </MapContainer>,
    );
    await waitFor(() => expect(container.querySelector('[data-testid="terminal-marker"]')).not.toBeNull());
    const marker = container.querySelector<HTMLElement>('[data-testid="terminal-marker"]')!;
    expect(marker.getAttribute("role")).toBe("img");
    expect(marker.hasAttribute("tabindex")).toBe(false);
    expect(marker.getAttribute("aria-label")).toBe("Bicol Central Station, Bus and UV Express terminal, community-mapped location");
  });
});

describe("TricycleHintCard (D15)", () => {
  const T14 = SNAPSHOT.terminals.find((t) => t.code === "T14")!;
  const near = { lat: T14.lat! + 0.002, lng: T14.lng! };
  const far = { lat: 13.6236, lng: 123.1847 };

  it("states the minimum fare, no discount, confirm with the driver, no minutes, and its sources", () => {
    const hint = tricycleHint(far, near, SNAPSHOT, [])!;
    const onShow = vi.fn();
    render(<TricycleHintCard hint={hint} sources={tricycleHintSources(hint, SNAPSHOT)} onShowOnMap={onShow} />);
    const card = screen.getByTestId("tricycle-hint");
    expect(within(card).getByRole("heading", { name: "Tricycle may serve this" })).toBeTruthy();
    expect(screen.getByTestId("tricycle-hint-terminal").textContent).toMatch(/^Balatas Tricycle Terminal \(T14\) · ≈ \d+ m from your destination$/);
    expect(screen.getByTestId("tricycle-hint-fare").textContent).toBe(
      "Minimum fare ₱15 (Ordinance 2024-002) · discounts not applied · confirm with the driver",
    );
    expect(screen.getByTestId("tricycle-hint-time").textContent).toBe("Tricycle time not estimated");
    expect(card.textContent).not.toMatch(/\bmin\b/);
    expect(screen.getByTestId("tricycle-hint-sources").textContent).toBe(
      "Sources: S04, N33 (fare) · OpenStreetMap, community-mapped (terminal location)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show on map: Balatas Tricycle Terminal" }));
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ code: "T14", lat: T14.lat, lng: T14.lng }));
  });

  it("a feeder-only hint has no Show on map button and cites the feeder's sources", () => {
    const hint = {
      feeder: { routeCode: "TRI-VISTODA", name: "Langon – Ateneo de Naga via Vistansa Subd", distanceM: 120, near: "origin" as const },
      copy: { ...tricycleHint(far, near, SNAPSHOT, [])!.copy, terminalText: null, feederText: "Langon – Ateneo de Naga via Vistansa Subd (TRI-VISTODA) · 120 m from your start" },
    };
    render(<TricycleHintCard hint={hint} sources={tricycleHintSources(hint, SNAPSHOT)} onShowOnMap={vi.fn()} />);
    expect(screen.queryByTestId("tricycle-hint-show")).toBeNull();
    expect(screen.getByTestId("tricycle-hint-sources").textContent).toContain("N06 (feeder route)");
  });
});
