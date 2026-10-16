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
import { useEffect, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Line, SnapshotTerminal } from "@/domain/api/schemas";
import { modeName, type RouteMode } from "@/domain/modes/fleet";
import type { VisualKey } from "@/domain/modes/modes";
import type { LayersPref } from "@/domain/prefs/prefs";
import { ModeChip } from "@/ui/modes/mode-chip";
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

export function filterMapTerminals(
  terminals: readonly SnapshotTerminal[] | null | undefined,
  layers: LayersPref,
): SnapshotTerminal[] {
  if (!terminals || !layers.terminals) return [];
  return terminals.filter((t) => {
    if (t.lat === null || t.lng === null) return false;
    if (layers.modes.length > 0 && !t.modes.some((m: string) => layers.modes.includes(m as RouteMode))) return false;
    return true;
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
      routeName: line.routeName,
      mode: line.mode,
      colourKey: line.colourKey,
      chipText: line.fleet.chip,
      fleetLabel: line.fleet.label,
      notes,
    });
  }
  return [...byCode.values()];
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  open: boolean;
  onClose: () => void;
  layers: LayersPref;
  onUpdateLayers: (patch: Partial<LayersPref>) => void;
  tracedLines: readonly Line[];
  terminals?: readonly SnapshotTerminal[] | null;
};

export function LayersSheet({
  open,
  onClose,
  layers,
  onUpdateLayers,
  tracedLines,
  terminals = null,
}: Props) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    // Whatever opened the sheet (the Layers button) gets focus back when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtnRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);

  // Modal: Tab and Shift+Tab cycle within the sheet, never into the map behind it.
  const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const mapRoutes = useMemo(() => distinctRoutesFromLines(tracedLines), [tracedLines]);
  const mapTerminals = useMemo(() => filterMapTerminals(terminals, layers), [terminals, layers]);

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
        onKeyDown={trapTab}
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
            <div className="pn-layers-switch-row">
              <span id={`${titleId}-routes`} className="pn-layers-switch-row__label">
                Routes
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={layers.routes}
                aria-labelledby={`${titleId}-routes`}
                className={layers.routes ? "pn-switch pn-switch--on" : "pn-switch"}
                onClick={() => onUpdateLayers({ routes: !layers.routes })}
                data-testid="layer-switch-routes"
              >
                <span className="pn-switch__thumb" aria-hidden="true" />
              </button>
            </div>

            <div className="pn-layers-switch-row">
              <span id={`${titleId}-terminals`} className="pn-layers-switch-row__label">
                Terminals
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={layers.terminals}
                aria-labelledby={`${titleId}-terminals`}
                className={layers.terminals ? "pn-switch pn-switch--on" : "pn-switch"}
                onClick={() => onUpdateLayers({ terminals: !layers.terminals })}
                data-testid="layer-switch-terminals"
              >
                <span className="pn-switch__thumb" aria-hidden="true" />
              </button>
            </div>

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
            {mapRoutes.length === 0 ? (
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
              Terminals ({mapTerminals.length})
            </h3>
            {mapTerminals.length === 0 ? (
              <p className="pn-layers-empty">No mapped terminals match the current filter.</p>
            ) : (
              <ul className="pn-layers-list" data-testid="layers-terminals-list">
                {mapTerminals.map((terminal) => (
                  <li key={terminal.code}>
                    <Link
                      href={`/app/terminals/${encodeURIComponent(terminal.code)}`}
                      className="pn-layers-list__link"
                      onClick={onClose}
                    >
                      <span className="pn-layers-list__top">
                        <strong>{terminal.name}</strong>
                      </span>
                      <span className="pn-layers-list__sub">
                        {terminal.modes.map((m: string) => modeName(m as RouteMode) ?? m).join(" · ")}
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
      className="pn-route-overview-card"
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
