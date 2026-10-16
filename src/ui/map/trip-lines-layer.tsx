"use client";

// Trip guide lines on the map (Task 12, J1/J2):
// - Walk legs: dotted (`1 9`, round caps) in the walk colour with casing, and a "Walk" chip at mid-leg when > 150 m.
// - Ride legs: sliced `[boardMeasureM, alightMeasureM]` along the variant's approximate path (wrapping across the
//   start on circular routes), solid in the route's colourKey (or two-tone traditional base + modern dashed overlay
//   for `mixed_trad_modern`), direction chevrons every 250 m, and a short mode chip at mid-leg.
// - Untraced variants draw no ride line (stops stay above).
import L from "leaflet";
import { Fragment, useMemo } from "react";
import { Marker, Polyline } from "react-leaflet";
import type { PlanOptionDto, PlanResponse } from "@/domain/api/plan";
type PlanVariantInfo = PlanResponse["variants"][number];
import type { Line, Lines } from "@/domain/api/schemas";
type TracedLine = Line;
import { haversineMeters } from "@/domain/geo/geometry";
import { decodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import type { ColourKey } from "@/domain/modes/fleet";
import { MAP_CHIP_TEXT, type VisualKey } from "@/domain/modes/modes";
import { lineWidths, paletteForSurface, type MapSurface } from "@/domain/modes/palette";
import { WALK_PATH_LABEL, type EnrichedPlanOption, type EnrichedWalkLeg } from "@/domain/trip/enrich";
import { isNegligibleWalk, routeChipLabel } from "@/domain/trip/present";
import { chevronSvgHtml, sampleChevrons, type DirectionChevron } from "./direction-chevrons";

export type SliceOptions = {
  isCircular?: boolean;
  totalLengthM?: number | null;
};

export type RideStrokeLayer = {
  role: "casing" | "base" | "secondary";
  visualKey: Exclude<VisualKey, "mixed_trad_modern">;
  dashArray: string | null;
  className: string;
};

/**
 * Linearly slices `coords` between `[fromM, toM]` (metres from the start of the polyline).
 * When `isCircular` is true and `fromM > toM`, wraps across the start (`[fromM, total] + [0, toM]`).
 */
export function slicePolylineByMeasure(
  coords: readonly LatLng[],
  fromM: number,
  toM: number,
  options: SliceOptions = {},
): LatLng[] {
  if (coords.length < 2) return [...coords];

  const segLengths: number[] = [];
  let rawTotalM = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i - 1]!, coords[i]!);
    segLengths.push(d);
    rawTotalM += d;
  }
  if (rawTotalM <= 0) return [coords[0]!, coords[coords.length - 1]!];

  const nominalTotalM = options.totalLengthM && options.totalLengthM > 0 ? options.totalLengthM : rawTotalM;
  const scale = rawTotalM / nominalTotalM;

  const clampRaw = (m: number) => Math.max(0, Math.min(rawTotalM, m * scale));

  const sliceLinearRaw = (startRawM: number, endRawM: number): LatLng[] => {
    const lo = Math.max(0, Math.min(rawTotalM, Math.min(startRawM, endRawM)));
    const hi = Math.max(0, Math.min(rawTotalM, Math.max(startRawM, endRawM)));
    if (hi - lo < 1e-3) {
      const pt = pointAtRawMeasure(coords, segLengths, lo);
      return [pt, pt];
    }
    const out: LatLng[] = [pointAtRawMeasure(coords, segLengths, lo)];
    let acc = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const nextAcc = acc + segLengths[i]!;
      if (nextAcc > lo + 1e-3 && nextAcc < hi - 1e-3) {
        out.push(coords[i + 1]!);
      }
      acc = nextAcc;
    }
    out.push(pointAtRawMeasure(coords, segLengths, hi));
    return out;
  };

  if (options.isCircular && fromM > toM) {
    const firstHalf = sliceLinearRaw(clampRaw(fromM), rawTotalM);
    const secondHalf = sliceLinearRaw(0, clampRaw(toM));
    if (firstHalf.length === 0) return secondHalf;
    if (secondHalf.length === 0) return firstHalf;
    const lastFirst = firstHalf[firstHalf.length - 1]!;
    const firstSecond = secondHalf[0]!;
    const dup = haversineMeters(lastFirst, firstSecond) < 0.5;
    return dup ? [...firstHalf, ...secondHalf.slice(1)] : [...firstHalf, ...secondHalf];
  }

  return sliceLinearRaw(clampRaw(fromM), clampRaw(toM));
}

function pointAtRawMeasure(coords: readonly LatLng[], segLengths: readonly number[], targetRawM: number): LatLng {
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i]!;
    if (acc + segLen >= targetRawM || i === segLengths.length - 1) {
      const a = coords[i]!;
      const b = coords[i + 1]!;
      const t = segLen > 0 ? Math.min(1, Math.max(0, (targetRawM - acc) / segLen)) : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    acc += segLen;
  }
  return coords[coords.length - 1]!;
}

