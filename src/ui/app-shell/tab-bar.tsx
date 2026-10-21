"use client";

// The app's tab bar (artboard Home "Main" nav; Components "Tab bar · Liquid Glass over the map"):
// a glass pill 16 px from the sides and 24 px from the bottom, over the map and the tab pages.
// Map · Explore · Saved · Community · More (task B7 adds Community now that it has content). The current
// tab carries aria-current="page". AppFrame hides it in detail panels, and the home screen hides it
// whenever the map is not the whole screen: a pin being placed, planning, a trip's detail, guidance.
//
// Offline (Task 12): a soft navigation cannot reach the server, so while useIsOffline() is true
// the tabs are plain links (a document navigation) and the service worker serves the tab's
// static shell from its cache.

import "@/ui/kit/styles";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useIsOffline } from "@/client/pwa/connectivity";
import { useT } from "@/i18n/provider";

type Tab = { href: string; id: "map" | "explore" | "saved" | "community" | "more"; icon: string; strokeWidth?: number };

export const TABS: readonly Tab[] = [
  { href: "/app", id: "map", icon: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" },
  { href: "/app/explore", id: "explore", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z" },
  { href: "/app/saved", id: "saved", icon: "M6 3h12v18l-6-4.5L6 21z" },
  { href: "/app/community", id: "community", icon: "M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 19c0-2.5 2.5-4.5 5.5-4.5s5.5 2 5.5 4.5M14 14.7c.6-.2 1.2-.2 2-.2 2.8 0 5.5 1.8 5.5 4.5" },
  { href: "/app/more", id: "more", icon: "M5 12h.01M12 12h.01M19 12h.01", strokeWidth: 2.6 },
];

/** The tab a path belongs to: "/app" exactly for Map, otherwise the tab's section. */
export function activeTab(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname === "/app" || pathname === "/app/") return "/app";
  return TABS.find((t) => t.href !== "/app" && (pathname === t.href || pathname.startsWith(`${t.href}/`)))?.href ?? null;
}

/**
 * Reports how much of the bottom of the screen `ref` covers (innerHeight − its top edge): the pill,
 * its gap and the safe-area inset (home indicator) together, as laid out, so there is one source of
 * truth for the clearance. Re-measured on resize; reports 0 when it unmounts (the bar is hidden).
 */
export function useBottomClearance(ref: RefObject<HTMLElement | null>, report: (px: number) => void): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => report(Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)));
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      report(0);
    };
  }, [ref, report]);
}

export function TabBar({ onClearance, returning = false }: { onClearance: (px: number) => void; returning?: boolean }) {
  const current = activeTab(usePathname());
  const shell = useT().shell;
  const offline = useIsOffline();
  const Anchor = offline ? "a" : Link;
  const nav = useRef<HTMLElement>(null);
  useBottomClearance(nav, onClearance);
  return (
    <nav ref={nav} aria-label={shell.mainNav} className="pn-tabbar" data-tabbar="" data-returning={returning ? "" : undefined} data-testid="tab-bar">
      {TABS.map((tab) => (
        <Anchor
          key={tab.href}
          href={tab.href}
          className="pn-tabbar__tab"
          aria-current={current === tab.href ? "page" : undefined}
          data-testid={`tab-${tab.id}`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={tab.icon} />
          </svg>
          <span className="pn-tabbar__label">{shell.tabs[tab.id]}</span>
        </Anchor>
      ))}
    </nav>
  );
}
