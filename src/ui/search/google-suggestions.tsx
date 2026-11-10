"use client";

// Google suggestions below the on-device results (Task 15, cost controls binding). Google is asked
// only when on-device search found fewer than 3 results, after 3 characters and a 400 ms pause, or
// when the rider taps "Search more places". One session token per typing session (a new one after a
// pick). Rows are "Google suggestion · not verified"; a pick resolves to a point on our map. Any
// non-ok answer leaves the on-device results alone: "capped" and "rate_limited" say so, and
// "unavailable" (Google off, offline, failed) hides this block until the next search opening.
// A pick is one paid details call: while it runs the rows are busy and a second tap does nothing,
// and its answer is dropped when the query has changed (or the screen closed) in the meantime.

import { useEffect, useId, useRef, useState } from "react";
import { fetchGoogleSuggestions, resolveGooglePlace } from "@/client/places/google-places";
import type { LatLng } from "@/domain/geo/types";
import {
  GOOGLE_DEBOUNCE_MS,
  GOOGLE_QUERY_MIN,
  normalizeGoogleQuery,
  shouldAskGoogle,
  type GoogleSuggestion,
  type SuggestResponse,
} from "@/domain/places/google";
import type { SearchPurpose } from "@/domain/search/select";
import { ListChevron } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { useT } from "@/i18n/provider";

type Endpoint = { point: LatLng; label: string; place: "google" };

/** The row that was tapped, for the query it was listed under. */
type Picked = { query: string; title: string } & (
  | { status: "resolving"; placeId: string }
  | { status: "problem"; problem: string }
  | { status: "resolved"; endpoint: Endpoint }
);

type Props = {
  /** The (debounced) query the on-device results are for. */
  query: string;
  localCount: number;
  /** On-device search has answered (index and places chunk loaded). */
  ready: boolean;
  purpose: SearchPurpose | null;
  onEndpoint: (which: "start" | "destination", endpoint: Endpoint) => void;
  onSave: (place: { label: string; point: LatLng; source: "google" }) => void;
};

export function GoogleSuggestions({ query, localCount, ready, purpose, onEndpoint, onSave }: Props) {
  const tt = useT();
  const t = tt.search;
  const NOTE = { capped: t.googleCapped, rate_limited: t.googleRateLimited } as const;
  const PICK_PROBLEM = { outside: t.googleOutside, capped: NOTE.capped, rate_limited: NOTE.rate_limited, unavailable: t.googleUnavailable } as const;
  const id = useId();
  const token = useRef<string>(crypto.randomUUID());
  const [off, setOff] = useState(false);
  const [tapped, setTapped] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ query: string; response: SuggestResponse } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  // The pick in flight (state lags a double tap by a render; this does not).
  const picking = useRef<AbortController | null>(null);

  const q = normalizeGoogleQuery(query);
  const auto = ready && shouldAskGoogle(q, localCount);
  const wanted = !off && [...q].length >= GOOGLE_QUERY_MIN && (auto || tapped === q);

  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchGoogleSuggestions(q, token.current, controller.signal).then(
        (response) => {
          if (response.status === "unavailable") setOff(true);
          else setAnswer({ query: q, response });
        },
        () => undefined,
      );
    }, auto ? GOOGLE_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wanted, auto, q]);

  // A new query (or closing the screen) drops the pick in flight: its answer must not navigate.
  useEffect(
    () => () => {
      picking.current?.abort();
      picking.current = null;
    },
    [q],
  );

  if (off || [...q].length < GOOGLE_QUERY_MIN) return null;
  if (!wanted) {
    return ready ? (
      <button type="button" className="pn-text-btn pn-search__more" onClick={() => setTapped(q)}>
        {t.googleMore}
      </button>
    ) : null;
  }
  const response = answer?.query === q ? answer.response : null;
  if (!response) return null;
  if (response.status === "unavailable") return null;
  if (response.status !== "ok") return <Note testId="search-google-note">{NOTE[response.status]}</Note>;
  if (response.suggestions.length === 0) return null;

  const pick = async (s: GoogleSuggestion) => {
    if (picking.current) return;
    const run = new AbortController();
    picking.current = run;
    setPicked({ query: q, title: s.title, status: "resolving", placeId: s.placeId });
    const result = await resolveGooglePlace(s.placeId, token.current);
    // The session ends with the details call: the next search starts a new one.
    if (result.status === "ok") token.current = crypto.randomUUID();
    if (run.signal.aborted) {
      // Stale (the query changed): drop the busy mark, never navigate.
      setPicked((p) => (p?.status === "resolving" && p.placeId === s.placeId && p.query === q ? null : p));
      return;
    }
    picking.current = null;
    if (result.status !== "ok") {
      setPicked({ query: q, title: s.title, status: "problem", problem: PICK_PROBLEM[result.status] });
      return;
    }
    const endpoint: Endpoint = { point: result.point, label: s.title, place: "google" };
    const handedOver = purpose === "start" || purpose === "destination" || purpose === "save";
    setPicked(handedOver ? null : { query: q, title: s.title, status: "resolved", endpoint });
    if (purpose === "start" || purpose === "destination") onEndpoint(purpose, endpoint);
    else if (purpose === "save") onSave({ label: s.title, point: result.point, source: "google" });
  };
  const shownPick = picked?.query === q ? picked : null;
  const resolving = shownPick?.status === "resolving" ? shownPick.placeId : null;

  return (
    <section className="pn-section" aria-labelledby={id} data-testid="search-google">
      <h2 id={id} className="pn-section__title">
        {t.googleHeading}
      </h2>
      <ul className="pn-group">
        {response.suggestions.map((s) => (
          <li key={s.placeId}>
            {/* aria-disabled, not disabled: the tapped row keeps focus while its place is fetched. */}
            <button
              type="button"
              className="pn-cell pn-search__cell"
              aria-disabled={resolving !== null}
              aria-busy={resolving === s.placeId || undefined}
              onClick={() => void pick(s)}
              data-testid="search-result-google"
            >
              {/* The same row as an on-device result: icon circle, text, chevron (search.css). */}
              <span className="pn-search__kind pn-search__kind--grey">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" />
                  <circle cx="12" cy="10" r="2" />
                </svg>
              </span>
              <span className="pn-cell__text">
                <span className="pn-cell__title">{s.title}</span>
                {resolving === s.placeId ? <span className="pn-cell__sub">{tt.forms.loading}</span> : s.subtitle ? <span className="pn-cell__sub">{s.subtitle}</span> : null}
                <span className="pn-badge pn-badge--evidence">{t.googleSuggestion}</span>
              </span>
              <ListChevron />
            </button>
          </li>
        ))}
      </ul>
      {shownPick && shownPick.status !== "resolving" ? (
        <div className="pn-card pn-search__notice" role="status" data-testid="search-google-pick">
          <p className="pn-card__text">{shownPick.status === "problem" ? shownPick.problem : t.googlePicked(shownPick.title)}</p>
          {shownPick.status === "resolved" ? (
            <div className="pn-search__notice-actions">
              <button type="button" className="pn-btn pn-btn--secondary" onClick={() => onEndpoint("start", shownPick.endpoint)}>
                {t.setStart}
              </button>
              <button type="button" className="pn-btn pn-btn--secondary" onClick={() => onEndpoint("destination", shownPick.endpoint)}>
                {t.setDestination}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="pn-footnote" data-testid="search-google-attribution">
        {t.googleFooter(t.googleAttribution)}
      </p>
    </section>
  );
}
