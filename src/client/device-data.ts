"use client";

// "Clear data on this device" (Settings → Data on this device). One entry point that later tasks
// extend as they add stores: IndexedDB saved trips / places / history (Task 8) and the runtime
// caches of the service worker (Task 12). Today it removes what exists: the preferences and any
// other ParaNaga keys in localStorage, and ParaNaga's sessionStorage keys (guidance state).

import { resetPrefs } from "@/client/prefs/use-prefs";
import { clearHistory } from "@/client/history/trip-history";

/** Every key ParaNaga writes to Web Storage starts with this. */
export const STORAGE_PREFIX = "paranaga.";

function removeOwnKeys(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

function clearStorage(get: () => Storage): void {
  try {
    removeOwnKeys(get());
  } catch {
    // Storage blocked: nothing of ours can be in it.
  }
}

/** Removes everything ParaNaga keeps on this device; settings go back to their defaults. */
export async function clearDeviceData(): Promise<void> {
  clearStorage(() => window.sessionStorage);
  clearStorage(() => window.localStorage);
  await clearHistory();
  // Re-reads the (now empty) preferences, re-applies the default theme and tells every screen.
  resetPrefs();
}
