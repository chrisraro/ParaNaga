"use client";

// Trip history on this device (decision D3). The store itself arrives with Saved → History
// (Task 8, IndexedDB); until then there is never any history to find or delete. Settings already
// asks through these two functions, so the "Also delete the history on this phone?" question
// appears as soon as history exists.

/** True when this device holds at least one trip-history entry. */
export async function hasHistory(): Promise<boolean> {
  return false;
}

/** Deletes every trip-history entry on this device. */
export async function clearHistory(): Promise<void> {
  // No history store yet (Task 8).
}
