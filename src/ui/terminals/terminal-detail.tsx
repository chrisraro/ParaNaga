"use client";

// Terminal detail (artboard TerminalDetail; Increment A, Task 6; Increment D, Task 13) from
// GET /api/v1/terminals/:code. With an OpenStreetMap coordinate (community data, ODbL): a map
// centred on the terminal's marker, "Directions to here" (the coordinate becomes the destination,
// labelled as a map point because no entrance is mapped), the OSM provenance row and the
// OsmAttribution line. Without one: "Location not mapped" and no directions, with a note saying
// why. The Routes tab lists the routes whose legal plan or Nov 2025 trial circuit names the
// terminal, the regional services leaving from it with fare ESTIMATES ("operator prices may
// differ"), then "Destinations from here" (Leaving Naga, IC1) when a published intercity service
// leaves from it, then its destination categories (services not verified). "Help map an entrance" is
// not offered until corrections open (no dead buttons).

import "@/ui/kit/styles";
import "@/ui/places/places.css";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { terminalDetailSchema, type TerminalDetail } from "@/domain/api/schemas";
import {
  terminalEvidenceLabel,
  terminalModesText,
  terminalNoteSentences,
  terminalRouteSub,
} from "@/domain/places/place-detail";
import {
  isRouteMode,
  regionalServiceRow,
  terminalDirectionsLabel,
  terminalKindLabel,
} from "@/domain/places/terminals";
import { regionalCategoryLabel } from "@/domain/search/search";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { DetailError, DetailLoading, DetailNotFound, DetailPanel, useFocusOnMount, useReturnToMap } from "@/ui/detail/detail-frame";
import { StatusBadge } from "@/ui/kit/badge";
import { ListCell, ListChevron } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { Segmented } from "@/ui/kit/segmented";
import { NagaMap } from "@/ui/map/naga-map";
import { ModeChip } from "@/ui/modes/mode-chip";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { routeTitleBesideChip } from "@/domain/planner/route-display";
import { LoopChip } from "@/ui/trip/trip-parts";
import { useT } from "@/i18n/provider";

const TERMINAL_ZOOM = 17;

export function TerminalDetailScreen({ code }: { code: string }) {
  const TITLE = useT().detail.terminal;
  const resource = useNetworkResource(`/api/v1/terminals/${encodeURIComponent(code)}`, terminalDetailSchema);
  if (resource.status === "loading") return <DetailLoading title={TITLE} />;
  if (resource.status === "not_found") return <DetailNotFound what="terminal" />;
  if (resource.status === "error") return <DetailError title={TITLE} offline={resource.offline} onRetry={resource.retry} />;
  return <TerminalDetailView data={resource.data} />;
}

type Tab = "routes" | "entrances" | "hours";
type TerminalInfo = TerminalDetail["terminal"];
type Point = { lat: number; lng: number };

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </svg>
  );
}

