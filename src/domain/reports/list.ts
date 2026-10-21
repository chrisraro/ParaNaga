import { complaintCategoryLabel, type ComplaintCategory } from "@/domain/complaints/categories";
import { complaintStatusLabel, type ComplaintStatus } from "@/domain/complaints/status";
import { categoryLabel, type CorrectionCategory } from "@/domain/corrections/categories";
import { statusLabel, type CorrectionStatus } from "@/domain/corrections/status";
import { DEFAULT_LOCALE, formatLocale, type Locale } from "@/i18n/locales";

// One list for S19 My reports: the caller's corrections (B6) and driver reports (B8), newest
// first. Pure. No report text goes through here: a list row has a reference or kind label, a
// category, a date and a status, nothing the person wrote.

export type ReportRowKind = "correction" | "complaint";

/** Chip tone: how settled the status is. Colour is never the only signal (the label says it). */
export type StatusTone = "open" | "waiting" | "done" | "closed";

export type ReportRow = {
  kind: ReportRowKind;
  id: string;
  /** PN-XXXX-XX for a driver report; corrections have no reference. */
  reference: string | null;
  kindLabel: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  tone: StatusTone;
  at: string;
  href: string;
};

type CorrectionIn = { id: string; category: CorrectionCategory; status: CorrectionStatus; submittedAt: string };
type ComplaintIn = { id: string; reference: string; category: ComplaintCategory; status: ComplaintStatus; submittedAt: string };

const CORRECTION_TONE: Record<CorrectionStatus, StatusTone> = {
  draft: "waiting",
  submitted: "open",
  under_review: "open",
  needs_evidence: "waiting",
  accepted: "done",
  rejected: "closed",
  duplicate: "closed",
  incorporated: "done",
  superseded: "closed",
};
const COMPLAINT_TONE: Record<ComplaintStatus, StatusTone> = {
  submitted: "open",
  under_review: "open",
  needs_information: "waiting",
  closed: "closed",
  withdrawn: "closed",
};

export const correctionTone = (s: CorrectionStatus): StatusTone => CORRECTION_TONE[s];
export const complaintTone = (s: ComplaintStatus): StatusTone => COMPLAINT_TONE[s];

export function mergeReports(corrections: readonly CorrectionIn[], complaints: readonly ComplaintIn[]): ReportRow[] {
  const rows: ReportRow[] = [
    ...corrections.map(
      (c): ReportRow => ({
        kind: "correction",
        id: c.id,
        reference: null,
        kindLabel: "Correction",
        categoryLabel: categoryLabel(c.category),
        status: c.status,
        statusLabel: statusLabel(c.status),
        tone: correctionTone(c.status),
        at: c.submittedAt,
        href: `/app/reports/correction/${c.id}`,
      }),
    ),
    ...complaints.map(
      (c): ReportRow => ({
        kind: "complaint",
        id: c.id,
        reference: c.reference,
        kindLabel: "Driver report",
        categoryLabel: complaintCategoryLabel(c.category),
        status: c.status,
        statusLabel: complaintStatusLabel(c.status),
        tone: complaintTone(c.status),
        at: c.submittedAt,
        href: `/app/reports/complaint/${c.id}`,
      }),
    ),
  ];
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Neutral wording for a closed driver report; never a finding about the driver. */
export const OUTCOME_LABELS: Record<string, string> = {
  info_provided_to_reporter: "Information was sent to you",
  insufficient_detail: "Not enough detail to follow up",
  duplicate: "Already reported",
  outside_scope: "Outside what ParaNaga can review",
  reporter_withdrew: "You withdrew it",
};
export const outcomeLabel = (code: string | null): string | null => (code ? (OUTCOME_LABELS[code] ?? null) : null);

export const manilaDate = (iso: string, locale: Locale = DEFAULT_LOCALE): string => {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleString(formatLocale(locale), { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "";
};
export const manilaDay = (iso: string, locale: Locale = DEFAULT_LOCALE): string => {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString(formatLocale(locale), { timeZone: "Asia/Manila", dateStyle: "medium" }) : "";
};
