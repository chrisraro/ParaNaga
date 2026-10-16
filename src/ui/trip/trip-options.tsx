"use client";

// Trip options (artboard TripOptions), shown in the home sheet once both endpoints are set.
// Per card: labels, the warning "Unverified route" badge, the ride distance (no minutes or
// arrival time: "Time not available"), the leg strip (walk ≈ m → Loop chip + direction → walk
// ≈ m), the gold-outline fare estimate chip, and the transfer count. Each card is one button
// whose accessible name is its whole text (labels, legs, fare estimate, transfers).

import "./trip.css";

import { Fragment, type ReactNode } from "react";
import type { PlanOptionDto, PlanResponse } from "@/domain/api/plan";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { formatDistance, isNegligibleWalk, routeChipLabel, transfersText } from "@/domain/trip/present";
import { Chevron, FareChip, LoopChip, UnverifiedBadge, WalkIcon, planLookups, type PlanLookups } from "./trip-parts";

export function optionDomId(optionId: string): string {
  return `pn-trip-option-${optionId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

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

function OptionCard({ option, lookups, onOpen, index }: { option: PlanOptionDto; lookups: PlanLookups; onOpen: (id: string) => void; index: number }) {
  const primary = index === 0;
  const routes = option.legs.filter((l) => l.kind === "ride").map((l) => routeChipLabel(l.routeCode, l.routeName));
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
          <span className="pn-trip-card__time">Time not available</span>
        </span>
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
};

export function TripOptions({ data, refreshing = false, onOpen, tricycleHint = null }: Props) {
  const lookups = planLookups(data);
  const extraNotes = data.plan.notes.filter((n) => n !== UNVERIFIED_ROUTE_BADGE);
  return (
    <section className="pn-trip" aria-labelledby="pn-trip-options-title" aria-busy={refreshing || undefined} data-testid="trip-options">
      <h2 id="pn-trip-options-title" className="pn-trip__title" tabIndex={-1} data-results-heading="">
        Trip options
      </h2>
      {refreshing ? <p className="pn-trip__refreshing">Updating for your new location…</p> : null}
      <ul className="pn-trip-list">
        {data.plan.options.map((option, i) => (
          <OptionCard key={option.id} option={option} lookups={lookups} onOpen={onOpen} index={i} />
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
