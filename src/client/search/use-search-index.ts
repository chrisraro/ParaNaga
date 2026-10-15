"use client";

// The search index of the published revision (decision D1): GET /api/v1/network/head for the
// revision, then GET /api/v1/network/search-index/:revisionId once per revision, validated with
// the shared Zod schema and kept in memory for the session. Queries never leave the browser:
// these two GETs carry no query text. (The service worker of Task 12 adds a persistent copy; its
// cache key must include the build, see the Task 4 review.)
//
// Offline (head or index request fails) with an index already in memory: that index is used and
// `offline` is true, so the screen says which data it is searching. Nothing in memory: "error".

import { useEffect, useState } from "react";
import { networkHeadSchema, searchIndexSchema, type SearchIndex } from "@/domain/api/schemas";

export type SearchIndexState =
  | { status: "loading" }
  | { status: "ready"; index: SearchIndex; offline: boolean }
  | { status: "error" };

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

async function loadIndex(signal: AbortSignal): Promise<{ index: SearchIndex; offline: boolean }> {
  try {
    const head = networkHeadSchema.parse(await getJson("/api/v1/network/head", signal));
    let index = byRevision.get(head.revisionId);
    if (!index) {
      index = searchIndexSchema.parse(await getJson(`/api/v1/network/search-index/${encodeURIComponent(head.revisionId)}`, signal));
      byRevision.set(head.revisionId, index);
    }
    latest = index;
    return { index, offline: false };
  } catch (error) {
    if (!signal.aborted && latest) return { index: latest, offline: true };
    throw error;
  }
}

export function useSearchIndex(): SearchIndexState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  // An index already loaded this session shows at once while the head is checked again.
  const [state, setState] = useState<SearchIndexState>(() => (latest ? { status: "ready", index: latest, offline: false } : { status: "loading" }));

  useEffect(() => {
    const controller = new AbortController();
    loadIndex(controller.signal).then(
      ({ index, offline }) => {
        if (!controller.signal.aborted) setState({ status: "ready", index, offline });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };
  return { ...state, retry };
}
