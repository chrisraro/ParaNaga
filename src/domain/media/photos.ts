import catalog from "./catalog.json";
import stopReferences from "./stop-references.json";

export type PlacePhoto = (typeof catalog.assets)[number];
export const PLACE_PHOTOS: readonly PlacePhoto[] = catalog.assets;
const assets = new Map(PLACE_PHOTOS.map((photo) => [photo.id, photo]));
const links: Readonly<Record<string, string>> = catalog.links;

/** Only reviewed stable identities resolve. No fuzzy name or nearest-photo substitution. */
export function photoForPlace(key: string): PlacePhoto | null {
  const id = links[key];
  return id ? assets.get(id) ?? null : null;
}

/** Match the original source record, with a coordinate guard against relocated pins. */
export function photoForStopSource(source: { layer: string | null; code: string | null; lat: number; lng: number }): PlacePhoto | null {
  const ref = stopReferences.find((r) => r.layer === source.layer && r.code === source.code && Math.abs(r.lat - source.lat) < 0.00001 && Math.abs(r.lng - source.lng) < 0.00001);
  return ref ? assets.get(ref.photoId) ?? null : null;
}

export function photoForPinPlace(label: string, pins: readonly { layer: string | null; code: string | null; lat: number; lng: number }[]): PlacePhoto | null {
  for (const pin of pins) {
    const ref = stopReferences.find((r) => r.label === label && r.layer === pin.layer && r.code === pin.code);
    if (ref) {
      const photo = photoForStopSource(pin);
      if (photo) return photo;
    }
  }
  return null;
}
