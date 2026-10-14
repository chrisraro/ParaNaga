// Naga City boundary: OpenStreetMap relation 3084673, ODbL 1.0 (c) OpenStreetMap contributors.
// naga-city-boundary.json is a byte-identical copy of data/geo/naga-city-boundary.geojson
// (bundlers cannot import the .geojson extension); tests/unit/geo.test.ts enforces they match.
import boundary from "./naga-city-boundary.json";
import { boundsContains, padBounds, pointInRing } from "./geometry";
import type { Bounds, LatLng, LngLat } from "./types";

type BoundaryFile = {
  features: { geometry: { coordinates: LngLat[][] } }[];
};

const outerRing = (boundary as unknown as BoundaryFile).features[0]?.geometry.coordinates[0];
if (!outerRing || outerRing.length < 4) {
  throw new Error("naga-city-boundary.geojson has no outer ring");
}

/** City outline, GeoJSON order [lng, lat]. */
export const NAGA_BOUNDARY: readonly LngLat[] = outerRing;

function computeBounds(ring: readonly LngLat[]): Bounds {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lng, lat] of ring) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

export const NAGA_BOUNDS: Bounds = computeBounds(NAGA_BOUNDARY);
export const NAGA_MAX_BOUNDS: Bounds = padBounds(NAGA_BOUNDS, 0.01);
export const NAGA_DEFAULT_CENTER: LatLng = { lat: 13.6233869, lng: 123.1846726 };
export const NAGA_DEFAULT_ZOOM = 15;
export const NAGA_MIN_ZOOM = 12;
export const NAGA_MAX_ZOOM = 19;

export function isInsideNaga(point: LatLng): boolean {
  return boundsContains(NAGA_BOUNDS, point) && pointInRing(point, NAGA_BOUNDARY);
}

/** Inverse mask for Leaflet: world rectangle with the city cut out. [lat, lng] order. */
export const NAGA_MASK_RINGS: readonly (readonly [number, number][])[] = [
  [
    [-90, -180],
    [-90, 180],
    [90, 180],
    [90, -180],
  ],
  NAGA_BOUNDARY.map(([lng, lat]): [number, number] => [lat, lng]),
];
