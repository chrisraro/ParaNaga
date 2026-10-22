// AI-processing disclosure shown before the first submission (spec 05 §5.8). Accepting it is
// recorded in core.ack (kind 'ai_processing_disclosure'); bump the version when the text changes.

import { en } from "@/i18n/dict";

export const AI_DISCLOSURE_KIND = "ai_processing_disclosure" as const;
export const AI_DISCLOSURE_VERSION = "2026-10-v1";

// The text is in the dictionary (report.disclosure; Filipino keeps the same meaning, flagged for review).
export const AI_DISCLOSURE_TITLE = en.report.disclosure.title;
export const AI_DISCLOSURE_POINTS = Object.values(en.report.disclosure.points);
export const AI_DISCLOSURE_CHECKBOX = en.report.disclosure.checkbox;
