"use client";

// Leaflet implementation of the Naga City map. Leaflet touches `window` on import, so this
// module is only ever loaded through `naga-map.tsx` (next/dynamic, ssr: false).

import "leaflet/dist/leaflet.css";
import "./naga-map.css";
import "../modes/modes.css";

import L from "leaflet";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import { OSM_ATTRIBUTION, attributionParts, currentTileConfig } from "@/client/map/tile-config";
import { usePresence } from "@/ui/app-shell/presence";
import { prefersReducedMotion, useReducedMotion } from "@/client/map/use-reduced-motion";
import { usePrefs } from "@/client/prefs/use-prefs";
import type { LocationFix } from "@/domain/geo/location-fix";
import {
  NAGA_BOUNDARY,
  NAGA_DEFAULT_CENTER,
  NAGA_DEFAULT_ZOOM,
  NAGA_MASK_RINGS,
  NAGA_MAX_BOUNDS,
  NAGA_MAX_ZOOM,
  NAGA_MIN_ZOOM,
  isInsideNaga,
} from "@/domain/geo/naga";
import type { Bounds, LatLng } from "@/domain/geo/types";
import { mapSurface as computeMapSurface } from "@/domain/modes/palette";
import { MapControls } from "./map-controls";
import { ROUTE_FIT_DURATION_S, ROUTE_FIT_EASE_LINEARITY, ROUTE_FIT_MAX_ZOOM, routeFitKey, routeFitPadding } from "./route-fit";
import { MapLegend } from "./map-legend";
import { legendVisualKeys } from "./map-layer-policy";
import { RouteLinesLayer, collectRouteLegendItems, linesHaveOnewayCaution } from "./route-lines-layer";
import { STOP_HIT_RADIUS_PX, StopsLayer } from "./stops-layer";
import { TerminalsLayer } from "./terminals-layer";
import { TripLinesLayer, type TripLinesData } from "./trip-lines-layer";
import type { HighlightStop, NagaMapPins, NagaMapProps } from "./types";
import { UserLocationLayer } from "./user-location-layer";

const MAX_BOUNDS: L.LatLngBoundsLiteral = [
  [NAGA_MAX_BOUNDS.south, NAGA_MAX_BOUNDS.west],
  [NAGA_MAX_BOUNDS.north, NAGA_MAX_BOUNDS.east],
];
const DEFAULT_CENTER: L.LatLngTuple = [NAGA_DEFAULT_CENTER.lat, NAGA_DEFAULT_CENTER.lng];
/** Zoom used when recentring on the user, so the dot is at street level. */
const LOCATE_MIN_ZOOM = 16;

// Inverse mask: world rectangle with the city cut out (already [lat, lng]).
const MASK_RINGS: L.LatLngTuple[][] = NAGA_MASK_RINGS.map((ring) =>
  ring.map(([lat, lng]): L.LatLngTuple => [lat, lng]),
);
const OUTLINE: L.LatLngTuple[] = NAGA_BOUNDARY.map(([lng, lat]): L.LatLngTuple => [lat, lng]);

// Module-level styles: a stable pathOptions object means react-leaflet never calls setStyle
// on the 1,269-point polygons on re-render. Dark mode (mask 0.45) is applied in naga-map.css,
// which overrides Leaflet's fill-opacity attribute, so no JS light/dark variant is needed.
const MASK_STYLE: L.PathOptions = {
  className: "pn-mask",
  stroke: false,
  fillColor: "#0F1E3D",
  fillOpacity: 0.28,
  interactive: false,
};
const OUTLINE_STYLE: L.PathOptions = {
  className: "pn-outline",
  color: "#0B7A75",
  weight: 2,
  fill: false,
  interactive: false,
};

