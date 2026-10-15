// Planner copy shared with the UI. A leaf module (no planner code), so client components can
// import these without bundling the graph, search and fare logic. Re-exported by plan.ts.

export const PLAN_LABELS = ["Recommended", "Fewest transfers", "Least walking"] as const;
export type PlanLabel = (typeof PLAN_LABELS)[number];

export const UNVERIFIED_ROUTE_BADGE = "Unverified route — confirm with the driver";
