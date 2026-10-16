"use client";

// Sources and credits (spec S22; More → About, and the one "Sources" link on every detail screen):
// where every data, estimate, photo and licence credit lives, so the working screens carry none. The register of every source the published
// revision cites (GET /api/v1/sources), ordered by code. Each row: "{code} · {title}", "{evidence
// type} · published {date or text} · checked {date}", and "Open source" when the source has an
// http(s) address with no query string, or an allow-listed one (externalHref: the My Maps viewer
// S39), opened in a new tab with rel="noopener noreferrer" and nothing appended; the KML export
// (S40) is listed without a link, since it downloads a file. The
// only attribution of the public stop map is its owner's display name, never as a verified identity.

import "@/ui/kit/styles";
import "./help.css";

import { useNetworkResource } from "@/client/network/use-network-resource";
import { sourceListSchema } from "@/domain/api/schemas";
import { externalHref, sourceMetaLine, sourceTitleLine } from "@/domain/sources/present";
import { useEffect, useRef } from "react";
import { DetailPanel } from "@/ui/detail/detail-frame";
import Link from "next/link";
import { Suspense } from "react";
import { EXPLORE_PLACES_NOTE, RAIL_STATUS_TEXT, railSourcesText } from "@/domain/places/explore";
import { EntitySources } from "./entity-sources";
import { formatIsoDate, publishedDateText } from "@/domain/network/present";
import { Note } from "@/ui/kit/note";
import { ListGroup } from "@/ui/kit/list";
import { OsmAttribution } from "@/ui/kit/osm-attribution";
import { DataRevisionRow } from "@/ui/settings/data-revision-row";
import { SourceCredits } from "./source-credits";
import { rightsForSource } from "@/domain/sources/rights";

