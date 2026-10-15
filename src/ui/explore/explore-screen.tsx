"use client";

// Explore (artboard Explore; Increment A, Task 7; decision D5). Category chips over the
// OpenStreetMap places of the cached search index (the same index Search and Place detail use, so
// Explore reaches no new API), as artboard cards: a tinted tile with "Photo pending", the name,
// "{Category} · from OpenStreetMap", "How to commute here" (the place's coordinate becomes the
// destination and the map plans from the current start, or asks for one) and a link to the place.
// Below, a directory of everything else on file: mapped-pin places, routes, terminals, barangays
// and feeder leads, each row linking to its own detail screen (leads are text only).

import "@/ui/kit/styles";
import "./explore.css";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { useSearchIndex } from "@/client/search/use-search-index";
import { routeListSchema, type SearchIndex, type SearchOsmPlace } from "@/domain/api/schemas";
import {
  DIRECTORY_SEGMENTS,
  EXPLORE_CATEGORIES,
  EXPLORE_PLACES_NOTE,
  LEAD_STATUS_TEXT,
  RAIL_SOURCE_CODES,
  RAIL_STATUS_TEXT,
  TERMINAL_ROW_SUB,
  barangaysAZ,
  chipOfOsmCategory,
  emptyCategoryText,
  feederLeadsByCode,
  mappedStopsAZ,
  pinPlaceSub,
  placesInCategory,
  routeDirectoryGroups,
  routeEvidenceBadge,
  type DirectorySegment,
  type ExploreCategoryId,
} from "@/domain/places/explore";
import { OSM_CATEGORY_LABEL } from "@/domain/places/osm-categories";
import { barangayHref, osmPlaceHref, pinPlaceHref, terminalHref } from "@/domain/places/place-detail";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { useReturnToMap } from "@/ui/detail/detail-frame";
import { StatusBadge } from "@/ui/kit/badge";
import { ListCell, ListChevron } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { OsmAttribution } from "@/ui/kit/osm-attribution";
import { Segmented } from "@/ui/kit/segmented";
import { LoopChip } from "@/ui/trip/trip-parts";

export function ExploreScreen() {
  const state = useSearchIndex();
  if (state.status === "loading") {
    return (
      <div className="pn-detail__stack" role="status" aria-label="Loading places" data-testid="explore-loading">
        <div className="pn-skeleton" style={{ width: "70%", height: 36 }} />
        <div className="pn-skeleton" style={{ height: 220 }} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="pn-detail__stack" data-testid="explore-error">
        <p role="alert" className="pn-footnote">
          {state.problem === "offline" ? "You are offline. Check your connection, then try again." : "Could not load the places. Try again."}
        </p>
        <button type="button" className="pn-detail__retry" onClick={state.retry}>
          Try again
        </button>
      </div>
    );
  }
  return <ExploreView index={state.index} />;
}

export function ExploreView({ index }: { index: SearchIndex }) {
  return (
    <>
      <PlacesByCategory places={index.osmPlaces} />
      <Directory index={index} />
    </>
  );
}

// ------------------------------------------------------------------ category chips + cards

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

