"use client";

// S24 "Leaving Naga" (IC1; design §4–§5). One static shell, /app/leaving: the list of towns and
// hubs outside the city, and with ?to=D-… one destination's services (plan deviation 1: a query,
// not a path segment, so the worker's ignoreSearch shell serves both offline).
//
// List: the rail status card (PNR lines, and the South Long Haul only as "no trains run"), the
// airport card, then the destinations by group with a search box. No map.
// Detail: "Running" cards (sortServices), then a muted "Not running" section. Each card: mode,
// name, a status pill with its "as of" date, evidence chips, then departures, fares seen (each
// with its basis and month) and, kept apart, the rule estimate from the national rates. "Get to
// {terminal}" only when getToTarget gives an in-city point (AC-IC1); otherwise "Location being
// confirmed". Everything about staleness is computed on the phone in Manila time, so it holds
// offline (AC-IC5). Unknown values read "not found" with a next step (AC-IC8).
//
// Copy rules: never "schedule", "next bus", "on time" or a booking verb. A card's summary (mode,
// name, status, chips, terminal action) stays within CARD_SUMMARY_WORDS; each fact is its own row.

import "@/ui/kit/styles";
import "../modes/modes.css";
import "./leaving.css";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useIntercity } from "@/client/network/use-intercity";
import type { Intercity, IntercityDestination, IntercityService } from "@/domain/api/schemas";
import { regionalFareEstimate, type RegionalMode } from "@/domain/fares/regional";
import {
  departureLineParts,
  evidenceChips,
  fareLineParts,
  getToTarget,
  manilaToday,
  statusPillParts,
  visibleDepartures,
  visibleObservations,
} from "@/domain/intercity/present";
import { terminalDirectionsLabel } from "@/domain/places/terminals";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { DetailError, DetailLoading, DetailPanel, useFocusOnMount, useReturnToMap } from "@/ui/detail/detail-frame";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { ListCell } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { ModeChip } from "@/ui/modes/mode-chip";
import type { Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { dateText, departureText, fareText, statusLabel, statusNoteText } from "./copy";
import {
  airServices,
  anyStale,
  extraOperators,
  firstListedDestination,
  groupedDestinations,
  observationsFor,
  parseDestinationParam,
  railServices,
  runningModes,
  servicesFor,
  southLongHaulNote,
  type IntercityMode,
} from "./model";

/** The most words a card's summary may use (design §4 copy rule). */
export const CARD_SUMMARY_WORDS = 24;

type Copy = Dict["intercity"];

export const leavingHref = (code: string) => `/app/leaving?to=${encodeURIComponent(code)}`;

/** The Suspense fallback of the static shell: the panel with a skeleton. */
export function LeavingFallback() {
  return <DetailLoading title={useT().intercity.title} />;
}

export function LeavingScreen() {
  const t = useT().intercity;
  const to = parseDestinationParam(useSearchParams().get("to"));
  const state = useIntercity();
  if (state.status === "ready") return <LeavingView data={state.data} to={to} />;
  if (state.status === "error") return <DetailError title={t.title} offline={state.offline} onRetry={state.retry} />;
  return <DetailLoading title={t.title} />;
}

/** `to`: null = the list; "" or an unknown code = "Place not on file"; else that destination. */
export function LeavingView({ data, to }: { data: Intercity; to: string | null }) {
  const t = useT().intercity;
  const destination = to ? (data.destinations.find((d) => d.code === to) ?? null) : null;
  return (
    <DetailPanel title={t.title} sources={SOURCES_HREF} testId="leaving-screen">
      {to === null ? (
        <ListView key="list" data={data} />
      ) : destination ? (
        <DestinationView key={destination.code} data={data} destination={destination} />
      ) : (
        <UnknownDestination key={`unknown:${to}`} />
      )}
    </DetailPanel>
  );
}

// ------------------------------------------------------------------ shared pieces

function PlaneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10.5 13.5L3 11l1.5-1.5 7.5.5 4-4.5c1-1 2.5-1.5 3.5-.5s.5 2.5-.5 3.5l-4.5 4 .5 7.5L13.5 21 11 13.5z" />
    </svg>
  );
}

