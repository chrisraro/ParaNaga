"use client";

// One background fetch of the search index (Task 12, controller decision R5): search is how a
// destination is chosen, and offline planning needs a destination, so the index of the current
// revision is fetched once, while the browser is idle, after the service worker controls the page.
// The worker stores it (CacheFirst; already cached → no network). Skipped when the person asked to
// save data: the Low-data mode preference, or the browser's Data Saver (navigator.connection.saveData).
// Nothing is sent but the GETs the app makes anyway (head, index, the named-places chunk); no query text.

import { readPrefs } from "@/client/prefs/use-prefs";
import { networkHeadSchema } from "@/domain/api/schemas";
import { serviceWorkerEnabled } from "./register-sw";

let scheduled = false;

/** The person asked to save data: Low-data mode, or the browser's Data Saver. */
export function savingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return readPrefs().lowData || connection?.saveData === true;
}

/** The fetch itself (exported for tests): head, then the index of that revision. */
export async function prefetchSearchIndexNow(): Promise<"fetched" | "skipped" | "failed"> {
  if (savingData()) return "skipped";
  // Bounded: a stuck background request would keep the worker busy (and delay an update).
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(20_000) : undefined;
  try {
    const headResponse = await fetch("/api/v1/network/head", { headers: { accept: "application/json" }, signal });
    if (!headResponse.ok) return "failed";
    const head = networkHeadSchema.parse(await headResponse.json());
    const index = await fetch(`/api/v1/network/search-index/${encodeURIComponent(head.revisionId)}`, { headers: { accept: "application/json" }, signal });
    await index.arrayBuffer(); // read to the end so the worker's copy is complete
    if (!index.ok) return "failed";
    // Task 14: the named-places chunk (restaurants, shops …), so those are searchable offline too.
    // Best effort: the core index above is what makes the prefetch a success.
    const places = await fetch(`/api/v1/network/search-places/${encodeURIComponent(head.revisionId)}`, { headers: { accept: "application/json" }, signal }).catch(() => null);
    await places?.arrayBuffer().catch(() => null);
    return "fetched";
  } catch {
    return "failed";
  }
}

function whenIdle(run: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 10_000 });
  else setTimeout(run, 3_000);
}

/** Once per page: after the worker controls the page, when idle, unless saving data. */
export function schedulePrefetchSearchIndex(): void {
  if (scheduled || !serviceWorkerEnabled()) return;
  scheduled = true;
  const start = () => whenIdle(() => void prefetchSearchIndexNow());
  if (navigator.serviceWorker.controller) start();
  else navigator.serviceWorker.addEventListener("controllerchange", start, { once: true });
}

/** Tests only. */
export function resetPrefetchForTests(): void {
  scheduled = false;
}
