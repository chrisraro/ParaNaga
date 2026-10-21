// Status badges (artboard Components; global constraints "Honesty"). Every badge is text plus an
// icon, never colour alone, and the text is fixed per variant so a screen cannot soften it.

import "./styles";

import type { ReactNode } from "react";
import { en, type Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";

export type BadgeVariant =
  | "verified"
  | "candidate"
  | "documented"
  | "trial"
  | "unverified-route"
  | "not-surveyed"
  | "historical"
  | "osm"
  | "provisional-stops"
  | "approximate-path";

const ICON_PROPS = {
  width: 12,
  height: 12,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

const BADGES: Record<BadgeVariant, { className: string; icon: ReactNode }> = {
  verified: {
    className: "pn-badge pn-badge--verified",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={3}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    ),
  },
  candidate: {
    className: "pn-badge pn-badge--candidate",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={3}>
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  documented: {
    className: "pn-badge pn-badge--evidence",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={2.6}>
        <path d="M6 4h9l3 3v13H6z" />
        <path d="M9 11h6M9 15h6" />
      </svg>
    ),
  },
  trial: {
    className: "pn-badge pn-badge--trial",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={2.6}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  "unverified-route": {
    className: "pn-trip-badge",
    icon: (
      <svg {...ICON_PROPS} width={14} height={14} strokeWidth={2.4}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
    ),
  },
  "not-surveyed": {
    className: "pn-badge pn-badge--evidence",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={2.6} strokeDasharray="3 3">
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  historical: {
    className: "pn-badge pn-badge--historical",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={2.6}>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 8v4l3 2" />
      </svg>
    ),
  },
  // Routes whose stop order is provisional (Loops A and B, on unverified mapped pins).
  "provisional-stops": {
    className: "pn-badge pn-badge--candidate",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={3}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  // Source badge on every OpenStreetMap place (with OsmAttribution on the same screen).
  osm: {
    className: "pn-badge pn-badge--evidence",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={2.6}>
        <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" />
        <circle cx="12" cy="10" r="2" />
      </svg>
    ),
  },
  "approximate-path": {
    className: "pn-badge pn-badge--evidence",
    icon: (
      <svg {...ICON_PROPS} strokeWidth={2.4}>
        <path d="M4 19c4 0 4-14 8-14s4 14 8 14" />
      </svg>
    ),
  },
};

/** The badge's wording in `copy`'s language (English by default). */
export function badgeText(variant: BadgeVariant, copy: Pick<Dict, "trip" | "kit"> = en): string {
  return variant === "unverified-route" ? copy.trip.unverifiedBadge : copy.kit.badges[variant];
}

export function StatusBadge({ variant, testId }: { variant: BadgeVariant; testId?: string }) {
  const badge = BADGES[variant];
  const t = useT();
  return (
    <span className={badge.className} data-variant={variant} data-testid={testId}>
      {badge.icon}
      {badgeText(variant, t)}
    </span>
  );
}
