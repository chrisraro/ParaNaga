// What the author sees for a version or comment. Pending is shown honestly as "Awaiting review";
// nothing here ever says a post is visible before a person (or a confident auto-publish) cleared it.

export const CONTENT_STATES = ["published", "pending", "rejected"] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

/** Collapses the stored moderation_status into what a person needs to know. */
export function contentState(moderationStatus: string): ContentState {
  if (moderationStatus === "published") return "published";
  if (moderationStatus === "rejected") return "rejected";
  return "pending"; // pending, human_review
}

export function stateLabel(state: ContentState): string {
  if (state === "published") return "Published";
  if (state === "rejected") return "Not published";
  return "Awaiting review";
}

export function stateHint(state: ContentState, kind: "post" | "comment" | "edit"): string {
  if (state === "published") return kind === "edit" ? "Your edit is visible to everyone." : "It is visible to everyone.";
  if (state === "rejected") return "It did not meet the community guidelines, so others cannot see it.";
  if (kind === "edit") return "Only you can see this edit. The earlier version stays visible until it is approved.";
  return "Only you can see it until a person has reviewed it.";
}
