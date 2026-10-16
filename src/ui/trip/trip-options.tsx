"use client";

// Trip options (artboard TripOptions), shown in the home sheet once both endpoints are set.
// Per card: labels, the warning "Unverified route" badge, the ride distance, the time estimate
// ("Estimate 18–27 min + waiting (unknown)", from the snapshot's model on the device; "Time not
// available" without one) with the peak note when the peak band is used, a vehicle-class chip per
// ride (C7), the leg strip (walk ≈ m → Loop chip + direction → walk ≈ m), the gold-outline fare
// estimate chip, and the transfer count. Each card is one button whose accessible name is its
// whole text (the range read as "18 to 27 minutes").

import "./trip.css";

import { Fragment, useMemo, type ReactNode } from "react";
import type { PlanOptionDto, PlanResponse, RideLegDto } from "@/domain/api/plan";
import type { EtaModel } from "@/domain/api/schemas";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { fareChipText, formatDistance, isNegligibleWalk, routeChipLabel, transfersText } from "@/domain/trip/present";
import { ModeChip } from "@/ui/modes/mode-chip";
import { EtaPeakNote, EtaTotalText, extractWalkLengths, useOptionEta } from "./eta-text";
import { Chevron, FareChip, LoopChip, UnverifiedBadge, WalkIcon, planLookups, type PlanLookups } from "./trip-parts";

export function optionDomId(optionId: string): string {
  return `pn-trip-option-${optionId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export const OPTIONS_LIST_ID = "pn-trip-options-list";
export const OPTIONS_TOGGLE_ID = "pn-options-toggle";

function headline(option: PlanOptionDto): string {
  if (option.rides === 0) return `Walk ${formatDistance(option.walkEstimateMeters)}`;
  return `Ride ${formatDistance(option.rideMeters)}`;
}

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
  lookups,
  onOpen,
  index,
  etaModel,
}: {
  option: PlanOptionDto;
  lookups: PlanLookups;
  onOpen: (id: string) => void;
  index: number;
  etaModel?: EtaModel | null;
}) {
  const primary = index === 0;
  const routes = option.legs.filter((l) => l.kind === "ride").map((l) => routeChipLabel(l.routeCode, l.routeName));
  const walkLengths = useMemo(() => extractWalkLengths(option.legs), [option.legs]);
  const { estimate } = useOptionEta(option, walkLengths, etaModel);
  const rideLegs = option.legs.filter((l): l is RideLegDto => l.kind === "ride");

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
          <span className={primary ? "pn-trip-card__label pn-trip-card__label--primary" : "pn-trip-card__label"}>
            {option.labels.join(" · ")}
          </span>
          {/* The driver caveat belongs to rides only; a walk has no driver. */}
          {option.rides > 0 ? (
            <>
              <span className="sr-only">. </span>
              <UnverifiedBadge />
            </>
          ) : null}
        </span>
        <span className="pn-trip-card__head">
          <strong>{headline(option)}</strong>
          {routes.length > 0 ? <span className="sr-only"> on {routes.join(" and ")}</span> : null}
          <span className="sr-only">. </span>
          <EtaTotalText estimate={estimate} className="pn-trip-card__time" testId="trip-option-time" />
        </span>
        {estimate?.total.peak ? <span className="sr-only">. </span> : null}
        <EtaPeakNote estimate={estimate} className="pn-trip-card__peak" testId="trip-peak-note" />
        {rideLegs.length > 0 ? (
          <span className="pn-trip-card__chips">
            {rideLegs.map((leg, idx) => (
              <ModeChip
                key={idx}
                mode={leg.fleet?.colourKey ?? leg.mode}
                label={leg.fleet?.chip ?? "Vehicle type not confirmed"}
                compact
              />
            ))}
          </span>
        ) : null}
        <span className="sr-only">. </span>
        <LegStrip option={option} lookups={lookups} />
        <span className="sr-only">. </span>
        <span className="pn-trip-card__foot">
          <FareChip fare={option.fare} />
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
  const lookups = planLookups(data);
  const extraNotes = data.plan.notes.filter((n) => n !== UNVERIFIED_ROUTE_BADGE);
  return (
    <section className="pn-trip" aria-labelledby="pn-trip-options-title" aria-busy={refreshing || undefined} data-testid="trip-options">
      <h2 id="pn-trip-options-title" className="pn-trip__title" tabIndex={-1} data-results-heading="">
        Trip options
      </h2>
      {refreshing ? <p className="pn-trip__refreshing">Updating for your new location…</p> : null}
      <ul id={OPTIONS_LIST_ID} className="pn-trip-list">
        {data.plan.options.map((option, i) => (
          <OptionCard key={option.id} option={option} lookups={lookups} onOpen={onOpen} index={i} etaModel={etaModel} />
        ))}
      </ul>
      <div className="pn-trip-warn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
        <div>
          <p>Walking distances are estimates; paths not verified.</p>
          {extraNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </div>
      {tricycleHint}
      <p className="pn-trip__revision">Transport data revision {data.revision.label}</p>
    </section>
  );
}

/**
 * Peek of the sheet once From and To are set: one line for the best option (route, time range,
 * fare) and the toggle that lifts the sheet to full with every option (aria-expanded while full).
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
  const routes = best.legs.filter((l) => l.kind === "ride").map((l) => routeChipLabel(l.routeCode, l.routeName));
  return (
    <div className="pn-peek" data-testid="options-peek">
      <p className="pn-peek__best" data-testid="options-best">
        <span className="sr-only">Best option: </span>
        <span>
          {routes.length > 0 ? routes.join(" + ") : "Walk"}
          <span aria-hidden="true"> · </span>
          <EtaTotalText estimate={estimate} />
          <span aria-hidden="true"> · </span>
          {fareChipText(best.fare)}
        </span>
      </p>
      <button
        type="button"
        id={OPTIONS_TOGGLE_ID}
        className="pn-peek__toggle"
        aria-expanded={expanded}
        aria-controls={OPTIONS_LIST_ID}
        onClick={onToggle}
        data-testid="options-toggle"
      >
        {expanded ? "Show fewer options" : "Show more options"}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
