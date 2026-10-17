import { complaintCategoryLabel } from "@/domain/complaints/categories";
import { manilaDate } from "@/domain/reports/list";
import type { ComplaintDetail } from "@/domain/reports/schemas";

// The plain-text summary the reporter pastes into the official MyNaga app (S20, F-D5). Built in
// the browser from the reporter's own report; nothing is sent anywhere. Pure.
// Not included: the reporter's identity, exact GPS coordinates, evidence links or storage keys.

export const EVIDENCE_NOTE = "Photo or video evidence is available from the reporter.";

export function buildMyNagaSummary(c: ComplaintDetail): string {
  const lines = [
    "Report about a public transport driver",
    `Category: ${complaintCategoryLabel(c.category)}`,
    `When it happened: ${manilaDate(c.incidentAt)} (Philippine time)`,
  ];
  if (c.locationText) lines.push(`Where: ${c.locationText}`);
  if (c.operator) lines.push(`Operator: ${c.operator}`);
  if (c.plate) lines.push(`Plate number: ${c.plate}`);
  if (c.bodyNumber) lines.push(`Body number: ${c.bodyNumber}`);
  lines.push(`What happened: ${c.description.trim()}`);
  if (c.evidence.length > 0) lines.push(EVIDENCE_NOTE);
  lines.push(`ParaNaga reference (for my own records): ${c.reference}`);
  return lines.join("\n");
}
