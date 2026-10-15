"use client";

// Context shared by the /app frame (app-frame.tsx), the home screen and the detail panels.

import { createContext, useContext, useEffect } from "react";
import type { LatLng } from "@/domain/geo/types";

/** A request to centre the home map on a point ("Show on map"); `n` makes each request new. */
export type MapFocus = { point: LatLng; n: number };

export type AppFrameValue = {
  /** Registers an open panel; returns the unregister function. */
  openPanel: () => () => void;
  /** Whether the panel open now was opened straight from the home map (not from another panel). */
  openedFromHome: () => boolean;
  mapFocus: MapFocus | null;
  showOnMap: (point: LatLng) => void;
};

export const AppFrameContext = createContext<AppFrameValue | null>(null);

// Where this browser tab entered the mounted /app frame. "Back" uses history only after an in-app
// navigation, so a detail page opened from a shared link goes to the map instead of leaving the
// site. Set when an AppFrame mounts and cleared when it unmounts (or is hidden), so leaving /app
// and coming back starts over.
let entryPath: string | null = null;

export function setEntryPath(path: string | null): void {
  entryPath = path;
}

/** True when the current page was reached by navigating inside the app (history has our page). */
export function cameFromInsideApp(): boolean {
  return entryPath !== null && window.location.pathname !== entryPath;
}

export function useAppFrame(): AppFrameValue | null {
  return useContext(AppFrameContext);
}

/** Marks a full-screen panel as open while the calling component is mounted. */
export function useAppPanel(): void {
  const openPanel = useAppFrame()?.openPanel;
  useEffect(() => (openPanel ? openPanel() : undefined), [openPanel]);
}
