"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const snapshot = () => window.matchMedia(QUERY).matches;

/** Live `prefers-color-scheme: dark`, for canvas drawing that CSS cannot theme; false on the server. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
