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
      `ParaNaga suggests jeepney trips along mapped routes. Paths come from ordinances and public maps, not a field survey, so every suggestion carries the badge “${UNVERIFIED_ROUTE_BADGE}”.`,
      "You can get on and off anywhere along a route. With no stop pin it shows the nearest point and says “Tell the driver ‘para’ · stop not marked”.",
      "Distances follow roads in the on-device street map (OpenStreetMap). Walks to and from a route can be up to 500 m straight-line and 750 m along streets.",
      "Walking is recommended only under 500 m with no jeepney near your destination. From 500 m a tricycle follows the jeepney options, marked Recommended; a padyak option appears where an area covers both ends.",
      "A ride is only suggested if it saves walking.",
      "Tricycle options avoid the restricted roads we could locate (Ordinance 2006-005/015). Confirm with the driver.",
      "Far areas (Cararayan and San Isidro, Pacol, Carolina and Panicuason): riders report that tricycles there run inside their own zone, and a trip to or from the city centre is a special trip with a fare that is not fixed. So we send you to the jeepney terminal and suggest no tricycle. This is a local report, not an ordinance.",
      "If the nearest jeepney is over 600 m of walking from you, an extra option “Tricycle, then Jeep R6” (or the route that serves the area) takes a tricycle to the jeepney’s loading point first. Its fare reads “From”: the jeepney estimate plus the ₱15 tricycle minimum. Tricycle time is not estimated.",
      "A special-trip tricycle (fare not fixed) appears when you start within 300 m of a tricycle terminal that serves the area, and as the only tricycle card when no jeepney can be reached. It is never Recommended. Agree the fare with the driver.",
      "Centro to Del Rosario has several routes by different roads: R2 via Magsaysay, R3 via Roxas (Diversion) and R4 via Panganiban. Each shows its road. Locals may call R2 “Francia” (unconfirmed).",
      "Naga licenses tricycles by colour zone, and no city list of TODAs exists. Zone tricycles shuttle between their centro and a junction. TODA terminals at Ateneo or at jeepney terminals are owner reports we could not confirm.",
      "Times are ranges from typical speeds and do not include waiting, because jeepneys have no published schedules. Tricycle and padyak show no minutes.",
      "Fares are estimates; discounts are not applied, except a padyak option's named discounted fare.",
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
