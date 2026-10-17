// What can be wrong (S16 step 1). Wording is plain and factual; nothing here promises a fix.
// A correction is a proposal for a reviewer. It never changes published transit data.

export const ENTITY_TYPES = ["stop", "route", "fare", "trip"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string | null | undefined): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value ?? "");
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  stop: "Stop",
  route: "Route",
  fare: "Fare",
  trip: "Trip",
};

export const CORRECTION_CATEGORIES = [
  "wrong_curb_side",
  "stop_moved_removed",
  "route_not_stopping",
  "route_deviation",
  "fare_mismatch",
  "hours_service",
  "crossing_access",
  "other_trip",
  "other",
] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

export type CategoryInfo = {
  value: CorrectionCategory;
  label: string;
  hint: string;
  /** Entity types this category applies to; omitted means any. */
  appliesTo?: readonly EntityType[];
};

export const CATEGORY_INFO: readonly CategoryInfo[] = [
  { value: "wrong_curb_side", label: "Wrong curb side", hint: "The stop is on the other side of the road.", appliesTo: ["stop"] },
  { value: "stop_moved_removed", label: "Stop moved or removed", hint: "The stop is somewhere else now, or gone.", appliesTo: ["stop"] },
  { value: "route_not_stopping", label: "Route doesn't stop here", hint: "A listed route does not serve this stop.", appliesTo: ["stop", "route"] },
  { value: "route_deviation", label: "Route goes a different way", hint: "The street path differs from what is shown.", appliesTo: ["route", "trip"] },
  { value: "fare_mismatch", label: "Fare mismatch", hint: "What you paid differs from the estimated range.", appliesTo: ["fare", "route", "trip"] },
  { value: "hours_service", label: "Hours or service", hint: "The route is not running when it should.", appliesTo: ["route", "stop", "trip"] },
  { value: "crossing_access", label: "Crossing or access problem", hint: "Hard to reach the stop, or unsafe to cross.", appliesTo: ["stop"] },
  { value: "other_trip", label: "Other trip problem", hint: "Something about this trip is off.", appliesTo: ["trip", "fare"] },
  { value: "other", label: "Something else", hint: "Anything that does not fit above." },
];

export function isCorrectionCategory(value: string): value is CorrectionCategory {
  return (CORRECTION_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(value: CorrectionCategory): string {
  return CATEGORY_INFO.find((c) => c.value === value)?.label ?? value;
}

/** Categories that fit the entity being reported; without an entity every category is offered. */
export function categoriesFor(entityType: EntityType | null): readonly CategoryInfo[] {
  if (!entityType) return CATEGORY_INFO;
  return CATEGORY_INFO.filter((c) => !c.appliesTo || c.appliesTo.includes(entityType));
}
