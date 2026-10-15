// Help articles (Task 11 brief, exact copy). Each article is a list of paragraphs; the offline
// article ends with a paragraph naming the published date of the data on this phone (filled in
// by the screen once known).

import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";

export type ArticleSlug = "how-trips-are-planned" | "why-stops-are-not-verified" | "using-paranaga-offline";

export type Article = {
  slug: ArticleSlug;
  title: string;
  body: readonly string[];
  /** A last paragraph naming the published date of the data on this phone (offline article). */
  dated?: (publishedDate: string) => string;
};

export const ARTICLES: readonly Article[] = [
  {
    slug: "how-trips-are-planned",
    title: "How trips are planned",
    body: [
      `ParaNaga suggests trips on Loops A and B only. Their stop order comes from the order of pins on a public map, not from a field survey, so every suggestion carries the badge “${UNVERIFIED_ROUTE_BADGE}”.`,
      "Walks to and from a stop are capped at 600 m, and 400 m between rides. Walking distances are straight-line estimates (× 1.3); paths and crossings are not checked.",
      "Fares are estimates from reported fare rules; the official matrix is not verified and discounts are not applied. There are no times: ParaNaga does not know when jeepneys run.",
    ],
  },
  {
    slug: "why-stops-are-not-verified",
    title: "Why stops are not verified yet",
    body: [
      "Every stop on the map comes from a public My Maps snapshot (retrieved 15 October 2026). Nobody has checked yet which side of the street a jeepney stops on, whether there is a sign, or whether boarding is allowed there.",
      "Until a reviewer attaches field evidence, stops stay “Mapped candidate”. Loops C and D are shown as pins only, because their stop order is unknown.",
    ],
  },
  {
    slug: "using-paranaga-offline",
    title: "Using ParaNaga offline",
    body: ["After you open ParaNaga once with a connection, the app and the transport data work offline. Saved trips open as text even when the map background can't load."],
    dated: (publishedDate) => `Planning offline uses the data from ${publishedDate}; fares may have changed. Location works offline if your phone has GPS.`,
  },
];

export function findArticle(slug: string): Article | null {
  return ARTICLES.find((a) => a.slug === slug) ?? null;
}

export const articleHref = (slug: ArticleSlug) => `/app/help/${slug}`;
