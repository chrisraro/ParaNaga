// Report a driver (S18, F-D4, task B8): what happened. Plain, neutral wording: the report
// describes what the commuter saw; ParaNaga never decides who is at fault.
// The words live in the dictionary (driverReport.categories); English by default.
import { en, type Dict } from "@/i18n/dict";

export const COMPLAINT_CATEGORIES = [
  "overcharging",
  "reckless_driving",
  "discount_refused",
  "harassment",
  "improper_loading",
  "other",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export type ComplaintCategoryInfo = { value: ComplaintCategory; label: string; hint: string };

/** The categories in display order, worded in `copy`'s language. */
export function complaintCategoryInfo(copy: Dict["driverReport"] = en.driverReport): readonly ComplaintCategoryInfo[] {
  return COMPLAINT_CATEGORIES.map((value) => ({ value, ...copy.categories[value] }));
}

export const COMPLAINT_CATEGORY_INFO: readonly ComplaintCategoryInfo[] = complaintCategoryInfo();

export function isComplaintCategory(value: string | null | undefined): value is ComplaintCategory {
  return (COMPLAINT_CATEGORIES as readonly string[]).includes(value ?? "");
}

export function complaintCategoryLabel(value: ComplaintCategory, copy: Dict["driverReport"] = en.driverReport): string {
  return copy.categories[value]?.label ?? value;
}
