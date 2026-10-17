import { listSavedPlaces, listSavedTrips, putSavedPlace, putSavedTrip } from "@/client/storage/db";
import type { SavedPlace, SavedTrip } from "@/domain/saved/saved";
import type { SavedPlacesResponseDto, SavedTripsResponseDto } from "@/domain/saved/sync-schemas";

export type SyncResult = {
  placesUploaded: number;
  placesDownloaded: number;
  tripsUploaded: number;
  tripsDownloaded: number;
};

/**
 * Two-way merge sync for signed-in commuters.
 * Device IndexedDB remains the primary offline source.
 * Local items are uploaded to the account; items on the account not on device are saved locally.
 */
export async function syncSavedItems(): Promise<SyncResult> {
  const localPlaces = await listSavedPlaces();
  const localTrips = await listSavedTrips();

  // 1. Fetch remote places
  let remotePlaces: SavedPlace[] = [];
  try {
    const res = await fetch("/api/v1/me/saved-places", { credentials: "same-origin" });
    if (res.ok) {
      const data: SavedPlacesResponseDto = await res.json();
      remotePlaces = data.places;
    }
  } catch {
    // offline or unauthenticated
  }

  // 2. Fetch remote trips
  let remoteTrips: SavedTrip[] = [];
  try {
    const res = await fetch("/api/v1/me/saved-trips", { credentials: "same-origin" });
    if (res.ok) {
      const data: SavedTripsResponseDto = await res.json();
      remoteTrips = data.trips;
    }
  } catch {
    // offline or unauthenticated
  }

  // 3. Upload local places to remote
  let placesUploaded = 0;
  if (localPlaces.records.length > 0) {
    try {
      const res = await fetch("/api/v1/me/saved-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places: localPlaces.records }),
        credentials: "same-origin",
      });
      if (res.ok) {
        placesUploaded = localPlaces.records.length;
      }
    } catch {
      // ignore network errors
    }
  }

  // 4. Download remote places missing locally
  let placesDownloaded = 0;
  const localPlaceIds = new Set(localPlaces.records.map((p) => p.id));
  for (const place of remotePlaces) {
    if (!localPlaceIds.has(place.id)) {
      try {
        await putSavedPlace(place);
        placesDownloaded += 1;
      } catch {
        // ignore storage errors
      }
    }
  }

  // 5. Upload local trips to remote
  let tripsUploaded = 0;
  if (localTrips.records.length > 0) {
    try {
      const res = await fetch("/api/v1/me/saved-trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trips: localTrips.records }),
        credentials: "same-origin",
      });
      if (res.ok) {
        tripsUploaded = localTrips.records.length;
      }
    } catch {
      // ignore network errors
    }
  }

  // 6. Download remote trips missing locally
  let tripsDownloaded = 0;
  const localTripIds = new Set(localTrips.records.map((t) => t.id));
  for (const trip of remoteTrips) {
    if (!localTripIds.has(trip.id)) {
      try {
        await putSavedTrip(trip);
        tripsDownloaded += 1;
      } catch {
        // ignore storage errors
      }
    }
  }

  return {
    placesUploaded,
    placesDownloaded,
    tripsUploaded,
    tripsDownloaded,
  };
}
