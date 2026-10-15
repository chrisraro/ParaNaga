"use client";

// The resolved colour scheme for canvas drawing that CSS cannot theme (the stops layer). Same rule
// as the stylesheets: <html data-theme="dark"> or "light" (Settings → Appearance) wins; otherwise
// (System) the device's prefers-color-scheme. Live: follows both the attribute and the device.

import { useSyncExternalStore } from "react";

export type ColorScheme = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

export function resolvedColorScheme(): ColorScheme {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/** "light" or "dark" as the page currently shows it; "light" during server render. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, resolvedColorScheme, () => "light");
}
