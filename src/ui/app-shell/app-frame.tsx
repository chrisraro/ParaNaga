"use client";

// The /app frame (rendered by src/app/app/layout.tsx): the home map screen stays mounted for the
// whole /app section, and the Stop / Route detail pages open as full-screen panels over it. So
// returning from a stop keeps the map view, the trip and the sheet as they were.
//
// While a panel is open the home screen is `inert` (out of the tab order and the accessibility
// tree); focus returns to whatever had it (a "Nearby stops" link, say) when the panel closes.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LatLng } from "@/domain/geo/types";
import { HomeScreen } from "@/ui/home/home-screen";
import { AppFrameContext, setEntryPath, type MapFocus } from "./app-frame-context";

export function AppFrame({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState(0);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const returnFocus = useRef<Element | null>(null);
  // The stop path the user opened straight from the home map (pin tap or Nearby-stops link).
  // "Show on map" may go back in history only while that panel is the one showing.
  const homeNavigation = useRef<string | null>(null);

  useEffect(() => {
    setEntryPath(window.location.pathname);
    return () => setEntryPath(null);
  }, []);

  const openPanel = useCallback(() => {
    const active = document.activeElement;
    if (!returnFocus.current && active && active !== document.body) returnFocus.current = active;
    // A panel for another path (a link followed inside a panel) ends the home-started navigation.
    // The loading → content swap of the same page keeps it (same path).
    if (homeNavigation.current !== null && window.location.pathname !== homeNavigation.current) homeNavigation.current = null;
    setPanels((n) => n + 1);
    return () => setPanels((n) => n - 1);
  }, []);

  const markHomeNavigation = useCallback((path: string) => {
    homeNavigation.current = path;
  }, []);
  const isHomeNavigation = useCallback((path: string) => homeNavigation.current === path, []);

  const showOnMap = useCallback((point: LatLng) => {
    setMapFocus((prev) => ({ point, n: (prev?.n ?? 0) + 1 }));
  }, []);

  // Panel closed: give focus back to what had it, if it is still on the page.
  const open = panels > 0;
  useEffect(() => {
    if (open) return;
    homeNavigation.current = null; // back on the map: nothing to go back to
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, [open]);

  const value = useMemo(
    () => ({ openPanel, markHomeNavigation, isHomeNavigation, mapFocus, showOnMap }),
    [openPanel, markHomeNavigation, isHomeNavigation, mapFocus, showOnMap],
  );

  return (
    <AppFrameContext.Provider value={value}>
      <div inert={open} data-testid="app-home-layer">
        <HomeScreen />
      </div>
      {children}
    </AppFrameContext.Provider>
  );
}
