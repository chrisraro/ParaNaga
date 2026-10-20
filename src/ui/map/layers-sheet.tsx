"use client";

// Map layers & mode filter sheet + accessible list equivalents (Task 12, D16, WCAG 2.2 AA).
// Opened from the 48×48 px "Layers" button in the map control stack.
// Provides:
//   - Switches for "Routes" and "Terminals" (D16's "Show historical routes" was removed with the
//     e-jeepney route, ruling 2026-10-16: no historical route is published).
//   - A modal dialog: Tab is trapped inside it, and closing returns focus to what opened it (the
//     Layers button).
//   - Multi-select mode chips ("All" resets; Jeepney, Tricycle, UV Express, Bus, Train).
//   - Accessible list equivalents: "Routes on the map ({n})" → `/app/routes/{code}` and
//     "Terminals ({n})" → `/app/terminals/{code}`.
//   - Regional note: "Regional UV Express and bus routes leave the city; see their terminals."
import "../modes/modes.css";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef } from "react";
import type { Line, SnapshotTerminal } from "@/domain/api/schemas";
import { modeName, type RouteMode } from "@/domain/modes/fleet";
import type { VisualKey } from "@/domain/modes/modes";
import { terminalLocationText } from "@/domain/places/explore";
import { terminalMatchesModes, terminalModesPhrase } from "@/domain/places/terminals";
import type { LayersPref } from "@/domain/prefs/prefs";
import { cycleTab, captureOpener } from "@/ui/kit/opener";
import { Switch } from "@/ui/kit/switch";
import { ModeChip } from "@/ui/modes/mode-chip";
import { isActiveRoute, routeLabel } from "@/domain/planner/route-display";
import { ModeIcon } from "@/ui/modes/mode-icon";
import { lineNotes, type LineNotes } from "./line-rules";
import { LineNotesView } from "./line-notes-view";

export { LineNotesView } from "./line-notes-view";

const MODE_FILTER_ITEMS: readonly { mode: RouteMode; label: string; iconKey: VisualKey }[] = [
  { mode: "jeepney", label: modeName("jeepney"), iconKey: "traditional_puj" },
  { mode: "tricycle", label: modeName("tricycle"), iconKey: "tricycle" },
  { mode: "uv_express", label: modeName("uv_express"), iconKey: "uv_express" },
  { mode: "bus", label: modeName("bus"), iconKey: "bus" },
  { mode: "rail", label: modeName("rail"), iconKey: "rail" },
];

export const REGIONAL_ROUTES_NOTE =
  "Regional UV Express and bus routes leave the city; see their terminals." as const;

/**
 * The Layers sheet's list equivalent of the terminals layer: with the Terminals switch on, every
 * terminal matching the mode filter, including those without a coordinate (listed as "Location
 * not mapped", never drawn); with it off, none (the heading count matches what is shown).
 */
export function listTerminals(
  terminals: readonly SnapshotTerminal[] | null | undefined,
  layers: LayersPref,
): SnapshotTerminal[] {
  if (!layers.terminals) return [];
  return (terminals ?? []).filter((t) => terminalMatchesModes(t, layers.modes));
}

export function filterMapTerminals(
  terminals: readonly SnapshotTerminal[] | null | undefined,
  layers: LayersPref,
): SnapshotTerminal[] {
  if (!terminals || !layers.terminals) return [];
  return terminals.filter((t) => {
    if (t.lat === null || t.lng === null) return false;
    return terminalMatchesModes(t, layers.modes);
  });
}

export type DistinctMapRoute = {
  routeCode: string;
  routeName: string;
  mode: RouteMode;
  colourKey: Line["colourKey"];
  chipText: string;
  fleetLabel: string;
  /** Over all of the route's drawn lines: a dashed one-way section, a terminal access road. */
  notes: LineNotes;
};

export function distinctRoutesFromLines(lines: readonly Line[]): DistinctMapRoute[] {
  const byCode = new Map<string, DistinctMapRoute>();
  for (const line of lines) {
    if (!isActiveRoute(line.routeCode)) continue;
    const notes = lineNotes(line);
    const seen = byCode.get(line.routeCode);
    if (seen) {
      seen.notes = {
        onewayCaution: seen.notes.onewayCaution || notes.onewayCaution,
        terminalAccess: seen.notes.terminalAccess || notes.terminalAccess,
      };
      continue;
    }
    byCode.set(line.routeCode, {
      routeCode: line.routeCode,
      routeName: routeLabel(line.routeCode, line.routeName),
      mode: line.mode,
      colourKey: line.colourKey,
      chipText: line.fleet.chip,
      fleetLabel: line.fleet.label,
      notes,
    });
  }
  return [...byCode.values()];
}

export const LINES_NOT_LOADED = "Route lines aren't loaded on this device." as const;

type Props = {
  open: boolean;
  onClose: () => void;
  layers: LayersPref;
  onUpdateLayers: (patch: Partial<LayersPref>) => void;
  /** Routes and Stops are drawn only while on (the home map starts with both off). */
  routesOn: boolean;
  onRoutesChange: (on: boolean) => void;
  stopsOn: boolean;
  onStopsChange: (on: boolean) => void;
  tracedLines: readonly Line[];
  /** False when route lines were not loaded (low-data, offline, or not published): say so. */
  linesLoaded?: boolean;
  terminals?: readonly SnapshotTerminal[] | null;
};

