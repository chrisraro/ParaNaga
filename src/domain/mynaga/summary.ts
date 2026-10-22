import { complaintCategoryLabel } from "@/domain/complaints/categories";
import { manilaDate } from "@/domain/reports/list";
import type { ComplaintDetail } from "@/domain/reports/schemas";
import { en, type Dict } from "@/i18n/dict";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

// The plain-text summary the reporter pastes into the official MyNaga app (S20, F-D5). Built in
// the browser from the reporter's own report; nothing is sent anywhere. Pure.
// Not included: the reporter's identity, exact GPS coordinates, evidence links or storage keys.

export const EVIDENCE_NOTE = en.mynaga.summary.evidence;

/** In the reporter's UI language (`copy`, `locale`); English by default. */
export function buildMyNagaSummary(c: ComplaintDetail, copy: Dict = en, locale: Locale = DEFAULT_LOCALE): string {
  const s = copy.mynaga.summary;
  const lines = [
    s.heading,
    s.category(complaintCategoryLabel(c.category, copy.driverReport)),
    s.when(manilaDate(c.incidentAt, locale)),
  ];
  if (c.locationText) lines.push(s.where(c.locationText));
  if (c.operator) lines.push(s.operator(c.operator));
  if (c.plate) lines.push(s.plate(c.plate));
  if (c.bodyNumber) lines.push(s.body(c.bodyNumber));
  lines.push(s.what(c.description.trim()));
  if (c.evidence.length > 0) lines.push(s.evidence);
  lines.push(s.reference(c.reference));
  return lines.join("\n");
}
