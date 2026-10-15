// Planner copy shared with the UI. A leaf module (no planner code), so client components can
// import these without bundling the graph, search and fare logic. Re-exported by plan.ts.

export const PLAN_LABELS = ["Recommended", "Fewest transfers", "Least walking"] as const;
export type PlanLabel = (typeof PLAN_LABELS)[number];

export const UNVERIFIED_ROUTE_BADGE = "Unverified route — confirm with the driver";

/** Ends this close (straight-line metres) are the same place: nothing to plan. */
export const SAME_PLACE_M = 25;

/** Global access/egress walk cap (straight-line metres); the planner may only tighten it. */
export const MAX_ACCESS_WALK_M = 600;
