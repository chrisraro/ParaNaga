// Correction lifecycle (spec 04 §4.6, task B6): draft -> submitted -> under_review ->
// accepted | rejected | duplicate -> incorporated. Reviewers move it along through definer
// functions; the submitter never does. Nothing here touches published transit data: accepted
// only becomes incorporated through a validated publication (AC-13).

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
  needs_evidence: ["submitted"],
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

const STATUS_LABELS: Record<CorrectionStatus, string> = {
  draft: "Draft",
  submitted: "Received",
  under_review: "Being reviewed",
  needs_evidence: "Needs more detail",
  accepted: "Accepted",
  rejected: "Not accepted",
  duplicate: "Already reported",
  incorporated: "Added to the data",
  superseded: "Replaced by newer data",
};

export function statusLabel(status: CorrectionStatus): string {
  return STATUS_LABELS[status];
}
