"use client";

// Trip guide lines on the map (Task 12, J1/J2):
// - Walk legs: dotted (`1 9`, round caps) in the walk colour with casing, and a "Walk" chip at mid-leg when > 150 m.
// - Ride legs: sliced `[boardMeasureM, alightMeasureM]` along the variant's approximate path (wrapping across the
//   start on circular routes), solid in the route's colourKey (or two-tone traditional base + modern dashed overlay
//   for `mixed_trad_modern`), direction chevrons every 250 m, and a short mode chip at mid-leg.
// - The ride slice follows the same segment rules as the route lines (line-rules.ts): a flagged trace's
//   off-list sections and >= 100 m one-way conflicts are dashed, terminal access roads drawn normally.
// - A ride is drawn only on the line of its own variant (matched by variant id, from the plan's revision);
//   an untraced variant draws no ride line (stops stay above).
import L from "leaflet";
import { Fragment, useMemo } from "react";
import { Marker, Polyline } from "react-leaflet";
import type { PlanOptionDto, PlanResponse } from "@/domain/api/plan";
type PlanVariantInfo = PlanResponse["variants"][number];
import type { Line, Lines } from "@/domain/api/schemas";
type TracedLine = Line;
import { decodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import type { ColourKey } from "@/domain/modes/fleet";
import { type VisualKey } from "@/domain/modes/modes";
import { en, type Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { PADYAK_DASH_ARRAY, lineWidths, paletteForSurface, type MapSurface } from "@/domain/modes/palette";
import { WALK_STRAIGHT_LABEL, type EnrichedPlanOption, type EnrichedWalkLeg } from "@/domain/trip/enrich";
import { isNegligibleWalk, routeChipLabel } from "@/domain/trip/present";
import { chevronSvgHtml, sampleChevrons, type DirectionChevron } from "./direction-chevrons";
import type { LegendExtra } from "./map-legend";
import {
  lineNotes,
  midpointOnPolyline,
  rideIntervals,
  rideRuns,
  slicePolylineByMeasure,
  type LineNotes,
  type PolylineRun,
} from "./line-rules";

export { midpointOnPolyline, slicePolylineByMeasure, type SliceOptions } from "./line-rules";

export type RideStrokeLayer = {
  role: "casing" | "base" | "secondary";
  visualKey: Exclude<VisualKey, "mixed_trad_modern">;
  dashArray: string | null;
  className: string;
};

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
  /** Index of the leg in the option (guidance emphasises the current leg). */
  legIndex: number;
  coords: LatLng[];
  lengthM: number;
  midpoint: LatLng | null;
  label: string;
};

export type TripRideSegment = {
  key: string;
  legIndex: number;
  variantId: string;
  routeCode: string;
  routeName: string;
  colourKey: ColourKey;
  /** The whole slice (chevrons, fitting the map). */
  coords: LatLng[];
  /** The slice cut into solid and dashed runs (line-rules.ts). */
  runs: PolylineRun[];
  notes: LineNotes;
  chevrons: DirectionChevron[];
  midpoint: LatLng | null;
  chipText: string;
  label: string;
};

/** A routed tricycle or padyak leg. A street leg with no routed path (not confirmed, unavailable, restricted) is never drawn. */
export type TripStreetSegment = {
  key: string;
  legIndex: number;
  mode: "tricycle" | "padyak";
  coords: LatLng[];
  midpoint: LatLng | null;
  chipText: string;
  label: string;
};


export type TripLinesData = {
  walkSegments: TripWalkSegment[];
  rideSegments: TripRideSegment[];
  streetSegments: TripStreetSegment[];
  /** Legend entries beyond the vehicle classes: padyak and the free point. */
  legendExtras: LegendExtra[];
  allCoords: LatLng[];
  legendItems: VisualKey[];
  announcement: string;
  /** A dashed one-way-conflict section is drawn on some ride (legend caution). */
  caution: boolean;
};

/**
 * The line of exactly this variant, or null. Never another variant of the same route: its measures
 * would place the ride on the wrong direction or variant.
 */
export function findVariantLine(lines: Lines | null | undefined, variantId: string): TracedLine | null {
  if (!lines) return null;
  return lines.lines.find((l) => l.variantId === variantId) ?? null;
}

/** Pure builder turning a selected trip option and the revision's `Lines` into renderable map segments + legend items. */
export function buildTripLinesData(
  option: PlanOptionDto | EnrichedPlanOption,
  variants: readonly PlanVariantInfo[],
  lines: Lines | null | undefined,
  copy: Pick<Dict, "map" | "modes"> = en,
): TripLinesData {
  const m = copy.map;
  const modes = copy.modes;
  const walkSegments: TripWalkSegment[] = [];
  const rideSegments: TripRideSegment[] = [];
  const streetSegments: TripStreetSegment[] = [];
  const legendExtras = new Set<LegendExtra>();
  const allCoords: LatLng[] = [];
  const legendSet = new Set<VisualKey>();
  const announcedParts: string[] = [];
  let caution = false;

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
      const label = enriched.path ? enriched.path.label : WALK_STRAIGHT_LABEL;
      walkSegments.push({
        key: `walk-${idx}`,
        legIndex: idx,
        coords,
        lengthM,
        midpoint: lengthM > 150 ? midpointOnPolyline(coords) : null,
        label,
      });
      allCoords.push(...coords);
      legendSet.add("walk");
      announcedParts.push(m.announceWalk);
      return;
    }
    if (leg.kind === "tricycle" || leg.kind === "padyak") {
      announcedParts.push(leg.kind === "tricycle" ? m.announceTricycle : m.announcePadyak);
      const routed = leg.basis === "street_graph" && leg.path !== null;
      let coords: LatLng[] | null = null;
      if (routed) {
        try {
          coords = decodePolyline(leg.path!);
        } catch {
          coords = null;
        }
      }
      // No straight dashed line for a street leg: without a routed path (not confirmed, unavailable, restricted) nothing is drawn.
      if (!coords || coords.length < 2) return;
      streetSegments.push({
        key: `street-${idx}`,
        legIndex: idx,
        mode: leg.kind,
        coords,
        midpoint: midpointOnPolyline(coords),
        chipText: leg.kind === "tricycle" ? modes.chip.tricycle : m.chipPadyak,
        label: leg.kind === "tricycle" ? m.streetRoute : m.streetRoutePadyak,
      });
      allCoords.push(...coords);
      if (leg.kind === "padyak") legendExtras.add("padyak");
      else legendSet.add("tricycle");
      return;
    }
    if (leg.kind !== "ride") return;

    announcedParts.push(routeChipLabel(leg.routeCode, leg.routeName, leg.display));
    if (leg.distanceBasis !== "approximate_path" || leg.boardMeasureM === null || leg.alightMeasureM === null) {
      return;
    }
    const traced = findVariantLine(lines, leg.variantId);
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
    const runs = rideRuns(decoded, traced.lengthM, traced.segments, traced.status, leg.boardMeasureM, leg.alightMeasureM, isCircular);
    const notes = lineNotes(traced, rideIntervals(leg.boardMeasureM, leg.alightMeasureM, traced.lengthM, isCircular));
    if (notes.onewayCaution) caution = true;

    const colourKey = leg.fleet.colourKey;
    const chipText = modes.chip[colourKey];
    rideSegments.push({
      key: `ride-${idx}-${leg.variantId}`,
      legIndex: idx,
      variantId: leg.variantId,
      routeCode: leg.routeCode,
      routeName: leg.routeName,
      colourKey,
      coords: sliced,
      runs: runs.length > 0 ? runs : [{ coords: sliced, fromM: leg.boardMeasureM, toM: leg.alightMeasureM, dashed: false, reason: null }],
      notes,
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
      ? m.tripDrawn(announcedParts.join(", "))
      : "";

  return {
    walkSegments,
    rideSegments,
    streetSegments,
    legendExtras: [...legendExtras],
    allCoords,
    legendItems: [...legendSet],
    announcement,
    caution,
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
  /** Guidance: the leg being walked or ridden is drawn at full strength, the others softer. */
  activeLegIndex?: number | null;
};

/** Opacity of the legs other than the current one while guided. */
export const INACTIVE_LEG_OPACITY = 0.5;

/** The dash of a caution section (same as the route lines). */
export const CAUTION_DASH_ARRAY = "8 6" as const;

/** Opacity of the legs already travelled (before the current one): the road behind fades most. */
export const COMPLETED_LEG_OPACITY = 0.3;

/** 1 for every leg unless a current leg is named; then only that leg stays at full strength, the legs ahead softer, those behind softest. */
export function legOpacity(activeLegIndex: number | null, legIndex: number): number {
  if (activeLegIndex === null || activeLegIndex === legIndex) return 1;
  return legIndex < activeLegIndex ? COMPLETED_LEG_OPACITY : INACTIVE_LEG_OPACITY;
}

export function TripLinesLayer({ data, surface, highContrast, activeLegIndex = null }: Props) {
  const modes = useT().modes;
  const palette = paletteForSurface(surface);
  const widths = useMemo(() => lineWidths(highContrast), [highContrast]);
  // A current leg with no drawn segment (an undrawn ride, a negligible walk) dims nothing.
  const current =
    activeLegIndex !== null && [...data.walkSegments, ...data.rideSegments, ...data.streetSegments].some((s) => s.legIndex === activeLegIndex) ? activeLegIndex : null;

  const elements = useMemo(() => {
    const walkEls = data.walkSegments.map((seg) => {
      const positions = seg.coords.map((c) => [c.lat, c.lng] as [number, number]);
      const swatch = palette.walk;
      const opacity = legOpacity(current, seg.legIndex);
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
              opacity,
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
              opacity,
              lineCap: "round",
              lineJoin: "round",
            }}
            interactive={false}
          />
          {seg.midpoint ? (
            <Marker
              position={[seg.midpoint.lat, seg.midpoint.lng]}
              icon={midChipIcon(modes.chip.walk, swatch.core, swatch.casing)}
              interactive={false}
              keyboard={false}
              zIndexOffset={-200}
            />
          ) : null}
        </Fragment>
      );
    });

    // Tricycle: solid in its colour. Padyak: the same colour, dashed. A straight line with no street route:
    // thin and sparse, so it is never read as a route.
    const streetEls = data.streetSegments.map((seg) => {
      const swatch = palette.tricycle;
      const opacity = legOpacity(current, seg.legIndex);
      const positions = seg.coords.map((c) => [c.lat, c.lng] as [number, number]);
      const dashArray = seg.mode === "padyak" ? PADYAK_DASH_ARRAY : undefined;
      const core = widths.tripRideCorePx;
      const kind = seg.mode === "padyak" ? "pn-line--padyak" : "pn-line--tricycle";
      const cap = dashArray ? "butt" : "round";
      return (
        <Fragment key={seg.key}>
          <Polyline
            positions={positions}
            pathOptions={{ className: "pn-line pn-line--casing", color: swatch.casing, weight: core + widths.casingSidePx * 2, opacity, lineCap: cap, lineJoin: "round", dashArray }}
            interactive={false}
          />
          <Polyline
            positions={positions}
            pathOptions={{ className: `pn-line pn-line--ride ${kind}`, color: swatch.core, weight: core, opacity, lineCap: cap, lineJoin: "round", dashArray }}
            interactive={false}
          />
          {seg.midpoint ? (
            <Marker position={[seg.midpoint.lat, seg.midpoint.lng]} icon={midChipIcon(seg.chipText, swatch.core, swatch.casing)} interactive={false} keyboard={false} zIndexOffset={-200} />
          ) : null}
        </Fragment>
      );
    });

    const rideEls = data.rideSegments.map((seg) => {
      const layers = rideStrokeLayers(seg.colourKey);
      const baseSwatch = palette[seg.colourKey === "mixed_trad_modern" ? "traditional_puj" : seg.colourKey];
      const opacity = legOpacity(current, seg.legIndex);
      return (
        <Fragment key={seg.key}>
          {seg.runs.map((run, rIdx) => {
            const positions = run.coords.map((c) => [c.lat, c.lng] as [number, number]);
            const runClass = [
              run.dashed ? "pn-line--caution" : "",
              run.reason === "oneway_conflict" ? "pn-line--oneway-conflict" : "",
              run.reason === "off_list_detour" ? "pn-line--off-list" : "",
            ]
              .filter(Boolean)
              .join(" ");
            // A dashed (caution) run draws casing + dashed base only: the two-tone overlay would hide the dashes.
            return layers
              .filter((layer) => !(run.dashed && layer.role === "secondary"))
              .map((layer) => {
                const swatch = palette[layer.visualKey];
                const isCasing = layer.role === "casing";
                const dashArray = run.dashed && layer.role === "base" ? CAUTION_DASH_ARRAY : layer.dashArray;
                const className = !isCasing && runClass ? `${layer.className} ${runClass}` : layer.className;
                return (
                  <Polyline
                    key={`${seg.key}-${rIdx}-${layer.role}`}
                    positions={positions}
                    className={className}
                    pathOptions={{
                      className,
                      color: isCasing ? swatch.casing : swatch.core,
                      weight: isCasing ? widths.tripRideCorePx + widths.casingSidePx * 2 : widths.tripRideCorePx,
                      dashArray: dashArray ?? undefined,
                      opacity,
                      lineCap: dashArray ? "butt" : "round",
                      lineJoin: "round",
                    }}
                    interactive={false}
                  />
                );
              });
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

    return [...walkEls, ...streetEls, ...rideEls];
  }, [data, palette, widths, highContrast, current, modes]);

  return <>{elements}</>;
}
