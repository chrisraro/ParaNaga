"use client";

// Leaflet implementation of the Naga City map. Leaflet touches `window` on import, so this
// module is only ever loaded through `naga-map.tsx` (next/dynamic, ssr: false).

import "leaflet/dist/leaflet.css";
import "./naga-map.css";

import L from "leaflet";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import { OSM_ATTRIBUTION, currentTileConfig } from "@/client/map/tile-config";
import { prefersReducedMotion, useReducedMotion } from "@/client/map/use-reduced-motion";
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
import type { LatLng } from "@/domain/geo/types";
import { MapControls } from "./map-controls";
import type { NagaMapProps } from "./types";
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

const LEAFLET_URL = "https://leafletjs.com";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

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

type View = { lat: number; lng: number; zoom: number };

type SyncProps = {
  recenterSignal: number | undefined;
  userFix: LocationFix | null | undefined;
  onView: (view: View) => void;
  onAnnounce: (message: string) => void;
};

/** Lives inside <MapContainer>: reports the view and handles recenter requests. */
function MapViewSync({ recenterSignal, userFix, onView, onAnnounce }: SyncProps) {
  const map = useMap();

  const report = useEffectEvent(() => {
    const center = map.getCenter();
    onView({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
  });

  useEffect(() => {
    const handler = () => report();
    map.whenReady(handler);
    map.on("moveend zoomend", handler);
    return () => {
      map.off("moveend zoomend", handler);
    };
  }, [map]);

  const recenter = useEffectEvent(() => {
    const fix = userFix;
    const onUser = fix != null && isInsideNaga({ lat: fix.lat, lng: fix.lng });
    const center: L.LatLngTuple = onUser ? [fix.lat, fix.lng] : DEFAULT_CENTER;
    const zoom = onUser ? Math.max(map.getZoom(), LOCATE_MIN_ZOOM) : NAGA_DEFAULT_ZOOM;
    // Under reduced motion the fly-to becomes a jump (map design brief §3, Motion rules).
    if (prefersReducedMotion()) map.setView(center, zoom, { animate: false });
    else map.flyTo(center, zoom, { duration: 0.8 });
    onAnnounce(onUser ? "Map centered on your location" : "Map centered on Naga City center");
  });

  const lastSignal = useRef(recenterSignal);
  useEffect(() => {
    if (lastSignal.current === recenterSignal) return;
    lastSignal.current = recenterSignal;
    recenter();
  }, [recenterSignal]);

  return null;
}

export default function NagaMapLeaflet({
  userFix,
  userQuality,
  pins,
  crosshair = false,
  onCenterChange,
  recenterSignal,
  onLocate,
  className,
}: NagaMapProps) {
  const reducedMotion = useReducedMotion();
  const [tiles] = useState(currentTileConfig);
  const [map, setMap] = useState<L.Map | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const handleView = (next: View) => {
    setView(next);
    const center: LatLng = { lat: next.lat, lng: next.lng };
    onCenterChange?.(center, isInsideNaga(center));
  };

  const zoomBy = (delta: 1 | -1) => {
    if (!map) return;
    const target = Math.min(NAGA_MAX_ZOOM, Math.max(NAGA_MIN_ZOOM, Math.round(map.getZoom()) + delta));
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
        {tiles.url ? (
          <TileLayer url={tiles.url} bounds={MAX_BOUNDS} minZoom={NAGA_MIN_ZOOM} maxZoom={NAGA_MAX_ZOOM} />
        ) : null}
        <Polygon
          positions={MASK_RINGS}
          pathOptions={{
            className: "pn-mask",
            stroke: false,
            fillColor: "#0F1E3D",
            fillOpacity: 0.28,
            interactive: false,
          }}
        />
        <Polygon
          positions={OUTLINE}
          pathOptions={{
            className: "pn-outline",
            color: "#0B7A75",
            weight: 2,
            fill: false,
            interactive: false,
          }}
        />
        <UserLocationLayer fix={userFix} quality={userQuality} />
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
        <MapViewSync
          recenterSignal={recenterSignal}
          userFix={userFix}
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

      {tiles.url ? null : <p className="pn-map-notice">Map background unavailable</p>}

      <div className="pn-attribution">
        <a href={LEAFLET_URL} target="_blank" rel="noopener noreferrer">
          Leaflet
        </a>
        <span aria-hidden="true">|</span>
        {tiles.url === null ? (
          <span>
            Boundary{" "}
            <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
              {OSM_ATTRIBUTION}
            </a>
          </span>
        ) : tiles.attribution === OSM_ATTRIBUTION ? (
          <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
            {OSM_ATTRIBUTION}
          </a>
        ) : (
          <span>{tiles.attribution}</span>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
