"use client";

// Lazy on-device walk graph loader (GET /api/v1/network/walk-graph/:revisionId, Task 10 / D18).
//
// Rules:
//  - Loaded only after a trip plan exists (`revisionId` non-null and `enabled` true).
//  - Not downloaded when the person asked to save data (`savingData()`: Low-data mode preference or
//    `navigator.connection.saveData === true`); a copy the service worker already stored is still
//    used (no network). Otherwise "skipped".
//  - URL carries only the validated UUID revisionId — never coordinates or query strings.
//  - Validated and decoded once per revision with `parseWalkGraph`, kept in memory, and offered to
//    the service worker on the first visit via `offerToWorker`. The worker keeps it (CacheFirst,
//    Task 15), so later visits draw street paths offline. A payload the validator rejects is
//    dropped from the caches and fetched once more (fetchRevisionJson), never trusted.
//  - Offline with no stored copy: "offline" (walks say street paths need a connection the first
//    time), and it loads by itself when the connection comes back.
//  - Low-data opt-in (Task 15 follow-up): while saving data with no stored copy ("skipped"), trip
//    detail offers "Download street paths (≈ 80 KB)". Only that tap fetches it
//    (`downloadWalkGraph`); the worker then keeps it, so later low-data trips use the stored copy.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePrefs } from "@/client/prefs/use-prefs";
import { decodeJson, fetchRevisionJson, readStoredCopy } from "@/client/pwa/data-handoff";
import { savingData } from "@/client/pwa/prefetch-index";
import { parseUuidParam } from "@/domain/api/schemas";
import type { PlanOptionDto } from "@/domain/api/plan";
import { walkPathLengths } from "@/domain/trip/enrich";
import { parseWalkGraph, type WalkGraph } from "@/domain/walk/walk-graph";

export type WalkGraphState =
  | { status: "idle"; graph: null; revisionId: null }
  | { status: "loading"; graph: null; revisionId: string }
  | { status: "ready"; graph: WalkGraph; revisionId: string }
  | { status: "skipped"; graph: null; revisionId: string }
  | { status: "error"; graph: null; revisionId: string }
  | { status: "offline"; graph: null; revisionId: string };

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

const decodeGraph = (raw: unknown): WalkGraph | null => {
  const decoded = parseWalkGraph(raw);
  return decoded.ok ? decoded.graph : null;
};

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Loads and decodes the walk graph for `revisionId` (when saving data: only a stored copy).
 * Resolves with the decoded graph or null on error / skip / offline.
 */
export function loadWalkGraph(revisionId: string, opts: { force?: boolean } = {}): Promise<WalkGraph | null> {
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
  const existing = inflightByRevision.get(rev);
  if (existing) return existing;

  const url = `/api/v1/network/walk-graph/${encodeURIComponent(rev)}`;
  // force: the person tapped "Download street paths" (fetch although saving data).
  const saving = !opts.force && savingData();
  if (!saving) setState({ status: "loading", graph: null, revisionId: rev });
  const promise = (async () => {
    if (saving) {
      const stored = await readStoredCopy(url);
      const graph = stored === null ? null : decodeJson(stored, decodeGraph);
      if (!graph) {
        setState({ status: isOffline() ? "offline" : "skipped", graph: null, revisionId: rev });
        return null;
      }
      byRevision.set(rev, graph);
      setState({ status: "ready", graph, revisionId: rev });
      return graph;
    }
    const graph = await fetchRevisionJson(url, decodeGraph);
    byRevision.set(rev, graph);
    setState({ status: "ready", graph, revisionId: rev });
    return graph;
  })()
    .catch(() => {
      setState({ status: isOffline() ? "offline" : "error", graph: null, revisionId: rev });
      return null;
    })
    .finally(() => {
      inflightByRevision.delete(rev);
    });

  inflightByRevision.set(rev, promise);
  return promise;
}

