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
  // Synchronous bookkeeping for "opened from home": panel → panel navigation closes one panel and
  // opens the next in the same commit, so a close followed by an open before the next microtask
  // means the new panel came from another panel.
  const openCount = useRef(0);
  const justClosed = useRef(false);
  const fromHome = useRef(true);

  useEffect(() => {
    setEntryPath(window.location.pathname);
    return () => setEntryPath(null);
  }, []);

  const openPanel = useCallback(() => {
    const active = document.activeElement;
    if (!returnFocus.current && active && active !== document.body) returnFocus.current = active;
    fromHome.current = openCount.current === 0 && !justClosed.current;
    openCount.current += 1;
    setPanels((n) => n + 1);
    return () => {
      openCount.current -= 1;
      justClosed.current = true;
      queueMicrotask(() => {
        justClosed.current = false;
      });
      setPanels((n) => n - 1);
    };
  }, []);

  const openedFromHome = useCallback(() => fromHome.current, []);

  const showOnMap = useCallback((point: LatLng) => {
    setMapFocus((prev) => ({ point, n: (prev?.n ?? 0) + 1 }));
  }, []);

  // Panel closed: give focus back to what had it, if it is still on the page.
  const open = panels > 0;
  useEffect(() => {
    if (open) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, [open]);

  const value = useMemo(
    () => ({ openPanel, openedFromHome, mapFocus, showOnMap }),
    [openPanel, openedFromHome, mapFocus, showOnMap],
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