const LEAFLET_URL = "https://leafletjs.com";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function pinIcon(kind: "start" | "destination", label = kind === "start" ? "Start point" : "Destination"): L.DivIcon {
  return L.divIcon({
    className: "pn-marker",
    html: `<svg width="30" height="30" viewBox="0 0 30 30" role="img" aria-label="${escapeHtml(label)}"><circle class="pn-pin pn-pin--${kind}" cx="15" cy="15" r="12" stroke-width="3" /><circle cx="15" cy="15" r="5" fill="#FFFFFF" /></svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const START_ICON = pinIcon("start");
const DESTINATION_ICON = pinIcon("destination");

/** A place's own marker (place detail): destination style, named after the place. */
function PlaceMarker({ point, label }: { point: LatLng; label: string }) {
  const icon = useMemo(() => pinIcon("destination", label), [label]);
  return <Marker position={[point.lat, point.lng]} icon={icon} interactive={false} keyboard={false} />;
}

/** Boarding (filled) / getting-off (hollow) stop marker: a DOM marker above the lines. */
function tripStopIcon(stop: HighlightStop): L.DivIcon {
  const label = escapeHtml(`${stop.role === "board" ? "Board at" : "Get off at"} ${stop.label}`);
  return L.divIcon({
    className: `pn-trip-stop pn-trip-stop--${stop.role}`,
    html: `<svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="${label}"><circle class="pn-trip-stop__ring" cx="12" cy="12" r="8" /></svg>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function TripStopMarker({ stop }: { stop: HighlightStop }) {
  const icon = useMemo(() => tripStopIcon(stop), [stop]);
  return <Marker position={[stop.lat, stop.lng]} icon={icon} interactive={false} keyboard={false} zIndexOffset={200} />;
}

/** Fits the highlighted stops, pins, and trip lines (or explicit fitBoundsCoords) into view whenever they change. */
function FitHighlights({
  stops,
  pins,
  tripLines,
  fitBoundsCoords,
  paddingBottom,
  refitSignal,
  fitAnnouncement,
  fitId,
  fitPathReady,
  onAnnounce,
}: {
  stops: readonly HighlightStop[] | undefined;
  pins: NagaMapPins | undefined;
  tripLines: TripLinesData | null | undefined;
  fitBoundsCoords: readonly LatLng[] | null | undefined;
  paddingBottom: number;
  /** Changes when the sheet snaps: the fit is redone so the route stays above the sheet. */
  refitSignal: number | undefined;
  /** Announced once per new fit of `fitBoundsCoords` (none: silent). */
  fitAnnouncement: string | undefined;
  /** When set, the coords fit is keyed on its two ends + this id, not on every coordinate. */
  fitId: string | undefined;
  /** The route's path arrived after the first fit: refines it unless the rider has panned. */
  fitPathReady: boolean | undefined;
  onAnnounce: (message: string) => void;
}) {
  const map = useMap();
  const stopsKey = stops && stops.length > 0 ? stops.map((s) => s.id).join("|") : "";
  const linesKey = stopsKey && tripLines ? `${tripLines.walkSegments.length}:${tripLines.rideSegments.map((r) => r.key).join(",")}` : "";
  // Announce per pair of ends: the path loading in later refits silently.
  const endsKey = fitBoundsCoords ? routeFitKey(fitBoundsCoords.slice(0, 2)) : "";
  const coordsKey = fitBoundsCoords ? (fitId === undefined ? routeFitKey(fitBoundsCoords) : `${endsKey}|${fitId}`) : "";
  const fitKey = [stopsKey, linesKey, coordsKey].filter(Boolean).join("#");
  // A snap change re-fits; a pan, zoom or GPS fix never does (the rider's view wins until the route changes).
  const announcedKey = useRef("");

  const fit = useEffectEvent(() => {
    const points: L.LatLngTuple[] = [];
    if (stops && stops.length > 0) {
      for (const s of stops) points.push([s.lat, s.lng]);
      if (tripLines && tripLines.allCoords.length > 0) {
        for (const c of tripLines.allCoords) points.push([c.lat, c.lng]);
      }
      if (pins?.start) points.push([pins.start.lat, pins.start.lng]);
      if (pins?.destination) points.push([pins.destination.lat, pins.destination.lng]);
    } else if (fitBoundsCoords && fitBoundsCoords.length > 0) {
      for (const c of fitBoundsCoords) points.push([c.lat, c.lng]);
    }
    if (points.length === 0) return;
    // Leaflet drops a fit that needs a new zoom while a zoom animation is running (setView returns
    // early), which leaves the route behind the sheet. Redo it when that zoom has ended.
    if ((map as unknown as { _animatingZoom?: boolean })._animatingZoom) {
      fitAfterZoom.current = true;
      return;
    }
    // The right padding keeps a highlighted marker (≈ 13 px radius) clear of the zoom and
    // locate controls (48 px wide, 16 px from the edge): 64 + 13 + a gap.
    const pad = routeFitPadding(paddingBottom, map.getSize().y);
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [pad.left, pad.top],
      paddingBottomRight: [pad.right, pad.bottom],
      maxZoom: ROUTE_FIT_MAX_ZOOM,
      duration: ROUTE_FIT_DURATION_S,
      easeLinearity: ROUTE_FIT_EASE_LINEARITY,
      animate: !prefersReducedMotion(),
    });
    // One short announcement per new route fit (not for a snap re-fit, not for a trip detail
    // fit, which has its own announcement).
    if (fitAnnouncement && !(stops && stops.length > 0) && endsKey && announcedKey.current !== endsKey) {
      announcedKey.current = endsKey;
      onAnnounce(fitAnnouncement);
    }
  });
  const fitAfterZoom = useRef(false);
  useEffect(() => {
    const onZoomEnd = () => {
      if (!fitAfterZoom.current) return;
      fitAfterZoom.current = false;
      fit();
    };
    map.on("zoomend", onZoomEnd);
    return () => {
      map.off("zoomend", onZoomEnd);
    };
  }, [map]);
  // The rider dragged the map: a late path load does not take the view back.
  const moved = useRef(false);
  useEffect(() => {
    const onDrag = () => {
      moved.current = true;
    };
    map.on("dragstart", onDrag);
    return () => {
      map.off("dragstart", onDrag);
    };
  }, [map]);
  const prev = useRef<{ fitKey: string; refit: number | undefined; path: boolean | undefined } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { fitKey, refit: refitSignal, path: fitPathReady };
    if (!fitKey) return;
    if (!before || before.fitKey !== fitKey) moved.current = false;
    else if (before.refit === refitSignal && before.path !== fitPathReady && moved.current) return;
    fit();
  }, [fitKey, refitSignal, fitPathReady]);
  return null;
}

