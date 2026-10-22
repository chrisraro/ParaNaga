// What can be wrong (S16 step 1). Wording is plain and factual; nothing here promises a fix.
// A correction is a proposal for a reviewer. It never changes published transit data.
// The words live in the dictionary (report.entity, report.categories); English by default.
import { en, type Dict } from "@/i18n/dict";

export const ENTITY_TYPES = ["stop", "route", "fare", "trip"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string | null | undefined): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value ?? "");
}

export const ENTITY_LABELS: Record<EntityType, string> = en.report.entity;

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

/** Entity types each category applies to; a missing entry means any. */
const APPLIES_TO: Partial<Record<CorrectionCategory, readonly EntityType[]>> = {
  wrong_curb_side: ["stop"],
  stop_moved_removed: ["stop"],
  route_not_stopping: ["stop", "route"],
  route_deviation: ["route", "trip"],
  fare_mismatch: ["fare", "route", "trip"],
  hours_service: ["route", "stop", "trip"],
  crossing_access: ["stop"],
  other_trip: ["trip", "fare"],
};

/** The categories in display order, worded in `copy`'s language. */
export function categoryInfo(copy: Dict["report"] = en.report): readonly CategoryInfo[] {
  return CORRECTION_CATEGORIES.map((value) => {
    const appliesTo = APPLIES_TO[value];
    return { value, ...copy.categories[value], ...(appliesTo ? { appliesTo } : {}) };
  });
}

export const CATEGORY_INFO: readonly CategoryInfo[] = categoryInfo();

export function isCorrectionCategory(value: string): value is CorrectionCategory {
  return (CORRECTION_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(value: CorrectionCategory, copy: Dict["report"] = en.report): string {
  return copy.categories[value]?.label ?? value;
}

/** Categories that fit the entity being reported; without an entity every category is offered. */
export function categoriesFor(entityType: EntityType | null, copy: Dict["report"] = en.report): readonly CategoryInfo[] {
  const all = categoryInfo(copy);
  if (!entityType) return all;
  return all.filter((c) => !c.appliesTo || c.appliesTo.includes(entityType));
}
