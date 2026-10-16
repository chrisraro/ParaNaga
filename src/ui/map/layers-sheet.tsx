"use client";

// Map layers & mode filter sheet + accessible list equivalents (Task 12, D16, WCAG 2.2 AA).
// Opened from the 48×48 px "Layers" button in the map control stack.
// Provides:
//   - Switches for "Routes", "Terminals", and "Show historical routes".
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
import type { LayersPref } from "@/domain/prefs/prefs";
import { ModeChip } from "@/ui/modes/mode-chip";
import { ModeIcon } from "@/ui/modes/mode-icon";

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
};

export function distinctRoutesFromLines(lines: readonly Line[]): DistinctMapRoute[] {
  const byCode = new Map<string, DistinctMapRoute>();
  for (const line of lines) {
    if (byCode.has(line.routeCode)) continue;
    byCode.set(line.routeCode, {
      routeCode: line.routeCode,
      routeName: line.routeName,
      mode: line.mode,
      colourKey: line.colourKey,
      chipText: line.fleet.chip,
      fleetLabel: line.fleet.label,
    });
  }
  return [...byCode.values()];
}

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

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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

            <div className="pn-layers-switch-row">
              <span id={`${titleId}-historical`} className="pn-layers-switch-row__label">
                Show historical routes
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={layers.historical}
                aria-labelledby={`${titleId}-historical`}
                className={layers.historical ? "pn-switch pn-switch--on" : "pn-switch"}
                onClick={() => onUpdateLayers({ historical: !layers.historical })}
                data-testid="layer-switch-historical"
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
      <Link
        href={`/app/routes/${encodeURIComponent(route.routeCode)}`}
        className="pn-route-overview-card__link"
      >
        Route details
      </Link>
    </aside>
  );
}