type View = { lat: number; lng: number; zoom: number; bounds: Bounds };

type SyncProps = {
  recenterSignal: number | undefined;
  userFix: LocationFix | null | undefined;
  target: LatLng | null | undefined;
  targetLabel: string;
  onView: (view: View) => void;
  onAnnounce: (message: string) => void;
};

/** Lives inside <MapContainer>: reports the view and handles recenter requests. */
function MapViewSync({ recenterSignal, userFix, target, targetLabel, onView, onAnnounce }: SyncProps) {
  const map = useMap();

  const report = useEffectEvent(() => {
    const center = map.getCenter();
    const b = map.getBounds();
    onView({
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom(),
      bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
    });
  });

  // Report once when ready (guarded so StrictMode's effect replay doesn't fire it twice),
  // then on every moveend; Leaflet fires moveend after zooms too.
  const readyReported = useRef(false);
  useEffect(() => {
    const handler = () => report();
    map.whenReady(() => {
      if (readyReported.current) return;
      readyReported.current = true;
      report();
    });
    map.on("moveend", handler);
    return () => {
      map.off("moveend", handler);
    };
  }, [map]);

  const recenter = useEffectEvent(() => {
    const fix = target ?? userFix;
    const onUser = fix != null && isInsideNaga({ lat: fix.lat, lng: fix.lng });
    const center: L.LatLngTuple = onUser ? [fix.lat, fix.lng] : DEFAULT_CENTER;
    const zoom = onUser ? Math.max(map.getZoom(), LOCATE_MIN_ZOOM) : NAGA_DEFAULT_ZOOM;
    // Under reduced motion the fly-to becomes a jump (map design brief §3, Motion rules).
    if (prefersReducedMotion()) map.setView(center, zoom, { animate: false });
    else map.flyTo(center, zoom, { duration: 0.8 });
    const where = target ? targetLabel : "your location";
    onAnnounce(onUser ? `Map centered on ${where}` : "Map centered on Naga City center");
  });

  // Starts at 0 (the screens' initial signal), not the current value: a recentre requested before
  // this client-only map finished loading (e.g. "Show on map" from a directly opened stop) still runs.
  const lastSignal = useRef<number | undefined>(0);
  useEffect(() => {
    if (recenterSignal === undefined || lastSignal.current === recenterSignal) return;
    lastSignal.current = recenterSignal;
    recenter();
  }, [recenterSignal]);

  return null;
}

