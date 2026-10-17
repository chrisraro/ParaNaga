"use client";

// Mapped stop pins for the current map view, from the published network snapshot (decision D2):
// the snapshot is loaded once (src/client/network/use-snapshot.ts, kept by the service worker so
// it works offline) and filtered in memory, so no map view ever reaches the server
// (GET /api/v1/stops?bbox= stays for API clients only). The view is snapped to the same grid as
// before (domain/geo/bbox.ts) and at most MAX_STOP_PINS pins are drawn. A failed load keeps the
// map usable; any later map move tries again.

import { useEffect, useEffectEvent, useMemo } from "react";
import type { StopPin } from "@/domain/api/schemas";
import { viewBbox } from "@/domain/geo/bbox";
import type { Bounds } from "@/domain/geo/types";
import { pinsInBounds, snapshotPins } from "@/domain/network/snapshot-pins";
import { useSnapshot } from "@/client/network/use-snapshot";

/** Never draw more pins than this at once (the whole Naga package has 128). */
export const MAX_STOP_PINS = 400;

export type StopsInView = {
  stops: readonly StopPin[];
  status: "idle" | "loading" | "ready" | "error";
  /** More pins matched than MAX_STOP_PINS; only the first ones are drawn. */
  truncated: boolean;
};

/** One shared empty list: a fresh `[]` per render would change an effect dependency on every render. */
const NO_STOPS: readonly StopPin[] = [];
const IDLE: StopsInView = { stops: NO_STOPS, status: "idle", truncated: false };

/**
 * `view` must be referentially stable between map moves (e.g. React state set from `moveend`): a
 * new bounds object is how the hook learns the map moved, and after a failure each new object
 * retries the snapshot.
 */
export function useStopsInView(view: Bounds | null, enabled = true): StopsInView {
  const snapshot = useSnapshot(enabled);
  const pins = useMemo(() => (snapshot.snapshot ? snapshotPins(snapshot.snapshot) : null), [snapshot.snapshot]);
  const bbox = enabled && view ? viewBbox(view) : null;
  const key = bbox ? `${bbox.west},${bbox.south},${bbox.east},${bbox.north}` : null;

  const inView = useMemo(() => {
    if (!pins || !bbox) return null;
    const all = pinsInBounds(pins, bbox);
    return { stops: all.slice(0, MAX_STOP_PINS), truncated: all.length > MAX_STOP_PINS };
    // `bbox` is encoded exactly by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, key]);

  // "Move the map to try again": a new view after a failed load retries it.
  const failed = snapshot.status === "error";
  const retryIfFailed = useEffectEvent(() => {
    if (failed && enabled) snapshot.retry();
  });
  // Only a new view object retries; the failure itself does not loop.
  useEffect(() => retryIfFailed(), [view]);

  if (!enabled || key === null) return IDLE;
  if (inView) return { stops: inView.stops, status: "ready", truncated: inView.truncated };
  return { stops: NO_STOPS, status: failed ? "error" : "loading", truncated: false };
}