function ServiceMode({ mode }: { mode: IntercityMode }) {
  const t = useT().intercity;
  if (mode === "air") {
    return (
      <span className="pn-mode-chip pn-ic-air" data-testid="mode-chip" data-mode="air">
        <span className="pn-mode-chip__icon">
          <PlaneIcon />
        </span>
        <span className="pn-mode-chip__label">{t.mode.air}</span>
      </span>
    );
  }
  return <ModeChip mode={mode} label={t.mode[mode]} />;
}

/** The status pill: label (and note) with its "as of" date; amber "may be out of date" once stale. */
function StatusPill({ service, today }: { service: IntercityService; today: string }) {
  const t = useT().intercity;
  const parts = statusPillParts(service, today);
  const label = statusLabel(parts, t);
  const note = statusNoteText(parts, t);
  const asOf = service.asOf ? dateText(service.asOf, t) : null;
  const stale = parts.stale && asOf !== null;
  // Teal only for a service reported running; unconfirmed, community-mapped and stopped are grey.
  const tone = stale ? "stale" : service.status === "operating" || service.status === "operating_limited" ? "neutral" : "stopped";
  return (
    <p className={`pn-ic-pill pn-ic-pill--${tone}`} data-testid="leaving-status" data-stale={stale ? "true" : undefined}>
      <span className="pn-ic-pill__label">{[label, note].filter(Boolean).join(" · ")}</span>{" "}
      {asOf ? <span className="pn-ic-pill__date">{stale ? t.stalePill(asOf) : t.asOf(asOf)}</span> : null}
    </p>
  );
}

