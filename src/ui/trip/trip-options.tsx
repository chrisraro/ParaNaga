"use client";

// Trip options (artboard TripOptions), shown in the home sheet once both endpoints are set.
// One card per mode, in the planner's order (walk, jeepney options, tricycle, padyak; at most 6):
//   - the labels (exactly one "Recommended" card is drawn as the primary one), the warning
//     "Unverified route" badge on rides, the mode headline ("Walk ≈ 300 m", "Jeep Loop A", "Tricycle",
//     "Padyak") and the time ("Estimate 18–27 min + waiting (unknown)" from the snapshot's model;
//     "Time not available" without one; "Time not estimated" for a tricycle or padyak, never minutes);
//   - a tricycle or padyak card: distance along streets or "Route not confirmed" (a straight line is
//     "approximate, not a route"), the restriction or area line, "Minimum fare ₱15" / "₱10 per passenger";
//   - a jeepney card: a vehicle-class chip per ride, the soft service-window warning, one route note per
//     ride with its evidence chip;
//   - the leg strip, the gold-outline fare chip and the transfer count.
// A "No jeepney route…" line sits above the tricycle card when the plan has no jeepney option. Each
// card is one button whose accessible name is its whole text (the range read as "18 to 27 minutes").

import "./trip.css";

import { Fragment, useMemo } from "react";
import type { PadyakLegDto, PlanOptionDto, PlanResponse, RideLegDto, TricycleLegDto } from "@/domain/api/plan";
import type { EtaModel, NetworkSnapshot } from "@/domain/api/schemas";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { cardRouteNotes, jeepneyReasonText, optionHeadline, recommendedIndex, streetCardView } from "@/domain/trip/option-card";
import { optionNotesView } from "@/domain/trip/option-notes";
import { formatDistance, isNegligibleWalk, routeChipLabel, transfersText } from "@/domain/trip/present";
import { ModeChip } from "@/ui/modes/mode-chip";
import { EtaPeakNote, EtaTotalText, extractWalkLengths, useMinuteTicker, useOptionEta } from "./eta-text";
import { RouteNote } from "./route-note";
import { ServiceWindowNote } from "./service-window-note";
import { Chevron, FareChip, LoopChip, StreetModeIcon, UnverifiedBadge, WalkIcon, planLookups, type PlanLookups } from "./trip-parts";

