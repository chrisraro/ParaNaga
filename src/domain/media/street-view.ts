export type StreetViewPoint = { lat: number; lng: number };

function validPoint({ lat, lng }: StreetViewPoint): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Google's viewer finds a nearby panorama; this is not proof of an exact curb or sign. */
export function streetViewLink(point: StreetViewPoint): string | null {
  if (!validPoint(point)) return null;
  return `https://www.google.com/maps/@?${new URLSearchParams({ api: "1", map_action: "pano", viewpoint: `${point.lat},${point.lng}` })}`;
}

export function streetViewEmbed(point: StreetViewPoint, key: string | undefined): string | null {
  if (!validPoint(point) || !key?.trim()) return null;
  return `https://www.google.com/maps/embed/v1/streetview?${new URLSearchParams({ key: key.trim(), location: `${point.lat},${point.lng}` })}`;
}
