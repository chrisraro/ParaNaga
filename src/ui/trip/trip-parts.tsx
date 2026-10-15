// Small pieces shared by Trip options and Trip detail (artboards TripOptions / TripDetail,
// Components: route chip, fare chips, warning badge). Honest by construction: the badge is
// always the warning "Unverified route", fares are always estimates.

import type { PlanResponse, RideLegDto } from "@/domain/api/plan";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { directionText, fareChipText, routeChipLabel, stopLabel, type LoopDirection } from "@/domain/trip/present";

export function WalkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="13" cy="4" r="2" />
      <path d="M9 21l2-7 3 3v4M7 12l3-4 4 1 3 3" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg className="pn-trip-chevron" width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M2 2l4 4-4 4" />
    </svg>
  );
}

/** Warning-style badge (never the teal "Verified route"). */
export function UnverifiedBadge() {
  return (
    <span className="pn-trip-badge" data-testid="unverified-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
      {UNVERIFIED_ROUTE_BADGE}
    </span>
  );
}

type FareLike = { status: string; minCentavos: number | null; maxCentavos: number | null };

/** Gold outline for an estimate (like "+ 1 unknown"); dashed grey when there is none. */
export function FareChip({ fare }: { fare: FareLike }) {
  const estimate = fare.status === "estimate" && fare.minCentavos !== null && fare.maxCentavos !== null;
  return (
    <span className={estimate ? "pn-fare-chip" : "pn-fare-chip pn-fare-chip--none"} data-testid="fare-chip">
      {fareChipText(fare)}
    </span>
  );
}

/** Route chip, e.g. "Loop A" with its loop arrow, optionally followed by the direction. */
export function LoopChip({ leg, direction }: { leg: Pick<RideLegDto, "routeCode" | "routeName">; direction?: LoopDirection | null }) {
  const dir = directionText(direction ?? null, "short");
  return (
    <span className="pn-loop">
      <span className="pn-loop-chip">
        <span className="pn-loop-chip__icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" />
          </svg>
        </span>
        {routeChipLabel(leg.routeCode, leg.routeName)}
      </span>
      {dir ? <span className="pn-loop__dir">{dir}</span> : null}
    </span>
  );
}

export type PlanLookups = {
  stopName: (id: string, fallback: string) => string;
  direction: (variantId: string) => LoopDirection | null;
};

export function planLookups(data: PlanResponse): PlanLookups {
  const stops = new Map(data.stops.map((s) => [s.id, s]));
  const variants = new Map(data.variants.map((v) => [v.variantId, v]));
  return {
    stopName: (id, fallback) => {
      const s = stops.get(id);
      return s ? stopLabel(s.name, s.code) : fallback;
    },
    direction: (variantId) => variants.get(variantId)?.loopDirection ?? null,
  };
}
