// Help articles (Task 11 brief and Task 14 time estimates). Each article is a list of paragraphs; the offline
// article ends with a paragraph naming the published date of the data on this phone (filled in
// by the screen once known), and "How times are estimated" adds the basis rows of the time model
// on this phone (basisRows), so its speeds and sources never drift from the estimates.
// The text lives in the dictionary (help.articles, T13); `articlesFor(t)` builds the list in a language.

import { en, type Dict } from "@/i18n/dict";

/** The lead of "How times are estimated" (the trip-detail sheet and the Help article), in English. */
export const ETA_WAITING_NOTE = en.help.etaWaitingNote;

export type ArticleSlug =
  | "how-trips-are-planned"
  | "why-stops-are-not-verified"
  | "using-paranaga-offline"
  | "how-times-are-estimated"
  | "vehicle-types-in-naga";

export type Article = {
  slug: ArticleSlug;
  title: string;
  body: readonly string[];
  /** A last paragraph naming the published date of the data on this phone (offline article). */
  dated?: (publishedDate: string) => string;
  /** After the body: the "How times are estimated" rows, built from the time model on this phone. */
  basis?: true;
};

/** The articles in the language of `t` (English by default). */
export function articlesFor(t: Dict = en): readonly Article[] {
  const a = t.help.articles;
  return [
    {
      slug: "how-trips-are-planned",
      title: a.planned.title,
      body: [a.planned.intro(t.trip.unverifiedBadge), ...Object.values(a.planned.body)],
    },
    { slug: "why-stops-are-not-verified", title: a.stops.title, body: Object.values(a.stops.body) },
    { slug: "using-paranaga-offline", title: a.offline.title, body: Object.values(a.offline.body), dated: a.offline.dated },
    // The basis paragraphs come from the time model on this phone (basisRows), after this lead.
    { slug: "how-times-are-estimated", title: a.times.title, body: [t.help.etaWaitingNote], basis: true },
    { slug: "vehicle-types-in-naga", title: a.vehicles.title, body: Object.values(a.vehicles.body) },
  ];
}

export const ARTICLES: readonly Article[] = articlesFor();

export function findArticle(slug: string, t: Dict = en): Article | null {
  return articlesFor(t).find((a) => a.slug === slug) ?? null;
}

export const articleHref = (slug: ArticleSlug) => `/app/help/${slug}`;
