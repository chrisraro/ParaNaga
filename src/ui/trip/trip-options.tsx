"use client";

// Trip options (artboard TripOptions), shown in the home sheet once both endpoints are set.
// A card is minimal (U3): the first label, the "Unverified route" chip for a ride, the route
// ("Loop A"), the time ("Est. 18–27 min + waiting (unknown)", from the snapshot's model on the
// device; "Time not available" without one), the fare ("Est. ₱14–₱17") and the transfer count.
// The leg strip, vehicle class, peak note and the full badge live in the detail. Each card is one
// button whose accessible name is its whole text (the range read as "18 to 27 minutes").

import "./trip.css";

import { Fragment, useMemo, type ReactNode } from "react";
import type { PlanOptionDto, PlanResponse } from "@/domain/api/plan";
import type { EtaModel } from "@/domain/api/schemas";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { formatDistance, isNegligibleWalk, optionTitle, transfersText } from "@/domain/trip/present";
import { EtaTotalText, extractWalkLengths, useOptionEta } from "./eta-text";
import { Chevron, FareChip, FareShort, LoopChip, UNVERIFIED_CHIP, WalkIcon, type PlanLookups } from "./trip-parts";

export function optionDomId(optionId: string): string {
  return `pn-trip-option-${optionId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export const OPTIONS_LIST_ID = "pn-trip-options-list";
export const OPTIONS_TOGGLE_ID = "pn-options-toggle";

export function LegStrip({ option, lookups }: { option: PlanOptionDto; lookups: PlanLookups }) {
  // A walk of a few metres (start or end at the stop itself) is not a step.
  const legs = option.legs.filter((leg) => !(option.rides > 0 && isNegligibleWalk(leg)));
  return (
    <span className="pn-legstrip">
      {legs.map((leg, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <>
              <Chevron />
              <span className="sr-only">, then </span>
            </>
          ) : null}
          {leg.kind === "walk" ? (
            <span className="pn-legstrip__walk">
              <WalkIcon />
              <span className="sr-only">Walk </span>
              {formatDistance(leg.estimateMeters)}
            </span>
          ) : (
            <>
              <span className="sr-only">Ride </span>
              <LoopChip leg={leg} direction={lookups.direction(leg.variantId)} />
              <span className="pn-legstrip__ride">{formatDistance(leg.distanceMeters)}</span>
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function OptionCard({
  option,
  onOpen,
  index,
  etaModel,
}: {
  option: PlanOptionDto;
  onOpen: (id: string) => void;
  index: number;
  etaModel?: EtaModel | null;
}) {
  const primary = index === 0;
  const walkLengths = useMemo(() => extractWalkLengths(option.legs), [option.legs]);
  const { estimate } = useOptionEta(option, walkLengths, etaModel);

  return (
    <li className="pn-trip-li">
      <button
        type="button"
        id={optionDomId(option.id)}
        className={primary ? "pn-trip-card pn-trip-card--primary pn-trip-in" : "pn-trip-card pn-trip-in"}
        style={{ animationDelay: `${index * 0.06}s` }}
        data-testid="trip-option"
        onClick={() => onOpen(option.id)}
      >
        <span className="pn-trip-card__top">
          {option.labels[0] ? (
            // One word is shown ("Recommended", "Fastest"); a longer label is read aloud only, to keep the card short.
            <span className={!option.labels[0].includes(" ") ? (primary ? "pn-trip-card__label pn-trip-card__label--primary" : "pn-trip-card__label") : "sr-only"}>{option.labels[0]}</span>
          ) : null}
          {/* The driver caveat belongs to rides only; a walk has no driver. The full badge is in the detail. */}
          {option.rides > 0 ? (
            <>
              <span className="sr-only">. </span>
              <span className="pn-trip-card__chip" data-testid="card-unverified">
                {UNVERIFIED_CHIP}
              </span>
            </>
          ) : null}
        </span>
        <span className="pn-trip-card__head">
          <strong>{optionTitle(option)}</strong>
          <span className="sr-only">. </span>
          <EtaTotalText estimate={estimate} className="pn-trip-card__time" testId="trip-option-time" short />
        </span>
        <span className="sr-only">. </span>
        <span className="pn-trip-card__foot">
          <FareChip fare={option.fare} short />
          <span className="sr-only">. </span>
          <span className="pn-trip-card__transfers">{transfersText(option.rides)}</span>
        </span>
      </button>
    </li>
  );
}

type Props = {
  data: PlanResponse;
  /** A newer plan (refined GPS point) is on its way; these options stay until it arrives. */
  refreshing?: boolean;
  onOpen: (optionId: string) => void;
  /** The "Tricycle may serve this" card (D15), shown below the options; never an option itself. */
  tricycleHint?: ReactNode;
  etaModel?: EtaModel | null;
};

export function TripOptions({ data, refreshing = false, onOpen, tricycleHint = null, etaModel }: Props) {
  const extraNotes = data.plan.notes.filter((n) => n !== UNVERIFIED_ROUTE_BADGE);
  return (
    <section className="pn-trip" aria-labelledby="pn-trip-options-title" aria-busy={refreshing || undefined} data-testid="trip-options">
      <h2 id="pn-trip-options-title" className="pn-trip__title" tabIndex={-1} data-results-heading="">
        Trip options
      </h2>
      {refreshing ? <p className="pn-trip__refreshing">Updating…</p> : null}
      <ul id={OPTIONS_LIST_ID} className="pn-trip-list">
        {data.plan.options.map((option, i) => (
          <OptionCard key={option.id} option={option} onOpen={onOpen} index={i} etaModel={etaModel} />
        ))}
      </ul>
      {extraNotes.length > 0 ? (
        <div className="pn-trip-warn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          <div>
            {extraNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </div>
      ) : null}
      {tricycleHint}
    </section>
  );
}

/**
 * Peek of the sheet once From and To are set: one line for the best option (route, time range,
 * fare, a caution chip for a ride) and the toggle "All options" that lifts the sheet to full with
 * every option (aria-expanded while full, the chevron turns). The summary hides at full: the list is there.
 */
export function OptionsPeek({
  data,
  etaModel,
  expanded,
  onToggle,
}: {
  data: PlanResponse;
  etaModel?: EtaModel | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const best = data.plan.options[0];
  const walkLengths = useMemo(() => extractWalkLengths(best?.legs ?? []), [best]);
  const { estimate } = useOptionEta(best, walkLengths, etaModel);
  if (!best) return null;
  return (
    <div className="pn-peek" data-testid="options-peek">
      {expanded ? null : (
      <p className="pn-peek__best" data-testid="options-best">
        <span className="sr-only">Best option: </span>
        <span>
          {optionTitle(best)}
          <span aria-hidden="true"> · </span>
          <EtaTotalText estimate={estimate} short />
          <span aria-hidden="true"> · </span>
          <FareShort fare={best.fare} />
        </span>
        {best.rides > 0 ? (
          <span className="pn-peek__chip" data-testid="options-best-unverified">
            {UNVERIFIED_CHIP}
          </span>
        ) : null}
      </p>
      )}
      <button
        type="button"
        id={OPTIONS_TOGGLE_ID}
        className="pn-peek__toggle"
        aria-expanded={expanded}
        aria-controls={OPTIONS_LIST_ID}
        onClick={onToggle}
        data-testid="options-toggle"
      >
        All options
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
