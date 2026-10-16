// Direction chevrons sampled along a ride or route polyline every 250 m.
// Pure geometry + HTML generator so unit tests can verify sampling and bearing without DOM.
import { haversineMeters } from "@/domain/geo/geometry";
import type { LatLng } from "@/domain/geo/types";

export type DirectionChevron = {
  point: LatLng;
  /** Compass bearing in degrees [0, 360), where 0 = north and 90 = east. */
  bearingDeg: number;
  /** Distance from the start of the polyline in metres. */
  measureM: number;
};

/** Compass bearing in [0, 360) degrees from `a` to `b` (0 = north, 90 = east). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Samples direction chevrons every `spacingM` metres (default 250 m) along `coords`.
 * If the polyline is shorter than `spacingM` but at least 80 m, places a single chevron at the midpoint.
 */
export function sampleChevrons(coords: readonly LatLng[], spacingM = 250): DirectionChevron[] {
  if (coords.length < 2 || spacingM <= 0) return [];

  const segLengths: number[] = [];
  let totalM = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i - 1]!, coords[i]!);
    segLengths.push(d);
    totalM += d;
  }
  if (totalM < 80) return [];

  const targets: number[] = [];
  if (totalM < spacingM) {
    targets.push(totalM / 2);
  } else {
    for (let m = spacingM; m <= totalM - 40; m += spacingM) {
      targets.push(m);
    }
    if (targets.length === 0) targets.push(totalM / 2);
  }

  const out: DirectionChevron[] = [];
  let segIdx = 0;
  let accM = 0;

  for (const targetM of targets) {
    while (segIdx < segLengths.length - 1 && accM + segLengths[segIdx]! < targetM) {
      accM += segLengths[segIdx]!;
      segIdx++;
    }
    const segLen = segLengths[segIdx] ?? 0;
    const a = coords[segIdx]!;
    const b = coords[segIdx + 1]!;
    const t = segLen > 0 ? Math.min(1, Math.max(0, (targetM - accM) / segLen)) : 0;
    const point: LatLng = {
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    };
    out.push({
      point,
      bearingDeg: bearingDegrees(a, b),
      measureM: targetM,
    });
  }

  return out;
}

/**
 * Decorative inline SVG for a direction chevron marker (`aria-hidden="true"`).
 * Drawn in the casing colour on a core-coloured disc so the 3:1 non-text contrast against the core holds.
 */
export function chevronSvgHtml(
  bearingDeg: number,
  coreColor: string,
  casingColor: string,
  highContrast = false,
): string {
  const size = highContrast ? 16 : 14;
  return `<span class="pn-chevron" aria-hidden="true" style="transform:rotate(${bearingDeg.toFixed(1)}deg)"><svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="${coreColor}" stroke="${casingColor}" stroke-width="1.5"/><path d="M5 9.5L8 5.5L11 9.5" stroke="${casingColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}
