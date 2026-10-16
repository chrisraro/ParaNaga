// Help articles (Task 11 brief and Task 14 time estimates). Each article is a list of paragraphs; the offline
// article ends with a paragraph naming the published date of the data on this phone (filled in
// by the screen once known), and "How times are estimated" adds the basis rows of the time model
// on this phone (basisRows), so its speeds and sources never drift from the estimates.

import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";

/** The lead of "How times are estimated" (the trip-detail sheet and the Help article). */
export const ETA_WAITING_NOTE = "Times are ranges. They do not include waiting, because Naga has no published jeepney schedules.";

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

export const ARTICLES: readonly Article[] = [
  {
    slug: "how-trips-are-planned",
    title: "How trips are planned",
    body: [
      `ParaNaga suggests trips on Loops A and B only. Their stop order comes from the order of pins on a public map, not from a field survey, so every suggestion carries the badge “${UNVERIFIED_ROUTE_BADGE}”.`,
      "Walks are capped at 600 m to a stop and 400 m between rides, and a ride is suggested only if it saves walking.",
      "Times are ranges from typical speeds and do not include waiting, because jeepneys have no published schedules.",
      "Fares are estimates; discounts are not applied.",
    ],
  },
  {
    slug: "why-stops-are-not-verified",
    title: "Why stops are not verified yet",
    body: [
      "Stops come from a public map. Nobody has checked boarding sides, signs or whether boarding is allowed.",
      "Until a reviewer attaches field evidence, stops stay “Mapped candidate”. Loops C and D are shown as pins only, because their stop order is unknown.",
    ],
  },
  {
    slug: "using-paranaga-offline",
    title: "Using ParaNaga offline",
    body: ["After you open ParaNaga once with a connection, the app and the transport data work offline. Saved trips open as text even when the map background can't load."],
    dated: (publishedDate) => `Planning offline uses the data from ${publishedDate}; fares may have changed. Location works offline if your phone has GPS.`,
  },
  {
    slug: "how-times-are-estimated",
    title: "How times are estimated",
    // The basis paragraphs come from the time model on this phone (basisRows), after this lead.
    body: [ETA_WAITING_NOTE],
    basis: true,
  },
  {
    slug: "vehicle-types-in-naga",
    title: "Vehicle types in Naga",
    body: [
      "Traditional jeepney: ₱14 first 4 km + ₱2.00/km. Traditional jeepneys run on every route group (R1–R8).",
      "Modern jeepney: ₱17 + ₱2.40/km. Air-conditioned modern jeepneys run on R4 (Centro–Del Rosario via Panganiban) and R7 (Centro–Carolina–Panicuason) alongside traditional jeepneys. No other route is shown with modern units.",
      "Tricycle and e-tricycle: ₱15 minimum (Ordinance 2024-002); discounts exist for students, seniors, PWD and solo parents but eligibility is not verified, so ParaNaga does not apply them; e-trikes need a franchise.",
      "UV Express and bus: regional; per-km rates; see terminals.",
    ],
  },
];

export function findArticle(slug: string): Article | null {
  return ARTICLES.find((a) => a.slug === slug) ?? null;
}

export const articleHref = (slug: ArticleSlug) => `/app/help/${slug}`;
