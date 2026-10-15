"use client";

// Context shared by the /app frame (app-frame.tsx), the home screen, the tab bar, the detail
// panels and the tab pages.

import { createContext, useContext, useLayoutEffect, useState } from "react";
import type { LatLng } from "@/domain/geo/types";
import type { EndpointWhich } from "@/domain/trip/endpoints";

/** A request to centre the home map on a point ("Show on map"); `n` makes each request new. */
export type MapFocus = { point: LatLng; n: number };

/** A place chosen on another screen (search, place detail, saved place) for the trip. */
export type RequestedEndpoint = { point: LatLng; label: string };

/**
 * A request from another screen to the home trip sheet, applied once by the home screen (`n`
 * makes each request new): set the start or destination to a place, or open "Choose on map".
 * The caller then navigates to /app.
 */
export type EndpointRequest =
  | { kind: "set"; which: EndpointWhich; endpoint: RequestedEndpoint; n: number }
  | { kind: "pick"; which: EndpointWhich; n: number };

/** A detail panel (stop, route, place, terminal: Back button, no tab bar) or a tab page. */
export type PanelKind = "detail" | "page";

export type AppFrameValue = {
  /** Registers an open panel; returns the unregister function. */
  openPanel: (kind?: PanelKind) => () => void;
  /** Records that the home map (pin tap or Nearby-stops link) is opening the panel at `path`. */
  markHomeNavigation: (path: string) => void;
  /** True while the panel at `path` is the one opened straight from the home map. */
  isHomeNavigation: (path: string) => boolean;
  mapFocus: MapFocus | null;
  showOnMap: (point: LatLng) => void;
  /** Hides the tab bar while the caller needs the whole screen; returns the release function. */
  hideTabBar: () => () => void;
  /** The tab bar is showing (no detail panel open, nobody asked to hide it). */
  tabBarVisible: boolean;
  /** A detail panel or tab page covers the home screen (which is inert meanwhile). */
  panelOpen: boolean;
  endpointRequest: EndpointRequest | null;
  requestEndpoint: (which: EndpointWhich, endpoint: RequestedEndpoint) => void;
  requestPick: (which: EndpointWhich) => void;
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

// Layout effects, so the tab bar and the inert home layer change in the same paint as the panel
// (no flash of the tab bar over a detail panel). Activity runs their cleanups when a page is hidden.

/** Marks a full-screen panel as open while the calling component is mounted (and visible). */
export function useAppPanel(kind: PanelKind = "detail"): void {
  const openPanel = useAppFrame()?.openPanel;
  useLayoutEffect(() => (openPanel ? openPanel(kind) : undefined), [openPanel, kind]);
}

/** Hides the tab bar while `active` (a pin being placed, guidance running). */
export function useHideTabBar(active: boolean): void {
  const hideTabBar = useAppFrame()?.hideTabBar;
  useLayoutEffect(() => (active && hideTabBar ? hideTabBar() : undefined), [active, hideTabBar]);
}

/**
 * Applies each numbered request (mapFocus, endpointRequest) exactly once, during render (React's
 * "adjust state when a prop changes" pattern): a re-render never re-applies it, and a request made
 * before the caller mounted is never replayed. `apply` may set the caller's own state.
 */
export function useApplyOnce<R extends { n: number }>(request: R | null, apply: (request: R) => void): void {
  const [seen, setSeen] = useState(request?.n ?? 0);
  if (request && request.n !== seen) {
    setSeen(request.n);
    apply(request);
  }
}
