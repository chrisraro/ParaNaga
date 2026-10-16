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
      `ParaNaga suggests jeepney trips along the routes it has mapped. Their paths come from ordinances and public maps, not from a field survey, so every suggestion carries the badge “${UNVERIFIED_ROUTE_BADGE}”.`,
      "You can get on and drop off anywhere along a route. The app does not need a stop pin: it shows the nearest point on the route path and says “Tell the driver ‘para’ · stop not marked”.",
      "Distances are measured along the roads in the on-device street map (OpenStreetMap), not in a straight line. Walks to and from the route can be up to 500 m straight-line and 750 m along streets.",
      "ParaNaga recommends walking only when the whole trip is under 500 m and no jeepney passes your destination. From 500 m, a tricycle is suggested after the jeepney options and marked Recommended. Where a padyak area covers both ends, a padyak option is also shown.",
      "A ride is only suggested if it saves walking compared to walking all the way.",
      "Tricycle options avoid the restricted roads we could locate (Ordinance 2006-005/015; check for updates). Not every rule could be located on the map, so confirm with the driver.",
      "Times are estimated as ranges based on typical travel speeds in Naga (slower during peak hours) and do not include waiting, because jeepneys have no published schedules. Tricycle and padyak trips show no minutes.",
      "Fares are estimates from reported fare rules; the official matrix is not verified and discounts are not applied, except where a padyak option names its discounted fare.",
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
    // The basis paragraphs come from the time model on this phone (basisRows), after this lead.
    body: [ETA_WAITING_NOTE],
    basis: true,
  },
  {
    slug: "vehicle-types-in-naga",
    title: "Vehicle types in Naga",
    body: [
      "Traditional jeepney: ₱14 first 4 km + ₱2.00/km, national rate 28 Sep 2026. Traditional jeepneys run on every route group (R1–R8), confirmed by the project owner on 16 October 2026.",
      "Modern jeepney: ₱17 + ₱2.40/km. Air-conditioned modern jeepneys run on R4 (Centro–Del Rosario via Panganiban) and R7 (Centro–Carolina–Panicuason) alongside traditional jeepneys, confirmed by the project owner on 16 October 2026. No other route is shown with modern units.",
      "Tricycle and e-tricycle: ₱15 minimum (Ordinance 2024-002); discounts exist for students, seniors, PWD and solo parents but eligibility is not verified, so ParaNaga does not apply them; e-trikes need a franchise.",
      "Tricycle restrictions: franchised tricycles may not use four national-road portions, except 9 pm to 5 am and at named crossings (Ordinance 2006-005/015, sources T01 and T02; check for updates). Tricycle options avoid the restricted roads we could locate; roads we could not locate are not applied, so confirm with the driver.",
      "E-trike national-road rules reported in news (Dec 2025) are not applied; unverified. Special VISTODA units may not enter Tecla San Andres–Ziga Rd (Ord 2025-067).",
      "Padyak (pedicab): ₱10 per passenger, ₱8 with an ID discount (city fare set Sep 2022), up to 2 passengers; confirm with the driver. A padyak option appears only when your start and destination are in the same documented padyak area, and padyaks do not use banned streets.",
      "Jeepney service hours: jeepneys usually run about 5:00 to 21:00, unconfirmed; some start earlier. Sunday and holiday service not confirmed. There is no official timetable, so no option is hidden because of the hour.",
      "UV Express and bus: regional; per-km rates; see terminals.",
    ],
  },
];

export function findArticle(slug: string): Article | null {
  return ARTICLES.find((a) => a.slug === slug) ?? null;
}

export const articleHref = (slug: ArticleSlug) => `/app/help/${slug}`;
