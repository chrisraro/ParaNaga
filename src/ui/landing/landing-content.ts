// Landing page copy and facts, kept in one place so tests/unit/landing-copy.test.ts can hold them to
// the app's copy rules (docs/spec/06-screens.md §6.5): no live, ETA or arriving wording, nothing
// called verified that is not, no e-jeepneys, estimates as ranges, tricycles and padyaks never
// timed. Every fact here comes from the app itself (route names straight from
// src/domain/planner/route-display.ts, the help articles, docs/spec/01-product.md); nothing is invented.

import { ROUTE_DISPLAY } from "@/domain/planner/route-display";

/** The routes exactly as the app names them (sign letter where one is known, then the title). */
export const ROUTES: readonly { letter: string | null; title: string }[] = Object.values(ROUTE_DISPLAY).map(({ letter, title }) => ({ letter, title }));

export { SHOT_H, SHOT_W } from "@/ui/landing/shot-size";

export type Screen = "home" | "search" | "directions" | "options" | "detail" | "saved" | "far" | "report" | "hero";

/** What each capture shows, for its alt text (public/landing/<screen>-<theme>.webp). */
export const SCREEN_ALT: Record<Screen, string> = {
  hero: "ParaNaga on a phone: a street map of Naga City with a trip from Plaza Rizal to Ateneo de Naga University and two options under it: the Recommended C Centro-Bagumbayan-Magsaysay-Roxas Loop C (clockwise), estimated 14 to 23 minutes plus waiting and ₱14, marked Unverified route, and a tricycle at a minimum fare of ₱15.",
  home: "ParaNaga's home screen: a street map of central Naga City with a Where to? bar, chips for Food & drink, Schools, Health and Markets & malls, terminal pins and a tab bar.",
  search: "Search for Ateneo: places from OpenStreetMap such as Ateneo de Naga University, and a mapped stop on Loops C and D marked Mapped candidate.",
  directions: "Directions from Plaza Rizal to Ateneo de Naga University: a walk and a jeepney ride drawn on the map, and two option cards: the Recommended C Centro-Bagumbayan-Magsaysay-Roxas Loop C (clockwise), estimated 14 to 23 minutes plus waiting and ₱14, and a tricycle at a minimum fare of ₱15.",
  options: "All trip options: Recommended C Centro-Bagumbayan-Magsaysay-Roxas Loop C (clockwise) with an estimated fare of ₱14, and a tricycle card with Time not estimated, the restricted roads it avoids and a minimum fare of ₱15.",
  detail: "Trip details for C Centro-Bagumbayan-Magsaysay-Roxas Loop C (clockwise): the walk and ride on the map, estimated 14 to 23 minutes plus waiting, estimated fare ₱14, a peak-hour note and a Start trip button.",
  saved: "Saved screen: a trip from Plaza Rizal to Ateneo de Naga University marked Available offline, with its walk, ride and estimated fare.",
  far: "Trip options to Pacol: a Local report note that tricycles to Pacol charge special-trip fares, a Recommended J Centro-Carolina-Panicuason jeepney with an estimated fare of ₱18 to ₱25, and a Least walking option that changes from Loop C to J.",
  report: "Report a correction, step 1 of 3: choices such as Wrong curb side, Stop moved or removed and Fare mismatch.",
};

export const HERO = {
  title: ["Which jeepney, where to board,", "and when to say"],
  lede: "ParaNaga plans trips across Naga City by jeepney, tricycle, padyak and on foot, then guides you step by step. Free in your phone's browser, no account needed.",
  note: "Routes and times are provisional and fares are estimates. Confirm with the driver.",
};

export const HOW = [
  { title: "Pick a place", body: "Type a school, a market or a barangay, or tap a chip on the map." },
  { title: "See your options", body: "Jeepney, tricycle, padyak or walking, each with an estimated fare." },
  { title: "Ride and say Para", body: "Follow the steps: where to walk, where to board and where to get off." },
];

export const SHOWCASE: readonly { screen: Screen; title: string; body: string }[] = [
  {
    screen: "home",
    title: "Start from the map.",
    body: "The map opens on Naga with a floating Where to? bar. Chips go straight to Food & drink, Schools, Health, Markets & malls, Government and Terminals, with your saved places first.",
  },
  {
    screen: "search",
    title: "Find any named place.",
    body: "Search covers every named place in OpenStreetMap, plus stops and routes. When it finds too little, Google suggestions fill in, each labelled not verified.",
  },
  {
    screen: "directions",
    title: "See the ride on the street map.",
    body: "Plaza Rizal to Ateneo de Naga University: the walk and the jeepney drawn on the street map, and the two best options right under it, the Recommended jeepney and a tricycle.",
  },
  {
    screen: "options",
    title: "Compare every way there.",
    body: "One option is Recommended. Jeepneys go by sign letter and route title; tricycle cards show the minimum fare and never a time.",
  },
  {
    screen: "detail",
    title: "Follow it step by step.",
    body: "Where to walk, where to board and where to say Para. Times are ranges marked as estimates, and waiting time is shown as unknown.",
  },
  {
    screen: "saved",
    title: "Keep trips on your phone.",
    body: "Saved trips work offline, as text. Sign in only if you want them backed up to an account.",
  },
];

