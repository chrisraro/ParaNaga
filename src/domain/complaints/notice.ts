// Fixed copy for the private driver report (S18). The acknowledgment itself is the brief §9D
// text in src/i18n/messages.ts (acknowledgments.driverReport); accepting it is recorded in
// core.ack (kind 'driver_report_notice'). Bump the version when that text changes.

export const DRIVER_NOTICE_KIND = "driver_report_notice" as const;
export const DRIVER_NOTICE_VERSION = "2026-10-v1";

export const EXPLAINER_POINTS = [
  "Your report stays private inside ParaNaga. It is never posted in Community and never shown to other commuters.",
  "It is not sent to Naga City or any agency automatically. After you send it, you can choose to continue in MyNaga yourself.",
  "A ParaNaga reviewer reads it. Photos and videos are kept in private storage and shown only to you and that reviewer.",
  "Stick to what you saw. Avoid filming faces of other passengers where you can.",
] as const;

export const SHARED_PHONE_NOTE = "Nothing is saved on this phone. If you leave this screen before sending, your answers and photos are cleared.";

export const RECEIPT_NEXT_STEPS = [
  "A reviewer checks that the report is complete. You may be asked for more information.",
  "ParaNaga does not decide who is at fault and does not contact the driver.",
  "To make an official complaint, continue in MyNaga. Opening MyNaga does not submit your report.",
] as const;
