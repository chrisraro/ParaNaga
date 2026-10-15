"use client";

// React access to the device database (src/client/storage/db.ts): saved trips, saved places and
// trip history, re-read after every write (this tab or another). `dropped` counts records that
// could not be read (kept in the store) so a screen can say so quietly. Plus the Saved screen's check of
// each saved trip against the published revision, through the shared network snapshot
// (src/client/network/use-snapshot.ts). Neither request carries coordinates.

import { useEffect, useMemo, useState } from "react";
import { loadSnapshot, useSnapshot } from "@/client/network/use-snapshot";
import { StorageUnavailableError, listHistory, listSavedPlaces, listSavedTrips, subscribeDeviceStore, type ListResult } from "@/client/storage/db";
import { revalidateSavedTrip, type HistoryEntry, type SavedPlace, type SavedTrip, type SavedTripStatus } from "@/domain/saved/saved";

/** `error.unavailable`: no storage on this phone (blocked, private mode), not a read failure. */
export type DeviceList<T> =
  | { status: "loading" }
  | { status: "ready"; records: T[]; dropped: number; unreadable: number }
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
          if (live) setState({ status: "ready", records: result.records, dropped: result.dropped, unreadable: result.unreadable });
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

/**
 * Status per saved trip id against the published revision; empty until known. Uses the shared
 * snapshot (use-snapshot.ts): its head is checked again whenever this mounts with trips and
 * whenever the browser comes back online, so a revision published while the phone was offline
 * flags the changed cards on reconnect. Offline, the service worker answers with the data this
 * phone last saw.
 */
export function useTripRevalidation(trips: readonly SavedTrip[] | null): ReadonlyMap<string, SavedTripStatus> {
  const hasTrips = trips !== null && trips.length > 0;
  const { snapshot } = useSnapshot(hasTrips);
  useEffect(() => {
    if (hasTrips) void loadSnapshot();
  }, [hasTrips]);
  const signature = trips ? trips.map((t) => `${t.id}@${t.revisionId}`).join(",") : null;
  return useMemo(() => {
    const result = new Map<string, SavedTripStatus>();
    if (!trips || !snapshot) return result;
    for (const t of trips) result.set(t.id, t.revisionId === snapshot.revision.revisionId ? "current" : revalidateSavedTrip(t, snapshot));
    return result;
    // Keyed by the trips' ids and revisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, snapshot]);
}
