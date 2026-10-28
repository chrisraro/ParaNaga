"use client";

// "Save" / "Saved" for one trip (Trip detail's Save, Arrive's "Save this trip"): the one place
// that decides, against this phone's saved trips, whether the trip is saved, saved on older data
// (offer to update the copy, atomically) or not saved, and what a tap does.

import { useState } from "react";
import { deleteSavedTrip, putSavedTrip, replaceSavedTrip } from "@/client/storage/db";
import { useT } from "@/i18n/provider";
import { useSavedTrips } from "@/client/saved/use-saved";
import type { LatLng } from "@/domain/geo/types";
import { matchSavedTrip, type SavedTripMatch, type SavedTrip } from "@/domain/saved/saved";

export type SavedTripTarget = { optionId: string; start: LatLng; destination: LatLng; revisionId: string };

export type SavedTripToggle = {
  /** null while the saved trips load. */
  match: SavedTripMatch | null;
  kind: SavedTripMatch["kind"];
  /** A save is running, or the list is still loading. */
  waiting: boolean;
  /** No storage on this phone. */
  unavailable: boolean;
  /** Saved → remove; saved on older data → replace the copy; not saved → save. */
  toggle: () => Promise<void>;
};

/** `newCard` builds a fresh card (new id and date) for a save; `onStatus` gets the outcome line. */
export function useSavedTripToggle(target: SavedTripTarget, newCard: () => SavedTrip, onStatus: (status: string) => void): SavedTripToggle {
  const t = useT().saved;
  const trips = useSavedTrips();
  const [busy, setBusy] = useState(false);
  const match = trips.status === "ready" ? matchSavedTrip(trips.records, target.optionId, target.start, target.destination, target.revisionId) : null;
  const waiting = busy || trips.status === "loading";
  const unavailable = trips.status === "error" && trips.unavailable;

  const toggle = async () => {
    if (waiting || unavailable || !match) return;
    setBusy(true);
    onStatus("");
    try {
      if (match.kind === "saved") {
        await deleteSavedTrip(match.trip.id);
        onStatus(t.tripRemoved);
      } else if (match.kind === "older") {
        await replaceSavedTrip(match.trip.id, newCard());
        onStatus(t.tripUpdated);
      } else {
        await putSavedTrip(newCard());
        onStatus(t.tripSaved);
      }
    } catch {
      onStatus(t.tripSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  return { match, kind: match?.kind ?? "none", waiting, unavailable, toggle };
}
