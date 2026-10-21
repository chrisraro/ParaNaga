// English: the source of truth for every UI string (ADR 011). Other locales are typed against it
// (src/i18n/dict.ts). Fixed texts from the brief are stored verbatim (spec §6.5).
export const en = {
  app: { name: "ParaNaga", tagline: "Know your ride. Find your way." },
  acknowledgments: {
    community:
      "Keep this about commuting in Naga. Share accurate, respectful information. Do not post spam, threats, harassment or private personal details. Jev checks submissions before publication; uncertain cases go to a moderator. Data corrections require a separate evidence review.",
    driverReport:
      "Describe what you observed accurately and submit evidence you are entitled to share. Your complaint is private within ParaNaga, and ParaNaga does not send it to Naga City. You can choose to continue reporting in MyNaga after reviewing your report.",
  },
} as const;
