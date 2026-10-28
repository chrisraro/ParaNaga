import {
  clearPendingDeletes,
  listPendingDeletes,
  listSavedPlaces,
  listSavedTrips,
  putSavedPlace,
  putSavedTrip,
  type PendingDeletes,
} from "@/client/storage/db";
import type { SavedPlacesResponseDto, SavedTripsResponseDto } from "@/domain/saved/sync-schemas";

export type SyncResult = {
  placesUploaded: number;
  placesDownloaded: number;
  tripsUploaded: number;
  tripsDownloaded: number;
};

/** The account accepts at most this many items per request. */
const BATCH = 50;

/** Any failed request throws, so the screen shows "Sync failed" rather than "up to date". */
async function call<T>(kind: keyof PendingDeletes, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/me/saved-${kind}`, {
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`Sync ${method} ${kind} failed (${res.status}).`);
  return (await res.json()) as T;
}

async function inBatches<T>(items: T[], send: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) await send(items.slice(i, i + BATCH));
}

/**
 * Two-way merge sync for signed-in commuters.
 * Device IndexedDB remains the primary offline source.
 * Deletes made on this phone go to the account first (and stay queued until it confirms), local
 * items are uploaded, and items on the account not on device are saved locally.
 */
export async function syncSavedItems(): Promise<SyncResult> {
  const localPlaces = (await listSavedPlaces()).records;
  const localTrips = (await listSavedTrips()).records;
  const pending = await listPendingDeletes();

  const remotePlaces = (await call<SavedPlacesResponseDto>("places", "GET")).places;
  const remoteTrips = (await call<SavedTripsResponseDto>("trips", "GET")).trips;

  for (const kind of ["places", "trips"] as const) {
    await inBatches(pending[kind], (ids) => call(kind, "DELETE", { ids }));
    await clearPendingDeletes(kind, pending[kind]);
  }

  await inBatches(localPlaces, (places) => call("places", "POST", { places }));
  const localPlaceIds = new Set(localPlaces.map((p) => p.id));
  const newPlaces = remotePlaces.filter((p) => !localPlaceIds.has(p.id) && !pending.places.includes(p.id));
  for (const place of newPlaces) await putSavedPlace(place);

  await inBatches(localTrips, (trips) => call("trips", "POST", { trips }));
  const localTripIds = new Set(localTrips.map((t) => t.id));
  const newTrips = remoteTrips.filter((t) => !localTripIds.has(t.id) && !pending.trips.includes(t.id));
  for (const trip of newTrips) await putSavedTrip(trip);

  return {
    placesUploaded: localPlaces.length,
    placesDownloaded: newPlaces.length,
    tripsUploaded: localTrips.length,
    tripsDownloaded: newTrips.length,
  };
}
