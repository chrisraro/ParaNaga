// i18n skeleton. Locale routing (/[locale]) and next-intl arrive with the first
// commuter screens (increment 1); reviewed Bikol (bcl) stays behind a flag.

export const LOCALES = ["en", "fil"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// Fixed texts from the brief are stored verbatim in English (spec §6.5).
// Filipino strings must be reviewed by a fluent speaker before launch.
const en = {
  app: { name: "ParaNaga", tagline: "Know your ride. Find your way." },
  acknowledgments: {
    community:
      "Keep this about commuting in Naga. Share accurate, respectful information. Do not post spam, threats, harassment or private personal details. Jev checks submissions before publication; uncertain cases go to a moderator. Data corrections require a separate evidence review.",
    driverReport:
      "Describe what you observed accurately and submit evidence you are entitled to share. Your complaint is private within ParaNaga, and ParaNaga does not send it to Naga City. You can choose to continue reporting in MyNaga after reviewing your report.",
  },
} as const;

type Messages = { [K in keyof typeof en]: { [P in keyof (typeof en)[K]]: string } };

const fil: Messages = {
  app: { name: "ParaNaga", tagline: "Alamin ang sasakyan mo. Hanapin ang daan mo." },
  // TODO(i18n review): Filipino acknowledgments need a reviewed translation; English shown until then.
  acknowledgments: en.acknowledgments,
};

export const messages: Record<Locale, Messages> = { en, fil };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
