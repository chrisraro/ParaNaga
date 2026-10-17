"use client";

// Trip options (artboard TripOptions), shown in the home sheet once both endpoints are set.
// A card is minimal (U3): the first label, the "Unverified route" chip for a ride, the route
// ("Loop A"), the time ("Est. 18–27 min + waiting (unknown)", from the snapshot's model on the
// device; "Time not available" without one), the fare ("Est. ₱14–₱17") and the transfer count.
// The leg strip, vehicle class, peak note and the full badge live in the detail. Each card is one
// button whose accessible name is its whole text (the range read as "18 to 27 minutes").

import "./trip.css";

import { Fragment, useMemo } from "react";
import type { PadyakLegDto, PlanOptionDto, PlanResponse, TricycleLegDto } from "@/domain/api/plan";
import type { EtaModel, NetworkSnapshot } from "@/domain/api/schemas";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { ACCESS_LINE, accessTricycleChip, cardRouteNotes, isAccessOption, isSpecialTrip, jeepneyReasonText, optionsCountText, recommendedIndex, specialFareText, streetCardView, viaChipText } from "@/domain/trip/option-card";
import { formatDistance, isNegligibleWalk, optionTitle, transfersText } from "@/domain/trip/present";
import { optionNotesView } from "@/domain/trip/option-notes";
import { EtaTotalText, extractWalkLengths, useMinuteTicker, useOptionEta } from "./eta-text";
import { RouteNote } from "./route-note";
import { ServiceWindowNote } from "./service-window-note";
import { Chevron, FareChip, FareShort, FarNote, LoopChip, StreetModeIcon, UNVERIFIED_CHIP, WalkIcon, type PlanLookups } from "./trip-parts";

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
  // A special trip carries its own two lines instead of the street rule (the rule stays in the detail).
  const special = v.specialNotes.length > 0;
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
      {special ? v.specialNotes.map((n) => (
        <span key={n} className="pn-trip-card__street" data-testid="street-special">
          {n}
        </span>
      )) : null}
      {v.restrictionNote && !special ? (
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
  onOpen,
  index,
  primary,
  etaModel,
  reason,
  now,
  routes,
}: {
  option: PlanOptionDto;
  onOpen: (id: string) => void;
  index: number;
  primary: boolean;
  etaModel?: EtaModel | null;
  /** The one line above a tricycle card when the plan has no jeepney option. */
  reason?: string | null;
  now: Date;
  routes?: NetworkSnapshot["routes"] | null;
}) {
  // The access option rides a jeepney after its tricycle: it keeps the jeepney card (minutes for the walk and ride only).
  const access = isAccessOption(option);
  const street = access ? undefined : option.legs.find((l): l is TricycleLegDto | PadyakLegDto => l.kind === "tricycle" || l.kind === "padyak");
  const special = isSpecialTrip(option);
  const via = viaChipText(option);
  const walkLengths = useMemo(() => extractWalkLengths(option.legs), [option.legs]);
  const { estimate } = useOptionEta(option, walkLengths, etaModel);
  const notes = useMemo(() => optionNotesView(option, routes, now), [option, routes, now]);
  const routeNotes = cardRouteNotes(notes);

  return (
    <li className="pn-trip-li" style={{ ["--i" as string]: Math.min(index, 5) }}>
      {option.mode === "tricycle" && reason ? (
        <p className="pn-trip-reason" data-testid="jeepney-reason">
          {reason}
        </p>
      ) : null}
      <button
        type="button"
        id={optionDomId(option.id)}
        className={primary ? "pn-trip-card pn-trip-card--primary pn-trip-in" : "pn-trip-card pn-trip-in"}
        data-testid="trip-option"
        data-mode={option.mode}
        onClick={() => onOpen(option.id)}
      >
        <span className="pn-trip-card__top">
          {option.labels[0] ? (
            <span className={primary ? "pn-trip-card__label pn-trip-card__label--primary" : "pn-trip-card__label"}>{option.labels[0]}</span>
          ) : null}
          {via ? (
            <>
              <span className="sr-only">. </span>
              <span className="pn-trip-card__via" data-testid="card-via">
                {via}
              </span>
            </>
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
          {option.rides === 0 && !street ? <span className="pn-trip-card__time">paths not verified</span> : null}
          <span className="sr-only">. </span>
          {street ? (
            <span className="pn-trip-card__time" data-testid="trip-option-time">
              {streetCardView(street).timeText}
            </span>
          ) : (
            <EtaTotalText estimate={estimate} className="pn-trip-card__time" testId="trip-option-time" short />
          )}
        </span>
        {street ? (
          <>
            <span className="sr-only">. </span>
            <StreetLines leg={street} />
          </>
        ) : null}
        {access ? (
          <>
            <span className="sr-only">. </span>
            <span className="pn-trip-card__street" data-testid="access-line">
              {ACCESS_LINE}
            </span>
            <span className="pn-trip-card__street pn-trip-card__street--fare" data-testid="access-tricycle">
              {accessTricycleChip(option)}
            </span>
          </>
        ) : null}
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
          <FareChip fare={option.fare} short text={specialFareText(option)} />
          {/* "No transfers" says nothing about a tricycle ride (and the access option changes vehicle by design). */}
          {access || special ? null : (
            <>
              <span className="sr-only">. </span>
              <span className="pn-trip-card__transfers">{transfersText(option.rides)}</span>
            </>
          )}
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
  etaModel?: EtaModel | null;
  /** The snapshot's routes: the evidence behind each ride's notes. */
  routes?: NetworkSnapshot["routes"] | null;
};

export function TripOptions({ data, refreshing = false, onOpen, etaModel, routes = null }: Props) {
  const now = useMinuteTicker();
  const primary = recommendedIndex(data.plan.options);
  const reason = jeepneyReasonText(data.plan.jeepneyReason);
  const extraNotes = data.plan.notes.filter((n) => n !== UNVERIFIED_ROUTE_BADGE);
  return (
    <section className="pn-trip" aria-labelledby="pn-trip-options-title" aria-busy={refreshing || undefined} data-testid="trip-options">
      <h2 id="pn-trip-options-title" className="pn-trip__title" tabIndex={-1} data-results-heading="">
        Trip options
      </h2>
      {refreshing ? <p className="pn-trip__refreshing">Updating…</p> : null}
      <FarNote note={data.plan.farNote} />
      <ul id={OPTIONS_LIST_ID} className="pn-trip-list">
        {data.plan.options.map((option, i) => (
          <OptionCard key={option.id} option={option} onOpen={onOpen} index={i} primary={i === primary} etaModel={etaModel} reason={reason} now={now} routes={routes} />
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
    </section>
  );
}

/**
 * Peek of the sheet once From and To are set: one line for the best option (route, time range,
 * fare, a caution chip for a ride) and the toggle "All options" that lifts the sheet to full with
 * every option (aria-expanded while the list is visible, the chevron turns at full). The summary hides at full: the list is there.
 */
export function OptionsPeek({
  data,
  etaModel,
  expanded,
  listShown,
  notes = [],
  onToggle,
}: {
  data: PlanResponse;
  etaModel?: EtaModel | null;
  /** Full: the list is all there is, so the best-option line is hidden. */
  expanded: boolean;
  /** The list is visible (half or full): the toggle reads as expanded. */
  listShown: boolean;
  /** Staleness lines (offline plan, changed since saved), shown at the peek where the list is inert. */
  notes?: readonly string[];
  onToggle: () => void;
}) {
  // The Recommended option (the tricycle at 500 m or more), not the first card: what is read out must match the list.
  // With nothing Recommended (a far trip without a jeepney) there is no best option: the peek counts the options.
  const best = data.plan.options[recommendedIndex(data.plan.options)];
  const bestStreet = best && !isAccessOption(best) ? best.legs.find((l): l is TricycleLegDto | PadyakLegDto => l.kind === "tricycle" || l.kind === "padyak") : undefined;
  const walkLengths = useMemo(() => extractWalkLengths(best?.legs ?? []), [best]);
  const { estimate } = useOptionEta(best, walkLengths, etaModel);
  if (data.plan.options.length === 0) return null;
  return (
    <div className="pn-peek" data-testid="options-peek">
      {expanded ? null : !best ? (
      <p className="pn-peek__best" data-testid="options-count">
        {optionsCountText(data.plan.options.length)}
      </p>
      ) : (
      <p className="pn-peek__best" data-testid="options-best">
        <span className="sr-only">Best option: </span>
        <span>
          {optionTitle(best)}
          <span aria-hidden="true"> · </span>
          {bestStreet ? streetCardView(bestStreet).timeText : <EtaTotalText estimate={estimate} short />}
          <span aria-hidden="true"> · </span>
          <FareShort fare={best.fare} text={specialFareText(best)} />
        </span>
        {best.rides > 0 ? (
          <span className="pn-peek__chip" data-testid="options-best-unverified">
            {UNVERIFIED_CHIP}
          </span>
        ) : null}
      </p>
      )}
      {listShown
        ? null
        : notes.map((note) => (
            <p key={note} className="pn-peek__note" data-testid="options-peek-note">
              {note}
            </p>
          ))}
      <button
        type="button"
        id={OPTIONS_TOGGLE_ID}
        className="pn-peek__toggle"
        aria-expanded={listShown}
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
