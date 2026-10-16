import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailLoading } from "@/ui/detail/detail-frame";
import { ARTICLES, findArticle } from "@/ui/help/articles";
import { HelpArticleScreen } from "@/ui/help/help-article";

// Static metadata: with Partial Prefetching the slug is runtime data in the fallback shell, which
// generateMetadata may not read (even with "use cache"), so the article screen names the tab
// itself once it renders (src/ui/help/help-article.tsx).
export const metadata: Metadata = {
  title: "Help",
  description: "ParaNaga help: how trips are planned, why stops are not verified yet, using ParaNaga offline, how times are estimated, vehicle types in Naga.",
};

// The Help articles are prerendered (the offline and time-estimate ones fill in data from this
// phone once they render); the two Task 14 articles are also service-worker shells. With Partial Prefetching the slug is
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