export const MODES = {
  jeepney: {
    title: "Jeepneys, by sign letter and route title",
    body: "Like the signboard: E Centro-Del Rosario via Magsaysay Ave. A route with no known letter shows its title alone, never a guessed letter, and each route page says where its letter comes from.",
  },
  tricycle: {
    title: "Tricycles, with the terminal",
    body: "The card names a nearby tricycle terminal and the minimum fare, ₱15 (Ordinance 2024-002). Tricycle time is not estimated, and roads tricycles may not use are flagged.",
  },
  padyak: { title: "Padyak", body: "Short local rides at ₱10 per passenger. Never timed." },
  walk: { title: "Walking", body: "When walking is the better choice, the app says so, with the distance along streets." },
  anywhere: {
    title: "Drop off anywhere along the route",
    body: "You can get on and off anywhere along a route. Where there is no marked stop, your steps say to get off near the place and tell the driver “para”.",
  },
};

export const FAR = {
  title: "Far barangays, told straight.",
  body: "Tricycles to Cararayan and San Isidro, Pacol, and Carolina and Panicuason charge special-trip fares, a local report. So ParaNaga points you to the jeepney and its terminal instead.",
  points: [
    "A special-trip tricycle is listed only if you still want one.",
    "Its fare is marked not fixed: agree it with the driver.",
    "It is never the Recommended option.",
  ],
};

export const OFFLINE = {
  title: "Works without signal.",
  body: "Open ParaNaga once with a connection and the app and the transport data work offline. Saved trips open as text, even in a dead zone.",
  install: [
    { device: "Android, Chrome", steps: ["Open ParaNaga", "Tap the menu, then Install app or Add to Home screen"] },
    { device: "iPhone, Safari", steps: ["Open ParaNaga", "Tap Share, then Add to Home Screen"] },
  ],
};

export const THEMES = {
  title: "Light, dark and high contrast.",
  body: "ParaNaga follows your phone, or you pick in Settings. High contrast gives stronger text and borders for reading in bright sun.",
};

export const COMMUNITY = {
  title: "Fix the map with other commuters.",
  items: [
    { title: "Report a correction", body: "A stop on the wrong curb side, a route that goes another way, a fare that differs. A person reviews it; nothing changes until then." },
    { title: "Report a driver, privately", body: "Never published. Only the reviewer sees it. In an emergency, call 911." },
    { title: "My reports", body: "Your corrections and driver reports in one place. Only you can see them." },
    { title: "MyNaga, if you want the City to hear it", body: "ParaNaga can open MyNaga for you, but it sends nothing to MyNaga or City Hall and cannot confirm your report was received." },
    { title: "Community tips", body: "Questions and tips from Naga commuters, reviewed before others can read them, and not verified by ParaNaga." },
  ],
};

export const PROMISE = {
  title: "What we know, and what we don't.",
  facts: [
    {
      title: "The official routes",
      body: "Ordinance 2025-070 sets eight route groups: Routes 1 to 7, and Route 8, the Naga Loop Service A to D, with 282 units allocated. That is an allowance, not a count of jeepneys on the road.",
    },
    { title: "Provisional, and labelled", body: "Routes, stops and times are not verified by ParaNaga yet. Every ride says so and asks you to confirm with the driver." },
    { title: "Fares are estimates", body: "From reported fare rules, shown as ranges. Discounts are not applied yet." },
    { title: "No vehicle tracking", body: "ParaNaga does not track jeepneys, so it never says when one will come." },
  ],
  privacy: [
    "No ads and no analytics.",
    "Recent searches stay on this phone. Trip history is off by default.",
    "Your location is used only on this device.",
    "An account is optional. Everything works as a guest.",
  ],
};

export const FAQ: readonly [string, string][] = [
  ["Is ParaNaga free?", "Yes. Planning trips, saving them and reading the map are free, with no account."],
  ["Do I need to install it?", "No. It runs in your phone's browser. Add it to your home screen for one-tap access and offline use."],
  ["Does it show where the jeepney is?", "No. ParaNaga does not track vehicles. It shows the routes and the steps, with time and fare estimates as ranges."],
  ["Can I trust the routes?", "Treat them as a good start, not the last word. Routes and stops are provisional until checked on the street, and every ride says so. Confirm with the driver."],
  ["Why does the app open only on phones?", "It guides you on the street, with your location, the map and big tap targets. On a computer, scan the code to continue on your phone."],
  ["Is this the City Government's app?", "No. ParaNaga is independent and not an official channel of the City Government of Naga."],
];