/** Returns the geographic midpoint at 50% of the polyline's cumulative length. */
export function midpointOnPolyline(coords: readonly LatLng[]): LatLng | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0]!;
  const segLengths: number[] = [];
  let totalM = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i - 1]!, coords[i]!);
    segLengths.push(d);
    totalM += d;
  }
  if (totalM <= 0) return coords[0]!;
  return pointAtRawMeasure(coords, segLengths, totalM / 2);
}

/**
 * Returns the ordered SVG stroke layers for a ride leg:
 * - single class: casing → solid core (`pn-line--ride`)
 * - `mixed_trad_modern` (D3): casing → solid traditional base (`pn-line--ride`) → dashed modern overlay (`24 24`, `pn-line--ride-secondary`)
 */
export function rideStrokeLayers(colourKey: ColourKey): RideStrokeLayer[] {
  if (colourKey === "mixed_trad_modern") {
    return [
      { role: "casing", visualKey: "traditional_puj", dashArray: null, className: "pn-line pn-line--casing" },
      { role: "base", visualKey: "traditional_puj", dashArray: null, className: "pn-line pn-line--ride" },
      {
        role: "secondary",
        visualKey: "modern_puj",
        dashArray: "24 24",
        className: "pn-line pn-line--ride pn-line--ride-secondary",
      },
    ];
  }
  return [
    { role: "casing", visualKey: colourKey, dashArray: null, className: "pn-line pn-line--casing" },
    { role: "base", visualKey: colourKey, dashArray: null, className: "pn-line pn-line--ride" },
  ];
}

export type TripWalkSegment = {
  key: string;
  coords: LatLng[];
  lengthM: number;
  midpoint: LatLng | null;
  label: string;
};

export type TripRideSegment = {
  key: string;
  variantId: string;
  routeCode: string;
  routeName: string;
  colourKey: ColourKey;
  coords: LatLng[];
  chevrons: DirectionChevron[];
  midpoint: LatLng | null;
  chipText: string;
  label: string;
};

export type TripLinesData = {
  walkSegments: TripWalkSegment[];
  rideSegments: TripRideSegment[];
  allCoords: LatLng[];
  legendItems: VisualKey[];
  announcement: string;
};

function findTracedLine(
  lines: Lines | null | undefined,
  variantId: string,
  routeCode: string,
): TracedLine | null {
  if (!lines) return null;
  if (lines.untraced.some((u) => u.variantId === variantId)) return null;
  return (
    lines.lines.find((l) => l.variantId === variantId) ??
    lines.lines.find((l) => l.routeCode === routeCode && l.kind === "permanent") ??
    lines.lines.find((l) => l.routeCode === routeCode) ??
    null
  );
}

