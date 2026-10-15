import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailLoading } from "@/ui/detail/detail-frame";
import { ARTICLES, findArticle } from "@/ui/help/articles";
import { HelpArticleScreen } from "@/ui/help/help-article";

export const metadata: Metadata = {
  title: "Help",
  description: "ParaNaga help: how trips are planned, why stops are not verified yet, using ParaNaga offline.",
};

// The three Help articles are fixed copy and are prerendered. With Partial Prefetching the slug is
// read inside Suspense (see src/app/app/stops/[id]/page.tsx), so an unlisted slug gets the static
// shell and then the not-found panel.
export function generateStaticParams() {
  return ARTICLES.map((a) => ({ article: a.slug }));
}

export default function HelpArticlePage({ params }: PageProps<"/app/help/[article]">) {
  return (
    <Suspense fallback={<DetailLoading title="Help" />}>
      <ArticleFromParams params={params} />
    </Suspense>
  );
}

async function ArticleFromParams({ params }: { params: PageProps<"/app/help/[article]">["params"] }) {
  const article = findArticle((await params).article);
  if (!article) notFound();
  return <HelpArticleScreen slug={article.slug} />;
}
