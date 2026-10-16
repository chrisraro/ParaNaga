"use client";

// Terminals layer (Increment D, Task 13): one marker per terminal WITH a coordinate (OpenStreetMap,
// ODbL); terminals without one are never drawn (the Layers sheet and Explore list them as
// "Location not mapped"). Up to TERMINAL_DOM_MARKER_LIMIT terminals are DOM markers: a rounded
// square per mode in the mode colour with its glyph (white on Palette L, #0B1220 on Palette D; the
// colours come from the map's `data-map-surface` tokens), stacked side by side for a terminal of
// several modes. Never colour alone: every tile carries the mode glyph, and the marker's
// accessible name is "{name}, {modes} terminal, community-mapped location".
//
// Each marker is a 44 px target (WCAG 2.5.8): terminals closer than TERMINAL_MARKER_SPACING_PX on
// screen at the current zoom are drawn as ONE group marker (their tiles plus a count), named after
// its terminals; activating it zooms in until they separate. Enter or Space activates a marker.
// More terminals than the DOM limit fall back to one canvas layer of circle markers (not
// focusable; the Layers sheet lists them).

import L from "leaflet";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Marker, useMap, useMapEvents } from "react-leaflet";
import { resolveVisualKey, type VisualKey } from "@/domain/modes/modes";
import { paletteForSurface, type MapSurface } from "@/domain/modes/palette";
import {
  groupScreenPoints,
  terminalGroupName,
  terminalMarkerName,
  terminalMarkerRender,
  terminalRouteModes,
} from "@/domain/places/terminals";
import { prefersReducedMotion } from "@/client/map/use-reduced-motion";
import { NAGA_MAX_ZOOM } from "@/domain/geo/naga";
import { ModeIcon } from "@/ui/modes/mode-icon";

export type MapTerminal = { code: string; name: string; modes: readonly string[]; lat: number; lng: number };

const MARKER_SIZE = 44;

/** The visual keys of a terminal's modes, in order (jeepney → traditional jeepney colour). */
export function terminalVisualKeys(modes: readonly string[]): VisualKey[] {
  return terminalRouteModes(modes).map(resolveVisualKey);
}

/** The tiles inside a marker: one rounded square per mode, each with its glyph. */
export function TerminalMarkerTiles({ modes, count = 1 }: { modes: readonly string[]; count?: number }) {
  const keys = [...new Set(terminalVisualKeys(modes))];
  return (
    <span className="pn-terminal-marker__stack" data-modes={keys.join(" ")}>
      {keys.map((key) => (
        <span
          key={key}
          className="pn-terminal-marker__tile"
          data-mode={key}
          style={{ "--pn-tile": `var(--pn-mode-${key})`, "--pn-tile-glyph": `var(--pn-mode-${key}-casing)` } as CSSProperties}
        >
          <ModeIcon mode={key} size={16} />
        </span>
      ))}
      {count > 1 ? (
        <span className="pn-terminal-marker__count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Names the marker element and makes it a button (Enter and Space activate it; Leaflet already
 * sets role=button and tabindex when the marker takes the keyboard). A non-interactive marker is
 * a named image. Returns the cleanup.
 */
function decorateMarker(
  el: HTMLElement,
  opts: { name: string; codes: readonly string[]; group: boolean; emphasized: boolean; interactive: boolean; activate: () => void },
): () => void {
  el.setAttribute("aria-label", opts.name);
  el.dataset.testid = opts.group ? "terminal-group" : "terminal-marker";
  el.dataset.codes = opts.codes.join(" ");
  if (!opts.group) el.dataset.code = opts.codes[0];
  el.classList.toggle("pn-terminal-marker--emphasized", opts.emphasized);
  if (!opts.interactive) {
    el.setAttribute("role", "img");
    el.removeAttribute("tabindex");
    return () => {};
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      opts.activate();
    }
  };
  el.addEventListener("keydown", onKey);
  return () => el.removeEventListener("keydown", onKey);
}

/** One terminal: open it. A group: zoom in until its terminals separate. */
function activateMarker(
  map: L.Map,
  members: readonly MapTerminal[],
  onSelect: ((code: string) => void) | undefined,
  onGroupZoom: () => void,
) {
  if (members.length === 1) {
    onSelect?.(members[0]!.code);
    return;
  }
  onGroupZoom();
  const bounds = L.latLngBounds(members.map((m): L.LatLngTuple => [m.lat, m.lng]));
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: NAGA_MAX_ZOOM, animate: !prefersReducedMotion() });
}

