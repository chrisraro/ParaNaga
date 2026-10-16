"use client";

// Google suggestions below the on-device results (Task 15, cost controls binding). Google is asked
// only when on-device search found fewer than 3 results, after 3 characters and a 400 ms pause, or
// when the rider taps "Search more places". One session token per typing session (a new one after a
// pick). Rows are "Google suggestion · not verified"; a pick resolves to a point on our map. Any
// non-ok answer leaves the on-device results alone: "capped" and "rate_limited" say so, and
// "unavailable" (Google off, offline, failed) hides this block until the next search opening.

import { useEffect, useId, useRef, useState } from "react";
import { fetchGoogleSuggestions, resolveGooglePlace } from "@/client/places/google-places";
import type { LatLng } from "@/domain/geo/types";
import {
  GOOGLE_ATTRIBUTION,
  GOOGLE_DEBOUNCE_MS,
  GOOGLE_QUERY_MIN,
  GOOGLE_SUGGESTION_LABEL,
  normalizeGoogleQuery,
  shouldAskGoogle,
  type GoogleSuggestion,
  type SuggestResponse,
} from "@/domain/places/google";
import type { SearchPurpose } from "@/domain/search/select";
import { Note } from "@/ui/kit/note";

type Endpoint = { point: LatLng; label: string; place: "google" };

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

const NOTE: Record<"capped" | "rate_limited", string> = {
  capped: "No more Google suggestions today. Showing OpenStreetMap results only.",
  rate_limited: "Google suggestions are paused for a few minutes. Showing OpenStreetMap results only.",
};
const PICK_PROBLEM = {
  outside: "That place is outside Naga City, so it can't be used here.",
  capped: NOTE.capped,
  rate_limited: NOTE.rate_limited,
  unavailable: "Couldn't get that place's location. Try again.",
} as const;

export function GoogleSuggestions({ query, localCount, ready, purpose, onEndpoint, onSave }: Props) {
  const id = useId();
  const token = useRef<string>(crypto.randomUUID());
  const [off, setOff] = useState(false);
  const [tapped, setTapped] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ query: string; response: SuggestResponse } | null>(null);
  const [picked, setPicked] = useState<{ query: string; title: string; problem?: string; endpoint?: Endpoint } | null>(null);

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

  if (off || [...q].length < GOOGLE_QUERY_MIN) return null;
  if (!wanted) {
    return ready ? (
      <button type="button" className="pn-text-btn pn-search__more" onClick={() => setTapped(q)}>
        Search more places
      </button>
    ) : null;
  }
  const response = answer?.query === q ? answer.response : null;
  if (!response) return null;
  if (response.status === "unavailable") return null;
  if (response.status !== "ok") return <Note testId="search-google-note">{NOTE[response.status]}</Note>;
  if (response.suggestions.length === 0) return null;

  const pick = async (s: GoogleSuggestion) => {
    const result = await resolveGooglePlace(s.placeId, token.current);
    if (result.status !== "ok") {
      setPicked({ query: q, title: s.title, problem: PICK_PROBLEM[result.status] });
      return;
    }
    // The session ends with the details call: the next search starts a new one.
    token.current = crypto.randomUUID();
    const endpoint: Endpoint = { point: result.point, label: s.title, place: "google" };
    if (purpose === "start" || purpose === "destination") onEndpoint(purpose, endpoint);
    else if (purpose === "save") onSave({ label: s.title, point: result.point, source: "google" });
    else setPicked({ query: q, title: s.title, endpoint });
  };
  const shownPick = picked?.query === q ? picked : null;

  return (
    <section className="pn-section" aria-labelledby={id} data-testid="search-google">
      <h2 id={id} className="pn-section__title">
        More places from Google
      </h2>
      <ul className="pn-group">
        {response.suggestions.map((s) => (
          <li key={s.placeId}>
            <button type="button" className="pn-cell pn-search__cell" onClick={() => void pick(s)} data-testid="search-result-google">
              <span className="pn-cell__text">
                <span className="pn-cell__title">{s.title}</span>
                {s.subtitle ? <span className="pn-cell__sub">{s.subtitle}</span> : null}
                <span className="pn-badge pn-badge--evidence">{GOOGLE_SUGGESTION_LABEL}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shownPick ? (
        <div className="pn-card pn-search__notice" role="status" data-testid="search-google-pick">
          <p className="pn-card__text">{shownPick.problem ?? `${shownPick.title}: location from a Google suggestion, not verified.`}</p>
          {shownPick.endpoint ? (
            <div className="pn-search__notice-actions">
              <button type="button" className="pn-btn pn-btn--secondary" onClick={() => onEndpoint("start", shownPick.endpoint!)}>
                Set as start
              </button>
              <button type="button" className="pn-btn pn-btn--secondary" onClick={() => onEndpoint("destination", shownPick.endpoint!)}>
                Set as destination
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="pn-footnote" data-testid="search-google-attribution">
        {GOOGLE_ATTRIBUTION}. What you typed was sent to Google to find these; ParaNaga does not store it.
      </p>
    </section>
  );
}
