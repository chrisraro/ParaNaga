// Fixed copy for the private driver report (S18). The acknowledgment itself is the brief §9D
// text in src/i18n/en.ts (acknowledgments.driverReport); accepting it is recorded in
// core.ack (kind 'driver_report_notice'). Bump the version when that text changes.

import { en } from "@/i18n/dict";

export const DRIVER_NOTICE_KIND = "driver_report_notice" as const;
export const DRIVER_NOTICE_VERSION = "2026-10-v1";

// The explainer and receipt text are in the dictionary (driverReport.explainer, .sharedPhone, .nextSteps).
export const EXPLAINER_POINTS = Object.values(en.driverReport.explainer);

export const SHARED_PHONE_NOTE = en.driverReport.sharedPhone;

export const RECEIPT_NEXT_STEPS = Object.values(en.driverReport.nextSteps);
