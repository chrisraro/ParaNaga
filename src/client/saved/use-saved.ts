"use client";

// React access to the device database (src/client/storage/db.ts): saved trips, saved places and
// trip history, re-read after every write (this tab or another). `dropped` counts records that
// could not be read (kept in the store) so a screen can say so quietly. Plus the Saved screen's check of
// each saved trip against the published revision: GET /api/v1/network/head and, only when the
// revision changed, GET /api/v1/network/snapshot/:revisionId (immutable, kept for the session).
// Both GETs carry no coordinates; offline the check is skipped (the cards stay as saved).

import { useEffect, useState } from "react";
import { rememberHead } from "@/client/network/remember-head";
import { StorageUnavailableError, listHistory, listSavedPlaces, listSavedTrips, subscribeDeviceStore, type ListResult } from "@/client/storage/db";
import { networkHeadSchema, networkSnapshotSchema, type NetworkSnapshot } from "@/domain/api/schemas";
import { revalidateSavedTrip, type HistoryEntry, type SavedPlace, type SavedTrip, type SavedTripStatus } from "@/domain/saved/saved";

/** `error.unavailable`: no storage on this phone (blocked, private mode), not a read failure. */
export type DeviceList<T> =
  | { status: "loading" }
  | { status: "ready"; records: T[]; dropped: number }
  | { status: "error"; unavailable: boolean };

function useDeviceList<T>(load: () => Promise<ListResult<T>>, enabled = true): DeviceList<T> {
  const [state, setState] = useState<DeviceList<T>>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    // Unreadable records are kept in the store, so every read reports the same count.
    const read = () => {
      load().then(
        (result) => {
          if (live) setState({ status: "ready", records: result.records, dropped: result.dropped });
        },
        (error: unknown) => {
          if (live) setState({ status: "error", unavailable: error instanceof StorageUnavailableError });
        },
      );
    };
    read();
    const off = subscribeDeviceStore(read);
    return () => {
      live = false;
      off();
    };
    // `load` is a module function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return state;
}

export const useSavedTrips = (): DeviceList<SavedTrip> => useDeviceList(listSavedTrips);
export const useSavedPlaces = (): DeviceList<SavedPlace> => useDeviceList(listSavedPlaces);
/** Read only while `enabled` (history on): with history off the store is never opened for it. */
export const useHistoryList = (enabled: boolean): DeviceList<HistoryEntry> => useDeviceList(() => listHistory(), enabled);

// ---------------------------------------------------------------- revalidation

const snapshots = new Map<string, Pick<NetworkSnapshot, "revision" | "stops" | "variants">>();

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.json();
}

/** Status per saved trip id against the published revision; empty until known (or offline). */
export function useTripRevalidation(trips: readonly SavedTrip[] | null): ReadonlyMap<string, SavedTripStatus> {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, SavedTripStatus>>(() => new Map());
  const signature = trips ? trips.map((t) => `${t.id}@${t.revisionId}`).join(",") : null;
  useEffect(() => {
    if (!trips || trips.length === 0) return undefined;
    const controller = new AbortController();
    (async () => {
      const head = networkHeadSchema.parse(await getJson("/api/v1/network/head", controller.signal));
      rememberHead(head);
      const result = new Map<string, SavedTripStatus>();
      const stale = trips.filter((t) => t.revisionId !== head.revisionId);
      for (const t of trips) if (t.revisionId === head.revisionId) result.set(t.id, "current");
      if (stale.length > 0) {
        let snapshot = snapshots.get(head.revisionId);
        if (!snapshot) {
          const full = networkSnapshotSchema.parse(await getJson(`/api/v1/network/snapshot/${encodeURIComponent(head.revisionId)}`, controller.signal));
          snapshot = { revision: full.revision, stops: full.stops, variants: full.variants };
          snapshots.set(head.revisionId, snapshot);
        }
        for (const t of stale) result.set(t.id, revalidateSavedTrip(t, snapshot));
      }
      if (!controller.signal.aborted) setStatuses(result);
    })().catch(() => undefined); // offline or failed: the cards stay as saved, without a verdict
    return () => controller.abort();
    // Keyed by the trips' ids and revisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return statuses;
}
