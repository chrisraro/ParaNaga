"use client";

// Mapped stop pins for the current map view (GET /api/v1/stops?bbox=). The view is snapped to a
// grid (domain/geo/bbox.ts) so small pans reuse a query; requests are debounced, a superseded
// request is aborted, answers are validated with the shared schema and kept per bbox for the
// session. The bbox is never logged. A failure keeps the pins already shown: the map never blocks.

import { useEffect, useEffectEvent, useState } from "react";
import { stopsInBboxSchema, type StopPin } from "@/domain/api/schemas";
import { bboxParam, viewBbox } from "@/domain/geo/bbox";
import type { Bounds } from "@/domain/geo/types";

export const STOPS_DEBOUNCE_MS = 250;
/** Never draw more pins than this at once (the whole Naga package has 128). */
export const MAX_STOP_PINS = 400;
const CACHE_ENTRIES = 24;

export type StopsInView = {
  stops: readonly StopPin[];
  status: "idle" | "loading" | "ready" | "error";
  /** More pins matched than MAX_STOP_PINS; only the first ones are drawn. */
  truncated: boolean;
};

type Entry = { stops: readonly StopPin[]; truncated: boolean };
const NONE: Entry = { stops: [], truncated: false };

async function requestStops(key: string, signal: AbortSignal): Promise<Entry> {
  const response = await fetch(`/api/v1/stops?bbox=${encodeURIComponent(key)}`, { signal });
  if (!response.ok) throw new Error("stops request failed");
  const parsed = stopsInBboxSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("stops response invalid");
  const all = parsed.data.stops;
  return { stops: all.slice(0, MAX_STOP_PINS), truncated: all.length > MAX_STOP_PINS };
}

/**
 * `view` must be referentially stable between map moves (e.g. React state set from `moveend`): a new
 * bounds object is how the hook learns the map moved, and after a failure each new object retries.
 * Building it during render (`{ ...bounds }`) would retry after every render.
 */
export function useStopsInView(view: Bounds | null, enabled = true): StopsInView {
  const bbox = view ? viewBbox(view) : null;
  const key = enabled && bbox ? bboxParam(bbox) : null;
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map());
  const [shownKey, setShownKey] = useState<string | null>(null);
  // The view (bounds object) a request failed for: any later map move retries, even inside the
  // same grid cell, so "Move the map to try again" is true.
  const [failed, setFailed] = useState<{ key: string; view: Bounds | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const viewNow = useEffectEvent(() => view);

  const hit = key === null ? undefined : entries.get(key);
  // A cached view shows at once; adjust the "last shown" view during render, not in an effect.
  if (hit && shownKey !== key) setShownKey(key);
  if (failed !== null && (failed.key !== key || failed.view !== view)) {
    setFailed(null);
    if (failed.key === key) setAttempt((n) => n + 1);
  }
  const cached = hit !== undefined;

  useEffect(() => {
    if (key === null || cached) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestStops(key, controller.signal).then(
        (entry) => {
          if (controller.signal.aborted) return;
          setEntries((prev) => {
            const next = new Map(prev).set(key, entry);
            if (next.size > CACHE_ENTRIES) next.delete(next.keys().next().value!);
            return next;
          });
          setShownKey(key);
        },
        () => {
          if (!controller.signal.aborted) setFailed({ key, view: viewNow() });
        },
      );
    }, STOPS_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, cached, attempt]);

  if (!enabled) return { stops: NONE.stops, status: "idle", truncated: false };
  const shown = hit ?? (shownKey !== null ? entries.get(shownKey) : undefined) ?? NONE;
  const status = key === null ? "idle" : hit ? "ready" : failed?.key === key ? "error" : "loading";
  return { stops: shown.stops, status, truncated: shown.truncated };
}
