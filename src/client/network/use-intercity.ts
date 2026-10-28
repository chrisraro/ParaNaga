"use client";

// The Leaving Naga guide of the published revision (IC1, S24): GET /api/v1/network/head for the
// revision, then GET /api/v1/network/intercity/:revisionId once per revision, validated with
// `intercitySchema` and kept in memory per revision. Mirrors use-lines.ts. The URLs carry the
// UUID revisionId only, never what the person typed.
//
// The worker keeps the guide CacheFirst (sw-routes INTERCITY) and the head NetworkFirst, so the
// screen opens offline after one visit; on a first visit the page's copies are offered to it
// (offerToWorker, via fetchRevisionJson). Not skipped when saving data: it is small (≈ 6 KB
// gzip) and only fetched when a screen that shows it is open.
//
// A failed head or guide request with a guide already in memory keeps that guide ("ready").
// Nothing in memory: "error", with `offline` when the browser says it has no connection.

import { useEffect, useSyncExternalStore } from "react";
import { rememberHead } from "@/client/network/remember-head";
import { fetchRevisionJson, offerToWorker, workerSeesRequests } from "@/client/pwa/data-handoff";
import { intercitySchema, networkHeadSchema, type Intercity } from "@/domain/api/schemas";

export type IntercityState =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ready"; data: Intercity }
  | { status: "error"; data: null; offline: boolean };

const IDLE: IntercityState = { status: "idle", data: null };

const byRevision = new Map<string, Intercity>();
let latest: Intercity | null = null;
let inflight: Promise<Intercity | null> | null = null;
let state: IntercityState = IDLE;
const listeners = new Set<() => void>();

function setState(next: IntercityState): void {
  if (state.status === next.status && state.data === next.data) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

async function headRevision(): Promise<string> {
  const url = "/api/v1/network/head";
  const sawRequest = workerSeesRequests();
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  const text = await response.text();
  const head = networkHeadSchema.parse(JSON.parse(text));
  offerToWorker(url, text, response.headers.get("Cache-Control"), sawRequest);
  rememberHead(head);
  return head.revisionId;
}

/** The guide held in memory (the latest one loaded this session), or null. */
export function heldIntercity(): Intercity | null {
  return latest;
}

/** Reads the head, then the guide of that revision (from memory when already loaded). */
export function loadIntercity(): Promise<Intercity | null> {
  if (inflight) return inflight;
  if (!latest) setState({ status: "loading", data: null });
  inflight = (async () => {
    const rev = await headRevision();
    let data = byRevision.get(rev);
    if (!data) {
      // An invalid payload (a damaged stored copy) is dropped and fetched once more.
      data = await fetchRevisionJson(`/api/v1/network/intercity/${encodeURIComponent(rev)}`, (raw) => {
        const parsed = intercitySchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      });
      byRevision.set(rev, data);
    }
    latest = data;
    setState({ status: "ready", data });
    return data;
  })()
    .catch(() => {
      if (latest) {
        setState({ status: "ready", data: latest });
        return latest;
      }
      setState({ status: "error", data: null, offline: isOffline() });
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** "Clear data on this device": drops the guides held in memory. */
export function forgetIntercity(): void {
  byRevision.clear();
  latest = null;
  inflight = null;
  setState(IDLE);
}

/** Tests only. */
export function resetIntercityForTests(): void {
  forgetIntercity();
  listeners.clear();
}

/**
 * Whether Leaving Naga has anything to show: the guide is ready and lists at least one destination.
 * The entry points (Explore card, Help row) render nothing while it loads or when it is empty
 * (before the owner publishes the intercity revision), so no link leads to an empty screen.
 */
export function useLeavingAvailable(): boolean {
  const state = useIntercity();
  return state.status === "ready" && state.data.destinations.length > 0;
}

/** The published guide; `enabled` false (e.g. Search's regional switch off) fetches nothing. */
export function useIntercity(enabled = true): IntercityState & { retry: () => void } {
  const current = useSyncExternalStore(subscribe, () => state, () => IDLE);
  useEffect(() => {
    // Once per mount: the head says whether a newer revision is published.
    if (enabled) void loadIntercity();
  }, [enabled]);
  const retry = () => void loadIntercity();
  if (!enabled) return { ...IDLE, retry };
  if (latest && current.status !== "ready") return { status: "ready", data: latest, retry };
  if (current.status === "idle") return { status: "loading", data: null, retry };
  return { ...current, retry };
}
