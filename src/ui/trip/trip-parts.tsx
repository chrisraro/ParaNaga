// Small pieces shared by Trip options and Trip detail (artboards TripOptions / TripDetail,
// Components: route chip, fare chips, warning badge). Honest by construction: the badge is
// always the warning "Unverified route", fares are always estimates.

import type { PlanResponse, RideLegDto } from "@/domain/api/plan";
import { FARE_NOT_FIXED, farNoteView } from "@/domain/trip/option-card";
import { routeChipText } from "@/domain/planner/route-display";
import { directionText, fareChipText, fareRangeText, routeChipLabel, stopLabel, type LoopDirection } from "@/domain/trip/present";
import { StatusBadge } from "@/ui/kit/badge";
import { ModeIcon } from "@/ui/modes/mode-icon";
import { EstAbbr } from "./eta-text";

export function WalkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="13" cy="4" r="2" />
      <path d="M9 21l2-7 3 3v4M7 12l3-4 4 1 3 3" />
    </svg>
  );
}

/** Pedal-cab glyph for padyak (the tricycle uses the shared ModeIcon). */
export function PadyakIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="6" cy="17" r="3.5" />
      <circle cx="18" cy="17" r="3.5" />
      <path d="M6 17l4-8h5l3 8M10 9l-1-3h-2" />
    </svg>
  );
}

/** Tricycle or padyak glyph with its name for assistive technology (the visible text names it too). */
export function StreetModeIcon({ mode }: { mode: "tricycle" | "padyak" }) {
  return mode === "tricycle" ? <ModeIcon mode="tricycle" size={16} /> : <PadyakIcon />;
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

/**
 * Gold outline for an estimate (like "+ 1 unknown"); dashed grey when there is none. `text` replaces the wording of an
 * access option ("From ₱33") or a special trip ("Fare not fixed", dashed: there is no fare to give).
 */
export function FareChip({ fare, short = false, text = null }: { fare: FareLike; short?: boolean; text?: string | null }) {
  const none = text === null ? !fareRangeText(fare) : text === FARE_NOT_FIXED;
  return (
    <span className={none ? "pn-fare-chip pn-fare-chip--none" : "pn-fare-chip"} data-testid="fare-chip">
      {short ? <FareShort fare={fare} text={text} /> : (text ?? fareChipText(fare))}
    </span>
  );
}

/** The card form of the fare: "Est. ₱14–₱17", "Fare n/a" or "No fare". */
export function FareShort({ fare, text = null }: { fare: FareLike; text?: string | null }) {
  if (text) return <>{text}</>;
  const range = fareRangeText(fare);
  // A range is spoken like the time range: "₱14 to ₱17", not a dash.
  if (range) return <><EstAbbr /> {range.includes("–") ? <span role="img" aria-label={range.replace("–", " to ")}>{range}</span> : range}</>;
  if (fare.status === "minimum" || fare.status === "flat_per_passenger") return <>{fareChipText(fare)}</>;
  return <>{fare.status === "no_ride" ? "No fare" : "Fare n/a"}</>;
}

/** Route chip, e.g. "Loop A" with its loop arrow (or an arrow for a line route), optionally followed by the direction. */
export function LoopChip({
  leg,
  direction,
  icon = "loop",
  short = false,
}: {
  leg: Pick<RideLegDto, "routeCode" | "routeName"> & { display?: RideLegDto["display"] };
  direction?: LoopDirection | null;
  icon?: "loop" | "line";
  /** In a route list the chip is the short "Route E" / "Loop C" / "R1"; the title beside it carries the full name. */
  short?: boolean;
}) {
  const text = short ? routeChipText(leg.routeCode) : routeChipLabel(leg.routeCode, leg.routeName, leg.display);
  const dir = directionText(direction ?? null, "short", text);
  return (
    <span className="pn-loop">
      <span className="pn-loop-chip">
        <span className="pn-loop-chip__icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={icon === "loop" ? "M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" : "M5 12h14M13 6l6 6-6 6"} />
          </svg>
        </span>
        {text}
      </span>
      {dir ? <span className="pn-loop__dir">{dir}</span> : null}
    </span>
  );
}

/**
 * Why no tricycle is suggested near a far area, as a quiet note with its evidence label ("Local report": it is
 * what riders report, not an ordinance). Null when the plan has no note.
 */
export function FarNote({ note, options = [] }: { note: string | null; options?: Parameters<typeof farNoteView>[1] }) {
  const v = farNoteView(note, options);
  if (!v) return null;
  return (
    <p className="pn-trip-farnote" data-testid="far-note">
      {v.label ? <span className="pn-trip-farnote__label">{v.label}</span> : null}
      {v.label ? <span className="sr-only">: </span> : null}
      {v.text}
    </p>
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
