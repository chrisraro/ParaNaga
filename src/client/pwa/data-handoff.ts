"use client";

// The first visit's data, handed to the service worker (Task 12). On the very first visit the
// page fetches the published head and snapshot (and maybe the search index) BEFORE the worker
// controls it, so the worker never sees those responses. Instead of downloading them again at
// install (wasteful, and against low-data mode), the page keeps its own copies here and posts them
// to the worker once it is active; the worker stores only what its allow-list accepts
// (acceptHandoff in src/domain/pwa/sw-routes.ts). A request made while the page was already
// controlled is never offered: the worker saw that response itself.

import { CACHE_PREFIX, cachesToClear, HANDOFF_MESSAGE, type HandoffEntry } from "@/domain/pwa/sw-routes";
import { serviceWorkerEnabled } from "./register-sw";

const pending = new Map<string, HandoffEntry>();
let scheduled = false;

/**
 * Whether the worker will see a request started now. Read it BEFORE the fetch: a request that
 * starts uncontrolled bypasses the worker even if the worker takes control while it runs.
 */
export function workerSeesRequests(): boolean {
  return !serviceWorkerEnabled() || navigator.serviceWorker.controller !== null;
}

/**
 * Offers a fetched JSON response (its text and Cache-Control) to the worker, when the request
 * went around it (`sawRequest` false, captured with workerSeesRequests() before the fetch).
 */
export function offerToWorker(url: string, body: string, cacheControl: string | null, sawRequest: boolean): void {
  if (sawRequest || !serviceWorkerEnabled() || !cacheControl) return;
  pending.set(url, { url, body, cacheControl });
  if (scheduled) return;
  scheduled = true;
  navigator.serviceWorker.ready.then(
    (registration) => {
      scheduled = false;
      const entries = [...pending.values()];
      pending.clear();
      if (entries.length > 0) registration.active?.postMessage({ type: HANDOFF_MESSAGE, entries });
    },
    () => {
      scheduled = false;
    },
  );
}

/** "Clear data on this device": nothing kept for the worker either. */
export function forgetHandoff(): void {
  pending.clear();
}

/**
 * The worker's stored copy of a per-revision data file (the lines, the walk graph), read without
 * any network request: used when the person asked to save data. Null when there is none, or Cache
 * Storage is unavailable.
 */
export async function readStoredCopy(url: string): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  try {
    const response = await caches.match(url);
    return response ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * Drops every stored copy of `url` from ParaNaga's caches: a copy the client validator rejected
 * (corrupt, or from an older format) is never served again, so the next request goes to the network.
 */
export async function dropStoredCopy(url: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    // The data caches only (never the precache or the shells).
    const names = cachesToClear(await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
    await Promise.all(names.map(async (name) => (await caches.open(name)).delete(url)));
  } catch {
    // Cache Storage blocked: nothing stored to drop.
  }
}

/**
 * GETs an immutable per-revision JSON file and decodes it (`decode` returns null for an invalid
 * payload). An invalid payload is most likely a damaged stored copy: it is dropped and fetched once
 * more from the network (`cache: "no-cache"`); still invalid → throws. A valid payload fetched
 * around the worker is offered to it (offerToWorker).
 */
export async function fetchRevisionJson<T>(url: string, decode: (raw: unknown) => T | null): Promise<T> {
  const sawRequest = workerSeesRequests();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const init: RequestInit = attempt === 0 ? { headers: { accept: "application/json" } } : { headers: { accept: "application/json" }, cache: "no-cache" };
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
    const text = await response.text();
    const value = decodeJson(text, decode);
    if (value !== null) {
      offerToWorker(url, text, response.headers.get("Cache-Control"), sawRequest);
      return value;
    }
    await dropStoredCopy(url);
  }
  throw new Error(`GET ${url}: the payload is not valid`);
}

/** `decode(JSON.parse(text))`, or null when the text is not JSON or not valid. */
export function decodeJson<T>(text: string, decode: (raw: unknown) => T | null): T | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    return decode(raw);
  } catch {
    return null;
  }
}