/** Regional services (UV Express, buses) with their fare estimates; never drawn, never planned. */
function RegionalServices({ data }: { data: TerminalDetail }) {
  const t = useT().terminals;
  const uid = useId();
  if (data.regionalServices.length === 0) return null;
  return (
    <section className="pn-section" aria-labelledby={`${uid}-regional`}>
      <h2 id={`${uid}-regional`} className="pn-section__title">
        {t.regionalTitle}
      </h2>
      <ul className="pn-group" data-testid="terminal-regional">
        {data.regionalServices.map((s) => {
          const row = regionalServiceRow(s, t);
          return (
            <li key={s.code} className="pn-cell" data-testid={`terminal-regional-${s.code}`}>
              <span className="pn-cell__text">
                <span className="pn-terminal__service-title">
                  <ModeChip mode={s.mode} compact />
                  <span className="pn-cell__title">{row.title}</span>
                </span>
                <span className="pn-cell__sub">{row.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="pn-footnote">{t.faresEstimates}</p>
    </section>
  );
}

function RoutesPanel({ data }: { data: TerminalDetail }) {
  const { routes, destinationCategories } = data;
  const tt = useT();
  const t = tt.terminals;
  const uid = useId();
  return (
    <>
      {routes.length === 0 ? (
        <p className="pn-cell pn-cell--empty pn-group" data-testid="terminal-no-routes">
          {t.noRoutes}
        </p>
      ) : (
        <>
          <ul className="pn-group" data-testid="terminal-routes">
            {routes.map((r) => (
              <li key={`${r.routeCode}:${r.basis}`}>
                <Link href={`/app/routes/${encodeURIComponent(r.routeCode)}`} className="pn-cell" data-testid={`terminal-route-${r.basis}`}>
                  <LoopChip leg={{ routeCode: r.routeCode, routeName: r.routeName }} icon="line" short />
                  <span className="pn-cell__text">
                    <span className="pn-cell__title">{routeTitleBesideChip(r.routeCode, r.routeName)}</span>
                    <span className="pn-cell__sub">{terminalRouteSub(r.basis, t)}</span>
                    {r.basis === "trial" ? <StatusBadge variant="trial" /> : null}
                  </span>
                  <ListChevron />
                </Link>
              </li>
            ))}
          </ul>
          <p className="pn-footnote">{t.baysNotMapped}</p>
        </>
      )}
      <RegionalServices data={data} />
      {data.hasIntercity ? (
        <ul className="pn-group" data-testid="terminal-intercity">
          <ListCell href="/app/leaving" title={t.destinationsFromHere} testId="terminal-destinations-from-here" />
        </ul>
      ) : null}
      {destinationCategories.length > 0 ? (
        <section className="pn-section" aria-labelledby={`${uid}-categories`}>
          <h2 id={`${uid}-categories`} className="pn-section__title">
            {t.categoriesTitle}
          </h2>
          <ul className="pn-group" data-testid="terminal-destinations">
            {destinationCategories.map((c) => (
              <li key={c.category} className="pn-cell">
                <span className="pn-cell__text">
                  <span className="pn-cell__title">
                    {t.categoryRow(regionalCategoryLabel(c.category, tt.search), c.destinations.join(", "))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** The map preview: centred on the terminal, with its (non-interactive) terminals-layer marker. */
function TerminalMap({ terminal, point }: { terminal: TerminalInfo; point: Point }) {
  const t = useT().terminals;
  const terminals = useMemo(
    () => [{ code: terminal.code, name: terminal.name, modes: terminal.modes, lat: point.lat, lng: point.lng }],
    [terminal.code, terminal.name, terminal.modes, point.lat, point.lng],
  );
  return (
    <div className="pn-place__map" data-testid="terminal-map">
      <NagaMap initialView={{ center: point, zoom: TERMINAL_ZOOM }} terminals={terminals} terminalsInteractive={false} label={t.mapOf(terminal.name)} />
    </div>
  );
}

/** "Directions to here": the coordinate becomes the destination, named as a map point. */
function DirectionsToHere({ name, point }: { name: string; point: Point }) {
  const t = useT().terminals;
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  return (
    <button
      type="button"
      className="pn-btn pn-btn--primary pn-place__cta"
      data-testid="terminal-directions"
      onClick={() => {
        frame?.requestEndpoint("destination", { point: { ...point }, label: terminalDirectionsLabel(name, t) });
        returnToMap();
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      {t.directionsToHere}
    </button>
  );
}

/** Location (OpenStreetMap provenance) and Modes (chips with per-mode sources) rows. */
function TerminalFacts({ terminal }: { terminal: TerminalInfo }) {
  const tt = useT();
  const t = tt.terminals;
  const modes = terminal.modes.filter(isRouteMode);
  return (
    <dl className="pn-place__facts" aria-label={t.aboutThis}>
      <div className="pn-place__fact" data-testid="terminal-location">
        <dt className="pn-place__fact-label">{t.location}</dt>
        <dd className="pn-place__fact-value">{terminal.coordinate ? t.mappedPoint(terminal.coordinate.note) : t.notMapped}</dd>
      </div>
      {modes.length > 0 ? (
        <div className="pn-place__fact" data-testid="terminal-modes">
          <dt className="pn-place__fact-label">{t.modes}</dt>
          <dd className="pn-place__fact-value pn-terminal__modes">
            {modes.map((m) => (
              <span key={m} className="pn-terminal__mode" data-testid={`terminal-mode-${m}`}>
                <ModeChip mode={m} label={tt.modes.name[m]} />
              </span>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function TerminalDetailView({ data }: { data: TerminalDetail }) {
  const { terminal } = data;
  const tt = useT();
  const t = tt.terminals;
  const TITLE = tt.detail.terminal;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const uid = useId();
  const [tab, setTab] = useState<Tab>("routes");
  const panelId = `${uid}-panel`;
  const notes = terminalNoteSentences(terminal.code, data.destinationCategories.length > 0, t);
  const sub = [terminalKindLabel(terminal.kind, t), terminalModesText(terminal.modes, t), terminal.locationText].filter(Boolean).join(" · ");
  const point = useMemo(
    () => (terminal.lat !== null && terminal.lng !== null ? { lat: terminal.lat, lng: terminal.lng } : null),
    [terminal.lat, terminal.lng],
  );
  const tabs = [
    { value: "routes", label: t.tabRoutes, controls: panelId, id: `${uid}-tab-routes` },
    { value: "entrances", label: t.tabEntrances, controls: panelId, id: `${uid}-tab-entrances` },
    { value: "hours", label: t.tabHours, controls: panelId, id: `${uid}-tab-hours` },
  ] as const;
  const activeTabId = tabs.find((t) => t.value === tab)!.id;

  return (
    <DetailPanel title={TITLE} action={<span className="pn-terminal__pill" data-testid="terminal-pill">{terminal.coordinate !== null ? t.pill : t.notMapped}</span>} sources={`${SOURCES_HREF}?terminal=${terminal.code}`} testId="terminal-detail">
      {point ? <TerminalMap terminal={terminal} point={point} /> : null}
      <main className="pn-detail__main pn-detail-in">
        <div className="pn-place__head">
          <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
            {terminal.name}
          </h1>
          {sub ? (
            <p className="pn-place__kind" data-testid="terminal-sub">
              {sub}
            </p>
          ) : null}
          <div className="pn-detail__row">
            <StatusBadge variant="documented" />
            <span className="pn-terminal__address" data-testid="terminal-address">
              {t.address(terminalEvidenceLabel(terminal.evidenceStatus, t))}
            </span>
          </div>
        </div>

        {point ? <DirectionsToHere name={terminal.name} point={point} /> : null}

        {terminal.statusNote ? (
          <p className="pn-terminal__status" data-testid="terminal-status-note">
            {terminal.statusNote}
          </p>
        ) : null}

        {notes.length > 0 ? (
          <div role="note" className="pn-terminal__info" data-testid="terminal-note">
            <InfoIcon />
            <span>{notes.join(" ")}</span>
          </div>
        ) : null}

        <TerminalFacts terminal={terminal} />

        <Segmented options={tabs} value={tab} onChange={setTab} label={t.sections} variant="tablist" testId="terminal-tabs" />

        <div id={panelId} role="tabpanel" aria-labelledby={activeTabId} className="pn-terminal__panel" data-testid={`terminal-panel-${tab}`}>
          {tab === "routes" ? <RoutesPanel data={data} /> : null}
          {tab === "entrances" ? (
            <div className="pn-terminal__empty">
              <p className="pn-terminal__empty-title">{t.entrancesNone}</p>
              <p className="pn-terminal__empty-text">
                {point ? t.tripsEndAtPoint : t.noLocationTrips}
              </p>
            </div>
          ) : null}
          {tab === "hours" ? (
            <dl className="pn-group pn-terminal__hours" data-testid="terminal-hours">
              <div className="pn-kv">
                <dt className="pn-kv__key">{t.hours}</dt>
                <dd className="pn-kv__value">{t.notOnFile}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        {point ? null : <Note testId="terminal-directions-note">{t.noDirections}</Note>}
      </main>
    </DetailPanel>
  );
}
