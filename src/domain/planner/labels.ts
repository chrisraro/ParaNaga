// Planner copy shared with the UI. A leaf module (no planner code), so client components can
// import these without bundling the graph, search and fare logic. Re-exported by plan.ts.
import { en } from "@/i18n/dict";

export const PLAN_LABELS = ["Recommended", "Fewest transfers", "Least walking", "Short local ride"] as const;
export type PlanLabel = (typeof PLAN_LABELS)[number];

/** The English badge: the planner's own notes carry it verbatim (they are filtered by it); screens show `t.trip.unverifiedBadge`. */
export const UNVERIFIED_ROUTE_BADGE = en.trip.unverifiedBadge;

/** Ends this close (straight-line metres) are the same place: nothing to plan. */
export const SAME_PLACE_M = 25;

/** Former stop-based access cap (straight-line metres); only the pre-Increment-E copy still names it. */
export const MAX_ACCESS_WALK_M = 600;
