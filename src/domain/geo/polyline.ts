// Encoded polyline (the common "polyline algorithm" format), precision 5 (1e-5 degrees, ≈1.1 m).
// Used for the approximate ride paths in the lines payload. Pure.
import type { LatLng } from "./types";

const FACTOR = 1e5;

function encodeValue(delta: number): string {
  let v = delta < 0 ? ~(delta << 1) : delta << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** Encodes points (lat, lng) rounded to 1e-5 degrees. */
export function encodePolyline(points: readonly LatLng[]): string {
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const p of points) {
    const la = Math.round(p.lat * FACTOR);
    const ln = Math.round(p.lng * FACTOR);
    out += encodeValue(la - lat) + encodeValue(ln - lng);
    lat = la;
    lng = ln;
  }
  return out;
}

/** Decodes an encoded polyline. Throws on a truncated or malformed string. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    for (;;) {
      if (i >= encoded.length) throw new Error("decodePolyline: truncated polyline");
      const b = encoded.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) throw new Error("decodePolyline: invalid character");
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) break;
      if (shift > 30) throw new Error("decodePolyline: value too long");
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / FACTOR, lng: lng / FACTOR });
  }
  return points;
}
