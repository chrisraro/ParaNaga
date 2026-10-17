// AI-processing disclosure shown before the first submission (spec 05 §5.8). Accepting it is
// recorded in core.ack (kind 'ai_processing_disclosure'); bump the version when the text changes.

export const AI_DISCLOSURE_KIND = "ai_processing_disclosure" as const;
export const AI_DISCLOSURE_VERSION = "2026-10-v1";

export const AI_DISCLOSURE_TITLE = "How your report is checked";
export const AI_DISCLOSURE_POINTS = [
  "The text you write is sent to an AI service called Jev to help sort reports before a person reads them. That service may process text outside the Philippines.",
  "Emails, phone numbers and plate-like codes are hidden before sending. Photos are never sent.",
  "A person makes the final decision. Your report does not change the map or any route until it has been reviewed.",
] as const;
export const AI_DISCLOSURE_CHECKBOX = "I understand how my report is checked.";
