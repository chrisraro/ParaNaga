"use client";

import type { ReactNode } from "react";
import { useViewportClass } from "@/client/use-viewport-class";
import { RouteNMark } from "@/ui/brand/route-n-mark";
import { LargeScreenGate } from "@/ui/app-gate/large-screen-gate";

/**
 * Renders the app only on phones and small tablets. The decision is made in the browser
 * (and follows resize/rotation); the server sends a neutral splash so a desktop never
 * flashes app UI before the gate appears.
 */
export function PhoneOnlyGate({ children }: { children: ReactNode }) {
  const viewport = useViewportClass();
  if (viewport === null) return <Splash />;
  if (viewport === "large") return <LargeScreenGate />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy" aria-busy="true">
      <RouteNMark size={72} title="ParaNaga is loading" />
    </div>
  );
}
