"use client";

// Install ParaNaga (More → Install). Honest by construction: the button exists only when the
// browser has actually offered an install (Chromium's `beforeinstallprompt`, kept here when it
// fires); iPhone and iPad Safari get the Share → "Add to Home Screen" instructions; a running
// installed app (display-mode: standalone) says "Installed". Nothing is ever prompted unasked.

import { useSyncExternalStore } from "react";

/** Chromium's install prompt event (not in the DOM typings). */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type InstallState = "installed" | "prompt" | "ios" | "other";

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
let listening = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Starts listening for the browser's install offer; call once, as early as possible. */
export function listenForInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // An offer that came before hydration was kept by public/theme-init.js.
  const early = (window as Window & { __pnInstallPrompt?: InstallPromptEvent }).__pnInstallPrompt;
  if (early) {
    deferred = early;
    delete (window as Window & { __pnInstallPrompt?: InstallPromptEvent }).__pnInstallPrompt;
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep it for the button; never shown unasked
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    emit();
  });
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/** iPhone, iPad (including iPadOS reporting as a Mac with touch) and iPod. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** "On iPhone: …" / "On iPad: …" (Share, then “Add to Home Screen”). */
export function iosInstallText(userAgent: string): string {
  const device = /iPhone|iPod/.test(userAgent) ? "iPhone" : "iPad";
  return `On ${device}: tap Share, then “Add to Home Screen”.`;
}

export function installState(): InstallState {
  if (installedNow || isStandalone()) return "installed";
  if (deferred) return "prompt";
  if (isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return "ios";
  return "other";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallState(): InstallState | null {
  return useSyncExternalStore(subscribe, installState, () => null);
}

/** Shows the browser's own install dialog (only after a tap on "Install ParaNaga"). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null; // a prompt event can be used once
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") installedNow = true;
  emit();
  return outcome;
}

/** Tests only. */
export function resetInstallForTests(): void {
  deferred = null;
  installedNow = false;
  listening = false;
  listeners.clear();
}
