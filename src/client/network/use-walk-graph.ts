"use client";

// Lazy on-device walk graph loader (GET /api/v1/network/walk-graph/:revisionId, Task 10 / D18).
//
// Rules:
//  - Loaded only after a trip plan exists (`revisionId` non-null and `enabled` true).
//  - Skipped when the person asked to save data (`savingData()`: Low-data mode preference or
//    `navigator.connection.saveData === true`), unless that revision is already decoded in memory.
//  - URL carries only the validated UUID revisionId — never coordinates or query strings.
//  - Validated and decoded once per revision with `parseWalkGraph`, kept in memory, and offered to
//    the service worker on the first visit via `offerToWorker`.

import { useEffect, useSyncExternalStore } from "react";
import { usePrefs } from "@/client/prefs/use-prefs";
import { offerToWorker, workerSeesRequests } from "@/client/pwa/data-handoff";
import { savingData } from "@/client/pwa/prefetch-index";
import { parseUuidParam } from "@/domain/api/schemas";
import { parseWalkGraph, type WalkGraph } from "@/domain/walk/walk-graph";

export type WalkGraphState =
  | { status: "idle"; graph: null; revisionId: null }
  | { status: "loading"; graph: null; revisionId: string }
  | { status: "ready"; graph: WalkGraph; revisionId: string }
  | { status: "skipped"; graph: null; revisionId: string }
  | { status: "error"; graph: null; revisionId: string };

const IDLE: WalkGraphState = { status: "idle", graph: null, revisionId: null };

const byRevision = new Map<string, WalkGraph>();
const inflightByRevision = new Map<string, Promise<WalkGraph | null>>();
let state: WalkGraphState = IDLE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function setState(next: WalkGraphState): void {
  if (state.status === next.status && state.graph === next.graph && state.revisionId === next.revisionId) return;
  state = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The decoded walk graph already held in memory for `revisionId` (or the current one). */
export function heldWalkGraph(revisionId?: string | null): WalkGraph | null {
  if (revisionId) {
    const parsed = parseUuidParam(revisionId, "revisionId");
    return parsed.ok ? (byRevision.get(parsed.value) ?? null) : null;
  }
  return state.graph;
}

/**
 * Loads and decodes the walk graph for `revisionId` (unless saving data). Resolves with the
 * decoded graph or null on error / skip.
 */
export function loadWalkGraph(revisionId: string): Promise<WalkGraph | null> {
  const parsedRev = parseUuidParam(revisionId, "revisionId");
  if (!parsedRev.ok) {
    setState({ status: "error", graph: null, revisionId });
    return Promise.resolve(null);
  }
  const rev = parsedRev.value;
  const cached = byRevision.get(rev);
  if (cached) {
    setState({ status: "ready", graph: cached, revisionId: rev });
    return Promise.resolve(cached);
  }
  if (savingData()) {
    setState({ status: "skipped", graph: null, revisionId: rev });
    return Promise.resolve(null);
  }
  const existing = inflightByRevision.get(rev);
  if (existing) return existing;

  setState({ status: "loading", graph: null, revisionId: rev });
  const url = `/api/v1/network/walk-graph/${encodeURIComponent(rev)}`;
  const sawRequest = workerSeesRequests();
  const promise = (async () => {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
    const text = await response.text();
    const raw: unknown = JSON.parse(text);
    const decoded = parseWalkGraph(raw);
    if (!decoded.ok) throw new Error(decoded.error);
    offerToWorker(url, text, response.headers.get("Cache-Control"), sawRequest);
    byRevision.set(rev, decoded.graph);
    setState({ status: "ready", graph: decoded.graph, revisionId: rev });
    return decoded.graph;
  })()
    .catch(() => {
      setState({ status: "error", graph: null, revisionId: rev });
      return null;
    })
    .finally(() => {
      inflightByRevision.delete(rev);
    });

  inflightByRevision.set(rev, promise);
  return promise;
}

/** "Clear data on this device": drops any walk graphs held in memory. */
export function forgetWalkGraph(): void {
  byRevision.clear();
  inflightByRevision.clear();
  setState(IDLE);
}

/** Tests only. */
export function resetWalkGraphForTests(): void {
  forgetWalkGraph();
  listeners.clear();
}

export function useWalkGraph(revisionId: string | null | undefined, enabled = true): WalkGraphState & { retry: () => void } {
  const prefs = usePrefs();
  const current = useSyncExternalStore(subscribe, () => state, () => IDLE);
  const parsedRev = revisionId ? parseUuidParam(revisionId, "revisionId") : null;
  const rev = parsedRev?.ok ? parsedRev.value : null;
  const saveData = savingData();

  useEffect(() => {
    if (!enabled || !rev) return;
    if (byRevision.has(rev)) {
      setState({ status: "ready", graph: byRevision.get(rev)!, revisionId: rev });
      return;
    }
    if (saveData) {
      setState({ status: "skipped", graph: null, revisionId: rev });
      return;
    }
    void loadWalkGraph(rev);
  }, [enabled, rev, saveData, prefs.lowData]);

  const retry = () => {
    if (rev) void loadWalkGraph(rev);
  };

  if (!enabled || !rev) return { ...IDLE, retry };
  const inMemory = byRevision.get(rev);
  if (inMemory) return { status: "ready", graph: inMemory, revisionId: rev, retry };
  if (saveData) return { status: "skipped", graph: null, revisionId: rev, retry };
  if (current.revisionId === rev) return { ...current, retry };
  return { status: "loading", graph: null, revisionId: rev, retry };
}
