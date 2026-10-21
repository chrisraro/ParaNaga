// Vibration and a system notification for the moments the rider must not miss (say "Para", get
// ready, near the destination). `newAttention` is pure: each alert key fires once per trip (GPS
// wobbling in and out of "near" never buzzes twice), and a new step has a new key, so a later ride
// can alert again. Notification permission is only ever asked from
// a tap (`askNotificationPermission`); without it only the vibration (where supported) fires.

import { useEffect, useRef } from "react";
import type { Attention, GuidanceView } from "@/domain/guidance/view";

export const ATTENTION_TAG = "paranaga-guidance";

/** The view's alert, or null when there is none or its key already fired this trip. */
export function newAttention(fired: ReadonlySet<string>, view: GuidanceView | null): Attention | null {
  const a = view && (view.screen === "ride" || view.screen === "walk") ? view.attention : null;
  return a && !fired.has(a.key) ? a : null;
}

/** From a tap only: asks once, when the choice has not been made. */
export function askNotificationPermission(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
}

async function notify({ title, body }: Attention): Promise<void> {
  const options = { body, tag: ATTENTION_TAG, renotify: true, icon: "/icons/icon-192.png" } as NotificationOptions;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) return await registration.showNotification(title, options);
  } catch {
    // fall through to the page notification
  }
  new Notification(title, options);
}

export function fireAttention(a: Attention): void {
  navigator.vibrate?.([300, 150, 300]);
  if (typeof Notification !== "undefined" && Notification.permission === "granted") void notify(a).catch(() => undefined);
}

/** Fires each alert once per trip (`tripId`: the session's start time); not per render or fix. */
export function useAttention(view: GuidanceView | null, tripId: number | null): void {
  const fired = useRef<{ tripId: number | null; keys: Set<string> }>({ tripId: null, keys: new Set() });
  useEffect(() => {
    if (fired.current.tripId !== tripId) fired.current = { tripId, keys: new Set() };
    const a = newAttention(fired.current.keys, view);
    if (!a) return;
    fired.current.keys.add(a.key);
    fireAttention(a);
  }, [view, tripId]);
}