type MarkerProps = {
  members: readonly MapTerminal[];
  at: MapTerminal;
  interactive: boolean;
  emphasized: boolean;
  onSelect?: ((code: string) => void) | undefined;
  onTapThrough?: TapThrough | undefined;
  /** A group was activated: remember it so focus can follow its first terminal after the zoom. */
  onGroupZoom: (fromKey: string, code: string) => void;
  /** Take keyboard focus once mounted (the marker that now holds the activated group's terminal). */
  autoFocus: boolean;
  onFocused: () => void;
};

function TerminalDomMarker({ members, at, interactive, emphasized, onSelect, onTapThrough, onGroupZoom, autoFocus, onFocused }: MarkerProps) {
  const map = useMap();
  const markerRef = useRef<L.Marker>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  // One icon for the marker's lifetime: a new icon would make Leaflet replace the element that
  // the tiles are portalled into.
  const icon = useMemo(
    () => L.divIcon({ className: "pn-terminal-marker", html: "", iconSize: [MARKER_SIZE, MARKER_SIZE], iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2] }),
    [],
  );
  const group = members.length > 1;
  const name = group ? terminalGroupName(members) : terminalMarkerName(members[0]!);
  const codes = useMemo(() => members.map((m) => m.code), [members]);
  const modes = useMemo(() => members.flatMap((m) => m.modes), [members]);

  const key = codes.join("|");
  const groupZoom = () => onGroupZoom(key, members[0]!.code);
  const activate = useEffectEvent(() => activateMarker(map, members, onSelect, groupZoom));
  const focused = useEffectEvent(() => onFocused());

  // The Marker child added itself to the map (and built its element) before this effect runs.
  useEffect(() => {
    setEl(markerRef.current?.getElement() ?? null);
  }, []);

  useEffect(() => {
    if (!el) return undefined;
    return decorateMarker(el, { name, codes, group, emphasized, interactive, activate });
  }, [el, name, codes, group, emphasized, interactive]);

  // Keyboard focus follows an activated group into the marker that now holds its first terminal
  // (WCAG 2.4.3): the group's own element is gone once the zoom regroups the markers.
  useEffect(() => {
    if (!el || !autoFocus) return;
    el.focus();
    focused();
  }, [el, autoFocus]);

  const position = useMemo((): L.LatLngTuple => [at.lat, at.lng], [at.lat, at.lng]);
  const handlers = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        // Stop pins win where they overlap a terminal: a tap within a pin's hit radius opens the stop.
        if (e.originalEvent && onTapThrough?.(map.mouseEventToContainerPoint(e.originalEvent))) return;
        activateMarker(map, members, onSelect, () => onGroupZoom(key, members[0]!.code));
      },
    }),
    [map, members, onSelect, onTapThrough, onGroupZoom, key],
  );
  return (
    <>
      <Marker
        ref={markerRef}
        position={position}
        icon={icon}
        interactive={interactive}
        keyboard={interactive}
        eventHandlers={interactive ? handlers : {}}
        zIndexOffset={emphasized ? 150 : 100}
      />
      {el ? createPortal(<TerminalMarkerTiles modes={modes} count={members.length} />, el) : null}
    </>
  );
}

/** Groups the terminals that would overlap at the map's current zoom (recomputed on zoom). */
function useScreenGroups(terminals: readonly MapTerminal[]): { at: MapTerminal; members: MapTerminal[] }[] {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return useMemo(() => {
    const byCode = new Map(terminals.map((t) => [t.code, t]));
    const points = terminals.map((t) => {
      const p = map.project([t.lat, t.lng], zoom);
      return { code: t.code, x: p.x, y: p.y };
    });
    return groupScreenPoints(points).map((g) => ({ at: byCode.get(g.anchor)!, members: g.codes.map((c) => byCode.get(c)!) }));
  }, [map, terminals, zoom]);
}

