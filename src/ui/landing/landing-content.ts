// Landing page facts that are not words. The copy lives in the dictionaries (`landing` in
// src/i18n/en.ts and fil.ts, T14) and tests/unit/landing-copy.test.ts holds it to the app's copy rules
// (docs/spec/06-screens.md §6.5): no live, ETA or arriving wording, nothing called verified that is
// not, no e-jeepneys, estimates as ranges, tricycles and padyaks never timed. Every fact comes from
// the app itself (route names straight from src/domain/planner/route-display.ts, the help articles,
// docs/spec/01-product.md); nothing is invented. Route titles are proper names and stay as they are.

import { ROUTE_DISPLAY } from "@/domain/planner/route-display";

/** The routes exactly as the app names them (sign letter where one is known, then the title). */
export const ROUTES: readonly { letter: string | null; title: string }[] = Object.values(ROUTE_DISPLAY).map(({ letter, title }) => ({ letter, title }));

export { SHOT_H, SHOT_W } from "@/ui/landing/shot-size";

export type Screen = "home" | "search" | "directions" | "options" | "detail" | "saved" | "far" | "report" | "hero";

/** The showcase steps in order; their words are `landing.showcase.<screen>`, their alt text `landing.alt.<screen>`. */
export const SHOWCASE_SCREENS = ["home", "search", "directions", "options", "detail", "saved"] as const satisfies readonly Screen[];
