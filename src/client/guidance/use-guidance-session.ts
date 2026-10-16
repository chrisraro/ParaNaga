"use client";

// The guidance session for the home screen (Task 10): the store (sessionStorage), the optional
// location watch and the Screen Wake Lock.
//
// Location, by the privacy rules: never requested without a tap. "Start trip" turns the watch on
// only when the person already allowed location for ParaNaga (permission "granted", so no prompt
// appears); otherwise, and after a reload, each step offers "Use my location for progress". Every
// position the watch delivers is dispatched as a `fix` event (the reducer ignores unusable ones),
// so ride progress survives a reload. The watch and the wake lock stop the moment the session
// leaves the active state (Arrive, missed stop, End), before that screen renders, and they never
// come back on their own: "Undo last step" after Arrive needs a new tap.
//
// The wake lock (where supported) keeps the screen on while a session is active and visible; it is
// released on end and when the page is hidden, and asked for again when it shows.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useGeolocation, type GeolocationState } from "@/client/geo/use-geolocation";
import { recordTrip } from "@/client/history/trip-history";
import type { LocationFix } from "@/domain/geo/location-fix";
import { startSession, type GuidanceEvent, type GuidanceSession } from "@/domain/guidance/session";
import type { GuidanceTrip } from "@/domain/guidance/steps";
import { guidanceView, type GuidanceView } from "@/domain/guidance/view";
import type { SavedTrip } from "@/domain/saved/saved";
import {
  applyGuidanceEvent,
  beginGuidance,
  getGuidanceServerSnapshot,
  getGuidanceSnapshot,
  subscribeGuidance,
} from "./guidance-store";

export type GuidanceTap = Exclude<GuidanceEvent, { type: "fix" }>;

export type UseGuidanceSession = {
  session: GuidanceSession | null;
  card: SavedTrip | null;
  view: GuidanceView | null;
  /** When the view was computed (the last fix or clock tick), for the polite-announcement throttle. */
  now: number;
  location: { state: GeolocationState; fix: LocationFix | null; watching: boolean };
  /** "Start trip": records history (when on), starts the session, and the watch only if already allowed. */
  start: (trip: GuidanceTrip, card: SavedTrip) => void;
  /** A tap on a guidance button. */
  send: (event: GuidanceTap) => void;
  /** "Use my location for progress" (a tap). */
  enableLocation: () => void;
};

const TICK_MS = 5_000;

type Lock = { release: () => Promise<void> };
type WakeLockApi = { request: (type: "screen") => Promise<Lock> };

function wakeLockApi(): WakeLockApi | null {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return api && typeof api.request === "function" ? api : null;
}

/** True when the person already allowed location for this site (no prompt would appear). */
async function locationAllowed(): Promise<boolean> {
  try {
    if (!window.isSecureContext || typeof navigator.permissions?.query !== "function") return false;
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export function useGuidanceSession(): UseGuidanceSession {
  const snapshot = useSyncExternalStore(subscribeGuidance, getGuidanceSnapshot, getGuidanceServerSnapshot);
  const session = snapshot?.session ?? null;
  const active = session?.status === "active";
  // The view's clock: moved by each fix and by a tick while the watch runs (never read in render).
  const [now, setNow] = useState(0);

  const geo = useGeolocation({
    onFix: (fix, at) => {
      setNow(at);
      applyGuidanceEvent({ type: "fix", fix, now: at });
    },
  });
  const geoStop = geo.stop;
  const geoActive = geo.state === "requesting" || geo.state === "watching" || geo.state === "unavailable" || geo.state === "timeout";

  // ---- wake lock
  const lock = useRef<Lock | null>(null);
  const releaseLock = useCallback(() => {
    const held = lock.current;
    lock.current = null;
    void held?.release().catch(() => undefined);
  }, []);
  useEffect(() => {
    const api = active ? wakeLockApi() : null;
    if (!api) return undefined;
    let cancelled = false;
    const request = () => {
      if (document.visibilityState !== "visible" || lock.current) return;
      api.request("screen").then(
        (held) => {
          if (cancelled || lock.current) void held.release().catch(() => undefined);
          else lock.current = held;
        },
        () => undefined,
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseLock();
      else request();
    };
    request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      releaseLock();
    };
  }, [active, releaseLock]);

  // ---- clock tick while watching (staleness of the walk distance)
  useEffect(() => {
    if (!active || !geoActive) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    // Timers are throttled or paused in a background tab: on return, move the clock at once so a
    // stale fix is shown as stale immediately, not up to one tick later.
    const onVisibility = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, geoActive]);

  // ---- minute tick while active: the time left is estimated from the clock (peak windows), also
  // with no location watch and right after a reload (the clock starts at 0 until something moves it).
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active]);

  // Backstop: no watch outside an active session (restored ended state, cleared data, a session
  // ended in another way). The taps below already stop it before the next screen renders.
  useEffect(() => {
    if (!active && geoActive) geoStop();
  }, [active, geoActive, geoStop]);

  const stopEverything = useCallback(() => {
    geoStop();
    releaseLock();
  }, [geoStop, releaseLock]);

  const geoStart = geo.start;
  const start = useCallback(
    (trip: GuidanceTrip, card: SavedTrip) => {
      const at = Date.now();
      setNow(at);
      beginGuidance(startSession(trip, at), card);
      void recordTrip(card.start.label, card.destination.label).catch(() => undefined);
      void locationAllowed().then((allowed) => {
        if (allowed && getGuidanceSnapshot()?.session.status === "active") geoStart();
      });
    },
    [geoStart],
  );

  const send = useCallback(
    (event: GuidanceTap) => {
      const before = getGuidanceSnapshot()?.session ?? null;
      if (!before) return;
      // Peek at the outcome: anything but an active session uses no location. Stop first, so the
      // next screen ("location tracking is off") is never shown while a watch still runs.
      const after = applyGuidanceEvent(event);
      if (!after || after.status !== "active") stopEverything();
      setNow(Date.now());
    },
    [stopEverything],
  );

  const enableLocation = useCallback(() => {
    if (getGuidanceSnapshot()?.session.status !== "active") return;
    geoStart();
  }, [geoStart]);

  const watching = geo.state === "watching";
  const fix = watching ? geo.fix : null;
  const view = session ? guidanceView(session, fix, now) : null;
  return {
    session,
    card: snapshot?.card ?? null,
    view,
    now,
    location: { state: geo.state, fix: geo.fix, watching },
    start,
    send,
    enableLocation,
  };
}
