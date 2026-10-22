// Community guidelines acknowledgement (brief 9B). Accepting it is recorded in core.ack (kind
// 'community_guidelines') with this version; bump the version when the text changes.

import { en } from "@/i18n/dict";

export const GUIDELINES_KIND = "community_guidelines" as const;
export const GUIDELINES_VERSION = "2026-10-v1";

// The text is in the dictionary: the guidelines themselves are acknowledgments.community (English
// in every language until a verbatim-reviewed translation), the rest community.*.
export const GUIDELINES_TITLE = en.community.guidelinesTitle;
export const GUIDELINES_TEXT = en.acknowledgments.community;
export const GUIDELINES_CHECKBOX = en.community.guidelinesCheckbox;

/** Shown with community posts and comments: tips are not verified fares, routes or stops. */
export const UNVERIFIED_NOTICE = en.community.unverifiedNotice;
/** Where a driver problem belongs: never a public post. */
export const DRIVER_NOTICE = en.community.driverNotice;