function ChipIcon({ chip }: { chip: "low" | "old" | "single_source" }) {
  const d = chip === "low" ? "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" : chip === "old" ? "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" : "M6 4h9l3 3v13H6z";
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

function EvidenceChips({ service }: { service: IntercityService }) {
  const t = useT().intercity;
  const chips = evidenceChips(service.sourceEvidenceTypes, new Set(service.sourceCodes).size);
  if (chips.length === 0) return null;
  return (
    <ul className="pn-ic-chips" aria-label={t.chipsLabel} data-testid="leaving-chips">
      {chips.map((c) => (
        <li key={c} className="pn-badge pn-badge--evidence" data-chip={c}>
          <ChipIcon chip={c} />
          {t.chip[c]}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Get to {terminal}": the terminal's mapped point becomes the trip's destination (named as a map
 * point, as on terminal detail: no entrance is mapped) and the map plans from the start.
 */
function GetTo({ point, label }: { point: { lat: number; lng: number }; label: string }) {
  const tt = useT();
  const t = tt.intercity;
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  return (
    <button
      type="button"
      className="pn-btn pn-btn--primary pn-ic-getto"
      data-testid="leaving-get-to"
      onClick={() => {
        frame?.requestEndpoint("destination", { point: { ...point }, label: terminalDirectionsLabel(label, tt.terminals) });
        returnToMap();
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      {t.getTo(label)}
    </button>
  );
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="pn-ic-fact" data-testid={testId}>
      <dt className="pn-ic-fact__label">{label}</dt>
      {children}
    </div>
  );
}

function FactLine({ children, testId, muted = false }: { children: ReactNode; testId: string; muted?: boolean }) {
  return (
    <dd className={muted ? "pn-ic-fact__line pn-ic-fact__line--muted" : "pn-ic-fact__line"} data-testid={testId} data-fact-line="">
      {children}
    </dd>
  );
}

const ESTIMATE_MODES: readonly string[] = ["uv_express", "bus", "jeepney"] satisfies readonly RegionalMode[];

/** One service card. Not running: status only, no fares, no departures, no "Get to". */
function ServiceCard({ data, service, destination, today, running }: {
  data: Intercity;
  service: IntercityService;
  destination: IntercityDestination;
  today: string;
  running: boolean;
}) {
  const t = useT().intercity;
  const uid = useId();
  const target = running ? getToTarget(service.terminal) : null;
  const operators = extraOperators(service);
  const listed = observationsFor(service, destination.code);
  const shown = visibleObservations(listed, service, today);
  const hidden = shown.length < listed.length;
  // Booking-site departure times follow the booking-site amounts' rule (stale or > 120 days: hidden).
  const departures = visibleDepartures(service.departures, service, today);
  const hiddenDepartures = departures.length < service.departures.length;
  const estimate =
    running && service.fareRuleCodes.length > 0 && ESTIMATE_MODES.includes(service.mode)
      ? regionalFareEstimate(service.distanceKm, service.mode as RegionalMode, service.fareRuleCodes, data.fareRules)
      : null;
  return (
    <li className="pn-ic-cards__item">
      <article className={running ? "pn-ic-card" : "pn-ic-card pn-ic-card--muted"} data-testid="leaving-card" data-code={service.code} aria-labelledby={`${uid}-name`}>
        <div className="pn-ic-card__summary" data-card-summary="">
          <div className="pn-ic-card__head">
            <ServiceMode mode={service.mode} />
            <h3 id={`${uid}-name`} className="pn-ic-card__name">
              {service.name}
            </h3>
          </div>
          {operators.length > 0 ? <p className="pn-ic-card__operators">{operators.join(", ")}</p> : null}
          <StatusPill service={service} today={today} />
          <EvidenceChips service={service} />
          {running && target === null ? (
            <p className="pn-ic-card__where" data-testid="leaving-no-get-to">
              {service.terminal ? (
                <>
                  {t.from(service.terminal.name)} · <span className="pn-ic-card__confirming">{t.locationBeingConfirmed}</span>
                </>
              ) : (
                t.terminalNotFound
              )}
            </p>
          ) : null}
        </div>
        {running ? (
          <dl className="pn-ic-facts">
            {target === null && service.terminal?.locationText ? (
              <Fact label={service.terminal.name} testId="leaving-address">
                <FactLine testId="leaving-address-text">{service.terminal.locationText}</FactLine>
              </Fact>
            ) : null}
            {service.accessNoteCode ? (
              <Fact label={t.accessLabel} testId="leaving-access">
                <FactLine testId="leaving-access-text">{t.access[service.accessNoteCode]}</FactLine>
              </Fact>
            ) : null}
            <Fact label={t.departuresLabel} testId="leaving-departures">
              {departures.map((d, i) => (
                <FactLine key={i} testId="leaving-departure">
                  {departureText(departureLineParts(d), t)}
                </FactLine>
              ))}
              {hiddenDepartures ? (
                <FactLine testId="leaving-departures-hidden" muted>
                  {t.hiddenTimes}
                </FactLine>
              ) : departures.length === 0 ? (
                <FactLine testId="leaving-departure" muted>
                  {departureText(departureLineParts(null), t)}
                </FactLine>
              ) : null}
            </Fact>
            <Fact label={t.faresLabel} testId="leaving-fares">
              {shown.map((o, i) => (
                <FactLine key={i} testId="leaving-fare">
                  <span className="pn-ic-amount">{fareText(fareLineParts(o), t)}</span>
                </FactLine>
              ))}
              {hidden ? (
                <FactLine testId="leaving-fares-hidden" muted>
                  {t.hiddenListings}
                </FactLine>
              ) : shown.length === 0 ? (
                <FactLine testId="leaving-fare-not-found" muted>
                  {fareText(fareLineParts(null), t)}
                </FactLine>
              ) : null}
            </Fact>
          </dl>
        ) : null}
        {estimate ? (
          <details className="pn-ic-estimate" data-testid="leaving-estimate">
            <summary>{t.estimateLabel}</summary>
            <p>{estimate.text}</p>
          </details>
        ) : null}
        <div className="pn-ic-card__actions">
          {target ? <GetTo point={target.point} label={target.label} /> : null}
          <Link
            href={`${SOURCES_HREF}?service=${encodeURIComponent(service.code)}`}
            className="pn-ic-sources"
            aria-label={t.sourcesFor(service.name)}
            data-testid="leaving-sources"
          >
            {t.sources}
          </Link>
        </div>
      </article>
    </li>
  );
}

// ------------------------------------------------------------------ detail view

function DestinationView({ data, destination }: { data: Intercity; destination: IntercityDestination }) {
  const t = useT().intercity;
  const uid = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const today = manilaToday();
  const { running, notRunning } = servicesFor(data, destination.code);
  return (
    <main className="pn-detail__main pn-detail-in pn-ic" data-testid="leaving-detail" data-code={destination.code}>
      <div className="pn-ic-head">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          {destination.name}
        </h1>
        <p className="pn-ic-head__sub">{t.detailSub(t.group[destination.groupCode])}</p>
      </div>
      {anyStale(running, today) ? (
        <Note tone="warning" testId="leaving-stale-banner">
          {t.staleBanner}
        </Note>
      ) : null}
      <section className="pn-section" aria-labelledby={`${uid}-running`} data-testid="leaving-running">
        <h2 id={`${uid}-running`} className="pn-section__title">
          {t.running}
        </h2>
        {running.length === 0 ? (
          <p className="pn-ic-empty" data-testid="leaving-none-running">
            {t.noneRunning(destination.name)}
          </p>
        ) : (
          <ul className="pn-ic-cards">
            {running.map((s) => (
              <ServiceCard key={s.code} data={data} service={s} destination={destination} today={today} running />
            ))}
          </ul>
        )}
      </section>
      {notRunning.length > 0 ? (
        <section className="pn-section pn-ic-stopped" aria-labelledby={`${uid}-stopped`} data-testid="leaving-not-running">
          <h2 id={`${uid}-stopped`} className="pn-section__title">
            {t.notRunning}
          </h2>
          <ul className="pn-ic-cards">
            {notRunning.map((s) => (
              <ServiceCard key={s.code} data={data} service={s} destination={destination} today={today} running={false} />
            ))}
          </ul>
        </section>
      ) : null}
      <Link href="/app/leaving" className="pn-ic-back" data-testid="leaving-back-to-list">
        {t.backToList}
      </Link>
      <Note>{t.footer}</Note>
    </main>
  );
}

function UnknownDestination() {
  const t = useT().intercity;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  return (
    <main className="pn-detail__state" data-testid="leaving-unknown">
      <h1 ref={heading} tabIndex={-1}>
        {t.unknownTitle}
      </h1>
      <p>{t.unknownCopy}</p>
      <Link href="/app/leaving" className="pn-detail__retry pn-ic-retry-link">
        {t.backToList}
      </Link>
    </main>
  );
}

// ------------------------------------------------------------------ list view

/** One line for a rail or flight row: status (and note) with its "as of" date. */
function statusLine(service: IntercityService, today: string, t: Copy): string {
  const parts = statusPillParts(service, today);
  const asOf = service.asOf ? dateText(service.asOf, t) : null;
  const date = asOf ? (parts.stale ? t.stalePill(asOf) : t.asOf(asOf)) : null;
  return [statusLabel(parts, t), statusNoteText(parts, t), date].filter(Boolean).join(" · ");
}

function RailCard({ data, today }: { data: Intercity; today: string }) {
  const t = useT().intercity;
  const uid = useId();
  const rail = railServices(data);
  const slh = southLongHaulNote(data);
  if (rail.length === 0 && !slh) return null;
  return (
    <section className="pn-section" aria-labelledby={`${uid}-rail`} data-testid="leaving-rail">
      <h2 id={`${uid}-rail`} className="pn-section__title">
        {t.railTitle}
      </h2>
      <ul className="pn-group">
        {rail.map((s) => (
          <li key={s.code} className="pn-cell" data-testid="leaving-rail-row" data-code={s.code}>
            <span className="pn-cell__text">
              <span className="pn-cell__title">{s.name}</span>
              <span className="pn-cell__sub">{statusLine(s, today, t)}</span>
            </span>
          </li>
        ))}
        {slh ? (
          <li className="pn-cell" data-testid="leaving-south-long-haul">
            <span className="pn-cell__text">
              <span className="pn-cell__sub pn-ic-slh">{t.southLongHaul}</span>
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function AirportCard({ data, today }: { data: Intercity; today: string }) {
  const t = useT().intercity;
  const uid = useId();
  const flights = airServices(data);
  if (flights.length === 0) return null;
  return (
    <section className="pn-section" aria-labelledby={`${uid}-air`} data-testid="leaving-airport">
      <h2 id={`${uid}-air`} className="pn-section__title">
        {t.airTitle}
      </h2>
      <ul className="pn-group">
        {flights.map((s) => {
          const to = firstListedDestination(data, s);
          const where = [s.terminal?.name, s.terminal?.locationText].filter(Boolean).join(" · ");
          const sub = [where, statusLine(s, today, t)].filter(Boolean).join(" · ");
          return to ? (
            <ListCell key={s.code} href={leavingHref(to.code)} lead={<PlaneTile />} title={t.flightsTo(to.name)} sub={sub} testId="leaving-airport-row" />
          ) : (
            <ListCell key={s.code} lead={<PlaneTile />} title={s.name} sub={sub} testId="leaving-airport-row" />
          );
        })}
      </ul>
    </section>
  );
}

function PlaneTile() {
  return (
    <span className="pn-ic-tile">
      <PlaneIcon />
    </span>
  );
}

function ListView({ data }: { data: Intercity }) {
  const tt = useT();
  const t = tt.intercity;
  const uid = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const [query, setQuery] = useState("");
  const today = manilaToday();
  const groups = useMemo(() => groupedDestinations(data, query), [data, query]);
  // Before the owner publishes IC1 the guide has no destinations: say so, no empty search box.
  const empty = data.destinations.length === 0;
  const modeNames = (code: string) => runningModes(data, code).map((m) => t.mode[m]);
  return (
    <main className="pn-detail__main pn-detail-in pn-ic" data-testid="leaving-list">
      <div className="pn-ic-head">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          {t.title}
        </h1>
        <p className="pn-ic-head__sub">{t.intro}</p>
      </div>
      <RailCard data={data} today={today} />
      <AirportCard data={data} today={today} />
      <section className="pn-section" aria-labelledby={`${uid}-dest`} data-testid="leaving-destinations">
        <h2 id={`${uid}-dest`} className="pn-ic-dest-title">
          {t.destinationsLabel}
        </h2>
        {empty ? (
          <p className="pn-ic-empty" data-testid="leaving-none-on-file">
            {t.noneOnFile}
          </p>
        ) : (
          <>
            <div role="search" className="pn-ic-search">
              <label htmlFor={`${uid}-q`} className="pn-ic-search__label">
                {t.searchLabel}
              </label>
              <input
                id={`${uid}-q`}
                type="search"
                className="pn-ic-search__input"
                placeholder={t.searchPlaceholder}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="leaving-search"
              />
            </div>
            {groups.length === 0 ? (
              <p className="pn-ic-empty" role="status" data-testid="leaving-no-match">
                {t.noMatch(query.trim())}
              </p>
            ) : (
              groups.map((g) => (
                <section key={g.group} className="pn-section" aria-labelledby={`${uid}-g-${g.group}`} data-testid={`leaving-group-${g.group}`}>
                  <h3 id={`${uid}-g-${g.group}`} className="pn-section__title">
                    {t.group[g.group]}
                  </h3>
                  <ul className="pn-group">
                    {g.destinations.map((d) => {
                      const modes = modeNames(d.code);
                      return (
                        <ListCell
                          key={d.code}
                          href={leavingHref(d.code)}
                          // The box filters these rows: a prefetch would tell the server what was typed.
                          prefetch={false}
                          title={d.name}
                          sub={modes.length > 0 ? t.destinationSub(modes.join(", ")) : t.noRunningSub}
                          testId="leaving-destination"
                        />
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </section>
      <Note>{t.footer}</Note>
    </main>
  );
}
