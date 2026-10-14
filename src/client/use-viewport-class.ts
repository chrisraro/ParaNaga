"use client";

import { useSyncExternalStore } from "react";
import { PHONE_MEDIA_QUERY, type ViewportClass } from "@/domain/device/viewport-gate";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): ViewportClass {
  return window.matchMedia(PHONE_MEDIA_QUERY).matches ? "phone" : "large";
}

/** The server cannot know the screen size, so it renders neither the app nor the gate. */
function getServerSnapshot(): null {
  return null;
}

/** "phone" | "large" in the browser (live on resize/rotate), null during server render. */
export function useViewportClass(): ViewportClass | null {
  return useSyncExternalStore<ViewportClass | null>(subscribe, getSnapshot, getServerSnapshot);
}
