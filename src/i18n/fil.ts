// Filipino (ADR 011). `: Dict` makes a missing or extra key a type error. Everyday street words
// ("jeep", "tricycle"; owner decision 2026-10-22). Strings identical to English must be listed in
// SAME_AS_EN (tests/unit/i18n-guards.test.ts).
import type { Dict } from "./dict";
import { en } from "./en";

export const fil: Dict = {
  app: { name: "ParaNaga", tagline: "Alamin ang sasakyan mo. Hanapin ang daan mo." },
  // TODO(i18n T13): the acknowledgments need a verbatim-reviewed translation; English until then.
  acknowledgments: {
    community:
      "Keep this about commuting in Naga. Share accurate, respectful information. Do not post spam, threats, harassment or private personal details. Jev checks submissions before publication; uncertain cases go to a moderator. Data corrections require a separate evidence review.",
    driverReport:
      "Describe what you observed accurately and submit evidence you are entitled to share. Your complaint is private within ParaNaga, and ParaNaga does not send it to Naga City. You can choose to continue reporting in MyNaga after reviewing your report.",
  },
  // TODO(i18n T9): pending draft + Jev check; English until then (every key is in PENDING_T9 in the guard test).
  guidance: en.guidance,
};
