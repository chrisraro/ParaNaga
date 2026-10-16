"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  // No matchMedia (a test DOM): nothing animates, so treat it as reduced motion.
  return typeof window.matchMedia !== "function" || window.matchMedia(QUERY).matches;
}

/** Live `prefers-reduced-motion: reduce`; false during server render. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
