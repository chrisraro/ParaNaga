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
/** This tab asked the waiting worker to take over (and will reload once it has). */
let initiated = false;
let controllerListener = false;
let watched = new WeakSet<ServiceWorker>();
const listeners = new Set<() => void>();
let reloadPage = () => window.location.reload();

/** "Later" on the card: hidden for this page session (More → App still offers Reload). */
let later = false;

function setWaiting(worker: ServiceWorker | null): void {
  if (waiting === worker) return;
  waiting = worker;
  for (const listener of [...listeners]) listener();
}

const isActive = (worker: ServiceWorker) => worker.state === "activating" || worker.state === "activated";

/** A worker counts as an update only when it waits behind another one that controls this page. */
function consider(worker: ServiceWorker): void {
  const controller = navigator.serviceWorker.controller;
  if (worker.state === "installed" && controller && controller !== worker) setWaiting(worker);
}

/**
 * Follows a worker's state: it becomes the update when installed, and stops being one once it
 * activates (here or in another tab / the installed app window) or becomes redundant.
 */
function watch(worker: ServiceWorker): void {
  if (watched.has(worker)) return;
  watched.add(worker);
  worker.addEventListener("statechange", () => {
    consider(worker);
    if (waiting !== worker) return;
    if (worker.state === "redundant") {
      // Superseded (e.g. a newer version arrived before it activated): a later one can be applied.
      initiated = false;
      setWaiting(null);
    } else if (!initiated && isActive(worker)) {
      setWaiting(null);
    }
  });
}

/**
 * One listener per page. A controller change this tab asked for reloads it (once); any other
 * (another tab tapped Reload) means nothing is waiting any more.
 */
function listenForControllerChange(): void {
  if (controllerListener) return;
  controllerListener = true;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (initiated) {
      if (reloaded) return;
      reloaded = true;
      reloadPage();
    } else {
      setWaiting(null);
    }
  });
}

/** Tracks a registration for updates (exported for tests). */
export function trackRegistration(reg: ServiceWorkerRegistration): void {
  registration = reg;
  listenForControllerChange();
  if (reg.waiting) {
    watch(reg.waiting);
    consider(reg.waiting);
  }
  if (reg.installing) watch(reg.installing);
  reg.addEventListener("updatefound", () => {
    if (reg.installing) watch(reg.installing);
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
    navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: "none" }).then(trackRegistration, () => undefined);
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

/** A new version is waiting (More → App shows "Update ready — Reload" while it is). */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribe, () => waiting !== null, () => false);
}

/** The floating card: a waiting version the person has not put off with "Later". */
export function useUpdateCard(): boolean {
  return useSyncExternalStore(subscribe, () => waiting !== null && !later, () => false);
}

/** "Later": hides the card for this page session; the update stays available in More. */
export function postponeUpdate(): void {
  if (later) return;
  later = true;
  for (const listener of [...listeners]) listener();
}

/**
 * Activates the waiting version and reloads into it. Does nothing without one. If that version is
 * already active (Reload tapped in another tab), this tab just reloads. The caller must not offer
 * this during guidance (UpdatePrompt checks it again before calling).
 */
export function applyUpdate(): void {
  const worker = waiting;
  if (!worker) return;
  if (isActive(worker) || navigator.serviceWorker.controller === worker) {
    reloadPage();
    return;
  }
  if (initiated) return; // already asked; the reload follows the controller change
  initiated = true;
  listenForControllerChange();
  worker.postMessage({ type: "SKIP_WAITING" });
}

/** Tests only. */
export function resetServiceWorkerForTests(): void {
  waiting = null;
  registration = null;
  started = false;
  initiated = false;
  later = false;
  controllerListener = false;
  watched = new WeakSet();
  listeners.clear();
  reloadPage = () => window.location.reload();
}

/** Tests only: observe reloads (jsdom cannot reload). */
export function setReloadForTests(reload: () => void): void {
  reloadPage = reload;
}

/** Tests only: pretend a version is waiting. */
export function setWaitingForTests(worker: ServiceWorker | null): void {
  setWaiting(worker);
}
