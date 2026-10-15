"use client";

// Mapped stop pins: ONE Leaflet layer group drawn on ONE canvas renderer (no DOM marker per pin).
// Every pin is the hollow amber "Mapped candidate" ring (Components · Map markers); a pin that a
// provisional route order lists (Loops A and B) also gets a small filled amber centre. Pins never
// draw lines. Canvas pins are not focusable, so the home sheet lists the same stops as links
// ("Nearby stops") for keyboard and screen-reader users.

import L from "leaflet";
import { useEffect, useEffectEvent, useMemo } from "react";
import { useMap } from "react-leaflet";
import { usePrefersDark } from "@/client/map/use-prefers-dark";
import type { StopPin } from "@/domain/api/schemas";

const AMBER = "#E8A317";
/** Map design brief: candidate ring r=8, stroke 3.5, fill = marker fill (light #FFFFFF / dark #111A2E). */
const RING_RADIUS = 7;
const RING_WEIGHT = 3.5;
const CENTRE_RADIUS = 2.75;

type Props = {
  stops: readonly StopPin[];
  /** False while placing a pin (crosshair): pins are shown for reference but ignore taps. */
  interactive: boolean;
  onSelect?: (stopId: string) => void;
};

export function StopsLayer({ stops, interactive, onSelect }: Props) {
  const map = useMap();
  const dark = usePrefersDark();
  // Tolerance widens the tap target around each ring (≈ 26 px across).
  const renderer = useMemo(() => L.canvas({ padding: 0.25, tolerance: 6 }), []);
  const group = useMemo(() => L.layerGroup(), []);
  // Rings overlap (pins tens of metres apart, or the same point in two layers): a tap selects the
  // pin whose centre is nearest the tap, preferring one on a route order at the same spot.
  const select = useEffectEvent((tap: L.Point) => {
    let best: { id: string; d: number; onRoute: boolean } | null = null;
    for (const stop of stops) {
      const d = map.latLngToContainerPoint([stop.lat, stop.lng]).distanceTo(tap);
      const onRoute = stop.routeCodes.length > 0;
      if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && onRoute && !best.onRoute)) best = { id: stop.id, d, onRoute };
    }
    if (best) onSelect?.(best.id);
  });

  useEffect(() => {
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, group]);

  useEffect(() => {
    group.clearLayers();
    const fill = dark ? "#111A2E" : "#FFFFFF";
    // Pins on a route order draw last, so their centre dot stays visible over a plain ring.
    const ordered = [...stops].sort((a, b) => Number(a.routeCodes.length > 0) - Number(b.routeCodes.length > 0));
    for (const stop of ordered) {
      const at: L.LatLngTuple = [stop.lat, stop.lng];
      const ring = L.circleMarker(at, {
        renderer,
        radius: RING_RADIUS,
        weight: RING_WEIGHT,
        color: AMBER,
        fillColor: fill,
        fillOpacity: 1,
        interactive,
        bubblingMouseEvents: false,
      });
      // Leaflet reports a small circle marker's click at the marker's own centre, so read the tap
      // position from the DOM event instead.
      if (interactive) ring.on("click", (e: L.LeafletMouseEvent) => select(map.mouseEventToContainerPoint(e.originalEvent)));
      group.addLayer(ring);
      if (stop.routeCodes.length > 0) {
        group.addLayer(
          L.circleMarker(at, { renderer, radius: CENTRE_RADIUS, stroke: false, fillColor: AMBER, fillOpacity: 1, interactive: false }),
        );
      }
    }
  }, [map, group, renderer, stops, interactive, dark]);

  return null;
}
