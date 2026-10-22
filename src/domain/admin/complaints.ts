// A17 Complaint review (N7, C11): the shapes shared by /api/v1/admin/complaints and the browser,
// and what each status lets a reviewer do. Pure and browser-safe (zod only). The database repeats
// every rule (migration 0018 priv.set_complaint_status, 0026 priv.review_* and legal hold): the
// complaint_reviewer role only, a fresh step-up, never the reviewer's own report, the transitions,
// an outcome code exactly when closing, and an audit row for every read and change.
import { z } from "zod";
import { COMPLAINT_CATEGORIES } from "@/domain/complaints/categories";
import { COMPLAINT_QUEUES, COMPLAINT_STATUSES, type ComplaintStatus } from "@/domain/complaints/status";

export const COMPLAINT_SCOPES = ["open", "closed"] as const;
export type ComplaintScope = (typeof COMPLAINT_SCOPES)[number];

export const OUTCOME_CODES = ["info_provided_to_reporter", "insufficient_detail", "duplicate", "outside_scope", "reporter_withdrew"] as const;
export type OutcomeCode = (typeof OUTCOME_CODES)[number];

/** Neutral wording: an outcome is never a finding about the driver. */
export const OUTCOME_LABELS: Readonly<Record<OutcomeCode, string>> = {
  info_provided_to_reporter: "Information given to the reporter",
  insufficient_detail: "Not enough detail to act on",
  duplicate: "Duplicate of another report",
  outside_scope: "Outside what ParaNaga handles",
  reporter_withdrew: "The reporter withdrew it",
};

export const STATUS_LABELS: Readonly<Record<ComplaintStatus, string>> = {
  submitted: "Submitted",
  under_review: "Under review",
  needs_information: "Needs information",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

export const QUEUE_LABELS: Readonly<Record<(typeof COMPLAINT_QUEUES)[number], string>> = {
  queue_priority: "Priority",
  queue_normal: "Normal",
  queue_check_completeness: "Check completeness",
};

export const CATEGORY_LABELS: Readonly<Record<(typeof COMPLAINT_CATEGORIES)[number], string>> = {
  overcharging: "Overcharging",
  reckless_driving: "Reckless driving",
  discount_refused: "Discount refused",
  harassment: "Harassment",
  improper_loading: "Improper loading or unloading",
  other: "Other",
};

/** Mirrors the transition list in priv.set_complaint_status (0018). 'withdrawn' is the reporter's. */
const NEXT: Readonly<Partial<Record<ComplaintStatus, readonly ComplaintStatus[]>>> = {
  submitted: ["under_review", "closed"],
  under_review: ["needs_information", "closed"],
  needs_information: ["under_review", "closed"],
};

export function nextStatuses(status: ComplaintStatus): readonly ComplaintStatus[] {
  return NEXT[status] ?? [];
}

const uuid = z.uuid();
const ts = z.string().min(1);

export const complaintListItemSchema = z.object({
  id: uuid,
  publicRef: z.string(),
  category: z.enum(COMPLAINT_CATEGORIES),
  status: z.enum(COMPLAINT_STATUSES),
  queue: z.enum(COMPLAINT_QUEUES),
  submittedAt: ts,
  incidentAt: ts,
  updatedAt: ts,
  closedAt: ts.nullable(),
  outcomeCode: z.enum(OUTCOME_CODES).nullable(),
  legalHold: z.boolean(),
  evidenceCount: z.number().int().nonnegative(),
});
export type ComplaintListItem = z.infer<typeof complaintListItemSchema>;

export const complaintListSchema = z.object({ scope: z.enum(COMPLAINT_SCOPES), complaints: z.array(complaintListItemSchema) });
export type ComplaintList = z.infer<typeof complaintListSchema>;

export const complaintEvidenceSchema = z.object({
  id: uuid,
  captureKind: z.enum(["in_app_camera", "file_upload"]),
  capturedAt: ts.nullable(),
  receivedAt: ts,
  mime: z.string().nullable(),
  bytes: z.number().nullable(),
  sha256: z.string(),
  available: z.boolean(),
});

export const complaintDetailSchema = z.object({
  id: uuid,
  publicRef: z.string(),
  category: z.enum(COMPLAINT_CATEGORIES),
  description: z.string(),
  incidentAt: ts,
  status: z.enum(COMPLAINT_STATUSES),
  outcomeCode: z.enum(OUTCOME_CODES).nullable(),
  queue: z.enum(COMPLAINT_QUEUES),
  legalHold: z.boolean(),
  retentionUntil: ts.nullable(),
  submittedAt: ts,
  closedAt: ts.nullable(),
  operator: z.string().nullable(),
  plate: z.string().nullable(),
  bodyNumber: z.string().nullable(),
  location: z.object({
    source: z.enum(["gps", "manual", "none"]),
    text: z.string().nullable(),
    accuracyM: z.number().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  }),
  evidence: z.array(complaintEvidenceSchema),
  events: z.array(
    z.object({
      from: z.string().nullable(),
      to: z.string(),
      actorRole: z.enum(["reporter", "complaint_reviewer", "system"]),
      mine: z.boolean(),
      visibility: z.enum(["reporter", "reviewer_only"]),
      outcomeCode: z.string().nullable(),
      note: z.string().nullable(),
      at: ts,
    }),
  ),
  access: z.array(z.object({ accessorRole: z.enum(["reporter", "complaint_reviewer"]), mine: z.boolean(), purpose: z.string(), issuedAt: ts })),
});
export type ComplaintDetail = z.infer<typeof complaintDetailSchema>;

const note = z.string().trim().max(1000, "A note is at most 1000 characters.");

/** POST /api/v1/admin/complaints/:id: a status change, or the legal hold. */
export const complaintActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("status"),
      to: z.enum(["under_review", "needs_information", "closed"]),
      outcomeCode: z.enum(OUTCOME_CODES).optional(),
      note: note.optional(),
      // Who sees the note: the reporter (on My reports) or reviewers only.
      visibility: z.enum(["reporter", "reviewer_only"]).default("reviewer_only"),
    })
    .strict()
    .refine((v) => (v.to === "closed") === (v.outcomeCode !== undefined), { message: "Choose an outcome to close, and only to close." }),
  z.object({ action: z.literal("legal_hold"), hold: z.boolean(), note: note.min(3, "Say why (at least 3 characters).") }).strict(),
]);
export type ComplaintAction = z.input<typeof complaintActionSchema>;

export const complaintActionResultSchema = z.object({ ok: z.literal(true) });

export const EVIDENCE_LINK_TTL_S = 60;
export const evidenceLinkSchema = z.object({ url: z.url(), expiresInSeconds: z.literal(EVIDENCE_LINK_TTL_S) });
export type EvidenceLink = z.infer<typeof evidenceLinkSchema>;
