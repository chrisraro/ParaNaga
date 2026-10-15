import type { Bounds, LatLng, LngLat } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

/** Ray casting. `ring` is GeoJSON order: [lng, lat]. */
export function pointInRing(point: LatLng, ring: readonly LngLat[]): boolean {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function padBounds(bounds: Bounds, degrees: number): Bounds {
  return {
    south: bounds.south - degrees,
    west: bounds.west - degrees,
    north: bounds.north + degrees,
    east: bounds.east + degrees,
  };
}

export function boundsContains(bounds: Bounds, point: LatLng): boolean {
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}
