"use client";

import { useState, type ReactNode } from "react";
import { useViewportClass } from "@/client/use-viewport-class";
import { RouteNMark } from "@/ui/brand/route-n-mark";
import { LargeScreenGate } from "@/ui/app-gate/large-screen-gate";

/**
 * Renders the app only on phones and small tablets (src/domain/device/viewport-gate.ts). The
 * decision is made in the browser and follows resize/rotation; the server sends a neutral splash
 * so a desktop never flashes app UI before the gate appears.
 *
 * Once the app has mounted it is never unmounted by the gate: if the screen later counts as
 * large (a window dragged wider), the gate covers the app and the app turns inert, so the trip,
 * the map view and the sheet are all still there when the screen is phone-sized again.
 */
export function PhoneOnlyGate({ children }: { children: ReactNode }) {
  const viewport = useViewportClass();
  const [appMounted, setAppMounted] = useState(false);
  if (viewport === "phone" && !appMounted) setAppMounted(true);

  if (viewport === null) return <Splash />;
  if (!appMounted) return viewport === "large" ? <LargeScreenGate /> : null;
  const covered = viewport === "large";
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
    <div className="flex min-h-dvh items-center justify-center bg-navy" aria-busy="true">
      <RouteNMark size={72} title="ParaNaga is loading" />
    </div>
  );
}
