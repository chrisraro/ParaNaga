"use client";

// The /app frame (rendered by src/app/app/layout.tsx): the home map screen stays mounted for the
// whole /app section; detail pages (stop, route, ...) and tab pages (Explore, Saved, More) open as
// full-screen panels over it. So returning to the map keeps the map view, the trip and the sheet
// as they were. The tab bar sits above everything except the detail panels.
//
// While a panel is open the home screen is `inert` (out of the tab order and the accessibility
// tree); focus returns to whatever had it (a "Nearby stops" link, say) when the panel closes, or
// to the home heading when the Map tab closed it.
//
// Other screens talk to the home screen through the context: "Show on map" (mapFocus) and the
// endpoint channel (requestEndpoint / requestPick / requestGps) and requestTrip (reopen a saved trip),
// each a numbered request applied once.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, ViewTransition, type ReactNode } from "react";
import type { LatLng } from "@/domain/geo/types";
import type { EndpointWhich } from "@/domain/trip/endpoints";
import { captureOpener } from "@/ui/kit/opener";
import { HomeScreen } from "@/ui/home/home-screen";
import { OfflineBanner } from "@/ui/pwa/offline-banner";
import { UpdatePrompt } from "@/ui/pwa/update-prompt";
import {
  AppFrameContext,
  setEntryPath,
  type EndpointRequest,
  type MapFocus,
  type PanelKind,
  type RequestedEndpoint,
  type TripRequest,
} from "./app-frame-context";
import { TabBar } from "./tab-bar";

export function AppFrame({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState({ detail: 0, page: 0 });
  const [tabBarHides, setTabBarHides] = useState(0);
  const [measuredClearance, setMeasuredClearance] = useState(0);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [endpointRequest, setEndpointRequest] = useState<EndpointRequest | null>(null);
  const [tripRequest, setTripRequest] = useState<TripRequest | null>(null);
  const returnFocus = useRef<Element | null>(null);
  // The stop path the user opened straight from the home map (pin tap or Nearby-stops link).
  // "Show on map" may go back in history only while that panel is the one showing.
  const homeNavigation = useRef<string | null>(null);

  useEffect(() => {
    setEntryPath(window.location.pathname);
    return () => setEntryPath(null);
  }, []);

  const openPanel = useCallback((kind: PanelKind = "detail") => {
    if (!returnFocus.current) returnFocus.current = captureOpener();
    // A panel for another path (a link followed inside a panel) ends the home-started navigation.
    // The loading → content swap of the same page keeps it (same path).
    if (homeNavigation.current !== null && window.location.pathname !== homeNavigation.current) homeNavigation.current = null;
    setPanels((p) => ({ ...p, [kind]: p[kind] + 1 }));
    return () => setPanels((p) => ({ ...p, [kind]: p[kind] - 1 }));
  }, []);

  const hideTabBar = useCallback(() => {
    setTabBarHides((n) => n + 1);
    return () => setTabBarHides((n) => n - 1);
  }, []);

  const markHomeNavigation = useCallback((path: string) => {
    homeNavigation.current = path;
  }, []);
  const isHomeNavigation = useCallback((path: string) => homeNavigation.current === path, []);

  const showOnMap = useCallback((point: LatLng) => {
    setMapFocus((prev) => ({ point, n: (prev?.n ?? 0) + 1 }));
  }, []);

  const requestEndpoint = useCallback((which: EndpointWhich, endpoint: RequestedEndpoint) => {
    const copy: RequestedEndpoint = { point: { ...endpoint.point }, label: endpoint.label, ...(endpoint.place ? { place: endpoint.place } : {}) };
    setEndpointRequest((prev) => ({ kind: "set", which, endpoint: copy, n: (prev?.n ?? 0) + 1 }));
  }, []);
  const requestPick = useCallback((which: EndpointWhich) => {
    setEndpointRequest((prev) => ({ kind: "pick", which, n: (prev?.n ?? 0) + 1 }));
  }, []);
  const requestGps = useCallback(() => {
    setEndpointRequest((prev) => ({ kind: "gps", n: (prev?.n ?? 0) + 1 }));
  }, []);
  const requestTrip = useCallback((savedTripId: string) => {
    setTripRequest((prev) => ({ savedTripId, n: (prev?.n ?? 0) + 1 }));
  }, []);

  // Panel closed, the map is showing again: decide from the destination, not from where the
  // browser left focus (iOS Safari does not focus a tapped link). Focus the home screen already
  // placed (the pick panel's confirm button) stays; otherwise focus returns to the home control
  // that opened the first panel (a "Nearby stops" link, a pin); otherwise, as after the Map tab,
  // Escape or Back from a tab page, it goes to the home heading.
  const homeLayer = useRef<HTMLDivElement>(null);
  const open = panels.detail + panels.page > 0;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return; // first render at /app: nothing closed
    wasOpen.current = false;
    homeNavigation.current = null; // back on the map: nothing to go back to
    const el = returnFocus.current;
    returnFocus.current = null;
    const home = homeLayer.current;
    if (!home) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && home.contains(active)) return;
    if (el instanceof HTMLElement && el.isConnected && home.contains(el)) el.focus();
    else home.querySelector<HTMLElement>("[data-home-heading]")?.focus();
  }, [open]);

  const tabBarVisible = panels.detail === 0 && tabBarHides === 0;
  const tabBarClearance = tabBarVisible ? measuredClearance : 0;
  const value = useMemo(
    () => ({
      openPanel,
      markHomeNavigation,
      isHomeNavigation,
      mapFocus,
      showOnMap,
      hideTabBar,
      tabBarVisible,
      tabBarClearance,
      panelOpen: open,
      endpointRequest,
      requestEndpoint,
      requestPick,
      requestGps,
      tripRequest,
      requestTrip,
    }),
    [openPanel, markHomeNavigation, isHomeNavigation, mapFocus, showOnMap, hideTabBar, tabBarVisible, tabBarClearance, open, endpointRequest, requestEndpoint, requestPick, requestGps, tripRequest, requestTrip],
  );

  return (
    <AppFrameContext.Provider value={value}>
      <div ref={homeLayer} inert={open} data-testid="app-home-layer">
        <HomeScreen />
      </div>
      {/* Route changes are transitions: the outgoing panel (or the bare map) crossfades into the
          incoming one, so a navigation never cuts to an empty frame (globals.css, .pn-panel). */}
      <ViewTransition name="pn-panel" default="none" update="pn-panel" enter="pn-panel" exit="pn-panel" share="pn-panel">
        {children}
      </ViewTransition>
      {/* usePathname in a layout: Suspense keeps the static shell valid for dynamic segments. */}
      {tabBarVisible ? (
        <Suspense fallback={null}>
          <TabBar onClearance={setMeasuredClearance} />
        </Suspense>
      ) : null}
      {/* Offline banner and the "new version" card (Task 12): above every panel, never blocking. */}
      <OfflineBanner />
      <UpdatePrompt />
    </AppFrameContext.Provider>
  );
}
