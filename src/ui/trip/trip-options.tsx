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
import { PEEK_ROW, PEEK_ROW_GAP } from "@/ui/app-shell/bottom-sheet";
import { ACCESS_LINE, accessTricycleChip, cardRouteNotes, isAccessOption, isSpecialTrip, jeepneyReasonText, optionsCountText, previewIndex, recommendedIndex, specialFareText, streetCardView, tricycleTerminalCardLines, viaChipText } from "@/domain/trip/option-card";
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
  const terminalLines = tricycleTerminalCardLines(option);

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
            {terminalLines.terminal ? (
              <span className="pn-trip-card__terminal-box" data-testid="card-terminal-box">
                <span className="pn-trip-card__street pn-trip-card__terminal" data-testid="card-terminal">
                  <svg className="pn-terminal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v4l3 2" />
                  </svg>
                  {terminalLines.terminal}
                </span>
                {terminalLines.toda ? (
                  <span className="pn-trip-card__street pn-trip-card__toda" data-testid="card-toda">
                    {terminalLines.toda}
                  </span>
                ) : null}
              </span>
            ) : null}
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
      <FarNote note={data.plan.farNote} options={data.plan.options} />
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

const isStreetMode = (o: PlanOptionDto) => o.mode === "tricycle" || o.mode === "padyak";

/**
 * The (at most two) options carded at the peek: the Recommended one (else the map preview's), then
 * the other mode: the tricycle beside a jeepney, the top jeepney beside a tricycle; after a walk or a
 * special trip, the next option. One card when the plan has only one mode.
 */
export function peekOptions(options: readonly PlanOptionDto[]): PlanOptionDto[] {
  const first = options[previewIndex(options)] ?? options[0];
  if (!first) return [];
  const second =
    first.mode === "walk" || isSpecialTrip(first)
      ? options.find((o) => o !== first)
      : isStreetMode(first)
        ? options.find((o) => o.mode === "jeepney")
        : options.find(isStreetMode);
  return second ? [first, second] : [first];
}

export const peekOptionDomId = (optionId: string) => `${optionDomId(optionId)}-peek`;

/** One compact card at the peek: route (cut with an ellipsis if long), the time for a jeepney or a walk (never for a tricycle), the fare and the caution chip. */
function PeekOption({ option, best, etaModel, onOpen }: { option: PlanOptionDto; best: boolean; etaModel?: EtaModel | null; onOpen: (id: string) => void }) {
  const street = !isAccessOption(option) && isStreetMode(option);
  const walkLengths = useMemo(() => extractWalkLengths(option.legs), [option.legs]);
  const { estimate } = useOptionEta(option, walkLengths, etaModel);
  return (
    <button
      type="button"
      id={peekOptionDomId(option.id)}
      className={best ? "pn-peek-row pn-peek-row--best" : "pn-peek-row"}
      data-testid={best ? "options-best" : "options-alt"}
      data-mode={option.mode}
      onClick={() => onOpen(option.id)}
    >
      <span className="pn-peek-row__line">
        <span className="pn-peek-row__title">{optionTitle(option)}</span>
        {best ? (
          <>
            <span className="sr-only">. </span>
            <span className="pn-peek-row__mark">Recommended</span>
          </>
        ) : null}
      </span>
      {street ? null : (
        <>
          <span className="sr-only">. </span>
          <EtaTotalText estimate={estimate} className="pn-peek-row__text" short />
        </>
      )}
      <span className="sr-only">. </span>
      <span className="pn-peek-row__line">
        <span>
          <FareShort fare={option.fare} text={specialFareText(option)} />
        </span>
        {option.rides > 0 ? (
          <>
            <span className="sr-only">. </span>
            <span className="pn-peek__chip" data-testid={best ? "options-best-unverified" : "options-alt-unverified"}>
              {UNVERIFIED_CHIP}
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Peek of the sheet once From and To are set: one compact card for each of the top two options
 * (peekOptions: the jeepney and the tricycle), each opening its detail like a list card, and the
 * toggle "All options" that lifts the sheet to full with every option (aria-expanded while the list
 * is visible, the chevron turns at full). The cards hide at full: the list is there. The cards have
 * a fixed height (PEEK_ROW), so the peek height is known before render and never grows.
 */
export function OptionsPeek({
  data,
  etaModel,
  expanded,
  listShown,
  notes = [],
  onToggle,
  onOpen,
}: {
  data: PlanResponse;
  etaModel?: EtaModel | null;
  /** Full: the list is all there is, so the cards are hidden. */
  expanded: boolean;
  /** The list is visible (half or full): the toggle reads as expanded. */
  listShown: boolean;
  /** Staleness lines (offline plan, changed since saved), shown at the peek where the list is inert. */
  notes?: readonly string[];
  onToggle: () => void;
  onOpen: (optionId: string) => void;
}) {
  // The Recommended option (the jeepney from 500 m), not the first card: what is read out must match the list.
  // With nothing Recommended (a far trip without a jeepney) no card is marked and the toggle counts the options.
  const best = data.plan.options[recommendedIndex(data.plan.options)];
  const shown = peekOptions(data.plan.options);
  if (data.plan.options.length === 0) return null;
  return (
    <div className="pn-peek" data-testid="options-peek" style={{ ["--pn-peek-row" as string]: `${PEEK_ROW}px`, ["--pn-peek-row-gap" as string]: `${PEEK_ROW_GAP}px` }}>
      {expanded ? null : (
        <div className="pn-peek__rows">
          {shown.map((o) => (
            <PeekOption key={o.id} option={o} best={o === best} etaModel={etaModel} onOpen={onOpen} />
          ))}
        </div>
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
        {best ? (
          "All options"
        ) : (
          <span>
            All options (<span data-testid="options-count">{optionsCountText(data.plan.options.length)}</span>)
          </span>
        )}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
