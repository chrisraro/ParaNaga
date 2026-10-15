"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assessFix,
  pickBetterFix,
  type FixAssessment,
  type LocationFix,
} from "@/domain/geo/location-fix";

export type GeolocationState =
  | "idle"
  | "requesting"
  | "watching"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "insecure";

export type UseGeolocation = {
  state: GeolocationState;
  fix: LocationFix | null;
  assessment: FixAssessment | null;
  /** Call only from a user gesture (tap). */
  start: () => void;
  stop: () => void;
};

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };
const REASSESS_MS = 5_000;

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function toFix(position: GeolocationPosition): LocationFix {
  const { latitude, longitude, accuracy, heading, speed } = position.coords;
  return { lat: latitude, lng: longitude, accuracy, timestamp: position.timestamp, heading, speed };
}

/**
 * Honest, battery-safe wrapper around the Geolocation API. Coordinates stay in React state only:
 * no network, no storage. The watch runs only after start(), and never while the tab is hidden.
 */
export function useGeolocation(): UseGeolocation {
  const [state, setState] = useState<GeolocationState>("idle");
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [assessment, setAssessment] = useState<FixAssessment | null>(null);

  const fixRef = useRef<LocationFix | null>(null);
  const watchId = useRef<number | null>(null);
  // The user wants a watch (true between start() and stop()/denied), even while hidden.
  const wanted = useRef(false);
  // True once the current start() session has received a success (fixRef may hold an older session's fix).
  const sessionHasFix = useRef(false);

  const clear = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const begin = useCallback(() => {
    if (watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        const next = pickBetterFix(fixRef.current, toFix(position), now);
        fixRef.current = next;
        sessionHasFix.current = true;
        setFix(next);
        setAssessment(assessFix(next, now));
        setState("watching");
      },
      (err) => {
        if (err.code === PERMISSION_DENIED) {
          wanted.current = false;
          clear();
          setState("denied");
        } else if (err.code === POSITION_UNAVAILABLE) {
          setState("unavailable");
        } else if (err.code === TIMEOUT) {
          setState(sessionHasFix.current ? "watching" : "timeout");
        }
      },
      WATCH_OPTIONS,
    );
  }, [clear]);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }
    if (!("geolocation" in navigator) || !navigator.geolocation) {
      setState("unsupported");
      return;
    }
    if (wanted.current) return;
    wanted.current = true;
    sessionHasFix.current = false;
    setState("requesting");
    if (document.visibilityState !== "hidden") begin();
  }, [begin]);

  const stop = useCallback(() => {
    wanted.current = false;
    clear();
    setState((s) => (s === "denied" || s === "unsupported" || s === "insecure" ? s : "idle"));
  }, [clear]);

  // Pause while hidden, resume on visible only if the user had started a watch.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clear();
      else if (wanted.current) begin();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wanted.current = false;
      clear();
    };
  }, [begin, clear]);

  // Re-assess staleness while a watch is wanted.
  const active = state === "requesting" || state === "watching";
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (fixRef.current) setAssessment(assessFix(fixRef.current, Date.now()));
    }, REASSESS_MS);
    return () => clearInterval(id);
  }, [active]);

  return { state, fix, assessment, start, stop };
}
