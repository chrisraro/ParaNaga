"use client";

// Search (artboard Search, /app/search?for=start|destination|save): one box over everything on
// file for Naga, searched in the browser over the published search index (decision D1). The query
// leaves this phone only for Google suggestions (Task 15: fewer than 3 results here, or "Search
// more places"), as a POST body through our server to Google; the server logs no query and keeps Google's
// answer up to 24 hours under a one-way hash only. A full-screen panel over the mounted home
// map (tab bar hidden, Escape or Cancel goes back).
//
// Picking: with for=start|destination an OpenStreetMap or mapped-pin place sets that trip end
// through the endpoint channel and returns to the map; otherwise a result opens its own screen
// (place, terminal, route detail). With for=save an OpenStreetMap or mapped-pin place opens the
// name dialog and is saved on this phone (Task 8). An honest inline notice remains only where no
// screen exists (a saved place). Saved places are searched too (read from this phone). "Use current location" and "Choose on map" hand the
// request to the home screen, which owns the GPS watch and the crosshair. A `#q=` fragment
// (src/domain/places/place-detail.ts searchHref) prefills the box; fragments never reach a server.

import "./search.css";
import "@/ui/kit/styles";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSavedPlaces } from "@/client/saved/use-saved";
import { useSearchIndex } from "@/client/search/use-search-index";
import { putSavedPlace } from "@/client/storage/db";
import { findSavedPlace, type SavedPlaceSource } from "@/domain/saved/saved";
import { countResults, groupView, resultSubtitle, searchIndex, type SearchGroup, type SearchGroupId, type SearchResult } from "@/domain/search/search";
import { queryFromHash } from "@/domain/places/place-detail";
import { actionFor, noticeFor, parseSearchPurpose, type SearchAction, type SearchPurpose } from "@/domain/search/select";
import { cameFromInsideApp, useAppFrame, useAppPanel } from "@/ui/app-shell/app-frame-context";
import { useEscapeToClose } from "@/ui/app-shell/panel";
import { StatusBadge } from "@/ui/kit/badge";
import { ListChevron } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { Switch } from "@/ui/kit/switch";
import { SavePlaceDialog } from "@/ui/saved/save-place-dialog";
import { GoogleSuggestions } from "./google-suggestions";

export const SEARCH_DEBOUNCE_MS = 150;
const FAILED_COPY = "Search data couldn't load. Try again.";
const EMPTY_COPY = "No match. Try a place, stop, street or route.";
const REGIONAL_NOTE = "Includes regional terminals. Services not verified.";

// ------------------------------------------------------------------ icons

const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

