"use client";

// The search index of the published revision (decision D1): GET /api/v1/network/head for the
// revision, then GET /api/v1/network/search-index/:revisionId once per revision, validated with
// the shared Zod schema and kept in memory for the session. Queries never leave the browser:
// these two GETs carry no query text. The service worker (Task 12) keeps a persistent copy per
// revision (in the URL) and build (in its cache name), so search works offline.
//
// Task 14: the named places outside the D10 categories (restaurants, shops, banks …) are a second,
// lazy chunk: GET /api/v1/network/search-places/:revisionId, fetched only after the index is ready
// (the first paint does not wait for it) and merged into `index.osmPlaces`. `morePlaces` says where
// it stands; a failed chunk leaves the core index working.
//
// A failed head or index request with an index already in memory: that index is used, and
// `problem` says why the data may be old: "offline" only when the browser says it has no
// connection (navigator.onLine false), else "failed" (a 5xx, a bad response). Nothing in memory:
// "error", with the same distinction.

import { useEffect, useMemo, useState } from "react";
import { networkHeadSchema, searchIndexSchema, searchPlacesSchema, type SearchIndex, type SearchOsmPlace } from "@/domain/api/schemas";
import { rememberHead } from "@/client/network/remember-head";
import { offerToWorker, workerSeesRequests } from "@/client/pwa/data-handoff";

export type SearchProblem = "offline" | "failed";

export type MorePlacesState = "loading" | "ready" | "failed";

export type SearchIndexState =
  | { status: "loading" }
  | { status: "ready"; index: SearchIndex; problem: SearchProblem | null; morePlaces: MorePlacesState }
  | { status: "error"; problem: SearchProblem };

const problemNow = (): SearchProblem => (typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed");

const byRevision = new Map<string, SearchIndex>();
const placesByRevision = new Map<string, SearchOsmPlace[]>();
let latest: SearchIndex | null = null;

/** Tests only (and "Delete data on this device"): forget the session's indexes. */
export function resetSearchIndexCache(): void {
  byRevision.clear();
  placesByRevision.clear();
  latest = null;
}

/** The lazy named-places chunk of a revision, kept in memory for the session. */
async function loadMorePlaces(revisionId: string, signal: AbortSignal): Promise<void> {
  if (placesByRevision.has(revisionId)) return;
  const body = searchPlacesSchema.parse(await getJson(`/api/v1/network/search-places/${encodeURIComponent(revisionId)}`, signal));
  placesByRevision.set(revisionId, body.places);
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const sawRequest = workerSeesRequests();
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  const text = await response.text();
  const body: unknown = JSON.parse(text);
  // First visit: the worker did not see this response; give it the page's copy.
  offerToWorker(url, text, response.headers.get("Cache-Control"), sawRequest);
  return body;
}

async function loadIndex(signal: AbortSignal): Promise<{ index: SearchIndex; problem: SearchProblem | null }> {
  try {
    const head = networkHeadSchema.parse(await getJson("/api/v1/network/head", signal));
    rememberHead(head);
    let index = byRevision.get(head.revisionId);
    if (!index) {
      index = searchIndexSchema.parse(await getJson(`/api/v1/network/search-index/${encodeURIComponent(head.revisionId)}`, signal));
      byRevision.set(head.revisionId, index);
    }
    latest = index;
    return { index, problem: null };
  } catch (error) {
    if (!signal.aborted && latest) return { index: latest, problem: problemNow() };
    throw error;
  }
}

type CoreState = { status: "loading" } | { status: "ready"; index: SearchIndex; problem: SearchProblem | null } | { status: "error"; problem: SearchProblem };

export function useSearchIndex(): SearchIndexState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  // An index already loaded this session shows at once while the head is checked again.
  const [state, setState] = useState<CoreState>(() => (latest ? { status: "ready", index: latest, problem: null } : { status: "loading" }));
  // The lazy chunk: a tick re-renders when it arrives; `failedFor` is the revision whose chunk failed.
  const [, setArrived] = useState(0);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadIndex(controller.signal).then(
      ({ index, problem }) => {
        if (!controller.signal.aborted) setState({ status: "ready", index, problem });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: "error", problem: problemNow() });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const revisionId = state.status === "ready" ? state.index.revision.revisionId : null;
  useEffect(() => {
    if (!revisionId || placesByRevision.has(revisionId)) return;
    const controller = new AbortController();
    loadMorePlaces(revisionId, controller.signal).then(
      () => {
        if (!controller.signal.aborted) setArrived((n) => n + 1);
      },
      () => {
        if (!controller.signal.aborted) setFailedFor(revisionId);
      },
    );
    return () => controller.abort();
  }, [revisionId, attempt]);

  const places = revisionId ? placesByRevision.get(revisionId) : undefined;
  const core = state.status === "ready" ? state.index : null;
  const index = useMemo(() => (core && places ? { ...core, osmPlaces: [...core.osmPlaces, ...places] } : core), [core, places]);

  const retry = () => {
    // Results already shown stay while retrying; only an empty screen shows the skeleton.
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    setFailedFor(null);
    setAttempt((n) => n + 1);
  };
  if (state.status !== "ready" || !index) return { ...(state as Exclude<CoreState, { status: "ready" }>), retry };
  const morePlaces: MorePlacesState = places ? "ready" : failedFor === revisionId ? "failed" : "loading";
  return { status: "ready", index, problem: state.problem, morePlaces, retry };
}
