"use client";

// "Clear data on this device" (Settings → Data on this device). One entry point that later tasks
// extend as they add stores. It removes the preferences and any other ParaNaga keys in
// localStorage, ParaNaga's sessionStorage keys (guidance state), every IndexedDB store (saved
// trips, saved places, trip history and the last-seen revision, Task 8), and the service worker's
// data caches (Task 12: head, snapshots, search indexes, reference reads) with their expiry
// records. The app code itself (precached build assets and static shells) stays, so ParaNaga
// still opens offline afterwards.

import { resetPrefs } from "@/client/prefs/use-prefs";
import { clearAllStores } from "@/client/storage/db";
import { forgetGuidance } from "@/client/guidance/guidance-store";
import { cachesToClear } from "@/domain/pwa/sw-routes";
import { forgetLines } from "@/client/network/use-lines";
import { forgetSnapshot } from "@/client/network/use-snapshot";
import { forgetWalkGraph } from "@/client/network/use-walk-graph";
import { forgetHandoff } from "@/client/pwa/data-handoff";
import { resetSearchIndexCache } from "@/client/search/use-search-index";

/** Serwist's expiry bookkeeping (URLs and times of cached data, nothing else). */
export const SW_EXPIRATION_DB = "serwist-expiration";

/** Deletes the service worker's data caches; the precache and the shells stay. */
export async function clearRuntimeCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(cachesToClear(names).map((name) => caches.delete(name)));
  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(SW_EXPIRATION_DB);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
}

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
  // A running guidance session is forgotten too (its keys were just removed).
  forgetGuidance();
  clearStorage(() => window.localStorage);
  forgetHandoff();
  try {
    await Promise.all([clearAllStores(), clearRuntimeCaches()]);
  } finally {
    // The copies held in memory go too, once the caches are empty: screens still showing data
    // load it afresh (as on a new visit) instead of keeping the old copy on screen.
    forgetSnapshot();
    forgetLines();
    forgetWalkGraph();
    resetSearchIndexCache();
    // Even if a store failed (the caller reports it): re-read the (now empty) preferences,
    // re-apply the default theme and tell every screen.
    resetPrefs();
  }
}
