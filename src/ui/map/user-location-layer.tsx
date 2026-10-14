"use client";

// The user's GPS fix on the map: a true metre-radius accuracy circle plus the location dot
// (map design brief §2). Imported only by naga-map-leaflet.tsx, which loads client-only.

import L from "leaflet";
import { Circle, Marker } from "react-leaflet";
import { fixQuality, type FixQuality, type LocationFix } from "@/domain/geo/location-fix";
import { isInsideNaga } from "@/domain/geo/naga";

const DOT_SIZE = 68;

// Leaflet's default PNG marker icons break under bundlers; every marker is an inline-SVG divIcon.
function dotIcon(coarse: boolean): L.DivIcon {
  const pulse = coarse ? "" : `<circle class="pn-pulse" cx="34" cy="34" r="34" />`;
  return L.divIcon({
    className: "pn-marker",
    html: `<svg width="${DOT_SIZE}" height="${DOT_SIZE}" viewBox="0 0 68 68" aria-hidden="true" focusable="false">${pulse}<circle class="pn-dot${coarse ? " pn-dot--coarse" : ""}" cx="34" cy="34" r="9" stroke-width="3.5" /></svg>`,
    iconSize: [DOT_SIZE, DOT_SIZE],
    iconAnchor: [DOT_SIZE / 2, DOT_SIZE / 2],
  });
}

const PRECISE_ICON = dotIcon(false);
const COARSE_ICON = dotIcon(true);

type Props = { fix: LocationFix | null | undefined; quality?: FixQuality };

export function UserLocationLayer({ fix, quality }: Props) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  // Outside the city the map stays locked and draws nothing (Global Constraints → Outside Naga City).
  if (!isInsideNaga({ lat: fix.lat, lng: fix.lng })) return null;

  const coarse = (quality ?? fixQuality(fix)) === "coarse";
  const icon = coarse ? COARSE_ICON : PRECISE_ICON;
  const radius = Number.isFinite(fix.accuracy) && fix.accuracy > 0 ? fix.accuracy : 0;
  const center: L.LatLngTuple = [fix.lat, fix.lng];

  return (
    <>
      {radius > 0 ? (
        <Circle
          center={center}
          radius={radius}
          pathOptions={{
            className: coarse ? "pn-accuracy pn-accuracy--coarse" : "pn-accuracy",
            stroke: coarse,
            weight: 1,
            color: coarse ? "#5A6478" : "#2BB5AE",
            fillColor: coarse ? "#5A6478" : "#2BB5AE",
            fillOpacity: coarse ? 0.12 : 0.14,
            interactive: false,
          }}
        />
      ) : null}
      <Marker position={center} icon={icon} interactive={false} keyboard={false} zIndexOffset={1000} />
    </>
  );
}