function PlacesByCategory({ places }: { places: readonly SearchOsmPlace[] }) {
  const uid = useId();
  const [cat, setCat] = useState<ExploreCategoryId>("all");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useMemo(() => placesInCategory(places, cat), [places, cat]);
  const active = Math.max(0, EXPLORE_CATEGORIES.findIndex((c) => c.id === cat));
  const tabId = (id: ExploreCategoryId) => `${uid}-cat-${id}`;
  const panelId = `${uid}-cards`;

  const choose = (i: number) => {
    const c = EXPLORE_CATEGORIES[i];
    if (!c) return;
    setCat(c.id);
    tabs.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = EXPLORE_CATEGORIES.length;
    let next: number | null = null;
    if (NEXT_KEYS.has(e.key)) next = (active + 1) % n;
    else if (PREV_KEYS.has(e.key)) next = (active - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    choose(next);
  };

  return (
    <>
      <div role="tablist" aria-label="Categories" className="pn-explore__chips" data-testid="explore-categories">
        {EXPLORE_CATEGORIES.map((c, i) => {
          const on = c.id === cat;
          return (
            <button
              key={c.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={tabId(c.id)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              className="pn-explore__chip"
              onClick={() => choose(i)}
              onKeyDown={onKeyDown}
              data-testid={`explore-chip-${c.id}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(cat)} className="pn-explore__panel" data-testid="explore-cards">
        {list.length === 0 ? (
          <p className="pn-explore__empty" data-testid="explore-empty">
            {emptyCategoryText(cat)}
          </p>
        ) : (
          <ul className="pn-explore__cards">
            {list.map((p) => (
              <PlaceCard key={p.key} place={p} />
            ))}
          </ul>
        )}
      </div>
      <Note testId="explore-places-note">{EXPLORE_PLACES_NOTE}</Note>
      <OsmAttribution testId="explore-osm-attribution" />
    </>
  );
}

const ICON_PATH: Record<Exclude<ExploreCategoryId, "all">, string> = {
  faith: "M12 2v6M9 5h6M5 22V12l7-4 7 4v10M10 22v-5h4v5",
  schools: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5",
  markets: "M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6",
  health: "M4 4h16v16H4zM12 8v8M8 12h8",
  government: "M4 21h16M6 21V10M18 21V10M12 21V10M3 10l9-6 9 6z",
  parks: "M12 22v-6M12 2l6 9h-3l4 5H5l4-5H6z",
  terminals: "M5 17V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11zM5 12h14M8 20v-3M16 20v-3M8 15h.01M16 15h.01",
};

function CommuteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <path d="M32 90 V30 L60 60 L88 90 V30" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlaceCard({ place }: { place: SearchOsmPlace }) {
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  const chip = chipOfOsmCategory(place.category);
  const href = osmPlaceHref(place.key);
  const kind = `${OSM_CATEGORY_LABEL[place.category]} · from OpenStreetMap`;
  return (
    <li className="pn-explore__card" data-testid="explore-card" data-category={place.category}>
      <div className={`pn-explore__tile pn-explore__tile--${chip}`}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d={ICON_PATH[chip]} />
        </svg>
        <span className="pn-explore__photo">Photo pending</span>
      </div>
      <div className="pn-explore__body">
        <div>
          <h2 className="pn-explore__name">
            {href ? (
              <Link href={href} className="pn-explore__name-link" data-testid="explore-card-link">
                <span>{place.name}</span>
                <ListChevron />
              </Link>
            ) : (
              place.name
            )}
          </h2>
          <p className="pn-explore__kind">{kind}</p>
        </div>
        <button
          type="button"
          className="pn-explore__commute"
          aria-label={`How to commute here: ${place.name}`}
          onClick={() => {
            frame?.requestEndpoint("destination", { point: { lat: place.lat, lng: place.lng }, label: place.name });
            returnToMap();
          }}
          data-testid="explore-commute"
        >
          <CommuteIcon />
          How to commute here
        </button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ directory

function Directory({ index }: { index: SearchIndex }) {
  const uid = useId();
  const [segment, setSegment] = useState<DirectorySegment>("stops");
  const panelId = `${uid}-dir`;
  const options = DIRECTORY_SEGMENTS.map((s) => ({ ...s, controls: panelId, id: `${uid}-seg-${s.value}` }));
  const activeId = options.find((o) => o.value === segment)!.id;
  return (
    <section className="pn-section pn-explore__directory" aria-labelledby={`${uid}-title`} data-testid="explore-directory">
      <h2 id={`${uid}-title`} className="pn-explore__directory-title">
        Directory
      </h2>
      <Segmented options={options} value={segment} onChange={setSegment} label="Directory sections" variant="tablist" testId="explore-segments" />
      <div id={panelId} role="tabpanel" aria-labelledby={activeId} className="pn-explore__dir-panel" data-testid={`explore-dir-${segment}`}>
        {segment === "stops" ? <MappedStops index={index} /> : null}
        {segment === "routes" ? <Routes /> : null}
        {segment === "terminals" ? <Terminals index={index} /> : null}
        {segment === "barangays" ? <Barangays index={index} /> : null}
        {segment === "leads" ? <Leads index={index} /> : null}
      </div>
    </section>
  );
}

function Count({ children }: { children: ReactNode }) {
  return (
    <p className="pn-explore__count" data-testid="explore-dir-count">
      {children}
    </p>
  );
}

function BadgeCell({ href, title, sub, badges, lead, testId }: { href: string; title: string; sub?: string; badges: ReactNode; lead?: ReactNode; testId?: string }) {
  return (
    <li>
      <Link href={href} className="pn-cell" data-testid={testId}>
        {lead}
        <span className="pn-cell__text">
          <span className="pn-cell__title">{title}</span>
          {sub ? <span className="pn-cell__sub">{sub}</span> : null}
          <span className="pn-explore__badges">{badges}</span>
        </span>
        <ListChevron />
      </Link>
    </li>
  );
}

function MappedStops({ index }: { index: SearchIndex }) {
  const list = useMemo(() => mappedStopsAZ(index.pinPlaces), [index.pinPlaces]);
  return (
    <>
      <Count>{`${list.length} mapped-pin places, A–Z`}</Count>
      <ul className="pn-group" aria-label="Mapped stops" data-testid="explore-stops">
        {list.map((p) => (
          <BadgeCell key={p.key} href={pinPlaceHref(p.key)} title={p.label} sub={pinPlaceSub(p)} badges={<StatusBadge variant="candidate" />} />
        ))}
      </ul>
      <Note>Pins sharing one name within 60 m are one row. Positions are unverified.</Note>
    </>
  );
}

function Routes() {
  const resource = useNetworkResource("/api/v1/routes", routeListSchema);
  const uid = useId();
  if (resource.status === "loading") {
    return (
      <div className="pn-detail__stack" role="status" aria-label="Loading routes" data-testid="explore-routes-loading">
        <div className="pn-skeleton" style={{ height: 180 }} />
      </div>
    );
  }
  if (resource.status !== "ready") {
    const offline = resource.status === "error" && resource.offline;
    return (
      <div className="pn-detail__stack" data-testid="explore-routes-error">
        <p role="alert" className="pn-footnote">
          {offline ? "You are offline. Check your connection, then try again." : "Could not load the routes. Try again."}
        </p>
        <button type="button" className="pn-detail__retry" onClick={resource.retry}>
          Try again
        </button>
      </div>
    );
  }
  const groups = routeDirectoryGroups(resource.data);
  const total = groups.reduce((n, g) => n + g.routes.length, 0);
  return (
    <>
      <Count>{`${total} routes of the approved plan`}</Count>
      <div className="pn-explore__route-groups" data-testid="explore-routes">
        {groups.map((g, gi) => (
          <section key={g.title} className="pn-section" aria-labelledby={`${uid}-g${gi}`}>
            <h3 id={`${uid}-g${gi}`} className="pn-section__title">
              {g.title}
            </h3>
            <ul className="pn-group">
              {g.routes.map((r) => (
                <BadgeCell
                  key={r.code}
                  href={`/app/routes/${encodeURIComponent(r.code)}`}
                  title={r.name}
                  lead={<LoopChip leg={{ routeCode: r.code, routeName: r.name }} icon="line" />}
                  badges={
                    <>
                      <StatusBadge variant={routeEvidenceBadge(r)} />
                      {r.hasTrial ? <StatusBadge variant="trial" /> : null}
                    </>
                  }
                  testId="explore-route"
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Note>Street order from the approved route plan. Route shapes and stops are not yet surveyed.</Note>
    </>
  );
}

function Terminals({ index }: { index: SearchIndex }) {
  return (
    <>
      <Count>{`${index.terminals.length} terminals`}</Count>
      <ul className="pn-group" aria-label="Terminals" data-testid="explore-terminals">
        {index.terminals.map((t) => (
          <ListCell key={t.code} href={terminalHref(t.code)} title={t.name} sub={TERMINAL_ROW_SUB} />
        ))}
      </ul>
    </>
  );
}

function Barangays({ index }: { index: SearchIndex }) {
  const list = useMemo(() => barangaysAZ(index.barangays), [index.barangays]);
  return (
    <>
      <Count>{`${list.length} barangays, A–Z`}</Count>
      <ul className="pn-group" aria-label="Barangays" data-testid="explore-barangays">
        {list.map((b) => (
          <BadgeCell key={b.key} href={barangayHref(b.key)} title={b.name} badges={<StatusBadge variant="not-surveyed" />} />
        ))}
      </ul>
    </>
  );
}

function Leads({ index }: { index: SearchIndex }) {
  const leads = feederLeadsByCode(index.feederLeads);
  return (
    <>
      <Count>{`${leads.length} feeder leads`}</Count>
      <ul className="pn-group" aria-label="Feeder leads" data-testid="explore-leads">
        {leads.map((l) => (
          <ListCell key={l.code} title={l.name} sub={LEAD_STATUS_TEXT} />
        ))}
      </ul>
      <p className="pn-explore__rail" data-testid="explore-rail">
        {RAIL_STATUS_TEXT}{" "}
        <span className="pn-explore__rail-sources">
          Sources{" "}
          {RAIL_SOURCE_CODES.map((c, i) => (
            <span key={c}>
              {i > 0 ? ", " : null}
              <span className="pn-mono">{c}</span>
            </span>
          ))}
        </span>
      </p>
    </>
  );
}
