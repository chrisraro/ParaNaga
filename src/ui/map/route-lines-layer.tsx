"use client";

// Route overview and route-detail polyline layer (Task 12, D3, D16, Task 5 rulings):
// - Draws traced route paths with casing and mode colours (two-tone traditional + modern for R4/R7).
// - Applies the Task 5 segment rules from line-rules.ts (shared with the trip ride slices):
//     * `oneway_conflict` segments >= 100 m (or on a `flagged` trace) render dashed (`8 6`, `.pn-line--caution`);
//     * `off_list_detour` segments render dashed only when `line.status === "flagged"`;
//     * `terminal_access` segments always render solid.
// - Tapping a line selects its route and opens the bottom route card; lines are not keyboard-focusable
//   (the accessible list equivalent lives in `LayersSheet`).
import L from "leaflet";
import { Fragment, useMemo } from "react";
import { Marker, Polyline } from "react-leaflet";
import type { Line, Lines } from "@/domain/api/schemas";
type TracedLine = Line;
import { decodePolyline } from "@/domain/geo/polyline";
import type { LatLng } from "@/domain/geo/types";
import type { RouteMode } from "@/domain/modes/fleet";
import type { VisualKey } from "@/domain/modes/modes";
import { lineWidths, paletteForSurface, type MapSurface } from "@/domain/modes/palette";
import { chevronSvgHtml, sampleChevrons } from "./direction-chevrons";
import { lineNotes, splitLineIntoRuns } from "./line-rules";

export { shouldDashSegment, splitLineIntoRuns, type PolylineRun } from "./line-rules";

export type LayersFilter = {
  routes: boolean;
  terminals: boolean;
  /** Empty array means "All" modes are active. */
  modes: readonly RouteMode[];
};

/**
 * Filters `Lines.lines` according to the user's `layers` preference (D16). Lines of a route whose
 * service is historical/unknown are never drawn (no such route is published; the D16 "Show historical
 * routes" switch was removed with the e-jeepney route, ruling 2026-10-16).
 */
export function filterOverviewLines(lines: Lines | null | undefined, filter: LayersFilter): TracedLine[] {
  if (!lines || !filter.routes) return [];
  return lines.lines.filter((line) => {
    if (line.serviceStatus === "historical_unknown") return false;
    if (filter.modes.length > 0 && !filter.modes.includes(line.mode)) return false;
    return true;
  });
}

/** Some drawn line has a dashed one-way-conflict section (the legend then explains the dashes). */
export function linesHaveOnewayCaution(tracedLines: readonly TracedLine[] | null | undefined): boolean {
  return (tracedLines ?? []).some((line) => lineNotes(line).onewayCaution);
}

/** Collects the distinct `VisualKey`s present in a set of traced lines, preserving a stable order. */
export function collectRouteLegendItems(tracedLines: readonly TracedLine[]): VisualKey[] {
  const seen = new Set<VisualKey>();
  for (const line of tracedLines) {
    seen.add(line.colourKey);
  }
  return [...seen];
}

type Props = {
  lines: readonly TracedLine[];
  surface: MapSurface;
  highContrast: boolean;
  selectedRouteCode?: string | null;
  onSelectRoute?: ((routeCode: string) => void) | null;
  /** When true (on RouteDetail), draws direction chevrons every 250 m and uses thicker strokes. */
  showChevrons?: boolean;
};

export function RouteLinesLayer({
  lines,
  surface,
  highContrast,
  selectedRouteCode = null,
  onSelectRoute = null,
  showChevrons = false,
}: Props) {
  const palette = paletteForSurface(surface);
  const widths = useMemo(() => lineWidths(highContrast), [highContrast]);

  const orderedLines = useMemo(() => {
    if (!selectedRouteCode) return lines;
    const unselected = lines.filter((l) => l.routeCode !== selectedRouteCode);
    const selected = lines.filter((l) => l.routeCode === selectedRouteCode);
    return [...unselected, ...selected];
  }, [lines, selectedRouteCode]);

  const rendered = useMemo(() => {
    return orderedLines.map((line) => {
      let coords: LatLng[];
      try {
        coords = decodePolyline(line.encoded);
      } catch {
        return null;
      }
      if (coords.length < 2) return null;

      const isSelected = selectedRouteCode === line.routeCode || showChevrons;
      const coreWeight = isSelected ? widths.selectedOverviewCorePx : widths.overviewCorePx;
      const casingWeight = coreWeight + widths.overviewCasingSidePx * 2;
      const baseKey = line.colourKey === "mixed_trad_modern" ? "traditional_puj" : line.colourKey;
      const baseSwatch = palette[baseKey];
      const runs = splitLineIntoRuns(coords, line.lengthM, line.segments, line.status);
      const chevrons = showChevrons ? sampleChevrons(coords, 250) : [];
      const clickable = Boolean(onSelectRoute);
      const handleSelect = clickable ? { click: () => onSelectRoute?.(line.routeCode) } : undefined;

      return (
        <Fragment key={line.variantId}>
          {runs.map((run, rIdx) => {
            const positions = run.coords.map((c) => [c.lat, c.lng] as [number, number]);
            const classBase = [
              "pn-line",
              "pn-line--route",
              `pn-route--${line.routeCode.replace(/[^A-Za-z0-9_-]/g, "_")}`,
              isSelected ? "pn-line--route-selected" : "",
              run.dashed ? "pn-line--caution" : "",
              run.reason === "oneway_conflict" ? "pn-line--oneway-conflict" : "",
              run.reason === "off_list_detour" ? "pn-line--off-list" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <Fragment key={`${line.variantId}-run-${rIdx}`}>
                <Polyline
                  positions={positions}
                  className="pn-line pn-line--casing pn-line--route-casing"
                  pathOptions={{
                    className: "pn-line pn-line--casing pn-line--route-casing",
                    color: baseSwatch.casing,
                    weight: casingWeight,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                  interactive={false}
                />
                <Polyline
                  positions={positions}
                  className={classBase}
                  pathOptions={{
                    className: classBase,
                    color: baseSwatch.core,
                    weight: coreWeight,
                    dashArray: run.dashed ? "8 6" : undefined,
                    lineCap: run.dashed ? "butt" : "round",
                    lineJoin: "round",
                  }}
                  interactive={clickable}
                  eventHandlers={handleSelect}
                />
                {line.colourKey === "mixed_trad_modern" && !run.dashed ? (
                  <Polyline
                    positions={positions}
                    className={`${classBase} pn-line--ride-secondary`}
                    pathOptions={{
                      className: `${classBase} pn-line--ride-secondary`,
                      color: palette.modern_puj.core,
                      weight: coreWeight,
                      dashArray: "24 24",
                      lineCap: "butt",
                      lineJoin: "round",
                    }}
                    interactive={clickable}
                    eventHandlers={handleSelect}
                  />
                ) : null}
              </Fragment>
            );
          })}
          {chevrons.map((chev, idx) => (
            <Marker
              key={`${line.variantId}-chev-${idx}`}
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
        </Fragment>
      );
    });
  }, [orderedLines, palette, widths, selectedRouteCode, showChevrons, onSelectRoute, highContrast]);

  return <>{rendered}</>;
}