function useEffectiveTheme(themePref: "system" | "light" | "dark"): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );
  useEffect(() => {
    if (themePref !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [themePref]);
  if (themePref === "dark") return "dark";
  if (themePref === "light") return "light";
  return systemDark ? "dark" : "light";
}

export default function NagaMapLeaflet({
  userFix,
  userQuality,
  userStale = false,
  pins,
  highlightStops,
  highlightPaddingBottom = 40,
  refitSignal,
  fitAnnouncement,
  fitId,
  fitPathReady,
  stopPins,
  stopPinsInteractive = true,
  onStopSelect,
  onBoundsChange,
  crosshair = false,
  onCenterChange,
  recenterSignal,
  recenterTarget,
  recenterTargetLabel = "the start pin",
  onLocate,
  onOpenLayers,
  layersButtonRef,
  tripLines = null,
  activeLegIndex = null,
  legendNotice = null,
  routeLinesDimmed = false,
  fitTripLines = true,
  routeLines = null,
  selectedRouteCode = null,
  onSelectRoute = null,
  showRouteChevrons = false,
  terminals = null,
  terminalsInteractive = true,
  onTerminalSelect = null,
  emphasizedTerminalCode = null,
  fitBoundsCoords = null,
  legend = null,
  mapSurface: explicitMapSurface,
  className,
  initialView,
  placeMarker,
  label = "Map of Naga City",
}: NagaMapProps) {
  const reducedMotion = useReducedMotion();
  const [tiles] = useState(currentTileConfig);
  // Low-data mode (Settings): no tile layer, so no tile is requested, until the user asks for the
  // background once (for as long as the map stays mounted).
  const { lowData, theme, highContrast } = usePrefs();
  const [backgroundOnce, setBackgroundOnce] = useState(false);
  const tileUrl = lowData && !backgroundOnce ? null : tiles.url;
  const { shown: notice, props: noticePresence } = usePresence(tiles.url === null ? "unavailable" : tileUrl === null ? "lowData" : null);
  const effectiveTheme = useEffectiveTheme(theme);
  const surface = explicitMapSurface ?? computeMapSurface(effectiveTheme, tileUrl !== null);
  const legendItems = useMemo(
    () => legendVisualKeys(null, legend ?? collectRouteLegendItems(routeLines ?? [])),
    [legend, routeLines],
  );
  const legendCaution = useMemo(
    () => Boolean(tripLines?.caution) || linesHaveOnewayCaution(routeLines),
    [tripLines, routeLines],
  );

  // No basemap: OSM derived data (boundary, route paths, walk graph) needs crediting ("Map data").
  const attribution = useMemo(
    () => attributionParts(tileUrl === null ? OSM_ATTRIBUTION : tiles.attribution),
    [tileUrl, tiles.attribution],
  );
  const [map, setMap] = useState<L.Map | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const handleView = (next: View) => {
    setView(next);
    const center: LatLng = { lat: next.lat, lng: next.lng };
    onCenterChange?.(center, isInsideNaga(center));
    onBoundsChange?.(next.bounds);
  };

  const zoomBy = (delta: 1 | -1) => {
    if (!map) return;
    const current = Math.round(map.getZoom());
    const target = Math.min(NAGA_MAX_ZOOM, Math.max(NAGA_MIN_ZOOM, current + delta));
    if (target === current) return; // at the limit: the button is aria-disabled

    map.setZoom(target, { animate: !prefersReducedMotion() });
    setAnnouncement(`Zoom level ${target}`);
  };

  const zoom = view?.zoom ?? NAGA_DEFAULT_ZOOM;

  // Stop pins win over terminal markers where they overlap (the pins are on a canvas under the
  // DOM markers): a marker tap within a pin's hit radius selects the nearest pin instead.
  const stopTapThrough = useCallback(
    (point: L.Point): boolean => {
      if (!map || !stopPins || !stopPinsInteractive || !onStopSelect) return false;
      let best: { id: string; d: number } | null = null;
      for (const stop of stopPins) {
        const d = map.latLngToContainerPoint([stop.lat, stop.lng]).distanceTo(point);
        if (d <= STOP_HIT_RADIUS_PX && (!best || d < best.d)) best = { id: stop.id, d };
      }
      if (!best) return false;
      onStopSelect(best.id);
      return true;
    },
    [map, stopPins, stopPinsInteractive, onStopSelect],
  );

  // data-moving: a pan or zoom (a drag, its inertia, an animated fit) is under way; tests wait on it.
  useEffect(() => {
    const el = map?.getContainer().parentElement;
    if (!map || !el) return undefined;
    const set = (moving: boolean) => el.setAttribute("data-moving", String(moving));
    const start = () => set(true);
    const end = () => set(false);
    set(false);
    map.on("movestart", start).on("moveend", end);
    return () => {
      map.off("movestart", start).off("moveend", end);
    };
  }, [map]);

  return (
    <div
      data-testid="naga-map"
      role="region"
      aria-label={label}
      data-center-lat={view ? view.lat.toFixed(6) : undefined}
      data-center-lng={view ? view.lng.toFixed(6) : undefined}
      data-zoom={view ? String(view.zoom) : undefined}
      data-stop-pins={stopPins ? stopPins.length : 0}
      data-map-surface={surface}
      className={className ? `pn-map ${className}` : "pn-map"}
    >
      <MapContainer
        ref={setMap}
        className="pn-map-leaflet"
        center={initialView ? [initialView.center.lat, initialView.center.lng] : DEFAULT_CENTER}
        zoom={initialView?.zoom ?? NAGA_DEFAULT_ZOOM}
        minZoom={NAGA_MIN_ZOOM}
        maxZoom={NAGA_MAX_ZOOM}
        maxBounds={MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        zoomControl={false}
        attributionControl={false}
        zoomAnimation={!reducedMotion}
        fadeAnimation={!reducedMotion}
        markerZoomAnimation={!reducedMotion}
        inertia={!reducedMotion}
      >
        {tileUrl ? (
          <TileLayer url={tileUrl} bounds={MAX_BOUNDS} minZoom={NAGA_MIN_ZOOM} maxZoom={NAGA_MAX_ZOOM} />
        ) : null}
        <Polygon
          positions={MASK_RINGS}
          pathOptions={MASK_STYLE}
        />
        <Polygon
          positions={OUTLINE}
          pathOptions={OUTLINE_STYLE}
        />
        {routeLines && routeLines.length > 0 ? (
          <RouteLinesLayer
            lines={routeLines}
            surface={surface}
            highContrast={highContrast}
            selectedRouteCode={selectedRouteCode}
            onSelectRoute={onSelectRoute}
            showChevrons={showRouteChevrons}
            dimmed={routeLinesDimmed}
          />
        ) : null}
        {tripLines ? (
          <TripLinesLayer
            data={tripLines}
            surface={surface}
            highContrast={highContrast}
            activeLegIndex={activeLegIndex}
          />
        ) : null}
        {terminals && terminals.length > 0 ? (
          <TerminalsLayer
            terminals={terminals}
            surface={surface}
            interactive={terminalsInteractive && onTerminalSelect !== null}
            emphasizedCode={emphasizedTerminalCode}
            onSelect={onTerminalSelect ?? undefined}
            onTapThrough={stopTapThrough}
          />
        ) : null}
        {stopPins ? <StopsLayer stops={stopPins} interactive={stopPinsInteractive} onSelect={onStopSelect} /> : null}
        <UserLocationLayer fix={userFix} quality={userQuality} stale={userStale} />
        {pins?.start ? (
          <Marker
            position={[pins.start.lat, pins.start.lng]}
            icon={START_ICON}
            interactive={false}
            keyboard={false}
          />
        ) : null}
        {pins?.destination ? (
          <Marker
            position={[pins.destination.lat, pins.destination.lng]}
            icon={DESTINATION_ICON}
            interactive={false}
            keyboard={false}
          />
        ) : null}
        {placeMarker ? <PlaceMarker point={placeMarker.point} label={placeMarker.label} /> : null}
        {highlightStops?.map((stop) => <TripStopMarker key={`${stop.role}:${stop.id}`} stop={stop} />)}
        <FitHighlights
          stops={highlightStops}
          pins={pins}
          tripLines={fitTripLines ? tripLines : null}
          fitBoundsCoords={fitBoundsCoords}
          paddingBottom={highlightPaddingBottom}
          refitSignal={refitSignal}
          fitAnnouncement={fitAnnouncement}
          fitId={fitId}
          fitPathReady={fitPathReady}
          onAnnounce={setAnnouncement}
        />
        <MapViewSync
          recenterSignal={recenterSignal}
          userFix={userFix}
          target={recenterTarget}
          targetLabel={recenterTargetLabel}
          onView={handleView}
          onAnnounce={setAnnouncement}
        />
      </MapContainer>

      {crosshair ? (
        <div className="pn-crosshair" aria-hidden="true">
          <svg width="36" height="48" viewBox="0 0 36 48" focusable="false">
            <ellipse className="pn-crosshair__shadow" cx="18" cy="46" rx="5" ry="2" />
            <path
              className="pn-crosshair__pin"
              d="M18 45C18 45 4 28.5 4 17.5a14 14 0 0 1 28 0C32 28.5 18 45 18 45z"
              strokeWidth="3"
            />
            <circle cx="18" cy="17.5" r="5.5" fill="#FFFFFF" />
          </svg>
        </div>
      ) : null}

      <MapControls
        canZoomIn={map !== null && zoom < NAGA_MAX_ZOOM}
        canZoomOut={map !== null && zoom > NAGA_MIN_ZOOM}
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onLocate={onLocate}
        onOpenLayers={onOpenLayers}
        layersButtonRef={layersButtonRef}
      />

      {/* Always present: walking and mapped stops are always on the map, plus a swatch for every
          vehicle class the screen draws (none while the lines load, are filtered out or fail). */}
      <MapLegend
        items={legendItems}
        // The swatches use the same palette as the drawn lines (Palette L whenever tiles are drawn,
        // even in dark theme); the legend panel itself keeps the theme's colours.
        surface={surface}
        caution={legendCaution}
        // The stop entry only while stop pins (or a trip's stop markers) are on the map.
        showStops={(stopPins?.length ?? 0) > 0 || (highlightStops?.length ?? 0) > 0}
        notice={legendNotice}
      />

      {notice === "unavailable" ? (
        <p className="pn-map-notice" {...noticePresence}>Map background unavailable</p>
      ) : notice === "lowData" ? (
        <p className="pn-map-notice pn-map-notice--action" data-testid="map-low-data-notice" {...noticePresence}>
          <span>Map background off (low-data mode)</span>
          <button type="button" className="pn-map-notice__btn" onClick={() => setBackgroundOnce(true)}>
            Show background once
          </button>
        </p>
      ) : null}

      <div className="pn-attribution">
        <a href={LEAFLET_URL} target="_blank" rel="noopener noreferrer">
          Leaflet
        </a>
        <span aria-hidden="true">|</span>
        <span>
          {tileUrl === null ? "Map data " : null}
          {attribution.map((part, i) =>
            part.href ? (
              <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
                {part.text}
              </a>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </span>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
