"use client";

// A Help article (/app/help/[article]): fixed copy (articles.ts) in a detail panel with Back. The
// offline article names the published date of the data: from GET /api/v1/network/head, or, with
// no connection, the revision this phone last saw (IndexedDB snapshotMeta).

import "@/ui/kit/styles";
import "./help.css";

import { useEffect, useState } from "react";
import { rememberHead } from "@/client/network/remember-head";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { readSnapshotMeta } from "@/client/storage/db";
import { networkHeadSchema } from "@/domain/api/schemas";
import { publishedDateText } from "@/domain/network/present";
import { DetailPanel, useFocusOnMount } from "@/ui/detail/detail-frame";
import { findArticle, type Article, type ArticleSlug } from "./articles";

export const UNKNOWN_PUBLISHED_DATE = "the last time this phone was online";

/** The published date of the data on this phone, in words; "…" while it is being read. */
function usePublishedDate(): string {
  const head = useNetworkResource("/api/v1/network/head", networkHeadSchema);
  const seen = head.status === "ready" ? head.data : null;
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (seen) rememberHead(seen);
  }, [seen]);
  const failed = head.status === "error" || head.status === "not_found";
  useEffect(() => {
    if (!failed) return undefined;
    let live = true;
    readSnapshotMeta().then(
      (meta) => live && setStored(meta?.publishedAt ?? null),
      () => live && setStored(null),
    );
    return () => {
      live = false;
    };
  }, [failed]);
  if (seen) return publishedDateText(seen.publishedAt) ?? UNKNOWN_PUBLISHED_DATE;
  if (failed && stored !== undefined) return publishedDateText(stored) ?? UNKNOWN_PUBLISHED_DATE;
  return "…";
}

function Paragraphs({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="pn-help__article" data-testid="help-article-body">
      {paragraphs.map((p) => (
        <p key={p.slice(0, 24)}>{p}</p>
      ))}
    </div>
  );
}

/** Only the offline article names a date, so only it reads the network head. */
function DatedParagraphs({ article }: { article: Article }) {
  return <Paragraphs paragraphs={article.body(usePublishedDate())} />;
}

export function HelpArticleScreen({ slug }: { slug: ArticleSlug }) {
  const article = findArticle(slug);
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  if (!article) return null;
  return (
    <DetailPanel title="Help" testId="help-article">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          {article.title}
        </h1>
        {article.slug === "using-paranaga-offline" ? <DatedParagraphs article={article} /> : <Paragraphs paragraphs={article.body("")} />}
      </main>
    </DetailPanel>
  );
}
