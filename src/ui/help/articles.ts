// Help articles (Task 11 brief and Task 14 time estimates). Each article is a list of paragraphs; the offline
// article ends with a paragraph naming the published date of the data on this phone (filled in
// by the screen once known).

import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";

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
};

export const ARTICLES: readonly Article[] = [
  {
    slug: "how-trips-are-planned",
    title: "How trips are planned",
    body: [
      `ParaNaga suggests trips on Loops A and B only. Their stop order comes from the order of pins on a public map, not from a field survey, so every suggestion carries the badge “${UNVERIFIED_ROUTE_BADGE}”.`,
      "Ride distances follow approximate paths traced along OpenStreetMap roads between candidate pins, or straight-line distances where roads are unmapped.",
      "Walks to and from a stop are capped at 600 m, and 400 m between rides. Walk paths are routed along walkable streets where mapped, or straight-line estimates (× 1.3).",
      "A ride is only suggested if it saves walking: taking a jeepney must replace meaningful walking distance compared to walking all the way.",
      "Times are estimated as ranges based on typical travel speeds in Naga (slower during peak hours). Times do not include waiting, because jeepneys have no published schedules.",
      "Fares are estimates from reported fare rules; the official matrix is not verified and discounts are not applied.",
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
  {
    slug: "how-times-are-estimated",
    title: "How times are estimated",
    body: [
      "Times are ranges. They do not include waiting, because Naga has no published jeepney schedules.",
      "Walking: 4.24 km/h baseline (Tolentino & Sigua 2022, N28); up to 25% slower for crossings and traffic (ParaNaga assumption A1).",
      "Jeepney off-peak: 10–15 km/h (SafeTravelPH 2025, N16; Puerto Princesa study 2025, N29).",
      "Jeepney peak: 7–13 km/h (upper from N29; lower is a ParaNaga assumption A2).",
      "Peak windows: 06:00–08:00, 11:00–13:00, 16:00–19:00 (Ordinance 2025-110, N04), applied every day (ParaNaga assumption A3).",
      "Waiting: unknown — no published schedules or headways for Naga.",
      "Based on typical speeds. ParaNaga uses no live traffic service.",
    ],
  },
  {
    slug: "vehicle-types-in-naga",
    title: "Vehicle types in Naga",
    body: [
      "Traditional jeepney: ₱14 first 4 km + ₱2.00/km, national rate 28 Sep 2026. The backbone of Naga intra-city transit.",
      "Modern jeepney: ₱17 + ₱2.40/km; reported on R4 and R7 (2023–2024). Air-conditioned or Euro-4 units operated by transport cooperatives.",
      "Electric jeepney (e-jeepney): one 2017 route, status unknown; no current route confirmed electric.",
      "Tricycle and e-tricycle: ₱15 minimum (Ordinance 2024-002); discounts exist for students, seniors, PWD and solo parents but eligibility is not verified, so ParaNaga does not apply them; e-trikes need a franchise.",
      "UV Express and bus: regional; per-km rates; see terminals.",
    ],
  },
];

export function findArticle(slug: string): Article | null {
  return ARTICLES.find((a) => a.slug === slug) ?? null;
}

export const articleHref = (slug: ArticleSlug) => `/app/help/${slug}`;
