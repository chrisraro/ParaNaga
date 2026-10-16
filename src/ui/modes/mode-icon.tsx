"use client";

// Inline SVG glyphs for every vehicle class, route mode, walk, and rail (Task 11).
// Always `aria-hidden="true"` and `focusable="false"` — a visible text label is always paired
// beside the icon in ModeChip, FleetChips, and MapLegend so colour/shape is never the sole cue.

import { resolveVisualKey, type RouteMode, type VisualKey } from "@/domain/modes/modes";

export type ModeIconProps = {
  mode: VisualKey | RouteMode;
  size?: number;
  className?: string;
};

export function ModeIcon({ mode, size = 18, className }: ModeIconProps) {
  const key = resolveVisualKey(mode);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-mode-icon={key}
    >
      {glyphFor(key)}
    </svg>
  );
}

function glyphFor(key: VisualKey) {
  switch (key) {
    case "traditional_puj":
      // Side-view traditional jeepney with extended hood and open rear step.
      return (
        <>
          <path d="M2 12V7.5L4.5 6H15.5L17.5 8.5V13.5H2V12Z" />
          <path d="M5 6V9.5H15.5" />
          <circle cx="5.5" cy="14.5" r="1.75" />
          <circle cx="14" cy="14.5" r="1.75" />
        </>
      );
    case "modern_puj":
      // Box minibus with high roof and tall front windscreen.
      return (
        <>
          <rect x="2.5" y="4.5" width="15" height="9" rx="2" />
          <path d="M2.5 9.5H17.5" />
          <path d="M7.5 4.5V9.5M12.5 4.5V9.5" />
          <circle cx="6" cy="15" r="1.6" />
          <circle cx="14" cy="15" r="1.6" />
        </>
      );
    case "mixed_trad_modern":
      // Dual-profile jeepney + modern minibus badge.
      return (
        <>
          <path d="M2 11.5V7.5L4 6H12.5V12.5H2V11.5Z" />
          <rect x="8.5" y="4.5" width="9.5" height="8" rx="1.5" />
          <circle cx="5" cy="14.5" r="1.5" />
          <circle cx="14.5" cy="14.5" r="1.5" />
        </>
      );
    case "tricycle":
      // Motorcycle with passenger sidecar canopy.
      return (
        <>
          <path d="M3 13H12.5L14.5 9H8.5L6.5 6.5H4L3 13Z" />
          <path d="M12.5 9L15.5 7.5" />
          <circle cx="5.5" cy="14.5" r="1.75" />
          <circle cx="15" cy="14.5" r="1.75" />
        </>
      );
    case "e_tricycle":
      // Tricycle cab with lightning bolt.
      return (
        <>
          <path d="M2.5 13H12L13.5 8.5H6L4 6.5H2.5V13Z" />
          <path d="M15.5 4.5L13.5 8H16L14 11.5" />
          <circle cx="5.5" cy="14.5" r="1.6" />
          <circle cx="14.5" cy="14.5" r="1.6" />
        </>
      );
    case "uv_express":
      // Commuter van silhouette.
      return (
        <>
          <path d="M2.5 13V6.5C2.5 5.7 3.2 5 4 5H13.5L17.5 9V13H2.5Z" />
          <path d="M9.5 5V9H17" />
          <circle cx="6" cy="14.5" r="1.6" />
          <circle cx="14" cy="14.5" r="1.6" />
        </>
      );
    case "bus":
      // Coach bus front/side with bumper and twin windows.
      return (
        <>
          <rect x="3" y="3.5" width="14" height="10.5" rx="2" />
          <path d="M3 8.5H17M10 3.5V8.5" />
          <path d="M5.5 11.5H7M13 11.5H14.5" />
          <circle cx="6.5" cy="15.5" r="1.5" />
          <circle cx="13.5" cy="15.5" r="1.5" />
        </>
      );
    case "unconfirmed":
      // Jeepney silhouette with question mark.
      return (
        <>
          <path d="M2 12.5V8L4 6.5H11.5V12.5H2Z" />
          <circle cx="5" cy="14.5" r="1.5" />
          <path d="M14 6.2C14 5.1 15 4.5 16 4.8C17 5.1 17.2 6.3 16.2 7C15.6 7.4 15.5 7.9 15.5 8.6" />
          <circle cx="15.5" cy="11" r="0.6" fill="currentColor" />
        </>
      );
    case "walk":
      // Walking figure.
      return (
        <>
          <circle cx="10.5" cy="4" r="1.6" />
          <path d="M7.5 9.5L10 7L12.8 9L14.5 10" />
          <path d="M10 7L9.2 12L7 16.5" />
          <path d="M9.5 12L12.2 14L13.2 16.8" />
        </>
      );
    case "rail":
      // Train front on rails.
      return (
        <>
          <rect x="4.5" y="3" width="11" height="11" rx="2" />
          <path d="M4.5 8H15.5" />
          <circle cx="7.5" cy="11" r="0.8" fill="currentColor" />
          <circle cx="12.5" cy="11" r="0.8" fill="currentColor" />
          <path d="M6.5 14L4.5 17M13.5 14L15.5 17M6 16H14" />
        </>
      );
  }
}
