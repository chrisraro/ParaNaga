// Driver report lifecycle (spec 04 §4.7): draft -> submitted -> under_review <-> needs_information
// -> closed; draft | submitted | needs_information -> withdrawn. Drafts live only on the phone, so
// the server stores reports from 'submitted' on. Outcomes are neutral: never a finding of guilt.
import { en, type Dict } from "@/i18n/dict";

export const COMPLAINT_STATUSES = ["submitted", "under_review", "needs_information", "closed", "withdrawn"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = en.driverReport.statuses;

export function complaintStatusLabel(status: ComplaintStatus, copy: Dict["driverReport"] = en.driverReport): string {
  return copy.statuses[status];
}

/** Review queues (spec 03 §3.8): decided by fixed rules only, never by an AI model. */
export const COMPLAINT_QUEUES = ["queue_normal", "queue_priority", "queue_check_completeness"] as const;
export type ComplaintQueue = (typeof COMPLAINT_QUEUES)[number];

// A reviewed keyword list (en, fil, bcl). Matching raises priority only; it never rejects.
const PRIORITY_WORDS = [
  "injured", "injury", "hurt", "bleeding", "hospital", "weapon", "knife", "gun", "threat", "threatened",
  "hit me", "punched", "slapped", "sinaktan", "saktan", "sinuntok", "sinampal", "kutsilyo", "baril",
  "binantaan", "nasugatan", "dugo", "hinipuan", "minolestiya",
];

export type RoutingInput = {
  category: string;
  description: string;
  evidenceCount: number;
  hasVehicleId: boolean;
};

/**
 * Deterministic first routing. Harassment or any priority word goes to the priority queue;
 * a report with no evidence and no plate or body number goes to the completeness check;
 * everything else to the normal queue.
 */
export function routeComplaint(input: RoutingInput): ComplaintQueue {
  const text = input.description.toLowerCase();
  if (input.category === "harassment" || PRIORITY_WORDS.some((w) => text.includes(w))) return "queue_priority";
  if (input.evidenceCount === 0 && !input.hasVehicleId) return "queue_check_completeness";
  return "queue_normal";
}
