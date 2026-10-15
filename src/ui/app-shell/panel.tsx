"use client";

// Behaviour shared by every full-screen panel over the home map, detail panels
// (src/ui/detail/detail-frame.tsx) and tab pages (page-frame.tsx) alike: the round Back button,
// Escape to go back, and focus on the screen's h1 when it opens. Lives in the shell so the kit
// and the feature panels both depend on it, not on each other.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type RefObject } from "react";
import { cameFromInsideApp } from "./app-frame-context";

export function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/**
 * Escape closes the panel whose root is `panel`, exactly like Back (history after an in-app
 * navigation, else the map). Once per panel (a held or double Escape must not go back twice), and
 * never while the app is covered by the large-screen overlay or a modal (inert), or when something
 * inside already handled the key (a dialog calls preventDefault).
 */
export function useEscapeToClose(panel: RefObject<HTMLElement | null>) {
  const router = useRouter();
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat || e.defaultPrevented || closing.current) return;
      if (!panel.current || panel.current.closest("[inert]")) return;
      e.preventDefault();
      closing.current = true;
      if (cameFromInsideApp()) router.back();
      else router.push("/app");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, panel]);
}

/**
 * Round "Back" button: history back after an in-app navigation (map → stop → route), otherwise a
 * link to the map, so a page opened from a shared link never leaves the site.
 */
export function BackButton() {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !cameFromInsideApp()) return;
    e.preventDefault();
    router.back();
  };
  return (
    <Link href="/app" aria-label="Back" className="pn-detail__round" onClick={onClick} data-testid="detail-back">
      <BackIcon />
    </Link>
  );
}

/** Focuses the screen's h1 once it has rendered (the panel replaced the whole view). */
export function useFocusOnMount<T extends HTMLElement>(ready: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ready) ref.current?.focus();
  }, [ready]);
  return ref;
}
