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
// endpoint channel (requestEndpoint / requestPick), each a numbered request applied once.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LatLng } from "@/domain/geo/types";
import type { EndpointWhich } from "@/domain/trip/endpoints";
import { HomeScreen } from "@/ui/home/home-screen";
import {
  AppFrameContext,
  setEntryPath,
  type EndpointRequest,
  type MapFocus,
  type PanelKind,
  type RequestedEndpoint,
} from "./app-frame-context";
import { TabBar } from "./tab-bar";

export function AppFrame({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState({ detail: 0, page: 0 });
  const [tabBarHides, setTabBarHides] = useState(0);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [endpointRequest, setEndpointRequest] = useState<EndpointRequest | null>(null);
  const returnFocus = useRef<Element | null>(null);
  // The stop path the user opened straight from the home map (pin tap or Nearby-stops link).
  // "Show on map" may go back in history only while that panel is the one showing.
  const homeNavigation = useRef<string | null>(null);

  useEffect(() => {
    setEntryPath(window.location.pathname);
    return () => setEntryPath(null);
  }, []);

  const openPanel = useCallback((kind: PanelKind = "detail") => {
    const active = document.activeElement;
    if (!returnFocus.current && active && active !== document.body) returnFocus.current = active;
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
    setEndpointRequest((prev) => ({ kind: "set", which, endpoint: { point: { ...endpoint.point }, label: endpoint.label }, n: (prev?.n ?? 0) + 1 }));
  }, []);
  const requestPick = useCallback((which: EndpointWhich) => {
    setEndpointRequest((prev) => ({ kind: "pick", which, n: (prev?.n ?? 0) + 1 }));
  }, []);

  // Panel closed: give focus back. The Map tab (focus on the tab bar) lands on the home heading;
  // focus the home screen already moved (the pick panel's confirm button) stays; otherwise focus
  // returns to what had it when the first panel opened.
  const homeLayer = useRef<HTMLDivElement>(null);
  const open = panels.detail + panels.page > 0;
  useEffect(() => {
    if (open) return;
    homeNavigation.current = null; // back on the map: nothing to go back to
    const el = returnFocus.current;
    returnFocus.current = null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-tabbar]")) {
      homeLayer.current?.querySelector<HTMLElement>("[data-home-heading]")?.focus();
    } else if (active instanceof HTMLElement && active !== document.body && homeLayer.current?.contains(active)) {
      // The home screen already placed focus.
    } else if (el instanceof HTMLElement && el.isConnected) {
      el.focus();
    }
  }, [open]);

  const tabBarVisible = panels.detail === 0 && tabBarHides === 0;
  const value = useMemo(
    () => ({
      openPanel,
      markHomeNavigation,
      isHomeNavigation,
      mapFocus,
      showOnMap,
      hideTabBar,
      tabBarVisible,
      panelOpen: open,
      endpointRequest,
      requestEndpoint,
      requestPick,
    }),
    [openPanel, markHomeNavigation, isHomeNavigation, mapFocus, showOnMap, hideTabBar, tabBarVisible, open, endpointRequest, requestEndpoint, requestPick],
  );

  return (
    <AppFrameContext.Provider value={value}>
      <div ref={homeLayer} inert={open} data-testid="app-home-layer">
        <HomeScreen />
      </div>
      {children}
      {tabBarVisible ? <TabBar /> : null}
    </AppFrameContext.Provider>
  );
}
