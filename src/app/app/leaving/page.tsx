import "@/ui/detail/detail.css";

import type { Metadata } from "next";
import { Suspense } from "react";
import { LeavingFallback, LeavingScreen } from "@/ui/intercity/leaving-screen";

export const metadata: Metadata = {
  title: "Leaving Naga",
  description: "Buses, vans, trains and flights from Naga to towns outside the city: the terminal, what is known about fares and departures, and when each fact was checked.",
};

// S24 (IC1). A static shell, listed in the worker's SHELL_PATHS: `?to=` (the destination) is read
// in the browser with useSearchParams inside Suspense, so one shell serves the list and every
// destination offline (plan deviation 1). The guide itself comes from
// GET /api/v1/network/intercity/:revisionId in the browser (cached CacheFirst by the worker).
export default function LeavingPage() {
  return (
    <Suspense fallback={<LeavingFallback />}>
      <LeavingScreen />
    </Suspense>
  );
}
