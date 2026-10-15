"use client";

// "Is the app offline?" for the UI: Next's useOffline (true when a navigation, prefetch or Server
// Action could not reach the server, or the browser fired `offline`; experimental.useOffline) OR
// the browser saying it has no network (navigator.onLine false, e.g. a cold start offline served
// by the service worker before any framework request failed). False on the server and before
// hydration, like useOffline.

import { useOffline } from "next/offline";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useIsOffline(): boolean {
  const framework = useOffline();
  const browser = useSyncExternalStore(subscribe, () => navigator.onLine === false, () => false);
  return framework || browser;
}
