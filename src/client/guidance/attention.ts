// Vibration and a system notification for the moments the rider must not miss (say "Para", get
// ready, near the destination). `newAttention` is pure: one alert per transition, and a new step
// has a new key, so a later ride can alert again. Notification permission is only ever asked from
// a tap (`askNotificationPermission`); without it only the vibration (where supported) fires.

import { useEffect, useRef } from "react";
import type { Attention, GuidanceView } from "@/domain/guidance/view";

export const ATTENTION_TAG = "paranaga-guidance";

/** The alert to fire for prev -> next, or null when there is none or it already fired. */
export function newAttention(prev: GuidanceView | null, next: GuidanceView | null): Attention | null {
  const of = (v: GuidanceView | null) => (v && (v.screen === "ride" || v.screen === "walk") ? v.attention : null);
  const a = of(next);
  return a && a.key !== of(prev)?.key ? a : null;
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

/** Fires once per new alert in the view (not per render or fix). */
export function useAttention(view: GuidanceView | null): void {
  const prev = useRef<GuidanceView | null>(null);
  useEffect(() => {
    const a = newAttention(prev.current, view);
    prev.current = view;
    if (a) fireAttention(a);
  }, [view]);
}
