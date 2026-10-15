"use client";

// Mounted once in the root layout: registers the service worker (production only, after load,
// scope "/"), keeps the browser's install offer for More → App (never shown unasked), and fetches
// the search index once in the background so search works offline (not when saving data).

import { useEffect } from "react";
import { listenForInstallPrompt } from "@/client/pwa/install";
import { schedulePrefetchSearchIndex } from "@/client/pwa/prefetch-index";
import { registerServiceWorker } from "@/client/pwa/register-sw";

export function PwaRoot() {
  useEffect(() => {
    listenForInstallPrompt();
    registerServiceWorker();
    schedulePrefetchSearchIndex();
  }, []);
  return null;
}
