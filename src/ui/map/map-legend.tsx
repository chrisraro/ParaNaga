"use client";

// Accessible collapsible MapLegend (Task 11).
//
// Shows a "Legend" button (`aria-expanded`) placed above map attribution and clear of zoom controls.
// When expanded, renders only the items passed (each with an SVG line/marker swatch showing the
// real casing + pattern, the ModeIcon, and the text label), plus:
//   - Walk note: "Dotted: approximate walking path · crossings not checked"
//   - Mixed-fleet note: "Alternating colours: traditional and modern jeepneys both operate (owner-confirmed)"
//   - Fixed footnote: "Lines are approximate paths, not verified route shapes."
// Keyboard operable; pressing Escape inside the legend closes it and returns focus to the button.

import "@/ui/modes/modes.css";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import L from "leaflet";
import { MODE_DISPLAY_NAMES, resolveVisualKey, type RouteMode, type VisualKey } from "@/domain/modes/modes";
import {
  APPROX_STREET_DASH_ARRAY,
  PADYAK_DASH_ARRAY,
  PALETTE_D,
  PALETTE_L,
  TWO_TONE_DASH_ARRAY,
  WALK_DASH_ARRAY,
  type MapSurface,
} from "@/domain/modes/palette";
import { ModeIcon } from "@/ui/modes/mode-icon";
import { ONEWAY_CAUTION } from "./line-rules";

export const LEGEND_FOOTNOTE = "Lines are approximate paths, not verified route shapes." as const;
export const LEGEND_WALK_NOTE = "Dotted: approximate walking path · crossings not checked" as const;
export const LEGEND_STOP_LABEL = "Mapped stop, not verified" as const;
export const LEGEND_MIXED_NOTE = "Alternating colours: traditional and modern jeepneys both operate (owner-confirmed)" as const;

/** Extra entries a trip can need: padyak (dashed), a straight line that is not a route, a free board or get-off point. */
export type LegendExtra = "padyak" | "approx_street" | "free_point";
export const LEGEND_EXTRA_LABEL: Record<LegendExtra, string> = {
  padyak: "Padyak",
  approx_street: "Approximate, not a route",
  free_point: "Board or get off here (stop not marked)",
};

export type LegendEntry =
  | VisualKey
  | RouteMode
  | {
      key: VisualKey | RouteMode;
      label?: string;
    };

export type MapLegendProps = {
  items: readonly LegendEntry[];
  defaultOpen?: boolean;
  surface?: MapSurface;
  /** Polite live announcement when a trip is drawn on the map. */
  announcement?: string | null;
  /** Some drawn line has a dashed one-way-conflict section: explain the dashes. */
  caution?: boolean;
  /** The "Mapped stop, not verified" entry (the amber ring); on by default: the pins are always on the map. */
  showStops?: boolean;
  /** One honest line above the footnote (e.g. the trip's own lines did not load). */
  notice?: string | null;
  extras?: readonly LegendExtra[];
};

