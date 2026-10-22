// Templated reasons a transport reviewer gives the reporter (N6, C9). The reporter sees the code
// worded in their language on My reports; the reviewer's own note never leaves the console. The
// database function community.admin_review_correction (migration 0025) accepts exactly these.
import { en, type Dict } from "@/i18n/dict";

export const INFO_REASONS = ["need_photo", "need_location", "need_details", "need_time"] as const;
export const REJECT_REASONS = ["already_correct", "not_verifiable", "out_of_scope", "not_transport"] as const;
export const REVIEW_REASONS = [...INFO_REASONS, ...REJECT_REASONS] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export function isReviewReason(value: unknown): value is ReviewReason {
  return typeof value === "string" && (REVIEW_REASONS as readonly string[]).includes(value);
}

/** What the reporter reads for a reviewer's reason code. */
export function reviewReasonText(code: ReviewReason, copy: Dict["report"] = en.report): string {
  return copy.reviewReasons[code];
}
