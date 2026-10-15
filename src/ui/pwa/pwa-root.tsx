"use client";

// Mounted once in the root layout: registers the service worker (production only, after load,
// scope "/") and keeps the browser's install offer for More → App (never shown unasked).

import { useEffect } from "react";
import { listenForInstallPrompt } from "@/client/pwa/install";
import { registerServiceWorker } from "@/client/pwa/register-sw";

export function PwaRoot() {
  useEffect(() => {
    listenForInstallPrompt();
    registerServiceWorker();
  }, []);
  return null;
}
