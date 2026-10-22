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
import { railSourcesText } from "@/domain/places/explore";
import { EntitySources } from "./entity-sources";
import { formatIsoDate, publishedDateText } from "@/domain/network/present";
import { Note } from "@/ui/kit/note";
import { ListGroup } from "@/ui/kit/list";
import { OsmAttribution } from "@/ui/kit/osm-attribution";
import { DataRevisionRow } from "@/ui/settings/data-revision-row";
import { SourceCredits } from "./source-credits";
import { rightsForSource } from "@/domain/sources/rights";
import { en } from "@/i18n/dict";
import { useT } from "@/i18n/provider";

// The data-basis, licence and attribution notes are English verbatim in every language until a
// verbatim-reviewed translation exists (sources.verbatim); headings and controls are translated.
const V = en.sources.verbatim;
/** The My Maps retrieval date comes from the register (S39 checked date), never typed here. */
export const dataBasisNote = (retrieved: string | null) => V.dataBasis(formatIsoDate(retrieved) ?? V.dateNotRecorded);
export const FLEET_BASIS_NOTE = V.fleetBasis;
export const FARE_BASIS_NOTE = V.fareBasis;
export const FAR_BASIS_NOTE = V.farBasis;
export const TIME_BASIS_NOTE = V.timeBasis;
export const CORRECTIONS_NOTE = V.corrections;
export const MAP_OWNER_NOTE = V.mapOwner;

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function SourcesScreen() {
  const tt = useT();
  const t = tt.sources;
  const v = t.verbatim;
  const resource = useNetworkResource("/api/v1/sources", sourceListSchema);
  const heading = useRef<HTMLHeadingElement>(null);
  // A hash link (#photo-…, #fare-basis) lands on its target; otherwise the h1 takes focus.
  useEffect(() => {
    // A malformed escape (#%E0) is no target at all, not an error.
    let id = "";
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      id = "";
    }
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
    <DetailPanel title={t.panelTitle} testId="sources-page">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          {t.title}
        </h1>
        <ListGroup label={t.revisionGroup} testId="sources-revision-group">
          <DataRevisionRow testId="sources-data-revision" />
        </ListGroup>
        <Suspense fallback={null}>
          <EntitySources />
        </Suspense>
        <section aria-labelledby="data-basis" className="pn-section">
          <h2 id="data-basis" className="pn-section__title">{t.dataBasisTitle}</h2>
          <p className="pn-footnote" data-testid="sources-data-basis">{dataBasisNote(resource.status === "ready" ? (resource.data.sources.find((x) => x.code === "S39")?.checkedOn ?? null) : null)}</p>
          <p className="pn-footnote">{v.fleetBasis}</p>
          <p className="pn-footnote" data-testid="sources-far-basis">{v.farBasis}</p>
        </section>
        <section aria-labelledby="fare-basis-title" className="pn-section" id="fare-basis">
          <h2 id="fare-basis-title" className="pn-section__title">{t.fareBasisTitle}</h2>
          <p className="pn-footnote" data-testid="sources-fare-basis">{v.fareBasis}</p>
        </section>
        <section aria-labelledby="time-basis" className="pn-section">
          <h2 id="time-basis" className="pn-section__title">{t.timeBasisTitle}</h2>
          <p className="pn-footnote">{v.timeBasis} <Link href="/app/help/how-times-are-estimated">{t.timeBasisLink}</Link></p>
        </section>
        {resource.status === "loading" ? (
          <div role="status" aria-label={t.loading} className="pn-detail__stack">
            <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
            <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
          </div>
        ) : resource.status === "ready" ? (
          <>
            <p className="pn-footnote" data-testid="sources-revision">
              {v.citedBy(resource.data.revision.label)}{publishedDateText(resource.data.revision.publishedAt) ? v.published(publishedDateText(resource.data.revision.publishedAt)!) : ""}.
            </p>
            <h2 id="source-register-title" className="pn-section__title">{t.registerTitle}</h2>
            <ul className="pn-group" data-testid="sources-list" aria-labelledby="source-register-title">
              {resource.data.sources.map((s) => {
                const href = externalHref(s.url);
                return (
                  <li key={s.code} className="pn-source" data-testid="source-row" data-code={s.code}>
                    <span className="pn-source__title">{sourceTitleLine(s)}</span>
                    <span className="pn-source__meta">{sourceMetaLine(s)}</span>
                    <span className="pn-source__meta">{rightsForSource(s.code)?.publisher ?? v.publisherNotRecorded} · {rightsForSource(s.code)?.license ?? v.rightsNotRecorded}</span>
                    {href ? (
                      <a
                        className="pn-source__link"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t.openSourceLabel(s.code)}
                        data-testid="source-link"
                      >
                        {t.openSource}
                        <ExternalIcon />
                      </a>
                    ) : (
                      <span className="pn-source__none" data-testid="source-unlinked">
                        {s.url ? v.notLinked : v.noAddress}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : <div role="status"><p>{t.unavailable}</p><button type="button" className="pn-detail__retry" onClick={resource.retry}>{tt.forms.tryAgain}</button></div>}
        <Note testId="sources-owner-note"><a href="https://www.google.com/maps/d/viewer?mid=1f0HedvouLfPzGTte38TdqNM4pYBICG4" target="_blank" rel="noopener noreferrer">{v.mapOwner}</a></Note>
        <OsmAttribution testId="sources-osm-attribution" />
        <p className="pn-footnote" data-testid="sources-places-note">{tt.explore.placesNote}</p>
        <p className="pn-footnote" data-testid="sources-rail-note">
          {tt.explore.railStatus} {t.railSources} {railSourcesText(resource.status === "ready" ? new Set(resource.data.sources.map((s) => s.code)) : null, tt.explore)}
        </p>
        <SourceCredits revisionId={resource.status === "ready" ? resource.data.revision.revisionId : undefined} />
        <p className="pn-footnote" data-testid="sources-corrections-note">{v.corrections}</p>
      </main>
    </DetailPanel>
  );
}
