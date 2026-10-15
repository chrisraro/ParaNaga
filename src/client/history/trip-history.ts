"use client";

// Trip history on this device (decision D3), in the IndexedDB "history" store (src/client/storage/db.ts).
// Off by default: nothing is recorded unless the user turned history on (Settings → Trip history).
// An entry is two labels and a date, never coordinates, recorded when guidance starts (Task 10
// calls recordTrip) and pruned after 90 days. Settings asks through hasHistory / clearHistory
// whether to delete what exists when history is turned off.

import { addHistoryEntry, clearHistoryStore, countHistory } from "@/client/storage/db";
import { readPrefs } from "@/client/prefs/use-prefs";

/** True when this device holds at least one trip-history entry. */
export async function hasHistory(): Promise<boolean> {
  return (await countHistory()) > 0;
}

/** Deletes every trip-history entry on this device. */
export async function clearHistory(): Promise<void> {
  await clearHistoryStore();
}

/**
 * Records "{from} → {to}" now, only while history is on; returns whether it did. Labels only:
 * the caller passes the endpoints' labels, never their points.
 */
export async function recordTrip(from: string, to: string, now = new Date()): Promise<boolean> {
  if (!readPrefs().historyEnabled) return false;
  await addHistoryEntry({ id: crypto.randomUUID(), from, to, at: now.toISOString() });
  return true;
}