function TerminalDomMarkers({ terminals, interactive, emphasizedCode, onSelect, onTapThrough }: Omit<Props, "surface"> & { interactive: boolean }) {
  const groups = useScreenGroups(terminals);
  const [focusAfter, setFocusAfter] = useState<{ fromKey: string; code: string } | null>(null);
  const onGroupZoom = useCallback((fromKey: string, code: string) => {
    // Only a keyboard activation moves focus; a tap leaves it where it is.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.testid === "terminal-group") setFocusAfter({ fromKey, code });
  }, []);
  const onFocused = useCallback(() => setFocusAfter(null), []);
  return (
    <>
      {groups.map((g) => {
        const key = g.members.map((m) => m.code).join("|");
        return (
        <TerminalDomMarker
          key={key}
          onGroupZoom={onGroupZoom}
          autoFocus={focusAfter !== null && key !== focusAfter.fromKey && g.members.some((m) => m.code === focusAfter.code)}
          onFocused={onFocused}
          members={g.members}
          at={g.at}
          interactive={interactive}
          emphasized={emphasizedCode !== null && emphasizedCode !== undefined && g.members.some((m) => m.code === emphasizedCode)}
          onSelect={onSelect}
          onTapThrough={onTapThrough}
        />
        );
      })}
    </>
  );
}

/** More than TERMINAL_DOM_MARKER_LIMIT terminals: one canvas layer, first mode's colour. */
function TerminalsCanvas({ terminals, surface, interactive, emphasizedCode, onSelect }: Props & { interactive: boolean }) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.25, tolerance: 8 }), []);
  const group = useMemo(() => L.layerGroup(), []);
  const select = useEffectEvent((code: string) => onSelect?.(code));
  useEffect(() => {
    group.addTo(map);
    return () => {
      group.remove();
      renderer.remove();
    };
  }, [map, group, renderer]);
  useEffect(() => {
    group.clearLayers();
    const palette = paletteForSurface(surface);
    for (const t of terminals) {
      const key = terminalVisualKeys(t.modes)[0] ?? "unconfirmed";
      const token = palette[key];
      const marker = L.circleMarker([t.lat, t.lng], {
        renderer,
        radius: t.code === emphasizedCode ? 11 : 8,
        weight: 3,
        color: token.casing,
        fillColor: token.core,
        fillOpacity: 1,
        interactive,
        bubblingMouseEvents: false,
      });
      if (interactive) marker.on("click", () => select(t.code));
      group.addLayer(marker);
    }
  }, [group, renderer, terminals, surface, interactive, emphasizedCode]);
  return null;
}

type Props = {
  terminals: readonly MapTerminal[];
  surface: MapSurface;
  /** False on terminal detail: the marker shows where the terminal is, it opens nothing. */
  interactive?: boolean;
  /** The terminal a tricycle hint names (D15): drawn larger, with a ring. */
  emphasizedCode?: string | null;
  onSelect?: ((code: string) => void) | undefined;
  /**
   * Called with a marker tap's container point before the marker acts: returns true when something
   * under it (a stop pin) took the tap. Keyboard activation never goes through it.
   */
  onTapThrough?: TapThrough | undefined;
};

export type TapThrough = (point: L.Point) => boolean;

export function TerminalsLayer({ terminals, surface, interactive = true, emphasizedCode = null, onSelect, onTapThrough }: Props) {
  if (terminalMarkerRender(terminals.length) === "canvas") {
    return <TerminalsCanvas terminals={terminals} surface={surface} interactive={interactive} emphasizedCode={emphasizedCode} onSelect={onSelect} />;
  }
  return <TerminalDomMarkers terminals={terminals} interactive={interactive} emphasizedCode={emphasizedCode} onSelect={onSelect} onTapThrough={onTapThrough} />;
}
