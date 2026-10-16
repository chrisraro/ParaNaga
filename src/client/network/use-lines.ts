"use client";

// Published approximate route lines (GET /api/v1/network/lines/:revisionId, Task 10 / D18).
//
// Fetched alongside the snapshot when map lines are shown, skipped automatically when saving data
// (`savingData()`), validated with `linesSchema`, cached in memory per revision, and offered to
// the service worker on first visit via `offerToWorker`. URL carries the UUID revisionId only.

import { useEffect, useSyncExternalStore } from "react";
import { usePrefs } from "@/client/prefs/use-prefs";
import { offerToWorker, workerSeesRequests } from "@/client/pwa/data-handoff";
import { savingData } from "@/client/pwa/prefetch-index";
import { linesSchema, parseUuidParam, type Lines } from "@/domain/api/schemas";

export type LinesState =
  | { status: "idle"; lines: null; revisionId: null }
  | { status: "loading"; lines: null; revisionId: string }
  | { status: "ready"; lines: Lines; revisionId: string }
  | { status: "skipped"; lines: null; revisionId: string }
  | { status: "error"; lines: null; revisionId: string };

const IDLE: LinesState = { status: "idle", lines: null, revisionId: null };

const byRevision = new Map<string, Lines>();
const inflightByRevision = new Map<string, Promise<Lines | null>>();
let state: LinesState = IDLE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function setState(next: LinesState): void {
  if (state.status === next.status && state.lines === next.lines && state.revisionId === next.revisionId) return;
  state = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The lines object already held in memory for `revisionId` (or the latest one). */
export function heldLines(revisionId?: string | null): Lines | null {
  if (revisionId) {
    const parsed = parseUuidParam(revisionId, "revisionId");
    return parsed.ok ? (byRevision.get(parsed.value) ?? null) : null;
  }
  return state.lines;
}

/**
 * Loads and validates the lines for `revisionId` (skipped when saving data unless `force` is set).
 */
export function loadLines(revisionId: string, opts?: { force?: boolean }): Promise<Lines | null> {
  const parsedRev = parseUuidParam(revisionId, "revisionId");
  if (!parsedRev.ok) {
    setState({ status: "error", lines: null, revisionId });
    return Promise.resolve(null);
  }
  const rev = parsedRev.value;
  const cached = byRevision.get(rev);
  if (cached) {
    setState({ status: "ready", lines: cached, revisionId: rev });
    return Promise.resolve(cached);
  }
  if (!opts?.force && savingData()) {
    setState({ status: "skipped", lines: null, revisionId: rev });
    return Promise.resolve(null);
  }
  const existing = inflightByRevision.get(rev);
  if (existing) return existing;

  setState({ status: "loading", lines: null, revisionId: rev });
  const url = `/api/v1/network/lines/${encodeURIComponent(rev)}`;
  const sawRequest = workerSeesRequests();
  const promise = (async () => {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
    const text = await response.text();
    const raw: unknown = JSON.parse(text);
    const parsed = linesSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.message);
    offerToWorker(url, text, response.headers.get("Cache-Control"), sawRequest);
    byRevision.set(rev, parsed.data);
    setState({ status: "ready", lines: parsed.data, revisionId: rev });
    return parsed.data;
  })()
    .catch(() => {
      setState({ status: "error", lines: null, revisionId: rev });
      return null;
    })
    .finally(() => {
      inflightByRevision.delete(rev);
    });

  inflightByRevision.set(rev, promise);
  return promise;
}

/** "Clear data on this device": drops any lines held in memory. */
export function forgetLines(): void {
  byRevision.clear();
  inflightByRevision.clear();
  setState(IDLE);
}

/** Tests only. */
export function resetLinesForTests(): void {
  forgetLines();
  listeners.clear();
}

export function useLines(revisionId: string | null | undefined, enabled = true): LinesState & { retry: () => void } {
  const prefs = usePrefs();
  const current = useSyncExternalStore(subscribe, () => state, () => IDLE);
  const parsedRev = revisionId ? parseUuidParam(revisionId, "revisionId") : null;
  const rev = parsedRev?.ok ? parsedRev.value : null;
  const saveData = savingData();

  useEffect(() => {
    if (!enabled || !rev) return;
    if (byRevision.has(rev)) {
      setState({ status: "ready", lines: byRevision.get(rev)!, revisionId: rev });
      return;
    }
    if (saveData) {
      setState({ status: "skipped", lines: null, revisionId: rev });
      return;
    }
    void loadLines(rev);
  }, [enabled, rev, saveData, prefs.lowData]);

  const retry = () => {
    if (rev) void loadLines(rev, { force: true });
  };

  if (!enabled || !rev) return { ...IDLE, retry };
  const inMemory = byRevision.get(rev);
  if (inMemory) return { status: "ready", lines: inMemory, revisionId: rev, retry };
  if (saveData) return { status: "skipped", lines: null, revisionId: rev, retry };
  if (current.revisionId === rev) return { ...current, retry };
  return { status: "loading", lines: null, revisionId: rev, retry };
}
