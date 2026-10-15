"use client";

// Sources and dates (spec S22; Help → About data): the register of every source the published
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
import { DetailError, DetailPanel, useFocusOnMount } from "@/ui/detail/detail-frame";
import { Note } from "@/ui/kit/note";

export const MAP_OWNER_NOTE = "The public My Maps owner is listed as “Tan Gumba”; the owner's identity is not verified.";

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function SourcesScreen() {
  const resource = useNetworkResource("/api/v1/sources", sourceListSchema);
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  if (resource.status === "error" || resource.status === "not_found") {
    return <DetailError title="Sources" offline={resource.status === "error" && resource.offline} onRetry={resource.retry} />;
  }
  return (
    <DetailPanel title="Help" testId="sources-page">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          Sources and dates
        </h1>
        {resource.status === "loading" ? (
          <div role="status" aria-label="Loading sources" className="pn-detail__stack">
            <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
            <div className="pn-skeleton" style={{ width: "90%", height: 64 }} />
          </div>
        ) : (
          <>
            <p className="pn-footnote" data-testid="sources-revision">
              Cited by the published data revision {resource.data.revision.label}.
            </p>
            <ul className="pn-group" data-testid="sources-list">
              {resource.data.sources.map((s) => {
                const href = externalHref(s.url);
                return (
                  <li key={s.code} className="pn-source" data-testid="source-row" data-code={s.code}>
                    <span className="pn-source__title">{sourceTitleLine(s)}</span>
                    <span className="pn-source__meta">{sourceMetaLine(s)}</span>
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
        )}
        <Note testId="sources-owner-note">{MAP_OWNER_NOTE}</Note>
      </main>
    </DetailPanel>
  );
}
