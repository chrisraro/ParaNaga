// Small pieces shared by Trip options and Trip detail (artboards TripOptions / TripDetail,
// Components: route chip, fare chips, warning badge). Honest by construction: the badge is
// always the warning "Unverified route", fares are always estimates.

import type { PlanResponse, RideLegDto } from "@/domain/api/plan";
import { directionText, fareChipText, fareRangeText, routeChipLabel, stopLabel, type LoopDirection } from "@/domain/trip/present";
import { StatusBadge } from "@/ui/kit/badge";
import { EstAbbr } from "./eta-text";

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

/** The caution chip on an option card or the peek (the full badge is in the detail). */
export const UNVERIFIED_CHIP = "Unverified route";

/** Warning-style badge (never the teal "Verified route"). */
export function UnverifiedBadge() {
  return <StatusBadge variant="unverified-route" testId="unverified-badge" />;
}

type FareLike = { status: string; minCentavos: number | null; maxCentavos: number | null };

/** Gold outline for an estimate (like "+ 1 unknown"); dashed grey when there is none. */
export function FareChip({ fare, short = false }: { fare: FareLike; short?: boolean }) {
  return (
    <span className={fareRangeText(fare) ? "pn-fare-chip" : "pn-fare-chip pn-fare-chip--none"} data-testid="fare-chip">
      {short ? <FareShort fare={fare} /> : fareChipText(fare)}
    </span>
  );
}

/** The card form of the fare: "Est. ₱14–₱17", "Fare n/a" or "No fare". */
export function FareShort({ fare }: { fare: FareLike }) {
  const range = fareRangeText(fare);
  if (range) return <><EstAbbr /> {range}</>;
  return <>{fare.status === "no_ride" ? "No fare" : "Fare n/a"}</>;
}

/** Route chip, e.g. "Loop A" with its loop arrow (or an arrow for a line route), optionally followed by the direction. */
export function LoopChip({
  leg,
  direction,
  icon = "loop",
}: {
  leg: Pick<RideLegDto, "routeCode" | "routeName">;
  direction?: LoopDirection | null;
  icon?: "loop" | "line";
}) {
  const dir = directionText(direction ?? null, "short");
  return (
    <span className="pn-loop">
      <span className="pn-loop-chip">
        <span className="pn-loop-chip__icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={icon === "loop" ? "M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" : "M5 12h14M13 6l6 6-6 6"} />
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