export function LayersSheet({
  open,
  onClose,
  layers,
  onUpdateLayers,
  routesOn,
  onRoutesChange,
  stopsOn,
  onStopsChange,
  tracedLines,
  linesLoaded = true,
  terminals = null,
}: Props) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    // Whatever opened the sheet (the Layers button) gets focus back when it closes.
    const opener = captureOpener();
    closeBtnRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      cycleTab(event, dialogRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);

  const mapRoutes = useMemo(() => distinctRoutesFromLines(tracedLines), [tracedLines]);
  const terminalList = useMemo(() => listTerminals(terminals, layers), [terminals, layers]);

  if (!open) return null;

  const allSelected = layers.modes.length === 0;

  const toggleMode = (mode: RouteMode) => {
    const exists = layers.modes.includes(mode);
    const next = exists ? layers.modes.filter((m) => m !== mode) : [...layers.modes, mode];
    onUpdateLayers({ modes: next });
  };

  return (
    <div className="pn-layers-backdrop" data-testid="layers-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pn-layers-sheet"
        data-testid="layers-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pn-layers-sheet__head">
          <h2 id={titleId} className="pn-layers-sheet__title">
            Map layers
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="pn-layers-sheet__close"
            aria-label="Close map layers"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="pn-layers-sheet__body">
          <div className="pn-layers-switches" role="group" aria-label="Layer visibility">
            <Switch label="Routes" checked={routesOn} onChange={onRoutesChange} testId="layer-switch-routes" />
            <Switch label="Stops" checked={stopsOn} onChange={onStopsChange} testId="layer-switch-stops" />
            <Switch label="Terminals" checked={layers.terminals} onChange={(terminals) => onUpdateLayers({ terminals })} testId="layer-switch-terminals" />
          </div>

          <div className="pn-layers-modes" role="group" aria-label="Filter by mode">
            <span className="pn-layers-section-label">Filter by mode</span>
            <div className="pn-layers-modes__chips">
              <button
                type="button"
                className={allSelected ? "pn-mode-filter-chip pn-mode-filter-chip--on" : "pn-mode-filter-chip"}
                aria-pressed={allSelected}
                onClick={() => onUpdateLayers({ modes: [] })}
                data-testid="mode-filter-all"
              >
                All
              </button>
              {MODE_FILTER_ITEMS.map((item) => {
                const active = layers.modes.includes(item.mode);
                return (
                  <button
                    key={item.mode}
                    type="button"
                    className={active ? "pn-mode-filter-chip pn-mode-filter-chip--on" : "pn-mode-filter-chip"}
                    aria-pressed={active}
                    onClick={() => toggleMode(item.mode)}
                    data-testid={`mode-filter-${item.mode}`}
                  >
                    <ModeIcon mode={item.iconKey} size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="pn-layers-note" data-testid="layers-regional-note">
            {REGIONAL_ROUTES_NOTE}
          </p>

          <section className="pn-layers-list-section" aria-labelledby={`${titleId}-routes-list`}>
            <h3 id={`${titleId}-routes-list`} className="pn-layers-section-title">
              Routes on the map ({mapRoutes.length})
            </h3>
            {!routesOn ? (
              <p className="pn-layers-empty">Routes are switched off.</p>
            ) : !linesLoaded ? (
              <p className="pn-layers-empty" data-testid="layers-lines-not-loaded">
                {LINES_NOT_LOADED}
              </p>
            ) : mapRoutes.length === 0 ? (
              <p className="pn-layers-empty">No routes match the current filter.</p>
            ) : (
              <ul className="pn-layers-list" data-testid="layers-routes-list">
                {mapRoutes.map((route) => (
                  <li key={route.routeCode}>
                    <Link
                      href={`/app/routes/${encodeURIComponent(route.routeCode)}`}
                      className="pn-layers-list__link"
                      onClick={onClose}
                    >
                      <span className="pn-layers-list__top">
                        <strong>{route.routeName}</strong>
                        <ModeChip mode={route.colourKey} label={route.chipText} compact />
                      </span>
                      <span className="pn-layers-list__sub">{route.fleetLabel}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pn-layers-list-section" aria-labelledby={`${titleId}-terminals-list`}>
            <h3 id={`${titleId}-terminals-list`} className="pn-layers-section-title">
              Terminals ({terminalList.length})
            </h3>
            {terminalList.length === 0 ? (
              <p className="pn-layers-empty">{layers.terminals ? "No terminals match the current filter." : "Terminals are switched off."}</p>
            ) : (
              <ul className="pn-layers-list" data-testid="layers-terminals-list">
                {terminalList.map((terminal) => (
                  <li key={terminal.code}>
                    <Link
                      href={`/app/terminals/${encodeURIComponent(terminal.code)}`}
                      className="pn-layers-list__link"
                      onClick={onClose}
                    >
                      <span className="pn-layers-list__top">
                        <strong>{terminal.name}</strong>
                      </span>
                      <span className="pn-layers-list__sub" data-testid="layers-terminal-sub">
                        {`${terminalModesPhrase(terminal.modes)} · ${terminalLocationText(terminal.lat !== null)}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export function SelectedRouteCard({
  route,
  onClose,
}: {
  route: DistinctMapRoute;
  onClose: () => void;
}) {
  return (
    <aside
      className="pn-route-overview-card" data-sheet-follower=""
      aria-label={`Selected route: ${route.routeName}`}
      data-testid="selected-route-card"
    >
      <div className="pn-route-overview-card__head">
        <ModeChip mode={route.colourKey} label={route.chipText} compact />
        <strong className="pn-route-overview-card__name">{route.routeName}</strong>
        <button
          type="button"
          className="pn-route-overview-card__close"
          aria-label="Dismiss selected route"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="pn-route-overview-card__fleet">{route.fleetLabel}</p>
      <p className="pn-route-overview-card__approx">Approximate path, not a verified route shape</p>
      <LineNotesView notes={route.notes} testIdPrefix="route-card" />
      <Link
        href={`/app/routes/${encodeURIComponent(route.routeCode)}`}
        className="pn-route-overview-card__link"
      >
        Route details
      </Link>
    </aside>
  );
}
