"use client";

// Service worker registration and the update flow (Task 12).
//
// Registration: production builds only, after `load`, scope "/", the script never read from the
// HTTP cache (updateViaCache "none"). The worker is built by Serwist (src/app/sw.ts).
//
// Updates: a new worker installs and then WAITS (it never takes over by itself). When one is
// waiting while this page is controlled, `useUpdateReady()` turns true and the app shows "A new
// version of ParaNaga is ready. [Reload]". Tapping Reload (applyUpdate) asks the waiting worker to
// take over and reloads once it has; the app never offers or performs that reload while guidance
// is running. A first install shows nothing (there is no older version to replace).

import { useSyncExternalStore } from "react";

export const SW_URL = "/serwist/sw.js";
export const SW_SCOPE = "/";

let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false;
const listeners = new Set<() => void>();

function setWaiting(worker: ServiceWorker | null): void {
  if (waiting === worker) return;
  waiting = worker;
  for (const listener of [...listeners]) listener();
}

/** A worker counts as an update only when it waits behind one that already controls this page. */
function track(reg: ServiceWorkerRegistration): void {
  registration = reg;
  const consider = (worker: ServiceWorker | null) => {
    if (worker && worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
  };
  consider(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      consider(worker);
      if (worker.state === "redundant" && waiting === worker) setWaiting(null);
    });
  });
}

/** Whether this build registers a worker (production only; tests may force it). */
export function serviceWorkerEnabled(): boolean {
  return process.env.NODE_ENV === "production" && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Registers the worker once per page, after the page has loaded. Safe to call repeatedly. */
export function registerServiceWorker(): void {
  if (started || !serviceWorkerEnabled()) return;
  started = true;
  const register = () => {
    navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: "none" }).then(track, () => undefined);
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** Looks for a new version now (e.g. when the app comes back to the foreground). */
export function checkForUpdate(): void {
  void registration?.update().catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribe, () => waiting !== null, () => false);
}

/**
 * Activates the waiting version and reloads into it. Does nothing without one. The caller must
 * not offer this during guidance (UpdatePrompt checks it again before calling).
 */
export function applyUpdate(): void {
  const worker = waiting;
  if (!worker) return;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}

/** Tests only. */
export function resetServiceWorkerForTests(): void {
  waiting = null;
  registration = null;
  started = false;
  listeners.clear();
}

/** Tests only: pretend a version is waiting. */
export function setWaitingForTests(worker: ServiceWorker | null): void {
  setWaiting(worker);
}
