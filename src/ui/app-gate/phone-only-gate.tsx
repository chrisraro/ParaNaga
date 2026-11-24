"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useViewportClass } from "@/client/use-viewport-class";
import { opensOnLargeScreen, type ViewportClass } from "@/domain/device/viewport-gate";
import { LunadMark } from "@/ui/brand/lunad-mark";
import { LargeScreenGate } from "@/ui/app-gate/large-screen-gate";

/**
 * Renders the app only on phones and small tablets (src/domain/device/viewport-gate.ts). The
 * decision is made in the browser and follows resize/rotation; the server sends a neutral splash
 * so a desktop never flashes app UI before the gate appears.
 *
 * Sign-in, Settings and Help open on any screen (opensOnLargeScreen).
 *
 * Once the app has mounted it is never unmounted by the gate: if the screen later counts as
 * large (a window dragged wider), the gate covers the app and the app turns inert, so the trip,
 * the map view and the sheet are all still there when the screen is phone-sized again.
 */
export function PhoneOnlyGate({ children }: { children: ReactNode }) {
  const viewport = useViewportClass();
  // The path is read only past the splash, in the browser: the static shell has no request data.
  return viewport === null ? <Splash /> : <Gate viewport={viewport}>{children}</Gate>;
}

function Gate({ viewport, children }: { viewport: ViewportClass; children: ReactNode }) {
  const covered = !opensOnLargeScreen(usePathname()) && viewport === "large";
  const [appMounted, setAppMounted] = useState(false);
  if (!covered && !appMounted) setAppMounted(true);

  if (!appMounted) return covered ? <LargeScreenGate /> : null;
  return (
    <>
      <div className="contents" inert={covered} aria-hidden={covered || undefined} data-testid="app-root">
        {children}
      </div>
      {covered ? (
        <div className="fixed inset-0 z-[5000] overflow-y-auto" data-testid="large-screen-overlay">
          <LargeScreenGate />
        </div>
      ) : null}
    </>
  );
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-deep" aria-busy="true">
      <LunadMark size={72} tone="bright" title="Lunad is loading" />
    </div>
  );
}