/** The My Maps retrieval date comes from the register (S39 checked date), never typed here. */
export const dataBasisNote = (retrieved: string | null) => `Stops come from a public My Maps snapshot (retrieved ${formatIsoDate(retrieved) ?? "date not recorded"}). Nobody has checked boarding sides, signs or whether boarding is allowed. Ride paths are traced along OpenStreetMap roads between pins; walk paths follow mapped walkable streets or straight-line estimates (× 1.3).`;
export const FLEET_BASIS_NOTE = "Fleet: the project owner confirmed on 16 Oct 2026 (U01) that traditional jeepneys run on every route group (R1–R8) and modern jeepneys on R4 and R7. This confirms service, not stop locations, stop order or paths.";
export const FARE_BASIS_NOTE = "Fares are estimates from reported fare rules; the fare matrix is not verified. Where a route runs both traditional and modern jeepneys, the range spans both. Discounts are not applied. National per-km rates of 28 Sep 2026. The tricycle minimum fare of ₱15 follows Ordinance 2024-002.";
export const TIME_BASIS_NOTE = "Times are ranges from typical walking and jeepney speeds. Each speed and window cites the sources below; the unmarked ends are ParaNaga assumptions.";
export const CORRECTIONS_NOTE = "Corrections and verification aren’t open yet.";
export const MAP_OWNER_NOTE = "Naga City Designated Stops — shared publicly by Tan Gumba";

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function SourcesScreen() {
  const resource = useNetworkResource("/api/v1/sources", sourceListSchema);
  const heading = useRef<HTMLHeadingElement>(null);
  // A hash link (#photo-…, #fare-basis) lands on its target; otherwise the h1 takes focus.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    // Lands on the target once it exists: the first frame after mount (after the router's own hash
    // handling), or the moment the source list renders it.
    const place = (): boolean => {
      const target = id ? document.getElementById(id) : null;
      if (!target) return false;
      target.tabIndex = -1;
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
      if (document.activeElement !== target) {
        // Not focusable itself (a list item): its first link, or its heading, takes focus.
        const inner = target.querySelector<HTMLElement>("a[href], h2");
        if (inner) {
          if (!inner.matches("a[href]")) inner.tabIndex = -1;
          inner.focus({ preventScroll: true });
        }
      }
      // Content above that grows afterwards (images, late rows) keeps the target at the top until
      // the rider scrolls or taps.
      const grow = new ResizeObserver(() => target.scrollIntoView({ block: "start" }));
      grow.observe(target.closest("main") ?? document.body);
      const stop = () => grow.disconnect();
      stopGrow = stop;
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(type, stop, { once: true, passive: true });
      return true;
    };
    let stopGrow: (() => void) | undefined;
    let observer: MutationObserver | undefined;
    const frame = requestAnimationFrame(() => {
      if (!id) heading.current?.focus();
      else if (!place()) {
        observer = new MutationObserver(() => {
          if (place()) observer?.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      stopGrow?.();
    };
  }, []);
  return (
    <DetailPanel title="Sources" testId="sources-page">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          Sources and credits
        </h1>
        <ListGroup label="Data revision" testId="sources-revision-group">
          <DataRevisionRow testId="sources-data-revision" />
        </ListGroup>
        <Suspense fallback={null}>
          <EntitySources />
        </Suspense>
        <section aria-labelledby="data-basis" className="pn-section">
          <h2 id="data-basis" className="pn-section__title">Data basis</h2>
          <p className="pn-footnote" data-testid="sources-data-basis">{dataBasisNote(resource.status === "ready" ? (resource.data.sources.find((x) => x.code === "S39")?.checkedOn ?? null) : null)}</p>
          <p className="pn-footnote">{FLEET_BASIS_NOTE}</p>
        </section>
        <section aria-labelledby="fare-basis-title" className="pn-section" id="fare-basis">
          <h2 id="fare-basis-title" className="pn-section__title">How fares are estimated</h2>
          <p className="pn-footnote" data-testid="sources-fare-basis">{FARE_BASIS_NOTE}</p>
        </section>
        <section aria-labelledby="time-basis" className="pn-section">
          <h2 id="time-basis" className="pn-section__title">How times are estimated</h2>
          <p className="pn-footnote">{TIME_BASIS_NOTE} <Link href="/app/help/how-times-are-estimated">How times are estimated</Link></p>
        </section>
        {resource.status === "loading" ? (
          <div role="status" aria-label="Loading sources" className="pn-detail__stack">
            <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
            <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
          </div>
        ) : resource.status === "ready" ? (
          <>
            <p className="pn-footnote" data-testid="sources-revision">
              Cited by the published data revision {resource.data.revision.label}{publishedDateText(resource.data.revision.publishedAt) ? `, published ${publishedDateText(resource.data.revision.publishedAt)}` : ""}.
            </p>
            <ul className="pn-group" data-testid="sources-list">
              {resource.data.sources.map((s) => {
                const href = externalHref(s.url);
                return (
                  <li key={s.code} className="pn-source" data-testid="source-row" data-code={s.code}>
                    <span className="pn-source__title">{sourceTitleLine(s)}</span>
                    <span className="pn-source__meta">{sourceMetaLine(s)}</span>
                    <span className="pn-source__meta">{rightsForSource(s.code)?.publisher ?? "Publisher not recorded"} · {rightsForSource(s.code)?.license ?? "Reuse rights not recorded"}</span>
                    {href ? (
                      <a
                        className="pn-source__link"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open source ${s.code} (opens in a new tab)`}
                        data-testid="source-link"
                      >
                        Open source
                        <ExternalIcon />
                      </a>
                    ) : (
                      <span className="pn-source__none" data-testid="source-unlinked">
                        {s.url ? "Address on file, not offered as a link (it downloads a file or carries extra parameters)" : "No public address on file"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : <div role="status"><p>The current revision’s source list is unavailable. Bundled photo credits and research notes remain available below.</p><button type="button" className="pn-detail__retry" onClick={resource.retry}>Try again</button></div>}
        <Note testId="sources-owner-note"><a href="https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4" target="_blank" rel="noopener noreferrer">{MAP_OWNER_NOTE}</a></Note>
        <OsmAttribution testId="sources-osm-attribution" />
        <p className="pn-footnote" data-testid="sources-places-note">{EXPLORE_PLACES_NOTE}</p>
        <p className="pn-footnote" data-testid="sources-rail-note">
          {RAIL_STATUS_TEXT} Sources {railSourcesText(resource.status === "ready" ? new Set(resource.data.sources.map((s) => s.code)) : null)}
        </p>
        <SourceCredits revisionId={resource.status === "ready" ? resource.data.revision.revisionId : undefined} />
        <p className="pn-footnote" data-testid="sources-corrections-note">{CORRECTIONS_NOTE}</p>
      </main>
    </DetailPanel>
  );
}