export function optionDomId(optionId: string): string {
  return `pn-trip-option-${optionId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
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
          ) : leg.kind !== "ride" ? (
            <span className="pn-legstrip__walk">
              <StreetModeIcon mode={leg.kind} />
              <span>
                {leg.kind === "tricycle" ? "Tricycle" : "Padyak"}
                {leg.distanceMeters === null ? "" : ` ${formatDistance(leg.distanceMeters)}`}
              </span>
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

function StreetLines({ leg }: { leg: TricycleLegDto | PadyakLegDto }) {
  const v = streetCardView(leg);
  return (
    <>
      {v.headline ? (
        <span className="pn-trip-card__street pn-trip-card__street--state" data-testid="street-state">
          {v.headline}
        </span>
      ) : null}
      {v.distanceText ? (
        <span className="pn-trip-card__street" data-testid="street-distance">
          {v.distanceText}
        </span>
      ) : null}
      {v.restrictionNote ? (
        <span className="pn-trip-card__street" data-testid="street-restriction">
          {v.restrictionNote}
        </span>
      ) : null}
      {v.areaNote ? (
        <span className="pn-trip-card__street" data-testid="street-area">
          {v.areaNote}
        </span>
      ) : null}
    </>
  );
}

function OptionCard({
  option,
  lookups,
  onOpen,
  index,
  primary,
  etaModel,
  now,
  routes,
}: {
  option: PlanOptionDto;
  lookups: PlanLookups;
  onOpen: (id: string) => void;
  index: number;
  primary: boolean;
  etaModel?: EtaModel | null;
  now: Date;
  routes?: NetworkSnapshot["routes"] | null;
}) {
  const rideLegs = option.legs.filter((l): l is RideLegDto => l.kind === "ride");
  const routeNames = rideLegs.map((l) => routeChipLabel(l.routeCode, l.routeName));
  const street = option.legs.find((l): l is TricycleLegDto | PadyakLegDto => l.kind === "tricycle" || l.kind === "padyak");
  const walkLengths = useMemo(() => extractWalkLengths(option.legs), [option.legs]);
  const { estimate } = useOptionEta(option, walkLengths, etaModel);
  const notes = useMemo(() => optionNotesView(option, routes, now), [option, routes, now]);
  const routeNotes = cardRouteNotes(notes);

  return (
    <button
      type="button"
      id={optionDomId(option.id)}
      className={primary ? "pn-trip-card pn-trip-card--primary pn-trip-in" : "pn-trip-card pn-trip-in"}
      style={{ animationDelay: `${index * 0.06}s` }}
      data-testid="trip-option"
      data-mode={option.mode}
      onClick={() => onOpen(option.id)}
    >
      <span className="pn-trip-card__top">
        <span className={primary ? "pn-trip-card__label pn-trip-card__label--primary" : "pn-trip-card__label"}>{option.labels.join(" · ")}</span>
        {/* The driver caveat belongs to rides only; a walk has no driver. */}
        {option.rides > 0 ? (
          <>
            <span className="sr-only">. </span>
            <UnverifiedBadge />
          </>
        ) : null}
      </span>
      <span className="pn-trip-card__head">
        <strong>{optionHeadline(option)}</strong>
        {routeNames.length > 0 ? <span className="sr-only"> on {routeNames.join(" and ")}</span> : null}
        <span className="sr-only">. </span>
        {street ? (
          <span className="pn-trip-card__time" data-testid="trip-option-time">
            {streetCardView(street).timeText}
          </span>
        ) : (
          <EtaTotalText estimate={estimate} className="pn-trip-card__time" testId="trip-option-time" />
        )}
      </span>
      {street ? (
        <>
          <span className="sr-only">. </span>
          <StreetLines leg={street} />
        </>
      ) : (
        <>
          {estimate?.total.peak ? <span className="sr-only">. </span> : null}
          <EtaPeakNote estimate={estimate} className="pn-trip-card__peak" testId="trip-peak-note" />
        </>
      )}
      {rideLegs.length > 0 ? (
        <span className="pn-trip-card__chips">
          {rideLegs.map((leg, idx) => (
            <ModeChip key={idx} mode={leg.fleet?.colourKey ?? leg.mode} label={leg.fleet?.chip ?? "Vehicle type not confirmed"} compact />
          ))}
        </span>
      ) : null}
      <span className="sr-only">. </span>
      <LegStrip option={option} lookups={lookups} />
      {notes.serviceWindow || routeNotes.length > 0 ? (
        <span className="pn-trip-card__notes">
          {notes.serviceWindow ? <ServiceWindowNote note={notes.serviceWindow} compact /> : null}
          {routeNotes.map((n) => (
            <RouteNote key={n.text} note={n} />
          ))}
        </span>
      ) : null}
      <span className="sr-only">. </span>
      <span className="pn-trip-card__foot">
        <FareChip fare={option.fare} />
        <span className="sr-only">. </span>
        <span className="pn-trip-card__transfers">{transfersText(option.rides)}</span>
      </span>
    </button>
  );
}

type Props = {
  data: PlanResponse;
  /** A newer plan (refined GPS point) is on its way; these options stay until it arrives. */
  refreshing?: boolean;
  onOpen: (optionId: string) => void;
  etaModel?: EtaModel | null;
  /** The snapshot's routes: the evidence behind each ride's notes. */
  routes?: NetworkSnapshot["routes"] | null;
};

export function TripOptions({ data, refreshing = false, onOpen, etaModel, routes = null }: Props) {
  const lookups = planLookups(data);
  const now = useMinuteTicker();
  const primary = recommendedIndex(data.plan.options);
  const reason = jeepneyReasonText(data.plan.jeepneyReason);
  const extraNotes = data.plan.notes.filter((n) => n !== UNVERIFIED_ROUTE_BADGE);
  return (
    <section className="pn-trip" aria-labelledby="pn-trip-options-title" aria-busy={refreshing || undefined} data-testid="trip-options">
      <h2 id="pn-trip-options-title" className="pn-trip__title" tabIndex={-1} data-results-heading="">
        Trip options
      </h2>
      {refreshing ? <p className="pn-trip__refreshing">Updating for your new location…</p> : null}
      <ul className="pn-trip-list">
        {data.plan.options.map((option, i) => (
          <li key={option.id} className="pn-trip-li">
            {option.mode === "tricycle" && reason ? (
              <p className="pn-trip-reason" data-testid="jeepney-reason">
                {reason}
              </p>
            ) : null}
            <OptionCard option={option} lookups={lookups} onOpen={onOpen} index={i} primary={i === primary} etaModel={etaModel} now={now} routes={routes} />
          </li>
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
      <p className="pn-trip__revision">Transport data revision {data.revision.label}</p>
    </section>
  );
}
