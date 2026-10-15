"use client";

// The network snapshot of the published revision (GET /api/v1/network/snapshot/:revisionId), one
// copy per page, shared by the home pins (decision D2), offline planning and the saved-trip check.
//
// Which revision: GET /api/v1/network/head (the service worker answers it from its cache when
// offline); if even that fails, the revision this phone last saw (IndexedDB snapshotMeta). The
// snapshot itself is immutable: the service worker keeps it (CacheFirst, keyed by revision and
// build), so it loads offline once it has been seen online. Validated with the shared schema.
//
// Reconnecting (`online`) checks the head again: a newly published revision is fetched and every
// subscriber (pins, saved-trip revalidation) sees it. Nothing here carries coordinates.

import { useEffect, useSyncExternalStore } from "react";
import { rememberHead } from "@/client/network/remember-head";
import { readSnapshotMeta } from "@/client/storage/db";
import { networkHeadSchema, networkSnapshotSchema, type NetworkSnapshot } from "@/domain/api/schemas";

export type SnapshotState =
  | { status: "idle" | "loading"; snapshot: null }
  | { status: "ready"; snapshot: NetworkSnapshot }
  | { status: "error"; snapshot: null };

const IDLE: SnapshotState = { status: "idle", snapshot: null };
let state: SnapshotState = IDLE;
let inflight: Promise<NetworkSnapshot | null> | null = null;
const listeners = new Set<() => void>();

function set(next: SnapshotState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.json();
}

async function currentRevisionId(): Promise<string | null> {
  try {
    const head = networkHeadSchema.parse(await getJson("/api/v1/network/head"));
    rememberHead(head);
    return head.revisionId;
  } catch {
    const meta = await readSnapshotMeta().catch(() => null);
    return meta?.revisionId ?? state.snapshot?.revision.revisionId ?? null;
  }
}

/**
 * Loads (or re-checks) the published snapshot. Resolves with the snapshot now held, which may be
 * the previous one when the network and the cache both failed; null when there is none.
 */
export function loadSnapshot(): Promise<NetworkSnapshot | null> {
  if (inflight) return inflight;
  if (state.snapshot === null) set({ status: "loading", snapshot: null });
  inflight = (async () => {
    const revisionId = await currentRevisionId();
    if (!revisionId) throw new Error("no revision known");
    if (state.snapshot?.revision.revisionId === revisionId) return state.snapshot;
    const snapshot = networkSnapshotSchema.parse(await getJson(`/api/v1/network/snapshot/${encodeURIComponent(revisionId)}`));
    set({ status: "ready", snapshot });
    return snapshot;
  })()
    .catch(() => {
      if (state.snapshot === null) set({ status: "error", snapshot: null });
      return state.snapshot;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The snapshot already in memory, if any (no request). */
export function heldSnapshot(): NetworkSnapshot | null {
  return state.snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function resetSnapshotForTests(): void {
  state = IDLE;
  inflight = null;
  listeners.clear();
}

/**
 * The published snapshot for a component; loads it on first use and re-checks it whenever the
 * browser comes back online. `enabled: false` neither loads nor re-checks (but still reads).
 */
export function useSnapshot(enabled = true): SnapshotState & { retry: () => void } {
  const current = useSyncExternalStore(subscribe, () => state, () => IDLE);
  useEffect(() => {
    if (!enabled) return undefined;
    if (state.status === "idle") void loadSnapshot();
    const recheck = () => void loadSnapshot();
    window.addEventListener("online", recheck);
    return () => window.removeEventListener("online", recheck);
  }, [enabled]);
  return { ...current, retry: () => void loadSnapshot() };
}
