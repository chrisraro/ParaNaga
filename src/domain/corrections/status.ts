// Correction lifecycle (spec 04 §4.6, task B6): draft -> submitted -> under_review ->
// accepted | rejected | duplicate -> incorporated. Reviewers move it along through definer
// functions; the submitter never does. Nothing here touches published transit data: accepted
// only becomes incorporated through a validated publication (AC-13).
import { en, type Dict } from "@/i18n/dict";

export const CORRECTION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "needs_evidence",
  "accepted",
  "rejected",
  "duplicate",
  "incorporated",
  "superseded",
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const TRANSITIONS: Readonly<Record<CorrectionStatus, readonly CorrectionStatus[]>> = {
  draft: ["submitted"],
  submitted: ["under_review", "needs_evidence", "duplicate", "rejected"],
  under_review: ["accepted", "rejected", "duplicate", "needs_evidence"],
  // A reviewer resumes (under_review) or closes it; migration 0025 mirrors this.
  needs_evidence: ["submitted", "under_review", "rejected", "duplicate"],
  accepted: ["incorporated", "superseded"],
  rejected: [],
  duplicate: [],
  incorporated: [],
  superseded: [],
};

export function canTransition(from: CorrectionStatus, to: CorrectionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: CorrectionStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function statusLabel(status: CorrectionStatus, copy: Dict["report"] = en.report): string {
  return copy.statuses[status];
}
