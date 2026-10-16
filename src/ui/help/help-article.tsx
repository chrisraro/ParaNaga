"use client";

// A Help article (/app/help/[article]): fixed copy (articles.ts) in a detail panel with Back. The
// offline article names the published date of the data: from GET /api/v1/network/head, or, with
// no connection, the revision this phone last saw (IndexedDB snapshotMeta).

import "@/ui/kit/styles";
import "./help.css";

import { useEffect, useState } from "react";
import { rememberHead } from "@/client/network/remember-head";
import { useSnapshot } from "@/client/network/use-snapshot";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { readSnapshotMeta } from "@/client/storage/db";
import { networkHeadSchema } from "@/domain/api/schemas";
import { basisRows } from "@/domain/eta/basis";
import { publishedDateText } from "@/domain/network/present";
import { DetailPanel, useFocusOnMount } from "@/ui/detail/detail-frame";
import { findArticle, type Article, type ArticleSlug } from "./articles";

export const UNKNOWN_PUBLISHED_DATE = "the last time this phone was online";

/** The published date of the data on this phone, in words; null while it is being read. */
function usePublishedDate(): string | null {
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
  return null;
}

function Paragraphs({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <div className="pn-help__article" data-testid="help-article-body">
      {paragraphs.map((p, i) => (
        // Static per article: the index is a stable key.
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

/**
 * Only the offline article names a date, so only it reads the network head. The paragraph with
 * the date appears once the date is known (no placeholder is ever read aloud).
 */
function DatedParagraphs({ article }: { article: Article }) {
  const date = usePublishedDate();
  return <Paragraphs paragraphs={date === null || !article.dated ? article.body : [...article.body, article.dated(date)]} />;
}

export const NO_TIME_MODEL = "The time-estimate model is not on this phone yet. Open ParaNaga with a connection once to load it.";

/**
 * "How times are estimated": the lead, then one paragraph per basis row (with its A1–A3 notes)
 * from the time model of the snapshot on this phone (the service worker answers offline).
 */
function BasisParagraphs({ article }: { article: Article }) {
  const { status, snapshot } = useSnapshot(true);
  const model = snapshot?.etaModel ?? null;
  const rows = model ? basisRows(model).flatMap((r) => [r.text, ...r.assumptions.map((a) => `Assumption ${a}`)]) : [];
  const tail = model ? rows : status === "ready" || status === "error" ? [NO_TIME_MODEL] : [];
  return <Paragraphs paragraphs={[...article.body, ...tail]} />;
}

export function HelpArticleScreen({ slug }: { slug: ArticleSlug }) {
  const article = findArticle(slug);
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  // The tab and history entry name the article (the route's static metadata says "Help"). The
  // old title is restored only if it is still ours (see DetailNotFound).
  const title = article?.title;
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    const mine = `${title} · ParaNaga`;
    document.title = mine;
    return () => {
      if (document.title === mine) document.title = previous;
    };
  }, [title]);
  if (!article) return null;
  return (
    <DetailPanel title="Help" testId="help-article">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          {article.title}
        </h1>
        {article.dated ? <DatedParagraphs article={article} /> : article.basis ? <BasisParagraphs article={article} /> : <Paragraphs paragraphs={article.body} />}
      </main>
    </DetailPanel>
  );
}
