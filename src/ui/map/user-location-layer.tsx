"use client";

// The user's GPS fix on the map: a true metre-radius accuracy circle plus the location dot
// (map design brief §2). Imported only by naga-map-leaflet.tsx, which loads client-only.

import L from "leaflet";
import { Circle, Marker } from "react-leaflet";
import { fixQuality, type FixQuality, type LocationFix } from "@/domain/geo/location-fix";
import { isInsideNaga } from "@/domain/geo/naga";

const DOT_SIZE = 68;

// Leaflet's default PNG marker icons break under bundlers; every marker is an inline-SVG divIcon.
function dotIcon(coarse: boolean, stale = false, heading: number | null = null): L.DivIcon {
  const pulse = coarse || stale ? "" : `<circle class="pn-pulse" cx="34" cy="34" r="34" />`;
  // Direction of travel (when the device gives one): a wedge on the dot, turned about its centre.
  const wedge = heading === null ? "" : `<path class="pn-heading" d="M34 11 L42 26 L34 22 L26 26 Z" stroke-width="2" stroke-linejoin="round" transform="rotate(${heading} 34 34)" />`;
  return L.divIcon({
    className: "pn-marker",
    html: `<svg width="${DOT_SIZE}" height="${DOT_SIZE}" viewBox="0 0 68 68" aria-hidden="true" focusable="false">${pulse}${wedge}<circle class="pn-dot${coarse ? " pn-dot--coarse" : ""}${stale ? " pn-dot--stale" : ""}" cx="34" cy="34" r="9" stroke-width="3.5" /></svg>`,
    iconSize: [DOT_SIZE, DOT_SIZE],
    iconAnchor: [DOT_SIZE / 2, DOT_SIZE / 2],
  });
}

const PRECISE_ICON = dotIcon(false);
const COARSE_ICON = dotIcon(true);
const STALE_ICON = dotIcon(false, true);

// Stable style objects so react-leaflet only restyles the circle when the quality changes.
const ACCURACY_STYLE: L.PathOptions = {
  className: "pn-accuracy",
  stroke: false,
  fillColor: "#2BB5AE",
  fillOpacity: 0.14,
  interactive: false,
};
const COARSE_ACCURACY_STYLE: L.PathOptions = {
  className: "pn-accuracy pn-accuracy--coarse",
  stroke: true,
  weight: 1,
  color: "#5A6478",
  fillColor: "#5A6478",
  fillOpacity: 0.12,
  interactive: false,
};

/** The direction of travel in whole 5° steps (fewer icon rebuilds), only while the device reports moving (> 1 m/s). */
export function movingHeading(fix: LocationFix): number | null {
  const { heading, speed } = fix;
  if (typeof heading !== "number" || !Number.isFinite(heading) || typeof speed !== "number" || !(speed > 1)) return null;
  return (Math.round((((heading % 360) + 360) % 360) / 5) * 5) % 360;
}

type Props = { fix: LocationFix | null | undefined; quality?: FixQuality; stale?: boolean };

export function UserLocationLayer({ fix, quality, stale = false }: Props) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  // Outside the city the map stays locked and draws nothing (Global Constraints → Outside Naga City).
  if (!isInsideNaga({ lat: fix.lat, lng: fix.lng })) return null;

  const coarse = (quality ?? fixQuality(fix)) === "coarse";
  const heading = movingHeading(fix);
  const icon = coarse ? COARSE_ICON : stale ? STALE_ICON : heading === null ? PRECISE_ICON : dotIcon(false, false, heading);
  const radius = Number.isFinite(fix.accuracy) && fix.accuracy > 0 ? fix.accuracy : 0;
  const center: L.LatLngTuple = [fix.lat, fix.lng];

  return (
    <>
      {radius > 0 ? (
        <Circle
          center={center}
          radius={radius}
          pathOptions={coarse ? COARSE_ACCURACY_STYLE : ACCURACY_STYLE}
        />
      ) : null}
      <Marker position={center} icon={icon} interactive={false} keyboard={false} zIndexOffset={1000} />
    </>
  );
}