/** Pure builder turning a selected trip option and the revision's `Lines` into renderable map segments + legend items. */
export function buildTripLinesData(
  option: PlanOptionDto | EnrichedPlanOption,
  variants: readonly PlanVariantInfo[],
  lines: Lines | null | undefined,
): TripLinesData {
  const walkSegments: TripWalkSegment[] = [];
  const rideSegments: TripRideSegment[] = [];
  const allCoords: LatLng[] = [];
  const legendSet = new Set<VisualKey>();
  const announcedParts: string[] = [];

  const variantById = new Map(variants.map((v) => [v.variantId, v]));

  option.legs.forEach((leg, idx) => {
    if (leg.kind === "walk") {
      if (option.rides > 0 && isNegligibleWalk(leg)) return;
      const enriched = leg as EnrichedWalkLeg;
      const coords =
        enriched.path && enriched.path.coords.length >= 2
          ? enriched.path.coords
          : [
              { lat: leg.from.lat, lng: leg.from.lng },
              { lat: leg.to.lat, lng: leg.to.lng },
            ];
      const lengthM = enriched.path ? enriched.path.lengthM : leg.estimateMeters;
      if (lengthM <= 0) return;
      const label = enriched.path ? enriched.path.label : WALK_PATH_LABEL;
      walkSegments.push({
        key: `walk-${idx}`,
        coords,
        lengthM,
        midpoint: lengthM > 150 ? midpointOnPolyline(coords) : null,
        label,
      });
      allCoords.push(...coords);
      legendSet.add("walk");
      announcedParts.push("walk");
      return;
    }

    announcedParts.push(routeChipLabel(leg.routeCode, leg.routeName));
    if (leg.distanceBasis !== "approximate_path" || leg.boardMeasureM === null || leg.alightMeasureM === null) {
      return;
    }
    const traced = findTracedLine(lines, leg.variantId, leg.routeCode);
    if (!traced) return;

    let decoded: LatLng[];
    try {
      decoded = decodePolyline(traced.encoded);
    } catch {
      return;
    }
    if (decoded.length < 2) return;

    const variantInfo = variantById.get(leg.variantId);
    const isCircular =
      variantInfo?.isCircular ?? (traced.direction === "clockwise" || traced.direction === "counterclockwise");
    const sliced = slicePolylineByMeasure(decoded, leg.boardMeasureM, leg.alightMeasureM, {
      isCircular,
      totalLengthM: traced.lengthM,
    });
    if (sliced.length < 2) return;

    const colourKey = leg.fleet.colourKey;
    const chipText = MAP_CHIP_TEXT[colourKey];
    rideSegments.push({
      key: `ride-${idx}-${leg.variantId}`,
      variantId: leg.variantId,
      routeCode: leg.routeCode,
      routeName: leg.routeName,
      colourKey,
      coords: sliced,
      chevrons: sampleChevrons(sliced, 250),
      midpoint: midpointOnPolyline(sliced),
      chipText,
      label: traced.label,
    });
    allCoords.push(...sliced);
    legendSet.add(colourKey);
  });

  const announcement =
    announcedParts.length > 0
      ? `Trip drawn: ${announcedParts.join(", ")}. Lines are approximate.`
      : "";

  return {
    walkSegments,
    rideSegments,
    allCoords,
    legendItems: [...legendSet],
    announcement,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function midChipIcon(text: string, coreColor: string, casingColor: string) {
  return L.divIcon({
    className: "pn-map-line-chip-wrap",
    html: `<span class="pn-map-line-chip" style="border-color:${coreColor};background:${casingColor};color:${coreColor}">${escapeHtml(text)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

type Props = {
  data: TripLinesData;
  surface: MapSurface;
  highContrast: boolean;
};

export function TripLinesLayer({ data, surface, highContrast }: Props) {
  const palette = paletteForSurface(surface);
  const widths = lineWidths(highContrast);

  const elements = useMemo(() => {
    const walkEls = data.walkSegments.map((seg) => {
      const positions = seg.coords.map((c) => [c.lat, c.lng] as [number, number]);
      const swatch = palette.walk;
      return (
        <Fragment key={seg.key}>
          <Polyline
            key={`${seg.key}-casing`}
            positions={positions}
            className="pn-line pn-line--casing pn-line--walk-casing"
            pathOptions={{
              className: "pn-line pn-line--casing pn-line--walk-casing",
              color: swatch.casing,
              weight: widths.walkDotPx + widths.casingSidePx * 2,
              lineCap: "round",
              lineJoin: "round",
            }}
            interactive={false}
          />
          <Polyline
            key={`${seg.key}-core`}
            positions={positions}
            className="pn-line pn-line--walk"
            pathOptions={{
              className: "pn-line pn-line--walk",
              color: swatch.core,
              weight: widths.walkDotPx,
              dashArray: "1 9",
              lineCap: "round",
              lineJoin: "round",
            }}
            interactive={false}
          />
          {seg.midpoint ? (
            <Marker
              position={[seg.midpoint.lat, seg.midpoint.lng]}
              icon={midChipIcon(MAP_CHIP_TEXT.walk, swatch.core, swatch.casing)}
              interactive={false}
              keyboard={false}
              zIndexOffset={-200}
            />
          ) : null}
        </Fragment>
      );
    });

    const rideEls = data.rideSegments.map((seg) => {
      const positions = seg.coords.map((c) => [c.lat, c.lng] as [number, number]);
      const layers = rideStrokeLayers(seg.colourKey);
      const baseSwatch = palette[seg.colourKey === "mixed_trad_modern" ? "traditional_puj" : seg.colourKey];
      return (
        <Fragment key={seg.key}>
          {layers.map((layer) => {
            const swatch = palette[layer.visualKey];
            const isCasing = layer.role === "casing";
            return (
              <Polyline
                key={`${seg.key}-${layer.role}`}
                positions={positions}
                className={layer.className}
                pathOptions={{
                  className: layer.className,
                  color: isCasing ? swatch.casing : swatch.core,
                  weight: isCasing ? widths.tripRideCorePx + widths.casingSidePx * 2 : widths.tripRideCorePx,
                  dashArray: layer.dashArray ?? undefined,
                  lineCap: layer.dashArray ? "butt" : "round",
                  lineJoin: "round",
                }}
                interactive={false}
              />
            );
          })}
          {seg.chevrons.map((chev, idx) => (
            <Marker
              key={`${seg.key}-chev-${idx}`}
              position={[chev.point.lat, chev.point.lng]}
              icon={L.divIcon({
                className: "pn-chevron-icon",
                html: chevronSvgHtml(chev.bearingDeg, baseSwatch.core, baseSwatch.casing, highContrast),
                iconSize: [16, 16],
                iconAnchor: [8, 8],
              })}
              interactive={false}
              keyboard={false}
              zIndexOffset={-250}
            />
          ))}
          {seg.midpoint ? (
            <Marker
              position={[seg.midpoint.lat, seg.midpoint.lng]}
              icon={midChipIcon(seg.chipText, baseSwatch.core, baseSwatch.casing)}
              interactive={false}
              keyboard={false}
              zIndexOffset={-200}
            />
          ) : null}
        </Fragment>
      );
    });

    return [...walkEls, ...rideEls];
  }, [data, palette, widths, highContrast]);

  return <>{elements}</>;
}
