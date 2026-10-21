"use client";

// Top guidance banner (home redesign T6): renders the active step's icon, title, distance/stop
// count, and next-leg hint from the pure GuidanceView model (`src/domain/guidance/view.ts`).
// Not a live region (§3.4): the guidance polite announcer and assertive Para alert already speak.

import type { GuidanceCopy, GuidanceView } from "@/domain/guidance/view";
import { useT } from "@/i18n/provider";

type ShownView = Exclude<GuidanceView, { screen: "ended" }>;

type Props = {
  view: GuidanceView | null;
  /** True after the rider pans the map away from the active step; shows the Re-center button. */
  panned?: boolean;
  onRecenter?: (() => void) | undefined;
};

function StepIcon({ view }: { view: ShownView }) {
  if (view.screen === "arrive") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M5 12l5 5L20 7" />
      </svg>
    );
  }
  if (view.screen === "ride" || view.screen === "street_ride") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="4" y="5" width="16" height="12" rx="3" />
        <path d="M4 11h16M7.5 17v2M16.5 17v2" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="13" cy="4.5" r="2" />
      <path d="M10 9l3-1 3 3-2 4 3 5M10 9l-2 5 3 2-2 4" />
    </svg>
  );
}

function bannerSubline(view: ShownView, g: GuidanceCopy): string | null {
  if (view.screen === "walk") {
    const parts: string[] = [];
    if (view.distanceText) {
      parts.push(view.directionText ? `${view.distanceText}, ${view.directionText}` : view.distanceText);
    }
    if (view.nextRide) {
      const dir = view.nextRide.direction ? ` (${view.nextRide.direction})` : "";
      parts.push(`${g.thenRide(view.nextRide.chip)}${dir}`);
    }
    return parts.length > 0 ? parts.join(" · ") : view.subtitle;
  }
  if (view.screen === "ride") {
    return `${view.subtitle} · ${view.countText}`;
  }
  if (view.screen === "street_ride") {
    return view.instruction;
  }
  return view.body;
}

export function GuidanceBanner({ view, panned = false, onRecenter }: Props) {
  const g = useT().guidance;
  if (!view || view.screen === "ended") return null;
  const subline = bannerSubline(view, g);
  return (
    <div className="pn-guide-banner" data-testid="guidance-banner" data-screen={view.screen}>
      <div className="pn-guide-banner__card">
        <span className="pn-guide-banner__icon">
          <StepIcon view={view} />
        </span>
        <div className="pn-guide-banner__body">
          <strong className="pn-guide-banner__title" data-testid="guidance-banner-title">
            {view.title}
          </strong>
          {subline ? (
            <p className="pn-guide-banner__sub" data-testid="guidance-banner-sub">
              {subline}
            </p>
          ) : null}
        </div>
      </div>
      {panned && onRecenter ? (
        <button
          type="button"
          className="pn-guide-banner__recenter"
          onClick={onRecenter}
          data-testid="guidance-recenter"
        >
          {g.recenter}
        </button>
      ) : null}
    </div>
  );
}
