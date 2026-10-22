// What the author sees for a version or comment. Pending is shown honestly as "Awaiting review";
// nothing here ever says a post is visible before a person (or a confident auto-publish) cleared it.
import { en, type Dict } from "@/i18n/dict";

export const CONTENT_STATES = ["published", "pending", "rejected"] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

/** Collapses the stored moderation_status into what a person needs to know. */
export function contentState(moderationStatus: string): ContentState {
  if (moderationStatus === "published") return "published";
  if (moderationStatus === "rejected") return "rejected";
  return "pending"; // pending, human_review
}

export function stateLabel(state: ContentState, copy: Dict["community"] = en.community): string {
  return copy.states[state];
}

export function stateHint(state: ContentState, kind: "post" | "comment" | "edit", copy: Dict["community"] = en.community): string {
  const h = copy.stateHints;
  if (state === "published") return kind === "edit" ? h.editPublished : h.published;
  if (state === "rejected") return h.rejected;
  if (kind === "edit") return h.editPending;
  return h.pending;
}
