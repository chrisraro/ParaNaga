"use client";

// The browser Back button steps out of the home screen one state at a time (guidance, detail,
// directions, map): one history entry per state above the map, pushed with the same URL. An entry
// carries only its depth (`pn`), never a coordinate. Next's router patches pushState (it copies its
// own state into ours), so this does not fight it.
//
// `level` is the screen's depth (historyDepth). The effect keeps the entries equal to it: it pushes
// when the level rises and goes back when the level falls (the on-screen Back, Escape, End). A
// popstate to a shallower entry runs `stepOut`; the effect then puts an entry back if the screen did
// not actually step out (a confirm dialog opened, a pin was cancelled). Entries without a `pn` on
// the map's own path count as depth 0; anything on another path (a panel) is left alone.

import { useEffect, useRef, useState } from "react";

/** How long the history must be quiet before an entry is pushed or dropped. */
const SETTLE_MS = 60;

function entryDepth(state: unknown): number | null {
  const pn = (state as { pn?: unknown } | null)?.pn;
  if (typeof pn === "number") return pn;
  return window.location.pathname === "/app" ? 0 : null;
}

export function useStepHistory(level: number, enabled: boolean, stepOut: () => void): void {
  const depth = useRef(0);
  // popstate events caused by our own history.go(): not the user's Back.
  const ignore = useRef(0);
  const [tick, setTick] = useState(0);
  const onStepOut = useRef(stepOut);
  const on = useRef(enabled);
  useEffect(() => {
    onStepOut.current = stepOut;
    on.current = enabled;
  });

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (ignore.current > 0) {
        ignore.current -= 1;
        return;
      }
      const pn = entryDepth(event.state);
      // Whatever just happened to the history, check the entries against the screen again.
      setTick((n) => n + 1);
      if (pn === null || !on.current) return;
      if (pn > depth.current) {
        // Forward onto an entry the screen no longer shows (or a reload): step back off it.
        ignore.current += 1;
        window.history.go(depth.current - pn);
      } else if (pn < depth.current) {
        depth.current = pn;
        onStepOut.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    // Settled first: a back() from a panel (search picking a place) may still be in flight, and an
    // entry pushed under it is dropped by it. Any popstate runs this effect again (the tick), so the
    // entries are only touched once the history has been quiet for a moment, on the map's own entry.
    const id = window.setTimeout(() => {
      if (window.location.pathname !== "/app") return;
      if (level > depth.current) {
        for (let i = depth.current + 1; i <= level; i += 1) window.history.pushState({ pn: i }, "");
        depth.current = level;
      } else if (level < depth.current) {
        const onEntry = (window.history.state as { pn?: unknown } | null)?.pn === depth.current;
        const delta = level - depth.current;
        depth.current = level;
        if (onEntry) {
          ignore.current += 1;
          window.history.go(delta);
        }
      }
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [level, enabled, tick]);
}
