"use client";

// Shared frame for the Stop and Route detail panels (artboards StopDetail / RouteDetail header:
// round back button, centred screen name, optional round action on the right), plus the loading,
// not-found and error states. The panel covers the home map, which stays mounted underneath.

import "./detail.css";
import "@/ui/trip/trip.css";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cameFromInsideApp, useAppFrame, useAppPanel } from "@/ui/app-shell/app-frame-context";
import { BackButton, useEscapeToClose, useFocusOnMount } from "@/ui/app-shell/panel";
import { useIsOffline } from "@/client/pwa/connectivity";
import type { Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";

// Shared panel behaviour lives in the shell (src/ui/app-shell/panel.tsx); re-exported for the
// detail screens that import it from here.
export { BackIcon, useFocusOnMount } from "@/ui/app-shell/panel";

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
 * Back to the map after setting a trip end: history when the map opened this panel, else open the
 * map (no extra history entry otherwise).
 */
export function useReturnToMap(): () => void {
  const frame = useAppFrame();
  const router = useRouter();
  return () => {
    if (cameFromInsideApp() && frame?.isHomeNavigation(window.location.pathname)) router.back();
    else router.push("/app");
  };
}

type PanelProps = {
  /** Screen name in the header ("Stop", "Route"); empty for none. */
  title: string;
  /** Round action on the right of the header; a spacer keeps the title centred without one. */
  action?: ReactNode;
  /** The one small "Sources" link (to Sources and credits), for a screen that shows data. */
  sources?: string;
  children: ReactNode;
  testId?: string;
};

/**
 * Full-screen detail panel: marks itself open on the app frame (the map underneath turns inert and
 * the tab bar hides), with a Back button; Escape goes back too.
 */
export function DetailPanel({ title, action, sources, children, testId }: PanelProps) {
  const t = useT().detail;
  useAppPanel("detail");
  const root = useRef<HTMLDivElement>(null);
  useEscapeToClose(root);
  return (
    <div ref={root} className="pn-detail" data-testid={testId}>
      <header className="pn-detail__header">
        <BackButton />
        <span className="pn-detail__header-title">{title}</span>
        <span className="pn-detail__header-end">
          {sources ? (
            <Link href={sources} className="pn-detail__sources" aria-label={t.sourcesLabel} data-testid="detail-sources">
              {t.sources}
            </Link>
          ) : null}
          {action ?? <span className="pn-detail__spacer" aria-hidden="true" />}
        </span>
      </header>
      {children}
    </div>
  );
}

/**
 * The panel's loading state. Offline (useOffline: the page's data cannot arrive until the network
 * returns, Next keeps the navigation pending and retries it), it says so instead of a skeleton;
 * the home map and its trip stay as they were underneath (F-03).
 */
export function DetailLoading({ title: titleProp, what }: { title?: string; what?: "stop" | "route" | "place" | "terminal" }) {
  const t = useT();
  const title = what ? t.detail[what] : (titleProp ?? "");
  const offline = useIsOffline();
  if (offline) {
    return (
      <DetailPanel title={title} testId="detail-offline">
        <div className="pn-detail__state" role="status">
          <p>{t.pwa.panelOffline}</p>
        </div>
      </DetailPanel>
    );
  }
  return (
    <DetailPanel title={title} testId="detail-loading">
      <div className="pn-detail__state" role="status" aria-label={t.detail.loading(title)}>
        <div className="pn-skeleton" style={{ width: "60%", height: 34 }} />
        <div className="pn-skeleton" style={{ width: "40%" }} />
        <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
      </div>
    </DetailPanel>
  );
}

// The header names the screen; the h1 says "not found" (the page itself gets no header name, so
// "Not found" is never shown twice).
type NotFoundKind = "stop" | "route" | "place" | "terminal" | "page";

function kindFromPath(pathname: string | null): NotFoundKind {
  if (pathname?.startsWith("/app/stops/")) return "stop";
  if (pathname?.startsWith("/app/routes/")) return "route";
  if (pathname?.startsWith("/app/places/")) return "place";
  if (pathname?.startsWith("/app/terminals/")) return "terminal";
  return "page";
}

const notFoundCopy = (t: Dict["detail"]): Record<NotFoundKind, { name: string; title: string; copy: string }> => ({
  stop: { name: t.stop, title: t.stopNotFound, copy: t.stopNotFoundCopy },
  route: { name: t.route, title: t.routeNotFound, copy: t.routeNotFoundCopy },
  place: { name: t.place, title: t.placeNotFound, copy: t.placeNotFoundCopy },
  terminal: { name: t.terminal, title: t.terminalNotFound, copy: t.terminalNotFoundCopy },
  page: { name: "", title: t.pageNotFound, copy: t.pageNotFoundCopy },
});

export function DetailNotFound({ what: whatProp }: { what?: NotFoundKind }) {
  const pathname = usePathname();
  const what = whatProp ?? kindFromPath(pathname);
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const t = useT().detail;
  const { name, title, copy } = notFoundCopy(t)[what];
  // An honest tab title: the page's static metadata says "Stop · ParaNaga" (the id is only known
  // at runtime, and the response is already streaming with HTTP 200 when notFound() is reached).
  // The cleanup restores the old title only if it is still ours: when leaving for another route,
  // React may already have applied that route's <title> before this cleanup runs.
  useEffect(() => {
    const previous = document.title;
    const mine = t.notFoundTabTitle(title);
    document.title = mine;
    return () => {
      if (document.title === mine) document.title = previous;
    };
  }, [title, t]);
  return (
    <DetailPanel title={name} testId="detail-not-found">
      <main className="pn-detail__state">
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p>{copy}</p>
        <Link href="/app" className="pn-detail__retry" style={{ display: "inline-flex", alignItems: "center" }}>
          {t.backToMap}
        </Link>
      </main>
    </DetailPanel>
  );
}

export function DetailError({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  const t = useT();
  return (
    <DetailPanel title={title} testId="detail-error">
      <main className="pn-detail__state">
        <h1>{offline ? t.detail.offline : t.detail.couldNotLoad(title)}</h1>
        <p role="alert">{offline ? t.detail.checkConnection : t.detail.wentWrong}</p>
        <button type="button" className="pn-detail__retry" onClick={onRetry}>
          {t.trip.tryAgain}
        </button>
      </main>
    </DetailPanel>
  );
}