/** Low-data opt-in: fetches the walk graph once over the network (a tap), and the worker keeps it. */
export function downloadWalkGraph(revisionId: string): Promise<WalkGraph | null> {
  return loadWalkGraph(revisionId, { force: true });
}

/** Approximate download size of a walk graph, for the opt-in button. */
export const WALK_GRAPH_DOWNLOAD_LABEL = "Download street paths (≈ 80 KB)";

/**
 * The low-data opt-in for `revisionId`: offered while the graph was skipped to save data (no
 * stored copy, not offline). `download` runs only on a tap; `failed` after a download that did not
 * arrive (the button stays, to try again).
 */
export function useWalkGraphDownload(revisionId: string | null | undefined): { offer: boolean; busy: boolean; failed: boolean; download: () => Promise<boolean> } {
  const current = useSyncExternalStore(subscribe, () => state, () => IDLE);
  const [attempt, setAttempt] = useState<"idle" | "busy" | "failed">("idle");
  const parsedRev = revisionId ? parseUuidParam(revisionId, "revisionId") : null;
  const rev = parsedRev?.ok ? parsedRev.value : null;
  const held = rev !== null && byRevision.has(rev);
  const skipped = rev !== null && current.revisionId === rev && (current.status === "skipped" || (attempt !== "idle" && current.status === "error"));
  const download = async () => {
    if (!rev || attempt === "busy") return false;
    setAttempt("busy");
    const graph = await downloadWalkGraph(rev);
    setAttempt(graph ? "idle" : "failed");
    return graph !== null;
  };
  return { offer: !held && (skipped || attempt === "busy"), busy: attempt === "busy", failed: attempt === "failed", download };
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
    if (!enabled || !rev) return undefined;
    void loadWalkGraph(rev);
    // Offline without a stored copy: try again as soon as the connection comes back.
    const onOnline = () => {
      if (!byRevision.has(rev)) void loadWalkGraph(rev);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [enabled, rev, saveData, prefs.lowData]);

  const retry = () => {
    if (rev) void loadWalkGraph(rev);
  };

  if (!enabled || !rev) return { ...IDLE, retry };
  const inMemory = byRevision.get(rev);
  if (inMemory) return { status: "ready", graph: inMemory, revisionId: rev, retry };
  if (current.revisionId === rev && current.status !== "ready") return { ...current, retry };
  return saveData ? { status: "skipped", graph: null, revisionId: rev, retry } : { status: "loading", graph: null, revisionId: rev, retry };
}

/**
 * The decoded walk graph for `revisionId` from memory or the copy the worker stored; never the
 * network (a saved card must not download 80 KB by being listed). Null when there is none.
 */
export async function storedWalkGraph(revisionId: string): Promise<WalkGraph | null> {
  const parsedRev = parseUuidParam(revisionId, "revisionId");
  if (!parsedRev.ok) return null;
  const rev = parsedRev.value;
  const held = byRevision.get(rev);
  if (held) return held;
  const stored = await readStoredCopy(`/api/v1/network/walk-graph/${encodeURIComponent(rev)}`);
  const graph = stored === null ? null : decodeJson(stored, decodeGraph);
  if (graph) byRevision.set(rev, graph);
  return graph;
}

/**
 * Walk-graph path lengths for a saved trip's walks when that revision's graph is cached on this
 * phone (so the saved estimate matches trip options); all null until then and without a copy.
 */
export function useSavedWalkLengths(option: PlanOptionDto, revisionId: string): (number | null)[] {
  const [graph, setGraph] = useState<WalkGraph | null>(() => heldWalkGraph(revisionId));
  useEffect(() => {
    let live = true;
    void storedWalkGraph(revisionId).then((g) => {
      if (live && g) setGraph(g);
    });
    return () => {
      live = false;
    };
  }, [revisionId]);
  return useMemo(() => walkPathLengths(option, graph), [option, graph]);
}
