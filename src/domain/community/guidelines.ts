// Community guidelines acknowledgement (brief 9B). Accepting it is recorded in core.ack (kind
// 'community_guidelines') with this version; bump the version when the text changes.

export const GUIDELINES_KIND = "community_guidelines" as const;
export const GUIDELINES_VERSION = "2026-10-v1";

export const GUIDELINES_TITLE = "Community guidelines";
export const GUIDELINES_TEXT =
  "Keep this about commuting in Naga. Share accurate, respectful information. Do not post spam, threats, harassment or private personal details. Jev checks submissions before publication; uncertain cases go to a moderator. Data corrections require a separate evidence review.";
export const GUIDELINES_CHECKBOX = "I have read the community guidelines.";

/** Shown with community posts and comments: tips are not verified fares, routes or stops. */
export const UNVERIFIED_NOTICE = "Written by other commuters. Not verified by ParaNaga.";
/** Where a driver problem belongs: never a public post. */
export const DRIVER_NOTICE = "Do not name or describe a driver here. Driver reports are private.";
