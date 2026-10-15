"use client";

// Leaflet implementation of the Naga City map. Leaflet touches `window` on import, so this
// module is only ever loaded through `naga-map.tsx` (next/dynamic, ssr: false).

import "leaflet/dist/leaflet.css";
import "./naga-map.css";

import L from "leaflet";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import { OSM_ATTRIBUTION, attributionParts, currentTileConfig } from "@/client/map/tile-config";
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
import { MapControls } from "./map-controls";
import { StopsLayer } from "./stops-layer";
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

function pinIcon(kind: "start" | "destination"): L.DivIcon {
  const label = kind === "start" ? "Start point" : "Destination";
  return L.divIcon({
    className: "pn-marker",
    html: `<svg width="30" height="30" viewBox="0 0 30 30" role="img" aria-label="${label}"><circle class="pn-pin pn-pin--${kind}" cx="15" cy="15" r="12" stroke-width="3" /><circle cx="15" cy="15" r="5" fill="#FFFFFF" /></svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const START_ICON = pinIcon("start");
const DESTINATION_ICON = pinIcon("destination");

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Boarding (filled) / getting-off (hollow) stop marker: a DOM marker, so no path is added. */
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
  return <Marker position={[stop.lat, stop.lng]} icon={icon} interactive={false} keyboard={false} />;
}

/** Fits the highlighted stops and the pins into view whenever the highlighted set changes. */
function FitHighlights({ stops, pins, paddingBottom }: { stops: readonly HighlightStop[] | undefined; pins: NagaMapPins | undefined; paddingBottom: number }) {
  const map = useMap();
  const key = stops?.map((s) => s.id).join("|") ?? "";
  const fit = useEffectEvent(() => {
    if (!stops || stops.length === 0) return;
    const points: L.LatLngTuple[] = stops.map((s) => [s.lat, s.lng]);
    if (pins?.start) points.push([pins.start.lat, pins.start.lng]);
    if (pins?.destination) points.push([pins.destination.lat, pins.destination.lng]);
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [40, 80],
      // The right padding keeps a highlighted marker (≈ 13 px radius) clear of the zoom and
      // locate controls (48 px wide, 16 px from the edge): 64 + 13 + a gap.
      paddingBottomRight: [84, paddingBottom],
      maxZoom: 17,
      animate: !prefersReducedMotion(),
    });
  });
  useEffect(() => {
    if (key) fit();
  }, [key]);
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

export default function NagaMapLeaflet({
  userFix,
  userQuality,
  userStale = false,
  pins,
  highlightStops,
  highlightPaddingBottom = 40,
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
  className,
}: NagaMapProps) {
  const reducedMotion = useReducedMotion();
  const [tiles] = useState(currentTileConfig);
  // Low-data mode (Settings): no tile layer, so no tile is requested, until the user asks for the
  // background once (for as long as the map stays mounted).
  const { lowData } = usePrefs();
  const [backgroundOnce, setBackgroundOnce] = useState(false);
  const tileUrl = lowData && !backgroundOnce ? null : tiles.url;
  // No basemap: only the OSM boundary data needs crediting.
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

  return (
    <div
      data-testid="naga-map"
      role="region"
      aria-label="Map of Naga City"
      data-center-lat={view ? view.lat.toFixed(6) : undefined}
      data-center-lng={view ? view.lng.toFixed(6) : undefined}
      data-zoom={view ? String(view.zoom) : undefined}
      data-stop-pins={stopPins ? stopPins.length : 0}
      className={className ? `pn-map ${className}` : "pn-map"}
    >
      <MapContainer
        ref={setMap}
        className="pn-map-leaflet"
        center={DEFAULT_CENTER}
        zoom={NAGA_DEFAULT_ZOOM}
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
        {highlightStops?.map((stop) => <TripStopMarker key={`${stop.role}:${stop.id}`} stop={stop} />)}
        <FitHighlights stops={highlightStops} pins={pins} paddingBottom={highlightPaddingBottom} />
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
      />

      {tiles.url === null ? (
        <p className="pn-map-notice">Map background unavailable</p>
      ) : tileUrl === null ? (
        <p className="pn-map-notice pn-map-notice--action" data-testid="map-low-data-notice">
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
          {tileUrl === null ? "Boundary " : null}
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
