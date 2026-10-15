"use client";

// The search index of the published revision (decision D1): GET /api/v1/network/head for the
// revision, then GET /api/v1/network/search-index/:revisionId once per revision, validated with
// the shared Zod schema and kept in memory for the session. Queries never leave the browser:
// these two GETs carry no query text. (The service worker of Task 12 adds a persistent copy; its
// cache key must include the build, see the Task 4 review.)
//
// A failed head or index request with an index already in memory: that index is used, and
// `problem` says why the data may be old: "offline" only when the browser says it has no
// connection (navigator.onLine false), else "failed" (a 5xx, a bad response). Nothing in memory:
// "error", with the same distinction.

import { useEffect, useState } from "react";
import { networkHeadSchema, searchIndexSchema, type SearchIndex } from "@/domain/api/schemas";
import { rememberHead } from "@/client/network/remember-head";

export type SearchProblem = "offline" | "failed";

export type SearchIndexState =
  | { status: "loading" }
  | { status: "ready"; index: SearchIndex; problem: SearchProblem | null }
  | { status: "error"; problem: SearchProblem };

const problemNow = (): SearchProblem => (typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed");

const byRevision = new Map<string, SearchIndex>();
let latest: SearchIndex | null = null;

/** Tests only: forget the session's indexes. */
export function resetSearchIndexCache(): void {
  byRevision.clear();
  latest = null;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.json();
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

export function useSearchIndex(): SearchIndexState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  // An index already loaded this session shows at once while the head is checked again.
  const [state, setState] = useState<SearchIndexState>(() => (latest ? { status: "ready", index: latest, problem: null } : { status: "loading" }));

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

  const retry = () => {
    // Results already shown stay while retrying; only an empty screen shows the skeleton.
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    setAttempt((n) => n + 1);
  };
  return { ...state, retry };
}
