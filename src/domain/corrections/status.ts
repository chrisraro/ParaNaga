// Correction lifecycle (spec 04 §4.6, task B6): draft -> submitted -> under_review ->
// accepted | rejected | duplicate -> incorporated. Reviewers move it along through definer
// functions; the submitter never does. 'superseded' is a known status that nothing in the app
// sets (only the unused legacy community.set_correction_status, 0016, can). Nothing here touches published transit data: accepted
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

/**
 * What a reviewer may do: exactly the (from, to) list in community.admin_review_correction
 * (migration 0025), which is what the database enforces. A unit test reads that SQL and compares.
 * The order within a row is the order the admin screen offers the actions in (first = default).
 */
export const TRANSITIONS: Readonly<Record<CorrectionStatus, readonly CorrectionStatus[]>> = {
  draft: [],
  submitted: ["under_review", "needs_evidence", "rejected", "duplicate"],
  under_review: ["accepted", "needs_evidence", "rejected", "duplicate"],
  needs_evidence: ["under_review", "rejected", "duplicate"],
  accepted: [],
  rejected: [],
  duplicate: [],
  incorporated: [],
  superseded: [],
};

/**
 * Moves no reviewer makes: the commuter's submission (community.submit_correction, 0016) and the
 * publication trigger (community.incorporate_corrections, 0025).
 */
export const SYSTEM_TRANSITIONS: readonly (readonly [CorrectionStatus, CorrectionStatus])[] = [
  ["draft", "submitted"],
  ["accepted", "incorporated"],
];

/** The whole lifecycle: reviewer and system moves. */
export function canTransition(from: CorrectionStatus, to: CorrectionStatus): boolean {
  return TRANSITIONS[from].includes(to) || SYSTEM_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function isTerminal(status: CorrectionStatus): boolean {
  return TRANSITIONS[status].length === 0 && !SYSTEM_TRANSITIONS.some(([f]) => f === status);
}

export function statusLabel(status: CorrectionStatus, copy: Dict["report"] = en.report): string {
  return copy.statuses[status];
}
