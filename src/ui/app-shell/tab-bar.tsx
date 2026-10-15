"use client";

// The app's tab bar (artboard Home "Main" nav; Components "Tab bar · Liquid Glass over the map"):
// a glass pill 16 px from the sides and 24 px from the bottom, over the map and the tab pages.
// Map · Explore · Saved · More (decision D4: no Community tab until it has content). The current
// tab carries aria-current="page". AppFrame hides it in detail panels, while a pin is being placed
// and while guidance runs.

import "@/ui/kit/styles";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Height the tab bar takes at the bottom of the screen: 24 px gap + 66 px pill (kit.css). */
export const TAB_BAR_CLEARANCE = 90;

type Tab = { href: string; label: string; icon: string; strokeWidth?: number };

export const TABS: readonly Tab[] = [
  { href: "/app", label: "Map", icon: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" },
  { href: "/app/explore", label: "Explore", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z" },
  { href: "/app/saved", label: "Saved", icon: "M6 3h12v18l-6-4.5L6 21z" },
  { href: "/app/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01", strokeWidth: 2.6 },
];

/** The tab a path belongs to: "/app" exactly for Map, otherwise the tab's section. */
export function activeTab(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname === "/app" || pathname === "/app/") return "/app";
  return TABS.find((t) => t.href !== "/app" && (pathname === t.href || pathname.startsWith(`${t.href}/`)))?.href ?? null;
}

export function TabBar() {
  const current = activeTab(usePathname());
  return (
    <nav aria-label="Main" className="pn-tabbar" data-tabbar="" data-testid="tab-bar">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="pn-tabbar__tab"
          aria-current={current === tab.href ? "page" : undefined}
          data-testid={`tab-${tab.label.toLowerCase()}`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={tab.icon} />
          </svg>
          <span className="pn-tabbar__label">{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