function SearchGlyph() {
  return (
    <svg {...ICON} strokeWidth={2.4}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
function LocateGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" fill="currentColor" />
    </svg>
  );
}
function PinGlyph() {
  return (
    <svg {...ICON} width={20} height={20}>
      <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

const KIND_ICON: Record<SearchResult["kind"], { tone: string; glyph: ReactNode }> = {
  saved: { tone: "teal", glyph: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /> },
  osm: { tone: "coral", glyph: <><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></> },
  pin: { tone: "gold", glyph: <circle cx="12" cy="12" r="6" /> },
  route: { tone: "grey", glyph: <><rect x="4" y="4" width="16" height="12" rx="3" /><path d="M4 11h16M8 20l-1-4M16 20l1-4" /></> },
  terminal: { tone: "grey", glyph: <><path d="M3 21h18M5 21V8l7-4 7 4v13" /><path d="M9 21v-6h6v6" /></> },
  barangay: { tone: "teal", glyph: <path d="M4 20V9l8-5 8 5v11z" /> },
  study: { tone: "grey", glyph: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></> },
  legacy: { tone: "grey", glyph: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 8v4l3 2" /></> },
  regional: { tone: "grey", glyph: <><path d="M3 12h18" /><path d="M15 6l6 6-6 6" /></> },
  feeder: { tone: "grey", glyph: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 18h8M6 16V8h8l4 5v3" /></> },
};

function KindIcon({ kind }: { kind: SearchResult["kind"] }) {
  const icon = KIND_ICON[kind];
  return (
    <span className={`pn-search__kind pn-search__kind--${icon.tone}`}>
      <svg {...ICON} width={16} height={16}>
        {icon.glyph}
      </svg>
    </span>
  );
}

function resultBadge(result: SearchResult): ReactNode {
  if (result.kind === "osm") return <StatusBadge variant="osm" />;
  if (result.kind === "pin") return <StatusBadge variant="candidate" />;
  if (result.kind === "route") {
    if (result.evidence === "provisional") return <StatusBadge variant="provisional-stops" />;
    if (result.evidence === "verified") return <StatusBadge variant="verified" />;
    return <StatusBadge variant="documented" />;
  }
  return null;
}

function resultKey(result: SearchResult): string {
  switch (result.kind) {
    case "saved":
      return `saved:${result.id}`;
    case "osm":
    case "pin":
    case "barangay":
      return `${result.kind}:${result.key}`;
    case "route":
    case "terminal":
    case "study":
    case "feeder":
      return `${result.kind}:${result.code}`;
    case "legacy":
      return `legacy:${result.title}`;
    case "regional":
      return `regional:${result.category}:${result.title}`;
  }
}

// ------------------------------------------------------------------ rows

function ResultRow({ result, purpose, onSelect }: { result: SearchResult; purpose: SearchPurpose | null; onSelect: (r: SearchResult) => void }) {
  const action = actionFor(result, purpose);
  const sub = resultSubtitle(result);
  const badge = resultBadge(result);
  const body = (
    <>
      <KindIcon kind={result.kind} />
      <span className="pn-cell__text">
        <span className="pn-cell__title">{result.title}</span>
        {sub ? <span className="pn-cell__sub">{sub}</span> : null}
        {badge}
      </span>
      {action.type === "none" ? null : <ListChevron />}
    </>
  );
  const testId = `search-result-${result.kind}`;
  const key = resultKey(result);
  if (action.type === "open") {
    return (
      <li>
        <Link href={action.href} className="pn-cell pn-search__cell" data-testid={testId} data-result-key={key}>
          {body}
        </Link>
      </li>
    );
  }
  if (action.type === "none") {
    return (
      <li>
        {/* Not tappable; focusable only by script (after "Show all"), never in the tab order. */}
        <div className="pn-cell pn-search__cell" tabIndex={-1} data-testid={testId} data-result-key={key}>
          {body}
        </div>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="pn-cell pn-search__cell" onClick={() => onSelect(result)} data-testid={testId} data-result-key={key}>
        {body}
      </button>
    </li>
  );
}

function ResultGroup({
  group,
  shownRows,
  onExpand,
  purpose,
  onSelect,
}: {
  group: SearchGroup;
  /** Rows revealed so far (undefined = the first GROUP_LIMIT). */
  shownRows: number | undefined;
  /** Reveals more; `firstNew` is the first row it adds, `next` the revealed count afterwards. */
  onExpand: (firstNew: SearchResult, next: number) => void;
  purpose: SearchPurpose | null;
  onSelect: (r: SearchResult) => void;
}) {
  const id = useId();
  const view = groupView(group, shownRows);
  const shown = view.rows;
  return (
    <section className="pn-section" aria-labelledby={id} data-testid={`search-group-${group.id}`}>
      <h2 id={id} className="pn-section__title">
        {group.title}
      </h2>
      <ul className="pn-group">
        {shown.map((r) => (
          <ResultRow key={resultKey(r)} result={r} purpose={purpose} onSelect={onSelect} />
        ))}
      </ul>
      {view.label ? (
        <button type="button" className="pn-text-btn pn-search__more" onClick={() => onExpand(group.results[shown.length]!, view.next)}>
          {view.label}
        </button>
      ) : null}
      {group.id === "legacy" ? <Note testId="search-legacy-note">Old route names are historical hints, not current routes.</Note> : null}
    </section>
  );
}

// ------------------------------------------------------------------ notice

function NoticeCard({
  result,
  purpose,
  onSet,
  onClose,
}: {
  result: SearchResult;
  purpose: SearchPurpose | null;
  onSet: (which: "start" | "destination", endpoint: { point: { lat: number; lng: number }; label: string; place?: SavedPlaceSource }) => void;
  onClose: () => void;
}) {
  const notice = noticeFor(result, purpose);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [result]);
  const id = useId();
  return (
    <section className="pn-card pn-search__notice" aria-labelledby={id} data-testid="search-notice">
      <h2 id={id} ref={heading} tabIndex={-1} className="pn-search__notice-title">
        {notice.title}
      </h2>
      <p className="pn-card__text">{notice.body}</p>
      {notice.endpoint ? (
        <div className="pn-search__notice-actions">
          <button type="button" className="pn-btn pn-btn--secondary" onClick={() => onSet("start", notice.endpoint!)}>
            Set as start
          </button>
          <button type="button" className="pn-btn pn-btn--secondary" onClick={() => onSet("destination", notice.endpoint!)}>
            Set as destination
          </button>
        </div>
      ) : null}
      <button type="button" className="pn-text-btn" onClick={onClose}>
        Close
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ screen

function publishedDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" });
}

function SkeletonRows() {
  return (
    <div className="pn-search__skeleton" role="status" aria-label="Loading search data" data-testid="search-loading">
      {[70, 55, 80].map((w) => (
        <div key={w} className="pn-search__skeleton-row">
          <span className="pn-skeleton pn-search__skeleton-icon" />
          <span className="pn-skeleton" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * The route component. The /app routes stay mounted while hidden (Activity) and their effects
 * re-run when shown again, so each opening bumps `opened` and the body is keyed on it: every
 * search starts fresh (query, notice, "Show all", regional switch), with the keyboard on the box.
 */
export function SearchScreen() {
  const params = useSearchParams();
  const purpose = parseSearchPurpose(params.get("for"));
  useAppPanel("detail");
  const root = useRef<HTMLDivElement>(null);
  useEscapeToClose(root);
  const indexState = useSearchIndex();
  // Each opening may carry a query in a "#q=" fragment (a "Search mapped stops for …" link). It is
  // read once per opening, then dropped from this history entry, so coming back here later does
  // not prefill the old label over what the user typed (no request is made).
  const [opening, setOpening] = useState(() => ({ n: 0, query: readHashQuery() }));
  useEffect(() => {
    const query = readHashQuery();
    // Counting openings is the point of this effect (Activity re-show), not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpening((o) => ({ n: o.n + 1, query }));
    if (!window.location.hash) return;
    // Deferred and cancelled on cleanup, so the effect is idempotent: a Strict Mode re-run (or an
    // Activity re-show right away) still reads the same fragment before it is dropped.
    const t = window.setTimeout(() => window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search), 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={root} className="pn-detail pn-search" data-testid="search-screen">
      <SearchBody key={opening.n} purpose={purpose} indexState={indexState} initialQuery={opening.query} />
    </div>
  );
}

const readHashQuery = () => (typeof window === "undefined" ? "" : queryFromHash(window.location.hash));

function SearchBody({
  purpose,
  indexState,
  initialQuery,
}: {
  purpose: SearchPurpose | null;
  indexState: ReturnType<typeof useSearchIndex>;
  initialQuery: string;
}) {
  const frame = useAppFrame();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Prefilled from a "Search mapped stops for …" link (#q=), read once per opening.
  const [query, setQuery] = useState(initialQuery);
  const [typed, setTyped] = useState(initialQuery);
  const [regional, setRegional] = useState(false);
  // "Show all" and the open notice belong to one (debounced) query. The notice remembers the
  // row that opened it, so Close puts focus back there.
  const [expanded, setExpanded] = useState<{ query: string; rows: Partial<Record<SearchGroupId, number>> }>({ query: "", rows: {} });
  const [notice, setNotice] = useState<{ query: string; result: SearchResult } | null>(null);
  // A row to focus once it has rendered (after Close, or the first row "Show all" revealed).
  // One attempt only: if the row is gone (the query changed meanwhile), the request is dropped,
  // so a row with that key reappearing later never takes focus.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    body.current?.querySelector<HTMLElement>(`[data-result-key="${CSS.escape(key)}"]`)?.focus();
  });

  useEffect(() => input.current?.focus(), []);

  // Debounced: results follow typing after a short pause; clearing the box is immediate.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const debounced = query.trim() === "" ? "" : typed;

  const index = indexState.status === "ready" ? indexState.index : null;
  const morePlaces = indexState.status === "ready" ? indexState.morePlaces : "ready";
  const savedPlaces = useSavedPlaces();
  const saved = useMemo(
    () => (savedPlaces.status === "ready" ? savedPlaces.records.map((p) => ({ id: p.id, label: p.label, point: p.point, source: p.source })) : []),
    [savedPlaces],
  );
  const groups = useMemo(() => (index ? searchIndex(index, debounced, { regional, saved }) : []), [index, debounced, regional, saved]);
  // for=save: the place whose name is being chosen.
  const [saving, setSaving] = useState<Extract<SearchAction, { type: "save" }>["place"] | null>(null);
  const [alreadySaved, setAlreadySaved] = useState<{ query: string; label: string } | null>(null);
  const total = countResults(groups);
  const hasQuery = debounced.trim() !== "";
  const openNotice = notice && notice.query === debounced ? notice.result : null;
  const expandedRows = expanded.query === debounced ? expanded.rows : {};

  const goBack = () => {
    if (cameFromInsideApp()) router.back();
    else router.push("/app");
  };
  // After setting a trip end: back to the map the search was opened from, else open the map.
  const returnToMap = () => {
    if ((purpose === "start" || purpose === "destination") && cameFromInsideApp()) router.back();
    else router.push("/app");
  };
  const setEnd = (which: "start" | "destination", endpoint: { point: { lat: number; lng: number }; label: string; place?: SavedPlaceSource }) => {
    frame?.requestEndpoint(which, endpoint);
    returnToMap();
  };
  const onSelect = (result: SearchResult) => {
    const action = actionFor(result, purpose);
    if (action.type === "endpoint") setEnd(action.which, action.endpoint);
    else if (action.type === "save") {
      // Never save the same point twice; wait for the saved places before deciding.
      if (savedPlaces.status === "loading") return;
      const existing = savedPlaces.status === "ready" ? findSavedPlace(savedPlaces.records, action.place.point) : null;
      if (existing) setAlreadySaved({ query: debounced, label: existing.label });
      else setSaving(action.place);
    }
    else if (action.type === "notice") setNotice({ query: debounced, result });
  };
  const savePlace = async (label: string) => {
    if (!saving) return;
    await putSavedPlace({ id: crypto.randomUUID(), label, point: { ...saving.point }, source: saving.source, savedAt: new Date().toISOString() });
    setSaving(null);
    // Back to Saved → Places, where "Add a place" opened this search.
    if (cameFromInsideApp()) router.back();
    else router.push("/app/saved?tab=places");
  };

  const liveText = !hasQuery || !index ? "" : total === 1 ? "1 result" : `${total} results`;
  const date = index ? publishedDate(index.revision.publishedAt) : null;

  return (
    <div ref={body}>
      <h1 className="sr-only">Search</h1>
      <header className="pn-search__header">
        <div className="pn-search__field">
          <SearchGlyph />
          <label htmlFor="pn-search-q" className="sr-only">
            Search places, stops and routes
          </label>
          <input
            ref={input}
            id="pn-search-q"
            type="search"
            className="pn-search__input"
            placeholder="Place, stop or route"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== "" ? (
            <button
              type="button"
              className="pn-search__clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          ) : null}
        </div>
        <button type="button" className="pn-search__cancel" onClick={goBack}>
          Cancel
        </button>
      </header>

      <main className="pn-search__main">
        <ul className="pn-group" aria-label="Search options">
          {/* Decision (Task 5): "Use current location" is offered for the start only, like the
              home sheet: GPS sets the start, never the destination. */}
          {purpose === "start" ? (
            <li>
              <button
                type="button"
                className="pn-cell pn-cell--compact pn-search__option"
                onClick={() => {
                  frame?.requestGps();
                  returnToMap();
                }}
              >
                <span className="pn-search__option-icon">
                  <LocateGlyph />
                </span>
                <span className="pn-cell__title">Use current location</span>
              </button>
            </li>
          ) : null}
          {purpose === "start" || purpose === "destination" ? (
            <li>
              <button
                type="button"
                className="pn-cell pn-cell--compact pn-search__option"
                onClick={() => {
                  frame?.requestPick(purpose);
                  returnToMap();
                }}
              >
                <span className="pn-search__option-icon">
                  <PinGlyph />
                </span>
                <span className="pn-cell__title">Choose on map</span>
              </button>
            </li>
          ) : null}
          <li>
            <Switch label="Include regional connections" checked={regional} onChange={setRegional} testId="search-regional" />
          </li>
        </ul>
        {regional ? <Note testId="search-regional-note">{REGIONAL_NOTE}</Note> : null}
        {purpose === "save" ? (
          <Note testId="search-save-note">Pick a place to save.</Note>
        ) : null}

        {indexState.status === "loading" ? <SkeletonRows /> : null}
        {indexState.status === "error" ? (
          <div className="pn-search__error" data-testid="search-error">
            <p>{indexState.problem === "offline" ? "Search needs a connection the first time. Try again." : FAILED_COPY}</p>
            <button type="button" className="pn-btn pn-btn--secondary" onClick={indexState.retry}>
              Try again
            </button>
          </div>
        ) : null}
        {indexState.status === "ready" && indexState.problem === "offline" ? (
          <Note icon testId="search-offline">
            Offline · data from {date ?? `revision ${indexState.index.revision.label}`}
          </Note>
        ) : null}
        {indexState.status === "ready" && indexState.problem === "failed" ? (
          <div className="pn-search__error" data-testid="search-failed">
            <p>{FAILED_COPY}</p>
            <button type="button" className="pn-btn pn-btn--secondary" onClick={indexState.retry}>
              Try again
            </button>
          </div>
        ) : null}

        {alreadySaved && alreadySaved.query === debounced ? (
          <p className="pn-search__already" role="status" data-testid="search-already-saved">
            Already saved as “{alreadySaved.label}”.
          </p>
        ) : null}
        {openNotice ? (
          <NoticeCard
            result={openNotice}
            purpose={purpose}
            onSet={setEnd}
            onClose={() => {
              pendingFocus.current = resultKey(openNotice);
              setNotice(null);
            }}
          />
        ) : null}

        {/* Task 14: shops, restaurants and the rest arrive as a lazy chunk after the index. */}
        {index && hasQuery && total === 0 && morePlaces === "loading" ? (
          <p className="pn-search__empty" role="status" data-testid="search-more-loading">
            Loading more places…
          </p>
        ) : null}
        {index && hasQuery && total === 0 && morePlaces !== "loading" ? (
          <p className="pn-search__empty" data-testid="search-empty">
            {EMPTY_COPY}
          </p>
        ) : null}
        {index && hasQuery && morePlaces === "failed" ? (
          <div className="pn-search__error" data-testid="search-more-failed">
            <p>Shops, restaurants and other places could not load, so they are missing from these results.</p>
            <button type="button" className="pn-btn pn-btn--secondary" onClick={indexState.retry}>
              Try again
            </button>
          </div>
        ) : null}
        {groups.map((g) => (
          <ResultGroup
            key={g.id}
            group={g}
            shownRows={expandedRows[g.id]}
            onExpand={(firstNew, next) => {
              // Focus moves to the first row it revealed (the button may have gone away).
              pendingFocus.current = resultKey(firstNew);
              setExpanded({ query: debounced, rows: { ...expandedRows, [g.id]: next } });
            }}
            purpose={purpose}
            onSelect={onSelect}
          />
        ))}
        {/* Task 15: Google suggestions below the on-device rows, only as the cost guard allows. */}
        {index && hasQuery ? (
          <GoogleSuggestions
            query={debounced}
            localCount={total}
            ready={morePlaces !== "loading"}
            purpose={purpose}
            onEndpoint={setEnd}
            onSave={(place) => setSaving(place)}
          />
        ) : null}
      </main>

      <p className="sr-only" aria-live="polite" data-testid="search-announcer">
        {liveText}
      </p>
      <SavePlaceDialog
        open={saving !== null}
        title="Save place"
        initialLabel={saving?.label ?? ""}
        onSave={savePlace}
        onCancel={() => setSaving(null)}
        testId="search-save-dialog"
      />
    </div>
  );
}
