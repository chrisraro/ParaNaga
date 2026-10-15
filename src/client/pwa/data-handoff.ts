"use client";

// The first visit's data, handed to the service worker (Task 12). On the very first visit the
// page fetches the published head and snapshot (and maybe the search index) BEFORE the worker
// controls it, so the worker never sees those responses. Instead of downloading them again at
// install (wasteful, and against low-data mode), the page keeps its own copies here and posts them
// to the worker once it is active; the worker stores only what its allow-list accepts
// (acceptHandoff in src/domain/pwa/sw-routes.ts). A page already controlled sends nothing: the
// worker saw those responses itself.

import { HANDOFF_MESSAGE, type HandoffEntry } from "@/domain/pwa/sw-routes";
import { serviceWorkerEnabled } from "./register-sw";

const pending = new Map<string, HandoffEntry>();
let scheduled = false;

/** Offers a fetched JSON response (its text and Cache-Control) to the worker. Best effort. */
export function offerToWorker(url: string, body: string, cacheControl: string | null): void {
  if (!serviceWorkerEnabled() || !cacheControl || navigator.serviceWorker.controller) return;
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
