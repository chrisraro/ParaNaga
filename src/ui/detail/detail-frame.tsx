"use client";

// Shared frame for the Stop and Route detail panels (artboards StopDetail / RouteDetail header:
// round back button, centred screen name, optional round action on the right), plus the loading,
// not-found and error states. The panel covers the home map, which stays mounted underneath.

import "./detail.css";
import "@/ui/trip/trip.css";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { cameFromInsideApp, useAppPanel } from "@/ui/app-shell/app-frame-context";

export function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function MapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
    </svg>
  );
}

export function WarnIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </svg>
  );
}

export function ChevronRight() {
  return (
    <svg className="pn-cell__chevron" width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 2l6 6-6 6" />
    </svg>
  );
}

/**
 * The map's candidate pin as an icon: hollow amber ring; `onRoute` adds the small filled centre
 * used for stops a provisional route order lists (Loops A and B).
 */
export function CandidateRing({ size = 30, onRoute = false }: { size?: number; onRoute?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      <circle cx="20" cy="20" r="13" fill="var(--pn-surface)" stroke="#E8A317" strokeWidth="4" />
      {onRoute ? <circle cx="20" cy="20" r="5" fill="#E8A317" /> : null}
    </svg>
  );
}

/**
 * Round "Back" button: history back after an in-app navigation (map → stop → route), otherwise a
 * link to the map, so a page opened from a shared link never leaves the site.
 */
function BackButton() {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !cameFromInsideApp()) return;
    e.preventDefault();
    router.back();
  };
  // Escape closes the panel exactly like Back (history after an in-app navigation, else the map).
  // Once per panel (a held or double Escape must not go back twice), and never while the app is
  // covered by the large-screen overlay (inert).
  const link = useRef<HTMLAnchorElement>(null);
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat || e.defaultPrevented || closing.current) return;
      if (link.current?.closest("[inert]")) return;
      e.preventDefault();
      closing.current = true;
      if (cameFromInsideApp()) router.back();
      else router.push("/app");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return (
    <Link ref={link} href="/app" aria-label="Back" className="pn-detail__round" onClick={onClick} data-testid="detail-back">
      <BackIcon />
    </Link>
  );
}

type PanelProps = {
  /** Screen name in the header ("Stop", "Route"); empty for none. */
  title: string;
  /** Round action on the right of the header; a spacer keeps the title centred without one. */
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
};

/** Full-screen panel: marks itself open on the app frame (the map underneath turns inert). */
export function DetailPanel({ title, action, children, testId }: PanelProps) {
  useAppPanel();
  return (
    <div className="pn-detail" data-testid={testId}>
      <header className="pn-detail__header">
        <BackButton />
        <span className="pn-detail__header-title">{title}</span>
        {action ?? <span className="pn-detail__spacer" aria-hidden="true" />}
      </header>
      {children}
    </div>
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

export function DetailLoading({ title }: { title: string }) {
  return (
    <DetailPanel title={title} testId="detail-loading">
      <div className="pn-detail__state" role="status" aria-label={`Loading ${title.toLowerCase()}`}>
        <div className="pn-skeleton" style={{ width: "60%", height: 34 }} />
        <div className="pn-skeleton" style={{ width: "40%" }} />
        <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
      </div>
    </DetailPanel>
  );
}

// The header names the screen; the h1 says "not found" (the page itself gets no header name, so
// "Not found" is never shown twice).
const SCREEN_NAME = { stop: "Stop", route: "Route", page: "" } as const;
type NotFoundKind = keyof typeof SCREEN_NAME;

function kindFromPath(pathname: string | null): NotFoundKind {
  if (pathname?.startsWith("/app/stops/")) return "stop";
  if (pathname?.startsWith("/app/routes/")) return "route";
  return "page";
}

export function DetailNotFound({ what: whatProp }: { what?: NotFoundKind }) {
  const pathname = usePathname();
  const what = whatProp ?? kindFromPath(pathname);
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const title = what === "stop" ? "Stop not found" : what === "route" ? "Route not found" : "Not found";
  // An honest tab title: the page's static metadata says "Stop · ParaNaga" (the id is only known
  // at runtime, and the response is already streaming with HTTP 200 when notFound() is reached).
  // The cleanup restores the old title only if it is still ours: when leaving for another route,
  // React may already have applied that route's <title> before this cleanup runs.
  useEffect(() => {
    const previous = document.title;
    const mine = `${title} · ParaNaga`;
    document.title = mine;
    return () => {
      if (document.title === mine) document.title = previous;
    };
  }, [title]);
  const copy =
    what === "stop"
      ? "No published stop has this link. It may have been removed or replaced in a newer data revision."
      : what === "route"
        ? "No published route has this code."
        : "There is nothing at this link.";
  return (
    <DetailPanel title={SCREEN_NAME[what]} testId="detail-not-found">
      <main className="pn-detail__state">
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p>{copy}</p>
        <Link href="/app" className="pn-detail__retry" style={{ display: "inline-flex", alignItems: "center" }}>
          Back to map
        </Link>
      </main>
    </DetailPanel>
  );
}

export function DetailError({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  return (
    <DetailPanel title={title} testId="detail-error">
      <main className="pn-detail__state">
        <h1>{offline ? "You are offline" : `Could not load this ${title.toLowerCase()}`}</h1>
        <p role="alert">{offline ? "Check your connection, then try again." : "Something went wrong on our side. Try again."}</p>
        <button type="button" className="pn-detail__retry" onClick={onRetry}>
          Try again
        </button>
      </main>
    </DetailPanel>
  );
}