function normalizeItems(items: readonly LegendEntry[]): { key: VisualKey; label: string }[] {
  const seen = new Set<VisualKey>();
  const out: { key: VisualKey; label: string }[] = [];
  for (const item of items) {
    const rawKey = typeof item === "string" ? item : item.key;
    const key = resolveVisualKey(rawKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = (typeof item === "object" && item.label) ? item.label : MODE_DISPLAY_NAMES[key];
    out.push({ key, label });
  }
  return out;
}

function LegendSwatch({ visualKey, surface }: { visualKey: VisualKey; surface: MapSurface }) {
  const palette = surface === "dark" ? PALETTE_D : PALETTE_L;
  const token = palette[visualKey];

  if (token.pattern === "marker_only") {
    return (
      <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
        <rect x="11" y="1" width="14" height="14" rx="4" fill={token.core} stroke={token.casing} strokeWidth="1.5" />
      </svg>
    );
  }

  if (token.pattern === "dotted") {
    return (
      <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
        <line x1="3" y1="8" x2="33" y2="8" stroke={token.casing} strokeWidth="8" strokeLinecap="round" />
        <line
          x1="3"
          y1="8"
          x2="33"
          y2="8"
          stroke={token.core}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={WALK_DASH_ARRAY}
        />
      </svg>
    );
  }

  if (token.pattern === "two_tone" && token.secondaryCore) {
    return (
      <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
        <line x1="2" y1="8" x2="34" y2="8" stroke={token.casing} strokeWidth="9" strokeLinecap="round" />
        <line x1="2" y1="8" x2="34" y2="8" stroke={token.core} strokeWidth="5" strokeLinecap="round" />
        <line
          x1="2"
          y1="8"
          x2="34"
          y2="8"
          stroke={token.secondaryCore}
          strokeWidth="5"
          strokeDasharray="8 8"
        />
      </svg>
    );
  }

  return (
    <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
      <line x1="2" y1="8" x2="34" y2="8" stroke={token.casing} strokeWidth="9" strokeLinecap="round" />
      <line
        x1="2"
        y1="8"
        x2="34"
        y2="8"
        stroke={token.core}
        strokeWidth="5"
        strokeLinecap="round"
        data-two-tone-dash={TWO_TONE_DASH_ARRAY}
      />
    </svg>
  );
}

/** Padyak (tricycle colour, dashed), an approximate street line (thin, sparse) or a free point (a diamond, not a stop ring). */
function ExtraSwatch({ extra, surface }: { extra: LegendExtra; surface: MapSurface }) {
  const token = (surface === "dark" ? PALETTE_D : PALETTE_L).tricycle;
  if (extra === "free_point") {
    return (
      <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
        <rect x="12" y="2" width="12" height="12" transform="rotate(45 18 8)" fill="#3E4C6B" stroke="#FFFFFF" strokeWidth="2" />
      </svg>
    );
  }
  const dash = extra === "padyak" ? PADYAK_DASH_ARRAY : APPROX_STREET_DASH_ARRAY;
  const core = extra === "padyak" ? 5 : 2.5;
  return (
    <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
      <line x1="2" y1="8" x2="34" y2="8" stroke={token.casing} strokeWidth={core + 4} />
      <line x1="2" y1="8" x2="34" y2="8" stroke={token.core} strokeWidth={core} strokeDasharray={dash} />
    </svg>
  );
}

/** The mapped-stop pin: the hollow amber ring the stops layer draws. */
function StopSwatch() {
  return (
    <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
      <circle cx="18" cy="8" r="5.5" fill="#FFFFFF" stroke="#E8A317" strokeWidth="3" />
    </svg>
  );
}

/** A dashed caution section, drawn like the map's (`8 6` dashes on the casing). */
function CautionSwatch({ surface }: { surface: MapSurface }) {
  const token = (surface === "dark" ? PALETTE_D : PALETTE_L).unconfirmed;
  return (
    <svg className="pn-map-legend__swatch" width="36" height="16" viewBox="0 0 36 16" aria-hidden="true" focusable="false">
      <line x1="2" y1="8" x2="34" y2="8" stroke={token.casing} strokeWidth="9" strokeLinecap="round" />
      <line x1="2" y1="8" x2="34" y2="8" stroke={token.core} strokeWidth="5" strokeDasharray="8 6" />
    </svg>
  );
}

export function MapLegend({ items, defaultOpen = false, surface = "light", announcement, caution = false, showStops = true, notice = null, extras = [] }: MapLegendProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const entries = normalizeItems(items);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  if (entries.length === 0 && !showStops && extras.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className="pn-map-legend"
      data-testid="map-legend"
      data-surface={surface}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {announcement ? (
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
      ) : null}
      {open ? (
        <div id={panelId} className="pn-map-legend__panel" role="region" aria-label="Map legend" data-testid="map-legend-panel">
          <ul className="pn-map-legend__list">
            {entries.map(({ key, label }) => (
              <li key={key} className="pn-map-legend__item" data-legend-item={key}>
                <div className="pn-map-legend__row">
                  <LegendSwatch visualKey={key} surface={surface} />
                  <ModeIcon mode={key} size={18} />
                  <span>{label}</span>
                </div>
                {key === "walk" ? <p className="pn-map-legend__note">{LEGEND_WALK_NOTE}</p> : null}
                {key === "mixed_trad_modern" ? <p className="pn-map-legend__note">{LEGEND_MIXED_NOTE}</p> : null}
              </li>
            ))}
            {extras.map((extra) => (
              <li key={extra} className="pn-map-legend__item" data-legend-item={extra}>
                <div className="pn-map-legend__row">
                  <ExtraSwatch extra={extra} surface={surface} />
                  <span>{LEGEND_EXTRA_LABEL[extra]}</span>
                </div>
              </li>
            ))}
            {showStops ? (
              <li className="pn-map-legend__item" data-legend-item="stop">
                <div className="pn-map-legend__row">
                  <StopSwatch />
                  <span>{LEGEND_STOP_LABEL}</span>
                </div>
              </li>
            ) : null}
            {caution ? (
              <li className="pn-map-legend__item" data-legend-item="caution" data-testid="map-legend-caution">
                <div className="pn-map-legend__row">
                  <CautionSwatch surface={surface} />
                  <span>Dashed section</span>
                </div>
                <p className="pn-map-legend__note pn-line-note__text">{ONEWAY_CAUTION}</p>
              </li>
            ) : null}
          </ul>
          {notice ? (
            <p className="pn-map-legend__note" data-testid="map-legend-notice">
              {notice}
            </p>
          ) : null}
          <p className="pn-map-legend__footnote">{LEGEND_FOOTNOTE}</p>
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className="pn-map-legend__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        data-testid="map-legend-button"
      >
        <span>Legend</span>
      </button>
    </div>
  );
}
