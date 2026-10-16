"use client";

// Accessible mode chip (Task 11): inline SVG icon + visible text label + 4 px left colour stripe.
// Never colour-only: the visible text carries the full meaning even when CSS colours are stripped.

import "./modes.css";

import type { CSSProperties } from "react";
import {
  MAP_CHIP_TEXT,
  MODE_DISPLAY_NAMES,
  resolveVisualKey,
  type RouteMode,
  type VisualKey,
} from "@/domain/modes/modes";
import { ModeIcon } from "./mode-icon";

export type ModeChipProps = {
  mode: VisualKey | RouteMode;
  /** Override text label (e.g. fleet.chip `"Jeepney · traditional + modern"`). Defaults to `MODE_DISPLAY_NAMES[key]`. */
  label?: string;
  /** Short map-chip variant (`"Jeep + Modern"`, `"Walk"`). */
  compact?: boolean;
  className?: string;
};

export function ModeChip({ mode, label, compact = false, className }: ModeChipProps) {
  const key = resolveVisualKey(mode);
  const text = label ?? (compact ? MAP_CHIP_TEXT[key] : MODE_DISPLAY_NAMES[key]);
  const style = {
    "--pn-chip-stripe": `var(--pn-mode-${key})`,
  } as CSSProperties;

  return (
    <span
      className={["pn-mode-chip", compact ? "pn-mode-chip--compact" : "", className ?? ""].filter(Boolean).join(" ")}
      style={style}
      data-testid="mode-chip"
      data-mode={key}
    >
      <span className="pn-mode-chip__icon">
        <ModeIcon mode={key} size={compact ? 15 : 18} />
      </span>
      <span className="pn-mode-chip__label">{text}</span>
    </span>
  );
}
