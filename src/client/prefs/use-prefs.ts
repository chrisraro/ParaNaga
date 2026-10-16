"use client";

// Device preferences store (decision D3): localStorage "paranaga.prefs", read through the Zod
// schema in src/domain/prefs (bad data → defaults), shared by every component through
// useSyncExternalStore, and kept in step with other tabs through the `storage` event. Every change
// also updates <html data-theme / data-contrast> the same way public/theme-init.js does before the
// first paint. If storage is unavailable (private mode, blocked) the choice still applies for this
// visit, in memory.

import { useLayoutEffect, useSyncExternalStore } from "react";
import { DEFAULT_PREFS, PREFS_STORAGE_KEY, parsePrefs, serializePrefs, type LayersPref, type Prefs } from "@/domain/prefs/prefs";
export type { LayersPref, Prefs };

type Listener = () => void;

const listeners = new Set<Listener>();
let cachedRaw: string | null | undefined;
let cached: Prefs = { ...DEFAULT_PREFS };
/** Set when a write could not reach localStorage: the in-memory value wins for this visit. */
let memoryOnly: Prefs | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The current preferences (referentially stable until they change). */
export function readPrefs(): Prefs {
  if (memoryOnly) return memoryOnly;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parsePrefs(raw);
  }
  return cached;
}

const serverPrefs: Prefs = { ...DEFAULT_PREFS };
const readServerPrefs = () => serverPrefs;

function notify() {
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent) {
  // key === null: another tab cleared the whole storage.
  if (event.key !== null && event.key !== PREFS_STORAGE_KEY) return;
  memoryOnly = null;
  notify();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Sets <html data-theme / data-contrast> for these preferences (same rules as theme-init.js). */
export function applyDocumentPrefs(prefs: Prefs): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", prefs.theme);
  if (prefs.highContrast) root.setAttribute("data-contrast", "more");
  else root.removeAttribute("data-contrast");
}

/** Merges `patch` into the stored preferences, applies them to the document and notifies. */
export function updatePrefs(patch: Partial<Prefs>): Prefs {
  const next: Prefs = { ...readPrefs(), ...patch };
  const raw = serializePrefs(next);
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, raw);
    memoryOnly = null;
  } catch {
    memoryOnly = next;
  }
  applyDocumentPrefs(next);
  notify();
  return next;
}

/** Merges a partial `layers` update into the stored preferences (D16). */
export function updateLayers(patch: Partial<LayersPref>): Prefs {
  const current = readPrefs();
  return updatePrefs({
    layers: {
      ...current.layers,
      ...patch,
      modes: patch.modes ? [...patch.modes] : [...current.layers.modes],
    },
  });
}

/** Removes the stored preferences (back to the defaults) — part of "Clear data on this device". */
export function resetPrefs(): void {
  try {
    window.localStorage.removeItem(PREFS_STORAGE_KEY);
  } catch {
    // Nothing stored that we could reach.
  }
  memoryOnly = null;
  applyDocumentPrefs(readPrefs());
  notify();
}

/** The preferences, live. The server render (and hydration) sees the defaults. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, readPrefs, readServerPrefs);
}

/**
 * Keeps <html> in step with the preferences after hydration: on mount (React's development
 * remount clears attributes theme-init.js set) and whenever they change, including from another
 * tab. Rendered once, in the root layout.
 */
export function usePrefsOnDocument(): void {
  const prefs = usePrefs();
  useLayoutEffect(() => {
    applyDocumentPrefs(readPrefs());
  }, [prefs]);
}
