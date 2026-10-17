// Report a driver (S18, F-D4, task B8): what happened. Plain, neutral wording: the report
// describes what the commuter saw; ParaNaga never decides who is at fault.

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

export const COMPLAINT_CATEGORY_INFO: readonly ComplaintCategoryInfo[] = [
  { value: "overcharging", label: "Overcharging", hint: "Asked for more than the posted or usual fare." },
  { value: "reckless_driving", label: "Reckless driving", hint: "Driving in a way that felt unsafe." },
  { value: "discount_refused", label: "Discount refused", hint: "A student, senior, PWD or solo parent discount was not given." },
  { value: "harassment", label: "Harassment", hint: "Unwelcome words, gestures or contact." },
  { value: "improper_loading", label: "Improper loading or unloading", hint: "Picking up or dropping off where it is not safe or allowed." },
  { value: "other", label: "Something else", hint: "Anything that does not fit above." },
];

export function isComplaintCategory(value: string | null | undefined): value is ComplaintCategory {
  return (COMPLAINT_CATEGORIES as readonly string[]).includes(value ?? "");
}

export function complaintCategoryLabel(value: ComplaintCategory): string {
  return COMPLAINT_CATEGORY_INFO.find((c) => c.value === value)?.label ?? value;
}
